/**
 * Backend en memoria de la vista previa · slice `admin` · liquidaciones, documentos legales y atención al cliente
 * (SIMULACIÓN, solo con `EXPO_PUBLIC_PREVIEW=1`). Espejo de los endpoints de `docs/contracts/trust.md` §4.3–§4.4 y
 * `docs/contracts/money.md` §8.6:
 *
 *   money   GET|POST /v1/admin/payout-runs · POST …/{payoutId}/execute      (finance_admin | admin · Idempotency-Key)
 *   legal   GET|POST /v1/admin/legal/documents · POST …/{documentId}/publish (admin · exige referencia de revisión legal)
 *   soporte GET /v1/admin/support/tickets[/{id}] · POST …/reply|assign|close · POST /attachments/{id}/access (admin | support)
 *
 * Reglas que se reproducen tal cual:
 *  - NADA pasa a `paid` sin la confirmación del proveedor: con el proveedor desactivado pedir el abono es
 *    `409 PAYMENTS_PROVIDER_DISABLED` y no se envía nada; con uno activo (SIMULADO) la liquidación pasa a `processing` y,
 *    pasados unos segundos del reloj virtual, el proveedor confirma (o rechaza) igual que lo haría el evento `payout.paid`;
 *  - publicar un texto legal exige la referencia de la revisión legal; sin ella no hay publicación;
 *  - abrir un adjunto de soporte audita ANTES de entregar la URL firmada de vida corta, y nunca los propios.
 */
import type {
  AdminLegalDocumentCreate,
  AdminLegalPublishRequest,
  AdminPayoutRun,
  AdminSupportAssignRequest,
  AdminSupportAttachment,
  AdminSupportAttachmentAccess,
  AdminSupportMessage,
  AdminSupportReplyRequest,
  AdminSupportTicketCategory,
  AdminSupportTicketDetail,
  AdminSupportTicketRow,
  AdminSupportTicketStatus,
  AdminSupportTicketsPage,
  GeneratePayoutRunsResponse,
  LegalDocument,
  LegalDocumentKind,
  LegalDocumentSummary,
  LegalSection,
  PayoutStatus,
} from "@/api/types";
import { moneyTables, writeConfig, type EarningRow, type PayoutRow } from "@/features/account/preview/moneyRows";
import { monthBounds, payoutViewDto } from "@/features/account/preview/moneyViews";
import {
  attachmentsTable,
  ticketMessagesTable,
  ticketsTable,
  type AttachmentRow,
  type TicketCategory,
  type TicketRow,
} from "@/features/account/preview/helpStore";
import { trustTables, type LegalDocumentRow } from "@/features/auth/preview/trustStore";
import {
  fail,
  madridParts,
  publicUser,
  registerSeedRef,
  reply,
  sha256Hex,
  signedUrl,
  stableUuid,
  uuidParam,
  SEED_USER_IDS,
  STORAGE_PROVIDER_NAME,
  type JsonSchema,
  type PreviewDb,
  type PreviewProfileId,
  type PreviewRouter,
} from "@/preview";
import { auditAdmin } from "./opsWorld/audit";
import { iso, isoOrNull, queryOf, sliceOf } from "./opsWorld/common";
import { authorizeAdmin, authorizeFinance } from "./opsWorld/rbac";
import { providerEnabled, SETTING_PROVIDER_OUTCOME } from "./reviewWorld/store";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Segundos (del reloj virtual) que tarda el proveedor SIMULADO en confirmar o rechazar un abono. */
export const PAYOUT_PROVIDER_DELAY_MS = 20_000;
export const SETTING_SUPPORT_UNAVAILABLE = "admin.support.unavailable";
export const SETTING_SUPPORT_STORAGE_OFF = "admin.support.storageOff";
export const SUPPORT_ATTACHMENT_TTL_SECONDS = 120;

export const backofficeSeedVariants: Readonly<Record<string, string>> = {
  "admin-payouts-ready": "Liquidaciones: dos personas conductoras con saldo disponible y cuenta de cobro, sin ninguna liquidación generada.",
  "admin-payouts-empty": "Liquidaciones: sin ninguna liquidación ni saldo disponible.",
  "admin-payouts-many": "Liquidaciones: veinticinco liquidaciones para probar «Ver más».",
  "admin-payouts-no-account": "Liquidaciones: una liquidación sin cuenta de cobro (el abono se bloquea).",
  "admin-legal-published": "Documentos legales: Términos y Privacidad ya publicados y un borrador nuevo de Términos.",
  "admin-support-empty": "Atención al cliente: sin ninguna consulta.",
  "admin-support-many": "Atención al cliente: treinta consultas para probar «Ver más».",
  "admin-support-off": "Atención al cliente: el centro de ayuda aún no está disponible en el entorno.",
  "admin-support-storage-off": "Atención al cliente: almacenamiento privado desactivado, los adjuntos no se pueden abrir.",
};

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Liquidaciones
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface PayoutMetaRow {
  id: string;
  provider_confirms_at: number | null;
}

const payoutMeta = (db: PreviewDb) => db.collection<PayoutMetaRow>("admin_payout_meta");

const PERIOD_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const PAYOUT_STATUSES: readonly PayoutStatus[] = ["draft", "processing", "paid", "failed", "cancelled"];

function payoutRunDto(db: PreviewDb, row: Readonly<PayoutRow>): AdminPayoutRun {
  return { ...payoutViewDto(row), driver: publicUser(db, row.user_id) };
}

/** El proveedor SIMULADO confirma (o rechaza) los abonos pedidos cuando vence su plazo en el reloj virtual. */
export function settlePayouts(db: PreviewDb): void {
  const tables = moneyTables(db);
  const metas = payoutMeta(db);
  const now = db.nowMs();
  const due = tables.payouts.filter((row) => {
    if (row.status !== "processing") return false;
    const at = metas.get(row.id)?.provider_confirms_at ?? null;
    return at !== null && at <= now;
  });
  if (due.length === 0) return;
  const failed = db.getSetting<string>(SETTING_PROVIDER_OUTCOME) === "failed";
  db.tx(() => {
    for (const row of due) {
      const at = metas.get(row.id)?.provider_confirms_at ?? now;
      metas.put({ id: row.id, provider_confirms_at: null });
      if (failed) {
        tables.payouts.update(row.id, { status: "failed", failure_code: "provider_rejected" });
        for (const earning of tables.earnings.filter((e) => e.payout_id === row.id)) tables.earnings.update(earning.id, { state: "available", payout_id: null });
        continue;
      }
      tables.payouts.update(row.id, { status: "paid", paid_at: at, failure_code: null });
      for (const earning of tables.earnings.filter((e) => e.payout_id === row.id)) tables.earnings.update(earning.id, { state: "paid_out" });
    }
  });
}

function listPayouts(db: PreviewDb, query: { period?: string; status?: PayoutStatus; cursor?: string; limit?: number }) {
  settlePayouts(db);
  if (query.period !== undefined && !PERIOD_RE.test(query.period)) fail("VALIDATION_ERROR", "El periodo debe tener el formato AAAA-MM.", 400);
  const rows = moneyTables(db)
    .payouts.filter((row) => (query.period === undefined || row.period === query.period) && (query.status === undefined || row.status === query.status))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
  const page = sliceOf(rows, query.cursor, query.limit);
  return { items: page.items.map((row) => payoutRunDto(db, row)), nextCursor: page.nextCursor };
}

function generatePayouts(db: PreviewDb, period: string): GeneratePayoutRunsResponse {
  const tables = moneyTables(db);
  const [from, to] = monthBounds(period);
  const byDriver = new Map<string, EarningRow[]>();
  for (const earning of tables.earnings.filter((e) => e.state === "available" && e.payout_id === null && e.occurred_at >= from && e.occurred_at < to)) {
    byDriver.set(earning.user_id, [...(byDriver.get(earning.user_id) ?? []), earning]);
  }
  const created: AdminPayoutRun[] = [];
  let skipped = 0;
  db.tx(() => {
    for (const [userId, earnings] of [...byDriver.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const defined = earnings.filter((e) => e.net.cents !== null);
      const net = defined.reduce((sum, e) => sum + (e.net.cents ?? 0), 0);
      const exists = tables.payouts.filter((p) => p.user_id === userId && p.period === period && p.status !== "cancelled").length > 0;
      if (net <= 0 || exists) {
        skipped += 1;
        continue;
      }
      const row = tables.payouts.insert({
        id: db.ids.uuid(),
        user_id: userId,
        period,
        status: "draft",
        net: { cents: net, status: "illustrative" },
        bookings_count: defined.length,
        scheduled_for: null,
        paid_at: null,
        failure_code: null,
        created_at: db.nowMs(),
      });
      for (const earning of defined) tables.earnings.update(earning.id, { state: "in_payout", payout_id: row.id });
      created.push(payoutRunDto(db, row));
    }
  });
  return { period, created, skipped };
}

function executePayout(db: PreviewDb, payoutId: string): AdminPayoutRun {
  settlePayouts(db);
  const tables = moneyTables(db);
  const row = tables.payouts.get(payoutId);
  if (row === undefined) return fail("PAYOUT_NOT_FOUND", "No existe esa liquidación.", 404);
  if (!providerEnabled(db)) {
    return fail("PAYMENTS_PROVIDER_DISABLED", "Todavía no hay proveedor de pago activo: no se puede pedir ningún abono.", 409);
  }
  if (row.status !== "draft" && row.status !== "failed") return fail("PAYOUT_NOT_EXECUTABLE", "Esa liquidación no se puede abonar en su estado actual.", 409);
  const hasAccount = tables.methods.filter((m) => m.user_id === row.user_id && m.purpose === "payout" && m.status === "active" && m.removed_at === null).length > 0;
  if (!hasAccount) return fail("PAYOUT_ACCOUNT_REQUIRED", "Esa persona conductora no tiene una cuenta de cobro activa.", 409);
  return db.tx(() => {
    const updated = tables.payouts.update(row.id, { status: "processing", failure_code: null });
    payoutMeta(db).put({ id: row.id, provider_confirms_at: db.nowMs() + PAYOUT_PROVIDER_DELAY_MS });
    for (const earning of tables.earnings.filter((e) => e.payout_id === row.id)) tables.earnings.update(earning.id, { state: "in_payout" });
    return payoutRunDto(db, updated);
  });
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Documentos legales
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const LEGAL_KINDS: readonly LegalDocumentKind[] = ["terms", "privacy", "cancellation", "private_check_notice"];
const KIND_ORDER = new Map(LEGAL_KINDS.map((kind, index) => [kind, index] as const));

function legalSummary(row: Readonly<LegalDocumentRow>): LegalDocumentSummary {
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    status: row.status,
    title: row.title,
    locale: "es-ES",
    legallyEffective: row.status === "published",
    pendingLegalReview: row.status === "draft_pending_legal_review",
    effectiveFrom: isoOrNull(row.effective_from),
    publishedAt: isoOrNull(row.published_at),
    contentSha256: row.content_sha256,
  };
}

function legalFull(row: Readonly<LegalDocumentRow>): LegalDocument {
  return { ...legalSummary(row), sections: row.sections.map((s) => ({ heading: s.heading, paragraphs: [...s.paragraphs], bullets: [...s.bullets] })) };
}

function contentInvalid(field: string, message: string): never {
  return fail("LEGAL_CONTENT_INVALID", "El título o las secciones del documento no son válidos.", 422, { fields: [{ field, message }] });
}

function cleanSections(input: readonly LegalSection[]): LegalSection[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 40) contentInvalid("sections", "entre 1 y 40 secciones");
  return input.map((section: LegalSection, index: number) => {
    const heading = (section.heading ?? "").trim();
    const paragraphs = (section.paragraphs ?? []).map((p: string) => p.trim()).filter((p: string) => p !== "");
    const bullets = (section.bullets ?? []).map((b: string) => b.trim()).filter((b: string) => b !== "");
    if (heading === "" || heading.length > 200) contentInvalid(`sections[${index}].heading`, "entre 1 y 200 caracteres");
    if (paragraphs.length + bullets.length === 0) contentInvalid(`sections[${index}]`, "escribe al menos un párrafo o una viñeta");
    return { heading, paragraphs, bullets };
  });
}

function listLegal(db: PreviewDb): { items: LegalDocumentSummary[] } {
  const rows = trustTables(db)
    .legalDocuments.all()
    .slice()
    .sort((a, b) => (KIND_ORDER.get(a.kind) ?? 9) - (KIND_ORDER.get(b.kind) ?? 9) || b.version - a.version);
  return { items: rows.map(legalSummary) };
}

function createLegal(db: PreviewDb, input: AdminLegalDocumentCreate): LegalDocument {
  const table = trustTables(db).legalDocuments;
  const title = (input.title ?? "").trim();
  if (title === "" || title.length > 200) contentInvalid("title", "entre 1 y 200 caracteres");
  const sections = cleanSections(input.sections);
  const same = table.filter((d) => d.kind === input.kind);
  const version = same.reduce((max, d) => Math.max(max, d.version), 0) + 1;
  const scope = same[0]?.scope ?? (input.kind === "cancellation" ? "booking" : input.kind === "private_check_notice" ? "private_check" : "account");
  const row = table.insert({
    id: stableUuid(`legal:${input.kind}:${version}`),
    kind: input.kind,
    version,
    status: "draft_pending_legal_review",
    title,
    scope,
    sections,
    content_sha256: sha256Hex(new TextEncoder().encode(JSON.stringify(sections))),
    effective_from: null,
    published_at: null,
  });
  return legalFull(row);
}

function publishLegal(db: PreviewDb, documentId: string, input: Partial<AdminLegalPublishRequest>): { doc: LegalDocument; reference: string } {
  const table = trustTables(db).legalDocuments;
  const row = table.get(documentId);
  if (row === undefined) return fail("LEGAL_DOCUMENT_NOT_FOUND", "No existe ese documento legal.", 404);
  const reference = (input.legalReviewReference ?? "").trim();
  if (reference.length < 3) {
    return fail("LEGAL_REVIEW_REFERENCE_REQUIRED", "Indica la referencia de la revisión legal que aprueba este texto.", 422, {
      fields: [{ field: "legalReviewReference", message: "mínimo 3 caracteres" }],
    });
  }
  if (row.status === "published") return fail("LEGAL_ALREADY_PUBLISHED", "Esa versión ya está publicada.", 409);
  if (row.status === "retired") return fail("LEGAL_DOCUMENT_RETIRED", "Esa versión está retirada y no puede publicarse.", 409);
  const now = db.nowMs();
  let effective = now;
  if (input.effectiveFrom !== undefined) {
    effective = Date.parse(input.effectiveFrom);
    if (Number.isNaN(effective)) return fail("VALIDATION_ERROR", "La fecha de entrada en vigor no es válida.", 422, { fields: [{ field: "effectiveFrom", message: "fecha ISO-8601" }] });
  }
  const updated = db.tx(() => {
    for (const previous of table.filter((d) => d.kind === row.kind && d.status === "published")) table.update(previous.id, { status: "retired" });
    return table.update(row.id, { status: "published", published_at: now, effective_from: effective });
  });
  return { doc: legalFull(updated), reference };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Atención al cliente
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Readonly<Record<AdminSupportTicketCategory, string>> = {
  trip_issue: "Problema con un viaje",
  payment_issue: "Problema de pago",
  account_profile: "Cuenta y perfil",
};

function requireSupport(db: PreviewDb): void {
  if (db.getSetting<boolean>(SETTING_SUPPORT_UNAVAILABLE) === true) {
    fail("SUPPORT_UNAVAILABLE", "El centro de ayuda aún no está disponible en este entorno.", 503);
  }
}

function staffRef(db: PreviewDb, userId: string | null): { id: string; displayName: string | null } | null {
  if (userId === null) return null;
  const name = db.profiles.get(userId)?.display_name?.trim();
  return { id: userId, displayName: name === undefined || name === "" ? null : name };
}

function messagesOf(db: PreviewDb, ticketId: string) {
  return ticketMessagesTable(db)
    .filter((m) => m.ticket_id === ticketId)
    .sort((a, b) => a.created_at - b.created_at);
}

function attachmentDto(row: Readonly<AttachmentRow>): AdminSupportAttachment {
  return { id: row.id, contentType: row.content_type, sizeBytes: row.size_bytes, createdAt: iso(row.created_at) };
}

function ticketRowDto(db: PreviewDb, ticket: Readonly<TicketRow>): AdminSupportTicketRow {
  const user = publicUser(db, ticket.user_id);
  const attachments = attachmentsTable(db).filter((a) => a.ticket_id === ticket.id);
  return {
    id: ticket.id,
    reference: ticket.reference,
    status: ticket.status,
    category: ticket.category,
    categoryLabel: CATEGORY_LABEL[ticket.category],
    user: { id: user.id, displayName: user.displayName, firstName: user.firstName, photoUrl: user.photoUrl },
    preview: ticket.body.length > 140 ? `${ticket.body.slice(0, 139).trimEnd()}…` : ticket.body,
    createdAt: iso(ticket.created_at),
    lastUserMessageAt: iso(ticket.last_user_message_at),
    lastStaffMessageAt: isoOrNull(ticket.last_staff_message_at),
    assignedTo: staffRef(db, ticket.assigned_to_user_id),
    messageCount: messagesOf(db, ticket.id).length,
    attachmentCount: attachments.length,
    waitingForStaff: ticket.status === "open",
  };
}

function ticketDetailDto(db: PreviewDb, ticket: Readonly<TicketRow>): AdminSupportTicketDetail {
  const attachments = attachmentsTable(db).filter((a) => a.ticket_id === ticket.id);
  const messages: AdminSupportMessage[] = messagesOf(db, ticket.id).map((m) => ({
    id: m.id,
    authorType: m.author_type,
    author: m.author_type === "staff" ? staffRef(db, m.author_user_id) : { id: m.author_user_id, displayName: publicUser(db, m.author_user_id).displayName },
    body: m.body,
    createdAt: iso(m.created_at),
    attachments: attachments.filter((a) => a.message_id === m.id).map(attachmentDto),
  }));
  return {
    ...ticketRowDto(db, ticket),
    tripId: ticket.trip_id,
    bookingId: ticket.booking_id,
    closedAt: isoOrNull(ticket.closed_at),
    closedBy: ticket.closed_by,
    messages,
    attachments: attachments.filter((a) => a.message_id === null).map(attachmentDto),
  };
}

function requireTicket(db: PreviewDb, ticketId: string): Readonly<TicketRow> {
  requireSupport(db);
  const ticket = ticketsTable(db).get(ticketId);
  return ticket === undefined ? fail("TICKET_NOT_FOUND", "No existe esa consulta.", 404) : ticket;
}

interface TicketsQuery {
  status?: AdminSupportTicketStatus | "all";
  assigned?: "any" | "me" | "unassigned";
  category?: AdminSupportTicketCategory;
  cursor?: string;
  limit?: number;
}

function listTickets(db: PreviewDb, userId: string, query: TicketsQuery): AdminSupportTicketsPage {
  requireSupport(db);
  const all = ticketsTable(db).all();
  const status = query.status ?? "open";
  const assigned = query.assigned ?? "any";
  const rows = all
    .filter(
      (t) =>
        (status === "all" || t.status === status) &&
        (query.category === undefined || t.category === query.category) &&
        (assigned === "any" || (assigned === "me" ? t.assigned_to_user_id === userId : t.assigned_to_user_id === null)),
    )
    // Las que esperan al equipo, primero las más antiguas; el resto, las más recientes.
    .sort((a, b) => (status === "open" ? a.last_user_message_at - b.last_user_message_at : b.updated_at - a.updated_at) || a.id.localeCompare(b.id));
  const page = sliceOf(rows, query.cursor, query.limit);
  return {
    items: page.items.map((t) => ticketRowDto(db, t)),
    nextCursor: page.nextCursor,
    counts: {
      open: all.filter((t) => t.status === "open").length,
      answered: all.filter((t) => t.status === "answered").length,
      closed: all.filter((t) => t.status === "closed").length,
    },
  };
}

function replyToTicket(db: PreviewDb, userId: string, ticketId: string, input: AdminSupportReplyRequest): AdminSupportTicketDetail {
  const ticket = requireTicket(db, ticketId);
  const body = (input.body ?? "").trim();
  if (body.length < 1 || body.length > 4000) fail("VALIDATION_ERROR", "La respuesta debe tener entre 1 y 4000 caracteres.", 422, { fields: [{ field: "body", message: "entre 1 y 4000 caracteres" }] });
  if (ticket.status === "closed") return fail("TICKET_CLOSED", "La consulta está cerrada.", 409);
  return db.tx(() => {
    const now = db.nowMs();
    ticketMessagesTable(db).insert({ id: db.ids.uuid(), ticket_id: ticket.id, author_type: "staff", author_user_id: userId, body, created_at: now });
    const updated = ticketsTable(db).update(ticket.id, {
      status: "answered",
      last_staff_message_at: now,
      assigned_to_user_id: ticket.assigned_to_user_id ?? userId,
      updated_at: now,
    });
    return ticketDetailDto(db, updated);
  });
}

function assignTicket(db: PreviewDb, userId: string, ticketId: string, input: AdminSupportAssignRequest): AdminSupportTicketDetail {
  const ticket = requireTicket(db, ticketId);
  if (ticket.status === "closed") return fail("TICKET_CLOSED", "La consulta está cerrada.", 409);
  const updated = ticketsTable(db).update(ticket.id, { assigned_to_user_id: input.assignee === "me" ? userId : null, updated_at: db.nowMs() });
  return ticketDetailDto(db, updated);
}

function closeTicket(db: PreviewDb, ticketId: string): AdminSupportTicketDetail {
  const ticket = requireTicket(db, ticketId);
  if (ticket.status === "closed") return fail("TICKET_ALREADY_CLOSED", "Esa consulta ya estaba cerrada.", 409);
  const now = db.nowMs();
  const updated = ticketsTable(db).update(ticket.id, { status: "closed", closed_at: now, closed_by: "staff", updated_at: now });
  return ticketDetailDto(db, updated);
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Rutas
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const TAG_MONEY = ["admin-money"] as const;
const TAG_LEGAL = ["admin-legal"] as const;
const TAG_SUPPORT = ["admin-support"] as const;

const sectionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["heading"],
  properties: {
    heading: { type: "string", maxLength: 400 },
    paragraphs: { type: "array", maxItems: 60, items: { type: "string", maxLength: 6000 } },
    bullets: { type: "array", maxItems: 60, items: { type: "string", maxLength: 1000 } },
  },
};

export function registerBackofficePreview(r: PreviewRouter, db: PreviewDb): void {
  registerBackofficeRefs();

  // ── Liquidaciones ───────────────────────────────────────────────────────────────────────────────────────────────

  r.get<{ Query: { period?: string; status?: PayoutStatus; cursor?: string; limit?: number } }>(
    "/v1/admin/payout-runs",
    {
      summary: "Liquidaciones por periodo (finanzas)",
      tags: TAG_MONEY,
      schema: { querystring: queryOf({ period: { type: "string", maxLength: 7 }, status: { type: "string", enum: [...PAYOUT_STATUSES] } }) },
    },
    (req) => {
      const principal = authorizeFinance(db, req);
      const result = listPayouts(db, req.query);
      auditAdmin(db, req.requestId, principal, "admin.payout_runs.listed", "payout_run", null, { period: req.query.period ?? null, status: req.query.status ?? null, returned: result.items.length });
      return result;
    },
  );

  r.post<{ Body: { period: string } }>(
    "/v1/admin/payout-runs",
    {
      summary: "Generar las liquidaciones de un periodo",
      tags: TAG_MONEY,
      idempotent: "required",
      schema: { body: { type: "object", additionalProperties: false, required: ["period"], properties: { period: { type: "string", maxLength: 7 } } } },
    },
    (req) => {
      const principal = authorizeFinance(db, req);
      if (!PERIOD_RE.test(req.body.period)) return fail("VALIDATION_ERROR", "El periodo debe tener el formato AAAA-MM.", 422, { fields: [{ field: "period", message: "AAAA-MM" }] });
      const result = generatePayouts(db, req.body.period);
      auditAdmin(db, req.requestId, principal, "admin.payout_runs.generated", "payout_run", null, { period: result.period, created: result.created.length, skipped: result.skipped });
      return result;
    },
  );

  r.post<{ Params: { payoutId: string } }>(
    "/v1/admin/payout-runs/:payoutId/execute",
    { summary: "Pedir el abono de una liquidación (proveedor SIMULADO)", tags: TAG_MONEY, idempotent: "required", schema: { params: uuidParam("payoutId") } },
    (req) => {
      const principal = authorizeFinance(db, req);
      const result = executePayout(db, req.params.payoutId);
      auditAdmin(db, req.requestId, principal, "admin.payout_run.execute_requested", "payout_run", req.params.payoutId, { period: result.period, status: result.status });
      return result;
    },
  );

  // ── Documentos legales ──────────────────────────────────────────────────────────────────────────────────────────

  r.get("/v1/admin/legal/documents", { summary: "Versiones de los documentos legales", tags: TAG_LEGAL }, (req) => {
    const principal = authorizeAdmin(db, req, "legal", "read");
    const result = listLegal(db);
    auditAdmin(db, req.requestId, principal, "admin.legal_documents.listed", "legal_document", null, { returned: result.items.length });
    return result;
  });

  r.post<{ Body: AdminLegalDocumentCreate }>(
    "/v1/admin/legal/documents",
    {
      summary: "Crear una versión nueva en borrador (pendiente de revisión legal)",
      tags: TAG_LEGAL,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "title", "sections"],
          properties: { kind: { type: "string", enum: [...LEGAL_KINDS] }, title: { type: "string", maxLength: 400 }, sections: { type: "array", maxItems: 60, items: sectionSchema } },
        },
      },
    },
    (req) => {
      const principal = authorizeAdmin(db, req, "legal", "write");
      const doc = createLegal(db, req.body);
      auditAdmin(db, req.requestId, principal, "admin.legal_document.draft_created", "legal_document", doc.id, { kind: doc.kind, version: doc.version, sections: doc.sections.length });
      return reply.created(doc);
    },
  );

  r.post<{ Params: { documentId: string }; Body: Partial<AdminLegalPublishRequest> }>(
    "/v1/admin/legal/documents/:documentId/publish",
    {
      summary: "Publicar una versión legal (exige la referencia de la revisión legal)",
      tags: TAG_LEGAL,
      schema: {
        params: uuidParam("documentId"),
        body: { type: "object", additionalProperties: false, properties: { legalReviewReference: { type: "string", maxLength: 300 }, effectiveFrom: { type: "string", maxLength: 40 } } },
      },
    },
    (req) => {
      const principal = authorizeAdmin(db, req, "legal", "write");
      const { doc, reference } = publishLegal(db, req.params.documentId, req.body ?? {});
      auditAdmin(db, req.requestId, principal, "admin.legal_document.published", "legal_document", doc.id, { kind: doc.kind, version: doc.version, legalReviewReference: reference });
      return doc;
    },
  );

  // ── Atención al cliente ─────────────────────────────────────────────────────────────────────────────────────────

  r.get<{ Query: TicketsQuery }>(
    "/v1/admin/support/tickets",
    {
      summary: "Cola de consultas del centro de ayuda",
      tags: TAG_SUPPORT,
      schema: {
        querystring: queryOf({
          status: { type: "string", enum: ["open", "answered", "closed", "all"] },
          assigned: { type: "string", enum: ["any", "me", "unassigned"] },
          category: { type: "string", enum: ["trip_issue", "payment_issue", "account_profile"] },
        }),
      },
    },
    (req) => {
      const principal = authorizeAdmin(db, req, "support", "read");
      const result = listTickets(db, principal.userId, req.query);
      auditAdmin(db, req.requestId, principal, "admin.support_tickets.listed", "support_ticket", null, { status: req.query.status ?? "open", returned: result.items.length });
      return result;
    },
  );

  r.get<{ Params: { ticketId: string } }>(
    "/v1/admin/support/tickets/:ticketId",
    { summary: "Detalle de una consulta", tags: TAG_SUPPORT, schema: { params: uuidParam("ticketId") } },
    (req) => {
      const principal = authorizeAdmin(db, req, "support", "read");
      const detail = ticketDetailDto(db, requireTicket(db, req.params.ticketId));
      auditAdmin(db, req.requestId, principal, "admin.support_ticket.viewed", "support_ticket", detail.id, { reference: detail.reference });
      return detail;
    },
  );

  r.post<{ Params: { ticketId: string }; Body: AdminSupportReplyRequest }>(
    "/v1/admin/support/tickets/:ticketId/reply",
    {
      summary: "Responder a una consulta",
      tags: TAG_SUPPORT,
      schema: { params: uuidParam("ticketId"), body: { type: "object", additionalProperties: false, required: ["body"], properties: { body: { type: "string", maxLength: 8000 } } } },
    },
    (req) => {
      const principal = authorizeAdmin(db, req, "support", "write");
      const detail = replyToTicket(db, principal.userId, req.params.ticketId, req.body);
      auditAdmin(db, req.requestId, principal, "admin.support_ticket.replied", "support_ticket", detail.id, { reference: detail.reference, length: req.body.body.trim().length });
      return detail;
    },
  );

  r.post<{ Params: { ticketId: string }; Body: AdminSupportAssignRequest }>(
    "/v1/admin/support/tickets/:ticketId/assign",
    {
      summary: "Asignarme o liberar una consulta",
      tags: TAG_SUPPORT,
      schema: { params: uuidParam("ticketId"), body: { type: "object", additionalProperties: false, required: ["assignee"], properties: { assignee: { type: "string", enum: ["me", "none"] } } } },
    },
    (req) => {
      const principal = authorizeAdmin(db, req, "support", "write");
      const detail = assignTicket(db, principal.userId, req.params.ticketId, req.body);
      auditAdmin(db, req.requestId, principal, "admin.support_ticket.assigned", "support_ticket", detail.id, { reference: detail.reference, assignee: req.body.assignee });
      return detail;
    },
  );

  r.post<{ Params: { ticketId: string } }>(
    "/v1/admin/support/tickets/:ticketId/close",
    { summary: "Cerrar una consulta", tags: TAG_SUPPORT, schema: { params: uuidParam("ticketId") } },
    (req) => {
      const principal = authorizeAdmin(db, req, "support", "write");
      const detail = closeTicket(db, req.params.ticketId);
      auditAdmin(db, req.requestId, principal, "admin.support_ticket.closed", "support_ticket", detail.id, { reference: detail.reference });
      return detail;
    },
  );

  r.post<{ Params: { attachmentId: string }; Body: { note?: string } }>(
    "/v1/admin/support/attachments/:attachmentId/access",
    {
      summary: "URL firmada de un adjunto de soporte (auditada antes de entregarla)",
      tags: TAG_SUPPORT,
      schema: { params: uuidParam("attachmentId"), body: { type: "object", additionalProperties: false, properties: { note: { type: "string", maxLength: 500 } } } },
    },
    (req): AdminSupportAttachmentAccess => {
      const principal = authorizeAdmin(db, req, "support", "read");
      requireSupport(db);
      const attachment = attachmentsTable(db).get(req.params.attachmentId);
      if (attachment === undefined) return fail("ATTACHMENT_NOT_FOUND", "No existe ese adjunto.", 404);
      if (attachment.owner_user_id === principal.userId) return fail("SELF_REVIEW_FORBIDDEN", "No puedes abrir un adjunto que subiste tú.", 403);
      if (db.getSetting<boolean>(SETTING_SUPPORT_STORAGE_OFF) === true) return fail("PRIVATE_STORAGE_DISABLED", "El almacenamiento privado no está disponible.", 503);
      if (attachment.storage_provider !== STORAGE_PROVIDER_NAME) return fail("EVIDENCE_STORAGE_MISMATCH", "El archivo está en otro proveedor de almacenamiento.", 409);
      const expiresAtMs = db.nowMs() + SUPPORT_ATTACHMENT_TTL_SECONDS * 1000;
      const note = req.body?.note?.trim() ?? "";
      auditAdmin(db, req.requestId, principal, "admin.support_attachment.access_url_issued", "support_attachment", attachment.id, {
        ticketId: attachment.ticket_id,
        ttlSeconds: SUPPORT_ATTACHMENT_TTL_SECONDS,
        ...(note !== "" ? { note } : {}),
      });
      return { url: signedUrl("download", attachment.storage_key, expiresAtMs), expiresAt: iso(expiresAtMs), ttlSeconds: SUPPORT_ATTACHMENT_TTL_SECONDS, contentType: attachment.content_type, attachmentId: attachment.id };
    },
  );
}

function registerBackofficeRefs(): void {
  registerSeedRef("adminPayout.draft", (db) => moneyTables(db).payouts.filter((p) => p.status === "draft").sort((a, b) => b.created_at - a.created_at)[0]?.id);
  registerSeedRef("adminPayout.failed", (db) => moneyTables(db).payouts.filter((p) => p.status === "failed").sort((a, b) => b.created_at - a.created_at)[0]?.id);
  registerSeedRef("adminLegal.draft", (db) => trustTables(db).legalDocuments.filter((d) => d.status === "draft_pending_legal_review").sort((a, b) => b.version - a.version)[0]?.id);
  registerSeedRef("adminLegal.published", (db) => trustTables(db).legalDocuments.filter((d) => d.status === "published").sort((a, b) => b.version - a.version)[0]?.id);
  registerSeedRef("adminTicket.open", (db) => ticketsTable(db).filter((t) => t.status === "open").sort((a, b) => a.last_user_message_at - b.last_user_message_at)[0]?.id);
  registerSeedRef("adminTicket.answered", (db) => ticketsTable(db).filter((t) => t.status === "answered").sort((a, b) => b.updated_at - a.updated_at)[0]?.id);
  registerSeedRef("adminTicket.closed", (db) => ticketsTable(db).filter((t) => t.status === "closed").sort((a, b) => b.updated_at - a.updated_at)[0]?.id);
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Datos de ejemplo
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function periodOf(ms: number, monthsBack: number): string {
  const parts = madridParts(ms);
  const index = parts.year * 12 + (parts.month - 1) - monthsBack;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function amount(cents: number): { cents: number; status: "illustrative" } {
  return { cents, status: "illustrative" };
}

function seedPayoutAccount(db: PreviewDb, userId: string, now: number): void {
  moneyTables(db).methods.put({
    id: stableUuid(`admin:payout-account:${userId}`),
    user_id: userId,
    purpose: "payout",
    kind: "bank_account",
    brand: null,
    last4: "4589",
    country: "ES",
    exp_month: null,
    exp_year: null,
    title: "Cuenta bancaria",
    masked_label: "ES** **** **** 4589",
    is_default: true,
    status: "active",
    created_at: now - 40 * DAY,
    removed_at: null,
  });
}

function seedAvailableEarning(db: PreviewDb, key: string, driver: string, passenger: string, at: number, cents: number): void {
  moneyTables(db).earnings.put({
    id: stableUuid(`admin:earning:${key}`),
    user_id: driver,
    passenger_user_id: passenger,
    trip: { trip_id: stableUuid(`admin:earning-trip:${key}`), departure_at: at, origin_label: "Sevilla", destination_label: "Camas" },
    contribution: amount(cents),
    driver_commission: amount(0),
    refund_adjustments: amount(0),
    net: amount(cents),
    state: "available",
    occurred_at: at,
    payout_id: null,
  });
}

function seedPayouts(db: PreviewDb, seed: string): void {
  if (seed === "admin-payouts-empty") return;
  const now = db.nowMs();
  const last = periodOf(now, 1);
  const before = periodOf(now, 2);
  const [lastFrom] = monthBounds(last);
  const { ana, carlos, laura, marta, daniel } = SEED_USER_IDS;
  const table = moneyTables(db).payouts;
  const payout = (key: string, user: string, period: string, status: PayoutStatus, cents: number, count: number, patch: Partial<PayoutRow> = {}): void => {
    table.put({
      id: stableUuid(`admin:payout:${key}`),
      user_id: user,
      period,
      status,
      net: amount(cents),
      bookings_count: count,
      scheduled_for: null,
      paid_at: null,
      failure_code: null,
      created_at: now - 3 * DAY,
      ...patch,
    });
  };

  if (seed === "admin-payouts-ready") {
    seedPayoutAccount(db, ana, now);
    seedPayoutAccount(db, carlos, now);
    seedAvailableEarning(db, "ready-1", ana, laura, lastFrom + 3 * DAY + 8 * HOUR, 450);
    seedAvailableEarning(db, "ready-2", ana, marta, lastFrom + 9 * DAY + 8 * HOUR, 600);
    seedAvailableEarning(db, "ready-3", carlos, daniel, lastFrom + 12 * DAY + 8 * HOUR, 380);
    return;
  }
  if (seed === "admin-payouts-many") {
    seedPayoutAccount(db, ana, now);
    for (let i = 0; i < 25; i += 1) {
      payout(`many-${i}`, i % 2 === 0 ? ana : carlos, periodOf(now, 1 + (i % 3)), i % 5 === 0 ? "failed" : i % 3 === 0 ? "paid" : "draft", 800 + i * 35, 2 + (i % 6), {
        created_at: now - (i + 1) * 3 * HOUR,
        paid_at: i % 5 !== 0 && i % 3 === 0 ? now - i * HOUR : null,
        failure_code: i % 5 === 0 ? "account_rejected" : null,
      });
    }
    return;
  }
  if (seed !== "admin-payouts-no-account") {
    seedPayoutAccount(db, ana, now);
    seedPayoutAccount(db, carlos, now);
  }
  payout("paid", ana, before, "paid", 1850, 5, { created_at: now - 35 * DAY, paid_at: now - 33 * DAY, scheduled_for: null });
  payout("draft", ana, last, "draft", 1240, 4, { created_at: now - 4 * DAY });
  payout("failed", carlos, last, "failed", 960, 3, { created_at: now - 4 * DAY, failure_code: "account_rejected" });
  payout("processing", marta, last, "processing", 530, 2, { created_at: now - 4 * DAY });
  // Con saldo disponible aún sin liquidar, para poder generar una liquidación nueva.
  if (seed !== "admin-payouts-no-account") seedAvailableEarning(db, "default-1", carlos, laura, lastFrom + 20 * DAY + 8 * HOUR, 420);
}

function seedLegal(db: PreviewDb, seed: string): void {
  if (seed !== "admin-legal-published") return;
  const table = trustTables(db).legalDocuments;
  const now = db.nowMs();
  for (const kind of ["terms", "privacy"] as const) {
    const current = table.get(stableUuid(`legal:${kind}:1`));
    if (current !== undefined && current.status !== "published") {
      table.update(current.id, { status: "published", published_at: now - 20 * DAY, effective_from: now - 20 * DAY });
    }
  }
  const terms = table.get(stableUuid("legal:terms:1"));
  if (terms !== undefined && !table.has(stableUuid("legal:terms:2"))) {
    const sections: LegalSection[] = [
      ...terms.sections.map((s) => ({ heading: s.heading, paragraphs: [...s.paragraphs], bullets: [...s.bullets] })),
      { heading: "Cambios de esta versión", paragraphs: ["Se aclara cómo se comunican los cambios de las condiciones a las personas usuarias."], bullets: [] },
    ];
    table.insert({
      ...terms,
      id: stableUuid("legal:terms:2"),
      version: 2,
      status: "draft_pending_legal_review",
      sections,
      content_sha256: sha256Hex(new TextEncoder().encode(JSON.stringify(sections))),
      effective_from: null,
      published_at: null,
    });
  }
}

interface TicketSeed {
  key: string;
  user: string;
  category: TicketCategory;
  status: "open" | "answered" | "closed";
  body: string;
  ageHours: number;
  reply?: string;
  followUp?: string;
  assigned?: boolean;
  attachment?: boolean;
}

const TICKETS: readonly TicketSeed[] = [
  { key: "t1", user: SEED_USER_IDS.laura, category: "trip_issue", status: "open", body: "El conductor no apareció en el punto de recogida de Camas y no contesta al chat. ¿Qué puedo hacer con mi reserva de hoy?", ageHours: 30, attachment: true },
  { key: "t2", user: SEED_USER_IDS.marta, category: "payment_issue", status: "open", body: "Me aparece la solicitud como pendiente de pago pero no me deja pagar. ¿Cuándo estará disponible el pago?", ageHours: 14 },
  { key: "t3", user: SEED_USER_IDS.daniel, category: "account_profile", status: "open", body: "He cambiado de móvil y no me llega el código para entrar. Necesito recuperar mi cuenta.", ageHours: 5, assigned: true },
  { key: "t4", user: SEED_USER_IDS.miguelAngel, category: "trip_issue", status: "answered", body: "¿Puedo cancelar un viaje de la semana que viene sin penalización?", ageHours: 52, reply: "Hola Miguel Ángel: puedes cancelar desde «Mis viajes». Las condiciones de cancelación aplicables aparecen antes de confirmar. Si algo no se ve igual, cuéntanos y lo revisamos.", assigned: true },
  { key: "t5", user: SEED_USER_IDS.laura, category: "account_profile", status: "answered", body: "Quiero cambiar mi nombre público porque tiene una errata.", ageHours: 80, reply: "Hola Laura: puedes editarlo en Perfil › Editar perfil. Avísanos si no te deja guardarlo.", followUp: "Ya lo he cambiado, gracias." },
  { key: "t6", user: SEED_USER_IDS.carlos, category: "payment_issue", status: "closed", body: "¿Cuándo cobraré mis viajes como conductor?", ageHours: 200, reply: "Hola Carlos: el calendario de abonos todavía no está definido; te avisaremos en la app cuando lo esté. Cerramos la consulta; escríbenos si necesitas algo más.", assigned: true },
];

function seedSupport(db: PreviewDb, seed: string): void {
  if (seed === "admin-support-empty" || seed === "admin-support-off") {
    if (seed === "admin-support-off") db.setSetting(SETTING_SUPPORT_UNAVAILABLE, true);
    return;
  }
  const now = db.nowMs();
  const staff = SEED_USER_IDS.staff;
  const tickets = ticketsTable(db);
  const messages = ticketMessagesTable(db);
  const attachments = attachmentsTable(db);
  const seeds: TicketSeed[] = [...TICKETS];
  if (seed === "admin-support-many") {
    for (let i = 0; i < 30; i += 1) {
      seeds.push({ key: `bulk-${i}`, user: i % 2 === 0 ? SEED_USER_IDS.laura : SEED_USER_IDS.marta, category: i % 3 === 0 ? "trip_issue" : i % 3 === 1 ? "payment_issue" : "account_profile", status: "open", body: `Consulta de ejemplo número ${i + 1}: necesito ayuda con mi cuenta.`, ageHours: 2 + i });
    }
  }
  seeds.forEach((t, index) => {
    const created = now - t.ageHours * HOUR;
    const id = stableUuid(`admin:ticket:${t.key}`);
    const staffAt = t.reply !== undefined ? created + 2 * HOUR : null;
    const lastUserAt = t.followUp !== undefined && staffAt !== null ? staffAt + HOUR : created;
    tickets.put({
      id,
      reference: `MVC-${madridParts(now).year}-${String(100 + index).padStart(6, "0")}`,
      user_id: t.user,
      category: t.category,
      status: t.status,
      trip_id: null,
      booking_id: null,
      body: t.body,
      assigned_to_user_id: t.assigned === true ? staff : null,
      last_user_message_at: lastUserAt,
      last_staff_message_at: staffAt,
      closed_at: t.status === "closed" && staffAt !== null ? staffAt + HOUR : null,
      closed_by: t.status === "closed" ? "staff" : null,
      created_at: created,
      updated_at: Math.max(lastUserAt, staffAt ?? 0),
    });
    const first = stableUuid(`admin:ticket:${t.key}:m0`);
    messages.put({ id: first, ticket_id: id, author_type: "user", author_user_id: t.user, body: t.body, created_at: created });
    if (t.reply !== undefined && staffAt !== null) messages.put({ id: stableUuid(`admin:ticket:${t.key}:m1`), ticket_id: id, author_type: "staff", author_user_id: staff, body: t.reply, created_at: staffAt });
    if (t.followUp !== undefined) messages.put({ id: stableUuid(`admin:ticket:${t.key}:m2`), ticket_id: id, author_type: "user", author_user_id: t.user, body: t.followUp, created_at: lastUserAt });
    if (t.attachment === true) {
      const attachmentId = stableUuid(`admin:ticket:${t.key}:a0`);
      const key = `support/${t.user}/${attachmentId}.svg`;
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320"><rect width="480" height="320" fill="#F4F8FE"/>` +
        `<rect x="40" y="40" width="400" height="200" rx="18" fill="#FFFFFF" stroke="#0407FA" stroke-width="3"/><rect x="64" y="70" width="240" height="14" rx="7" fill="#C9D8F2"/>` +
        `<rect x="64" y="100" width="180" height="14" rx="7" fill="#C9D8F2"/><text x="240" y="288" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#5B6B85">Ejemplo ilustrativo de la vista previa · no es una captura real</text></svg>`;
      db.blobs.put(key, new TextEncoder().encode(svg), "image/svg+xml", created);
      attachments.put({
        id: attachmentId,
        owner_user_id: t.user,
        ticket_id: id,
        message_id: first,
        storage_provider: STORAGE_PROVIDER_NAME,
        storage_key: key,
        content_type: "image/svg+xml",
        size_bytes: svg.length,
        sha256: sha256Hex(new TextEncoder().encode(svg)),
        created_at: created,
      });
    }
  });
  if (seed === "admin-support-storage-off") db.setSetting(SETTING_SUPPORT_STORAGE_OFF, true);
}

export function seedBackoffice(db: PreviewDb, profile: PreviewProfileId, seed: string): void {
  if (profile !== "admin" && !seed.startsWith("admin-")) return;
  seedPayouts(db, seed);
  seedLegal(db, seed);
  seedSupport(db, seed);
  // Estado real de hoy: sin proveedor de pago. Las variantes con liquidaciones listas lo activan (SIMULADO).
  if (seed === "admin-payouts-ready" || seed === "admin-payouts-many" || seed === "admin-payouts-no-account") writeConfig(db, { provider_enabled: true });
}
