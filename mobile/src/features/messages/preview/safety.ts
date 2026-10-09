/**
 * Bloqueos y denuncias de personas (contrato `docs/contracts/comms.md` §2.10 y §3) en el backend en memoria de la vista
 * previa (SIMULACIÓN, solo con `EXPO_PUBLIC_PREVIEW=1`). Bloquear/desbloquear ya existe en el núcleo (`PUT/DELETE
 * /v1/me/blocks/:userId`); aquí se añaden la lista, la denuncia de una persona y la de un mensaje.
 *
 * Reglas: solo se denuncia a quien se comparte reserva o conversación (`403 REPORT_NOT_RELATED`); no a uno mismo (`400`);
 * misma persona + mismo motivo en 24 h → `409 REPORT_ALREADY_FILED`; máx. 10 al día → `429 REPORT_RATE_LIMITED`; hasta 10
 * mensajes de prueba, copiados literalmente. El denunciado nunca sabe quién denunció.
 */
import type { BlockedUser, BlockedUsersPage, CreateUserReportRequest, ReportMessageRequest, UserReport, UserReportReason } from "@/api/types";
import { fail, isoReq, publicUser, reply, uuidParam, writeAudit } from "@/preview";
import type { JsonSchema, PreviewDb, PreviewRouter } from "@/preview";
import { findConversation, membersOf, visibleMessages } from "./access";
import { requireConversation } from "./conversations";
import { tablesOf, type UserReportRow } from "./rows";

const REASONS: readonly UserReportReason[] = ["harassment", "unsafe_behavior", "inappropriate_content", "spam_or_fraud", "no_show", "other"];
const DAY_MS = 86_400_000;
const MAX_PER_DAY = 10;
const MAX_EVIDENCE = 10;
const DEFAULT_LIMIT = 20;

const pageQuery: JsonSchema = { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 }, cursor: { type: "string", maxLength: 100 } } };
const encodeCursor = (n: number): string => `s1.${n}`;
function decodeCursor(c: string): number {
  const m = /^s1\.(\d{1,9})$/.exec(c);
  return m ? Number(m[1]) : fail("INVALID_CURSOR", "El cursor no es válido.", 400);
}

function reportWire(db: PreviewDb, row: Readonly<UserReportRow>): UserReport {
  return {
    id: row.id,
    reportedUser: publicUser(db, row.reported_user_id),
    reason: row.reason,
    details: row.details,
    tripId: row.trip_id,
    conversationId: row.conversation_id,
    evidenceCount: tablesOf(db).evidence.filter((e) => e.report_id === row.id).length,
    status: row.status,
    createdAt: isoReq(row.created_at),
    updatedAt: isoReq(row.updated_at),
    resolvedAt: row.resolved_at === null ? null : isoReq(row.resolved_at),
  };
}

/** Personas con las que `me` comparte un viaje (conductor, o pasajero/a con reserva) o una conversación. */
function sharesTrip(db: PreviewDb, a: string, b: string, tripId?: string): boolean {
  for (const trip of db.trips.all()) {
    if (tripId !== undefined && trip.id !== tripId) continue;
    const people = new Set<string>([trip.driver_user_id]);
    for (const request of db.rideRequests.filter((x) => x.trip_id === trip.id)) {
      if (db.bookings.find((bk) => bk.request_id === request.id) !== undefined) people.add(request.passenger_user_id);
    }
    if (people.has(a) && people.has(b)) return true;
  }
  return false;
}

interface FileInput {
  reportedUserId: string;
  reason: UserReportReason;
  details?: string | undefined;
  tripId?: string | undefined;
  conversationId?: string | undefined;
  evidenceMessageIds?: readonly string[] | undefined;
}

function fileReport(db: PreviewDb, me: string, input: FileInput, key: string | null, requestId: string | undefined): { row: Readonly<UserReportRow>; created: boolean } {
  const t = tablesOf(db);
  if (key !== null) {
    const previous = t.reports.find((x) => x.reporter_user_id === me && x.idempotency_key === key);
    if (previous) return { row: previous, created: false };
  }
  if (input.reportedUserId === me) return fail("REPORT_SELF_FORBIDDEN", "No puedes denunciarte a ti mismo.", 400);
  if (!db.users.has(input.reportedUserId)) return fail("USER_NOT_FOUND", "La persona no existe.", 404);
  const details = input.details?.trim() ?? "";
  if (details.length > 1000) return fail("VALIDATION_ERROR", "El detalle puede tener hasta 1.000 caracteres.", 400);

  let conversation = input.conversationId === undefined ? undefined : findConversation(db, input.conversationId);
  if (input.conversationId !== undefined) {
    if (!conversation || !membersOf(db, conversation).includes(me) || !membersOf(db, conversation).includes(input.reportedUserId)) {
      return fail("REPORT_NOT_RELATED", "Solo puedes denunciar a personas con las que has compartido un viaje o una conversación.", 403);
    }
  }
  const related = conversation !== undefined || sharesTrip(db, me, input.reportedUserId, input.tripId);
  if (!related) return fail("REPORT_NOT_RELATED", "Solo puedes denunciar a personas con las que has compartido un viaje o una conversación.", 403);
  if (conversation === undefined && !sharesTrip(db, me, input.reportedUserId)) return fail("REPORT_NOT_RELATED", "Solo puedes denunciar a personas con las que has compartido un viaje o una conversación.", 403);

  const evidenceIds = [...new Set(input.evidenceMessageIds ?? [])];
  if (evidenceIds.length > MAX_EVIDENCE) return fail("REPORT_EVIDENCE_INVALID", `Puedes adjuntar hasta ${MAX_EVIDENCE} mensajes.`, 422);
  if (evidenceIds.length > 0) conversation = conversation ?? undefined;
  const messages = conversation ? visibleMessages(db, conversation, me) : [];
  const evidence = evidenceIds.map((id) => messages.find((m) => m.id === id));
  if (evidenceIds.length > 0 && (conversation === undefined || evidence.some((m) => m === undefined))) {
    return fail("REPORT_EVIDENCE_INVALID", "Alguno de los mensajes no es de esa conversación o no puedes verlo.", 422);
  }

  const now = db.nowMs();
  if (t.reports.find((x) => x.reporter_user_id === me && x.reported_user_id === input.reportedUserId && x.reason === input.reason && now - x.created_at < DAY_MS) !== undefined) {
    return fail("REPORT_ALREADY_FILED", "Ya denunciaste a esta persona por este motivo hace poco. Lo estamos revisando.", 409);
  }
  if (t.reports.filter((x) => x.reporter_user_id === me && now - x.created_at < DAY_MS).length >= MAX_PER_DAY) {
    return fail("REPORT_RATE_LIMITED", "Has llegado al máximo de denuncias de hoy. Inténtalo mañana.", 429);
  }

  const row = t.reports.insert({
    id: db.ids.uuid(),
    reporter_user_id: me,
    reported_user_id: input.reportedUserId,
    reason: input.reason,
    details: details === "" ? null : details,
    trip_id: input.tripId ?? null,
    conversation_id: conversation?.id ?? null,
    status: "open",
    resolution_note: null,
    resolved_by_user_id: null,
    resolved_at: null,
    idempotency_key: key,
    idempotency_fingerprint: null,
    created_at: now,
    updated_at: now,
  });
  for (const message of evidence) {
    if (!message) continue;
    t.evidence.insert({
      id: db.ids.uuid(),
      report_id: row.id,
      message_source: message.source,
      message_id: message.id,
      sender_user_id: message.senderId,
      kind: message.kind,
      body: message.body,
      location_lat: message.lat,
      location_lng: message.lng,
      message_created_at: message.createdAt,
      created_at: now,
    });
  }
  writeAudit(db, { actorUserId: me, action: "user.reported", entityType: "user", entityId: input.reportedUserId, requestId: requestId ?? null, metadata: { reportId: row.id, reason: input.reason } });
  return { row, created: true };
}

const idempotencyHeaders: JsonSchema = { type: "object", properties: { "idempotency-key": { type: "string", pattern: "^[A-Za-z0-9_.:-]{8,80}$" } } };

export function registerSafety(r: PreviewRouter, db: PreviewDb): void {
  r.get<{ Query: { limit?: number; cursor?: string } }>(
    "/v1/me/blocks",
    { summary: "Personas que he bloqueado", tags: ["comms"], schema: { querystring: pageQuery } },
    (req): BlockedUsersPage => {
      const me = req.auth().userId;
      const all = [...db.blocks.filter((b) => b.blocker_user_id === me)].reverse().sort((a, b) => b.created_at - a.created_at);
      const offset = req.query.cursor ? decodeCursor(req.query.cursor) : 0;
      const items: BlockedUser[] = all.slice(offset, offset + (req.query.limit ?? DEFAULT_LIMIT)).map((b) => ({ user: publicUser(db, b.blocked_user_id), blockedAt: isoReq(b.created_at) }));
      const next = offset + items.length;
      return { items, nextCursor: next < all.length ? encodeCursor(next) : null };
    },
  );

  r.post<{ Body: CreateUserReportRequest }>(
    "/v1/me/reports",
    {
      summary: "Denunciar a una persona",
      tags: ["comms"],
      schema: {
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["reportedUserId", "reason"],
          properties: {
            reportedUserId: { type: "string", format: "uuid" },
            reason: { type: "string", enum: [...REASONS] },
            details: { type: "string" },
            tripId: { type: "string", format: "uuid" },
            conversationId: { type: "string", format: "uuid" },
            evidenceMessageIds: { type: "array", items: { type: "string", format: "uuid" } },
          },
        },
      },
    },
    (req) => {
      const out = fileReport(db, req.auth().userId, req.body, req.header("idempotency-key") ?? null, req.requestId);
      return out.created ? reply.created(reportWire(db, out.row)) : reportWire(db, out.row);
    },
  );

  r.get<{ Query: { limit?: number; cursor?: string } }>(
    "/v1/me/reports",
    { summary: "Mis denuncias", tags: ["comms"], schema: { querystring: pageQuery } },
    (req) => {
      const me = req.auth().userId;
      const all = [...tablesOf(db).reports.filter((x) => x.reporter_user_id === me)].reverse().sort((a, b) => b.created_at - a.created_at);
      const offset = req.query.cursor ? decodeCursor(req.query.cursor) : 0;
      const items = all.slice(offset, offset + (req.query.limit ?? DEFAULT_LIMIT)).map((x) => reportWire(db, x));
      const next = offset + items.length;
      return { items, nextCursor: next < all.length ? encodeCursor(next) : null };
    },
  );

  r.post<{ Params: { conversationId: string; messageId: string }; Body: ReportMessageRequest }>(
    "/v1/conversations/:conversationId/messages/:messageId/report",
    {
      summary: "Denunciar un mensaje",
      tags: ["comms"],
      schema: {
        params: { type: "object", required: ["conversationId", "messageId"], properties: { conversationId: { type: "string", format: "uuid" }, messageId: { type: "string", format: "uuid" } } },
        body: { type: "object", additionalProperties: false, required: ["reason"], properties: { reason: { type: "string", enum: [...REASONS] }, details: { type: "string" } } },
      },
    },
    (req) => {
      const me = req.auth().userId;
      const conversation = requireConversation(db, req.params.conversationId, me);
      const message = visibleMessages(db, conversation, me).find((m) => m.id === req.params.messageId);
      if (!message) return fail("MESSAGE_NOT_FOUND", "El mensaje no existe.", 404);
      if (message.senderId === me) return fail("REPORT_SELF_FORBIDDEN", "No puedes denunciar tus propios mensajes.", 400);
      const out = fileReport(db, me, { reportedUserId: message.senderId, reason: req.body.reason, details: req.body.details, conversationId: conversation.id, evidenceMessageIds: [message.id] }, null, req.requestId);
      return reply.created(reportWire(db, out.row));
    },
  );
}
