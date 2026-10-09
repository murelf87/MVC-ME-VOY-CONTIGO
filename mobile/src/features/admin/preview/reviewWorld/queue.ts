/**
 * «Usuarios y revisión» del backend en memoria (SIMULACIÓN): cola, expediente, decisiones y acceso a la documentación
 * privada. Espejo de `src/modules/trust/{review-queue,review,reasons}.ts`:
 *
 *  - El estado de cada elemento se DERIVA como en el servidor real: la foto, la identidad (documento de identidad), el
 *    permiso y la comprobación privada de cada persona; la pestaña sale de los elementos filtrados (pendiente si alguno
 *    espera a personal, si no rechazada, si no aprobada).
 *  - Los elementos entregados por esta vista previa viven en `trust_review_items`; los documentos de identidad y permiso
 *    que suba el flujo de perfil (`db.documents`) también aparecen y se deciden igual.
 *  - Decidir escribe auditoría (`admin.review.decision`); abrir una prueba privada escribe `admin.evidence.access_url_issued`
 *    ANTES de devolver la URL firmada de 120 s (si la auditoría falla, no sale ninguna URL).
 */
import type {
  AdminDossier,
  AdminDossierEvent,
  AdminDossierItem,
  AdminDossierVehicle,
  AdminEvidenceAccess,
  AdminEvidenceKind,
  AdminEvidencePurpose,
  AdminEvidenceRef,
  AdminReasonOption,
  AdminReviewDecision,
  AdminReviewDecisionResult,
  AdminReviewItemKey,
  AdminReviewItemResult,
  AdminReviewQueueItem,
  AdminReviewQueuePage,
  AdminReviewRow,
  AdminReviewTab,
  ReviewState,
  TrustReasonCode,
  TrustSelfRole,
} from "@/api/types";
import { fail, photoUrlFor, signedUrl, writeAudit, STORAGE_PROVIDER_NAME, UUID_RE, type PreviewDb, type Principal } from "@/preview";
import { iso, isoOrNull, maskPhone, nameParts, sliceOf } from "./common";
import { EVIDENCE_CONTENT_TYPE } from "./evidenceArt";
import { reviewTables, SETTING_QUEUE_EMPTY, SETTING_STORAGE_DISABLED, type EvidenceRow, type ReviewItemRow, type StoredItemState } from "./store";

export const ITEM_KEYS: readonly AdminReviewItemKey[] = ["identity", "driver_license", "profile_photo", "private_check"];

/** Vida de la URL firmada de la documentación privada (contrato: 120 s). */
export const EVIDENCE_TTL_SECONDS = 120;

const ACCESS_NOTE = "Acceso a documentación privada solo para personal autorizado de MVC.";

// ── Motivos (espejo de reasons.ts) ────────────────────────────────────────────────────────────────────────────────

const PHOTO_REASONS: ReadonlyArray<readonly [TrustReasonCode, string]> = [
  ["FACE_NOT_VISIBLE", "Rostro no visible"],
  ["SUNGLASSES_OR_COVERING", "Gafas de sol o rostro tapado"],
  ["MULTIPLE_PEOPLE", "Varias personas"],
  ["LOW_QUALITY", "Poca calidad"],
  ["NOT_A_PERSON", "No es una persona"],
  ["INAPPROPRIATE_CONTENT", "Contenido inapropiado"],
  ["OTHER", "Otro motivo"],
];
const CHECK_RETRY_REASONS: ReadonlyArray<readonly [TrustReasonCode, string]> = [
  ["FACE_OUT_OF_FRAME", "Rostro fuera del marco"],
  ["LOW_LIGHT", "Poca luz"],
  ["IMAGE_BLURRY", "Imagen borrosa"],
  ["FACE_COVERED", "Rostro tapado"],
  ["MULTIPLE_PEOPLE", "Varias personas"],
];
/** `MAX_ATTEMPTS_REACHED` lo fija el sistema, no el revisor. */
const CHECK_REJECT_REASONS: ReadonlyArray<readonly [TrustReasonCode, string]> = [
  ["NOT_MATCHING_PROFILE_PHOTO", "No coincide con la foto de perfil"],
  ["NOT_A_LIVE_PERSON", "No parece una persona real"],
  ["OTHER", "Otro motivo"],
];
const DOCUMENT_REASON: TrustReasonCode = "DOCUMENT_REVIEW_REJECTED";

const isPhotoReason = (code: string): boolean => PHOTO_REASONS.some(([c]) => c === code);
const isCheckRetryReason = (code: string): boolean => CHECK_RETRY_REASONS.some(([c]) => c === code);
const isCheckRejectReason = (code: string): boolean => CHECK_REJECT_REASONS.some(([c]) => c === code) || code === "MAX_ATTEMPTS_REACHED";

function reasonOptionsFor(key: AdminReviewItemKey): AdminReasonOption[] {
  if (key === "profile_photo") return PHOTO_REASONS.map(([code, label]) => ({ code, label, decisions: ["rejected"] }));
  if (key === "private_check") {
    return [
      ...CHECK_RETRY_REASONS.map(([code, label]): AdminReasonOption => ({ code, label, decisions: ["needs_retry"] })),
      ...CHECK_REJECT_REASONS.map(([code, label]): AdminReasonOption => ({ code, label, decisions: ["rejected"] })),
    ];
  }
  return [{ code: DOCUMENT_REASON, label: "Documento no válido", decisions: ["rejected"] }];
}

function codeAllowed(decision: AdminReviewDecision, code: string): boolean {
  if (decision === "needs_retry") return isCheckRetryReason(code);
  if (decision === "rejected") return isPhotoReason(code) || (isCheckRejectReason(code) && code !== "MAX_ATTEMPTS_REACHED") || code === DOCUMENT_REASON;
  return false;
}

function allowedDecisions(key: AdminReviewItemKey, state: ReviewState): AdminReviewDecision[] {
  if (state !== "in_review") return [];
  return key === "private_check" ? ["approved", "needs_retry", "rejected"] : ["approved", "rejected"];
}

// ── Lectura de los elementos de una persona ───────────────────────────────────────────────────────────────────────

interface EvidenceView {
  kind: AdminEvidenceKind;
  id: string;
  label: string;
  contentType: string;
  sizeBytes: number;
  submittedAt: number;
  status: string;
  storageProvider: string;
  storageKey: string;
}

interface ItemView {
  key: AdminReviewItemKey;
  state: ReviewState;
  submittedAt: number | null;
  decidedAt: number | null;
  decidedBy: string | null;
  reason: string | null;
  reasonCode: string | null;
  /** Más reciente primero. */
  evidence: EvidenceView[];
  source: "store" | "document" | "profile" | "none";
}

const NONE = (key: AdminReviewItemKey): ItemView => ({
  key,
  state: "none",
  submittedAt: null,
  decidedAt: null,
  decidedBy: null,
  reason: null,
  reasonCode: null,
  evidence: [],
  source: "none",
});

function evidenceOfRow(row: EvidenceRow): EvidenceView {
  return {
    kind: row.kind,
    id: row.id,
    label: row.label,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    submittedAt: row.submitted_at,
    status: row.status,
    storageProvider: STORAGE_PROVIDER_NAME,
    storageKey: row.storage_key,
  };
}

function storedView(row: Readonly<ReviewItemRow>): ItemView {
  return {
    key: row.key,
    state: row.state,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    reason: row.reason,
    reasonCode: row.reason_code,
    evidence: [...row.evidence].sort((a, b) => b.submitted_at - a.submitted_at).map(evidenceOfRow),
    source: "store",
  };
}

function documentView(db: PreviewDb, userId: string, key: "identity" | "driver_license"): ItemView | null {
  const kind = key === "identity" ? "identity_document" : "driver_license";
  const docs = db.documents
    .filter((d) => d.owner_user_id === userId && d.kind === kind)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 5);
  const latest = docs[0];
  if (latest === undefined) return null;
  const state: ReviewState = latest.review_status === "pending" ? "in_review" : latest.review_status;
  return {
    key,
    state,
    submittedAt: latest.created_at,
    decidedAt: latest.reviewed_at,
    decidedBy: latest.reviewed_by_user_id,
    reason: latest.review_reason,
    reasonCode: null,
    evidence: docs.map((d) => ({
      kind: "private_document",
      id: d.id,
      label: key === "identity" ? "Documento de identidad" : "Permiso de conducir",
      contentType: d.content_type,
      sizeBytes: d.size_bytes,
      submittedAt: d.created_at,
      status: d.review_status === "pending" ? "in_review" : d.review_status,
      storageProvider: d.storage_provider,
      storageKey: d.storage_key,
    })),
    source: "document",
  };
}

type ItemViews = Record<AdminReviewItemKey, ItemView>;

function readItems(db: PreviewDb, userId: string): ItemViews {
  const items = reviewTables(db).items;
  const stored = (key: AdminReviewItemKey): ItemView | null => {
    const row = items.get(`${userId}:${key}`);
    return row === undefined ? null : storedView(row);
  };
  const profile = db.profiles.get(userId);
  const photo =
    stored("profile_photo") ??
    (profile !== undefined && profile.public_photo_status === "approved" && profile.public_photo_key !== null
      ? { ...NONE("profile_photo"), state: "approved" as const, submittedAt: profile.updated_at, decidedAt: profile.updated_at, source: "profile" as const }
      : NONE("profile_photo"));
  return {
    identity: stored("identity") ?? documentView(db, userId, "identity") ?? NONE("identity"),
    driver_license: stored("driver_license") ?? documentView(db, userId, "driver_license") ?? NONE("driver_license"),
    profile_photo: photo,
    private_check: stored("private_check") ?? NONE("private_check"),
  };
}

// ── Fila derivada de una persona (REVIEW_STATES_SQL) ──────────────────────────────────────────────────────────────

interface ReviewRowData {
  userId: string;
  userStatus: "active" | "suspended" | "deleted";
  displayName: string | null;
  roles: TrustSelfRole[];
  views: ItemViews;
  pendingCount: number;
  tab: AdminReviewTab | null;
  refAt: number;
}

interface RowFilter {
  item: AdminReviewItemKey | null;
  role: TrustSelfRole | null;
}

function rolesOfUser(db: PreviewDb, userId: string): TrustSelfRole[] {
  const roles = db.userRoles.filter((r) => r.user_id === userId).map((r) => r.role);
  const out: TrustSelfRole[] = [];
  if (roles.includes("driver")) out.push("driver");
  if (roles.includes("passenger")) out.push("passenger");
  return out;
}

function deriveRow(db: PreviewDb, userId: string, filter: RowFilter): ReviewRowData | null {
  const user = db.users.get(userId);
  if (user === undefined || user.status === "deleted") return null;
  const profile = db.profiles.get(userId);
  if (profile === undefined) return null;
  const roles = rolesOfUser(db, userId);
  if (filter.role !== null && !roles.includes(filter.role)) return null;
  const views = readItems(db, userId);
  const effective = ITEM_KEYS.filter((key) => filter.item === null || filter.item === key).map((key) => views[key]);
  const pendingCount = ITEM_KEYS.filter((key) => views[key].state === "in_review").length;
  const effPending = effective.filter((v) => v.state === "in_review");

  let tab: AdminReviewTab | null = null;
  if (effPending.length > 0) tab = "pending";
  else if (effective.some((v) => v.state === "rejected")) tab = "rejected";
  else if (effective.some((v) => v.state === "approved")) tab = "approved";

  let refAt: number | null = null;
  if (effPending.length > 0) {
    refAt = Math.max(...effPending.map((v) => v.submittedAt ?? 0));
  } else {
    const decided = effective.filter((v) => v.state === "approved" || v.state === "rejected").map((v) => v.decidedAt ?? v.submittedAt ?? 0);
    if (decided.length > 0) refAt = Math.max(...decided);
  }
  return {
    userId,
    userStatus: user.status,
    displayName: profile.display_name,
    roles,
    views,
    pendingCount,
    tab,
    refAt: refAt ?? profile.updated_at,
  };
}

function labelFor(key: AdminReviewItemKey, state: ReviewState): string {
  switch (key) {
    case "identity":
      return state === "approved"
        ? "DNI verificado"
        : state === "in_review"
          ? "Identidad · En revisión"
          : state === "rejected"
            ? "Identidad · Rechazada"
            : "Identidad · Sin enviar";
    case "driver_license":
      return "Permiso de conducir";
    case "profile_photo":
      return "Foto de perfil";
    case "private_check":
      return state === "approved"
        ? "Comprobación privada · Completada"
        : state === "in_review"
          ? "Comprobación privada · En revisión"
          : state === "needs_retry"
            ? "Comprobación privada · Nueva captura"
            : state === "rejected"
              ? "Comprobación privada · Rechazada"
              : "Comprobación privada";
  }
}

/** «Requiere revisión» solo cuando espera a personal y la etiqueta no lo dice ya. */
function badgeFor(key: AdminReviewItemKey, state: ReviewState): string | null {
  if (state !== "in_review") return null;
  return key === "identity" ? null : "Requiere revisión";
}

const STATUS_LABEL: Record<AdminReviewTab | "none", string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  rejected: "Rechazado",
  none: "Sin entregas",
};

function publicPhoto(db: PreviewDb, userId: string): string | null {
  return photoUrlFor(db.profiles.get(userId));
}

function toQueueItem(db: PreviewDb, row: ReviewRowData, reviewerId: string): AdminReviewQueueItem {
  const isDriver = row.roles.includes("driver");
  const rows: AdminReviewRow[] = ITEM_KEYS.filter((key) => {
    if (key === "identity" || key === "profile_photo") return true;
    if (key === "driver_license") return isDriver || row.views.driver_license.state !== "none";
    return row.views.private_check.state !== "none";
  }).map((key) => ({ key, label: labelFor(key, row.views[key].state), state: row.views[key].state, badge: badgeFor(key, row.views[key].state) }));
  const { displayName, firstName } = nameParts(row.displayName);
  const tab = row.tab ?? "none";
  return {
    userId: row.userId,
    displayName,
    firstName,
    photoUrl: publicPhoto(db, row.userId),
    roles: row.roles,
    tab,
    statusLabel: STATUS_LABEL[tab],
    submittedAt: iso(row.refAt),
    rows,
    pendingCount: row.pendingCount,
    canDecide: row.pendingCount > 0 && row.userId !== reviewerId,
  };
}

function summaryOf(db: PreviewDb, userId: string, reviewerId: string): AdminReviewQueueItem | null {
  const row = deriveRow(db, userId, { item: null, role: null });
  return row === null ? null : toQueueItem(db, row, reviewerId);
}

// ── Cola ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface QueueQuery {
  tab: AdminReviewTab;
  role?: TrustSelfRole;
  item?: AdminReviewItemKey;
  sort: "recent" | "oldest";
  cursor?: string;
  limit?: number;
}

export function listQueue(db: PreviewDb, reviewerId: string, query: QueueQuery): AdminReviewQueuePage {
  if (db.getSetting<boolean>(SETTING_QUEUE_EMPTY) === true) {
    return { items: [], nextCursor: null, counts: { pending: 0, approved: 0, rejected: 0 } };
  }
  const filter: RowFilter = { item: query.item ?? null, role: query.role ?? null };
  const rows: ReviewRowData[] = [];
  for (const user of db.users.all()) {
    const row = deriveRow(db, user.id, filter);
    if (row !== null && row.tab !== null) rows.push(row);
  }
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const row of rows) if (row.tab !== null) counts[row.tab] += 1;

  const asc = query.sort === "oldest";
  const inTab = rows
    .filter((row) => row.tab === query.tab)
    .sort((a, b) => {
      if (a.refAt !== b.refAt) return asc ? a.refAt - b.refAt : b.refAt - a.refAt;
      if (a.userId === b.userId) return 0;
      return asc ? (a.userId < b.userId ? -1 : 1) : a.userId < b.userId ? 1 : -1;
    });
  const page = sliceOf(inTab, query.cursor, query.limit);
  return { items: page.items.map((row) => toQueueItem(db, row, reviewerId)), nextCursor: page.nextCursor, counts };
}

// ── Expediente ────────────────────────────────────────────────────────────────────────────────────────────────────

function actorRef(db: PreviewDb, id: string | null): { id: string; displayName: string | null } | null {
  if (id === null) return null;
  return { id, displayName: db.profiles.get(id)?.display_name ?? null };
}

function evidenceRef(e: EvidenceView): AdminEvidenceRef {
  return { kind: e.kind, id: e.id, label: e.label, contentType: e.contentType, sizeBytes: e.sizeBytes, submittedAt: iso(e.submittedAt), status: e.status };
}

function dossierItem(db: PreviewDb, key: AdminReviewItemKey, view: ItemView): AdminDossierItem {
  const state = view.state;
  return {
    key,
    label: labelFor(key, state),
    state,
    badge: badgeFor(key, state),
    submittedAt: isoOrNull(view.submittedAt),
    decidedAt: isoOrNull(view.decidedAt),
    decidedBy: actorRef(db, view.decidedBy),
    reason: view.reason ?? view.reasonCode,
    evidence: view.evidence.map(evidenceRef),
    allowedDecisions: allowedDecisions(key, state),
    reasonOptions: reasonOptionsFor(key),
  };
}

function historyOf(db: PreviewDb, views: ItemViews): AdminDossierEvent[] {
  const events: AdminDossierEvent[] = [];
  const decisionText = (key: AdminReviewItemKey, outcome: string, attempt: number | null): string => {
    const verb = outcome === "approved" || outcome === "accepted" ? "aprobad" : "rechazad";
    switch (key) {
      case "identity":
        return `Documento de identidad ${verb}${verb === "aprobad" ? "o" : "o"}`;
      case "driver_license":
        return `Permiso de conducir ${verb}o`;
      case "profile_photo":
        return `Foto de perfil ${verb}a`;
      case "private_check":
        return outcome === "needs_retry" ? `Captura ${attempt ?? 1}: nueva captura solicitada` : `Captura ${attempt ?? 1} ${outcome === "approved" || outcome === "accepted" ? "aceptada" : "rechazada"}`;
    }
  };
  const submittedText = (key: AdminReviewItemKey, attempt: number | null): string => {
    switch (key) {
      case "identity":
        return "Documento de identidad enviado";
      case "driver_license":
        return "Permiso de conducir enviado";
      case "profile_photo":
        return "Foto de perfil enviada";
      case "private_check":
        return `Captura ${attempt ?? 1} enviada`;
    }
  };
  for (const key of ITEM_KEYS) {
    const view = views[key];
    if (view.source === "none" || view.source === "profile") continue;
    const ordered = [...view.evidence].sort((a, b) => a.submittedAt - b.submittedAt);
    ordered.forEach((e, index) => {
      const attempt = key === "private_check" ? index + 1 : null;
      events.push({ at: iso(e.submittedAt), action: `${key}.submitted`, actor: null, summary: submittedText(key, attempt) });
    });
    if (view.decidedAt !== null && (view.state === "approved" || view.state === "rejected" || view.state === "needs_retry")) {
      const attempt = key === "private_check" ? view.evidence.length : null;
      events.push({
        at: iso(view.decidedAt),
        action: `${key}.${view.state}`,
        actor: actorRef(db, view.decidedBy),
        summary: decisionText(key, view.state, attempt),
      });
    }
  }
  events.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return events.slice(0, 40);
}

function requireUserId(userId: string): void {
  if (!UUID_RE.test(userId)) fail("USER_NOT_FOUND", "No existe esa persona usuaria.", 404);
}

export function getDossier(db: PreviewDb, reviewer: Principal, userId: string): AdminDossier {
  requireUserId(userId);
  const row = deriveRow(db, userId, { item: null, role: null });
  const user = db.users.get(userId);
  if (row === null || user === undefined) return fail("USER_NOT_FOUND", "No existe esa persona usuaria.", 404);
  const summary = toQueueItem(db, row, reviewer.userId);
  const isDriver = row.roles.includes("driver");

  const items: AdminDossierItem[] = [];
  items.push(dossierItem(db, "identity", row.views.identity));
  if (isDriver || row.views.driver_license.evidence.length > 0) items.push(dossierItem(db, "driver_license", row.views.driver_license));
  items.push(dossierItem(db, "profile_photo", row.views.profile_photo));
  if (row.views.private_check.state !== "none") items.push(dossierItem(db, "private_check", row.views.private_check));

  const vehicles: AdminDossierVehicle[] = db.vehicles
    .filter((v) => v.driver_user_id === userId)
    .sort((a, b) => a.created_at - b.created_at)
    .map((v) => ({
      id: v.id,
      label: `${v.make} ${v.model}`,
      plate: v.plate,
      reviewStatus: v.review_status,
      documentationStatus: v.documentation_status,
      vehiclePhotoStatus: v.vehicle_photo_status,
      insuranceStatus: v.insurance_status,
      reviewEndpoint: `/v1/admin/vehicles/${v.id}/review`,
    }));

  const { displayName, firstName } = nameParts(row.displayName);
  return {
    user: {
      id: userId,
      displayName,
      firstName,
      photoUrl: publicPhoto(db, userId),
      roles: row.roles,
      status: row.userStatus,
      phoneMasked: maskPhone(user.phone_e164),
      createdAt: iso(user.created_at),
    },
    summary,
    items,
    vehicles,
    history: historyOf(db, row.views),
    accessNote: ACCESS_NOTE,
  };
}

// ── Decisión ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DecisionInput {
  decision: AdminReviewDecision;
  reason?: string;
  reasonCode?: TrustReasonCode;
  items?: AdminReviewItemKey[];
}

function latestInReview<T extends { status: string }>(list: readonly T[]): T | undefined {
  return list.find((e) => e.status === "in_review");
}

function applyItemDecision(
  db: PreviewDb,
  reviewerId: string,
  userId: string,
  key: AdminReviewItemKey,
  view: ItemView,
  input: { decision: AdminReviewDecision; reason: string | null; reasonCode: string | null },
  requestId: string,
): void {
  const now = db.nowMs();
  const pending = latestInReview(view.evidence);
  if (pending === undefined && view.source !== "store") fail("NOTHING_TO_REVIEW", "No hay entregas pendientes de este elemento.", 409);
  const nextState: StoredItemState = input.decision === "approved" ? "approved" : input.decision === "needs_retry" ? "needs_retry" : "rejected";

  if (view.source === "document") {
    // Documento de identidad / permiso subido por la propia persona: se revisa como lo haría `reviewPrivateDocument`.
    const doc = pending === undefined ? undefined : db.documents.get(pending.id);
    if (doc === undefined) fail("NOTHING_TO_REVIEW", "No hay entregas pendientes de este elemento.", 409);
    else {
      db.documents.update(doc.id, {
        review_status: input.decision === "approved" ? "approved" : "rejected",
        review_reason: input.reason,
        reviewed_by_user_id: reviewerId,
        reviewed_at: now,
        updated_at: now,
      });
    }
  } else {
    const items = reviewTables(db).items;
    const row = items.get(`${userId}:${key}`);
    if (row === undefined) return fail("NOTHING_TO_REVIEW", "No hay entregas pendientes de este elemento.", 409);
    const evidenceStatus = (current: string): string => {
      if (current !== "in_review") return current;
      if (input.decision === "approved") return key === "private_check" ? "accepted" : "approved";
      return input.decision;
    };
    let marked = false;
    const evidence = [...row.evidence]
      .sort((a, b) => b.submitted_at - a.submitted_at)
      .map((e) => {
        if (!marked && e.status === "in_review") {
          marked = true;
          return { ...e, status: evidenceStatus(e.status) };
        }
        return e;
      });
    items.update(row.id, { state: nextState, decided_at: now, decided_by: reviewerId, reason: input.reason, reason_code: input.reasonCode, evidence });
  }

  // Efectos sobre el perfil, como en el servidor: identidad aprobada → verificada; foto aprobada → es la pública.
  const profile = db.profiles.get(userId);
  if (profile !== undefined) {
    if (key === "identity") db.profiles.update(userId, { identity_status: input.decision === "approved" ? "verified" : "rejected", updated_at: now });
    if (key === "profile_photo" && input.decision === "approved") db.profiles.update(userId, { public_photo_status: "approved", updated_at: now });
  }

  writeAudit(db, {
    actorUserId: reviewerId,
    action: "admin.review.decision",
    entityType: "user",
    entityId: userId,
    requestId,
    metadata: { item: key, decision: input.decision, evidenceId: pending?.id ?? null, reasonCode: input.reasonCode, hasReason: input.reason !== null },
  });
}

export function decide(db: PreviewDb, reviewer: Principal, userId: string, input: DecisionInput, requestId: string): AdminReviewDecisionResult {
  requireUserId(userId);
  const base = deriveRow(db, userId, { item: null, role: null });
  if (base === null) return fail("USER_NOT_FOUND", "No existe esa persona usuaria.", 404);
  if (userId === reviewer.userId) return fail("SELF_REVIEW_FORBIDDEN", "No puedes revisar tu propio expediente.", 403);

  const trimmed = input.reason?.trim() ?? "";
  const reason = trimmed === "" ? null : trimmed;
  if (input.decision === "rejected" && (reason === null || reason.length < 3)) {
    fail("REVIEW_REASON_REQUIRED", "Indica el motivo del rechazo (al menos 3 caracteres).", 422);
  }
  if (reason !== null && reason.length > 1000) fail("REVIEW_REASON_REQUIRED", "El motivo no puede superar los 1000 caracteres.", 422);
  if (input.decision === "needs_retry" && input.reasonCode === undefined) fail("REVIEW_REASON_REQUIRED", "Indica por qué hace falta otra captura.", 422);
  if (input.reasonCode !== undefined && !codeAllowed(input.decision, input.reasonCode)) {
    fail("REVIEW_REASON_CODE_INVALID", "El código de motivo no es válido para esta decisión.", 422, { reasonCode: input.reasonCode });
  }

  const requested = input.items === undefined ? null : [...new Set(input.items)];
  const targets = ITEM_KEYS.filter((key) => (requested !== null ? requested.includes(key) : base.views[key].state === "in_review"));
  const results: AdminReviewItemResult[] = [];

  db.tx(() => {
    for (const key of targets) {
      if (input.decision === "needs_retry" && key !== "private_check") {
        results.push({ item: key, outcome: "skipped", errorCode: "REVIEW_ITEM_INVALID", message: "Solo la comprobación privada admite pedir otra captura." });
        continue;
      }
      const view = base.views[key];
      if (view.state !== "in_review") {
        results.push({ item: key, outcome: "skipped", errorCode: "NOTHING_TO_REVIEW", message: "No hay entregas pendientes de este elemento." });
        continue;
      }
      applyItemDecision(db, reviewer.userId, userId, key, view, { decision: input.decision, reason, reasonCode: input.reasonCode ?? null }, requestId);
      results.push({ item: key, outcome: input.decision, errorCode: null, message: null });
    }
  });

  if (!results.some((r) => r.outcome !== "skipped")) {
    return fail("NOTHING_TO_REVIEW", "No hay ningún elemento pendiente de revisión para esta decisión.", 409, { results });
  }
  return { userId, results, summary: summaryOf(db, userId, reviewer.userId) };
}

// ── Acceso a la documentación privada ─────────────────────────────────────────────────────────────────────────────

interface LocatedEvidence {
  ownerUserId: string;
  storageProvider: string;
  storageKey: string;
  contentType: string;
  entityType: string;
}

function locateEvidence(db: PreviewDb, kind: AdminEvidenceKind, evidenceId: string): LocatedEvidence | null {
  if (!UUID_RE.test(evidenceId)) return null;
  const entityType = kind === "profile_photo" ? "profile_photo" : kind === "identity_selfie" ? "identity_check_attempt" : "private_document";
  for (const row of reviewTables(db).items.all()) {
    const found = row.evidence.find((e) => e.id === evidenceId && e.kind === kind);
    if (found !== undefined) {
      return { ownerUserId: row.user_id, storageProvider: STORAGE_PROVIDER_NAME, storageKey: found.storage_key, contentType: found.content_type, entityType };
    }
  }
  if (kind === "private_document") {
    const doc = db.documents.get(evidenceId);
    if (doc !== undefined) {
      return { ownerUserId: doc.owner_user_id, storageProvider: doc.storage_provider, storageKey: doc.storage_key, contentType: doc.content_type, entityType };
    }
  }
  return null;
}

/** Orden del servidor: localizar → firmar → AUDITAR → devolver. */
export function issueEvidenceAccess(
  db: PreviewDb,
  principal: Principal,
  kind: AdminEvidenceKind,
  evidenceId: string,
  input: { purpose: AdminEvidencePurpose; note?: string },
  requestId: string,
): AdminEvidenceAccess {
  const located = locateEvidence(db, kind, evidenceId);
  if (located === null) return fail("EVIDENCE_NOT_FOUND", "No existe esa evidencia.", 404);
  if (located.ownerUserId === principal.userId) {
    return fail("SELF_REVIEW_FORBIDDEN", "No puedes acceder a tu propia documentación desde el panel.", 403);
  }
  if (db.getSetting<boolean>(SETTING_STORAGE_DISABLED) === true) {
    return fail("PRIVATE_STORAGE_DISABLED", "El almacenamiento privado no está disponible.", 503);
  }
  if (located.storageProvider !== STORAGE_PROVIDER_NAME) {
    return fail("EVIDENCE_STORAGE_MISMATCH", "El archivo está en otro proveedor de almacenamiento.", 409);
  }
  const now = db.nowMs();
  const expiresAtMs = now + EVIDENCE_TTL_SECONDS * 1000;
  const url = signedUrl("download", located.storageKey, expiresAtMs);
  const note = input.note?.trim() ?? "";
  writeAudit(db, {
    actorUserId: principal.userId,
    action: "admin.evidence.access_url_issued",
    entityType: located.entityType,
    entityId: evidenceId,
    requestId,
    metadata: {
      evidenceKind: kind,
      purpose: input.purpose,
      ...(note !== "" ? { note } : {}),
      ttlSeconds: EVIDENCE_TTL_SECONDS,
      ownerUserId: located.ownerUserId,
      contentType: located.contentType === "" ? EVIDENCE_CONTENT_TYPE : located.contentType,
    },
  });
  return { url, expiresAt: iso(expiresAtMs), ttlSeconds: EVIDENCE_TTL_SECONDS, contentType: located.contentType, evidence: { kind, id: evidenceId } };
}
