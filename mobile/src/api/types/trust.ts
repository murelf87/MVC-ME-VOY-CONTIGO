/**
 * Contrato del módulo «trust»: foto de perfil, comprobación privada, identidad, documentos legales y
 * panel de administración (pantallas 05–08 y 37–40 del diseño).
 *
 * Fuente de verdad del formato en el cable: los schemas Fastify de `src/modules/trust` producen exactamente esto.
 * Endpoints, ejemplos, errores y máquinas de estado: docs/contracts/trust.md
 *
 * Reglas que este contrato hace visibles:
 *  - La selfie NO acredita identidad (`selfieAloneVerifiesIdentity: false`); no hay biometría facial
 *    (`biometricMatching: "not_activated"`); la revisión la hace una persona (`review: "human"`).
 *  - Dinero siempre `Money` (céntimos). Sin tarifa/política aprobada → `pending_definition` («Por definir»).
 *    `illustrative` solo aparece en `AdminTariffExample` (texto «Ejemplo») y en la vista previa.
 *  - Nada de claves de almacenamiento, teléfonos completos ni coordenadas precisas viaja en estos tipos.
 */
import type { IsoDateTime, Money, Page, ReviewState, Uuid } from "./common";
import type { Role } from "./core";

/* ───────────────────────────── Comunes ───────────────────────────── */

export type TrustStaffRole = "admin" | "verification_admin" | "finance_admin" | "support_admin";
/** Roles que el propio usuario puede tener (nunca de personal). */
export type TrustSelfRole = Role;

/** Motivo legible por la UI. `code` es estable (para textos propios); `message` es el texto es-ES del servidor. */
export interface TrustReason {
  code: TrustReasonCode;
  /** «Necesitamos otra captura» (null si no aplica). */
  title: string | null;
  /** «El rostro está fuera del marco o no se ve con claridad». */
  message: string;
}

export const TRUST_PHOTO_REASON_CODES = [
  "FACE_NOT_VISIBLE",
  "SUNGLASSES_OR_COVERING",
  "MULTIPLE_PEOPLE",
  "LOW_QUALITY",
  "NOT_A_PERSON",
  "INAPPROPRIATE_CONTENT",
  "OTHER",
] as const;
export type TrustPhotoReasonCode = (typeof TRUST_PHOTO_REASON_CODES)[number];

export const TRUST_CHECK_RETRY_REASON_CODES = [
  "FACE_OUT_OF_FRAME",
  "LOW_LIGHT",
  "IMAGE_BLURRY",
  "FACE_COVERED",
  "MULTIPLE_PEOPLE",
] as const;
export const TRUST_CHECK_REJECT_REASON_CODES = [
  "NOT_MATCHING_PROFILE_PHOTO",
  "NOT_A_LIVE_PERSON",
  "MAX_ATTEMPTS_REACHED",
  "OTHER",
] as const;
export type TrustCheckReasonCode =
  | (typeof TRUST_CHECK_RETRY_REASON_CODES)[number]
  | (typeof TRUST_CHECK_REJECT_REASON_CODES)[number];

/** Motivo de un documento (identidad / permiso): texto libre del revisor (ya visible hoy en GET /v1/me/documents). */
export type TrustDocumentReasonCode = "DOCUMENT_REVIEW_REJECTED";
export type TrustReasonCode = TrustPhotoReasonCode | TrustCheckReasonCode | TrustDocumentReasonCode;

/** Intención de subida directa al almacenamiento privado (misma mecánica que las subidas de vehículo). */
export interface TrustUploadIntent {
  intentId: Uuid;
  /** URL firmada de un solo uso; `PUT` con `headers` y el binario como cuerpo. */
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: IsoDateTime;
  maxSizeBytes: number;
  allowedContentTypes: string[];
}

export interface TrustUploadIntentRequest {
  contentType: string;
  /** Tamaño exacto en bytes del archivo que se va a subir (se verifica al completar). */
  sizeBytes: number;
}

/* ─────────────────── Foto de perfil (pantalla 05) ─────────────────── */

export type TrustPhotoSubmissionStatus = "in_review" | "approved" | "rejected" | "superseded";

export interface TrustPhotoSubmission {
  id: Uuid;
  status: TrustPhotoSubmissionStatus;
  submittedAt: IsoDateTime;
  decidedAt: IsoDateTime | null;
  reason: TrustReason | null;
  /** Vista previa firmada de SU propia foto (caduca en minutos); null con el almacenamiento desactivado. */
  previewUrl: string | null;
  previewExpiresAt: IsoDateTime | null;
}

export interface ProfilePhotoState {
  /**
   * Estado a efectos de producto (puerta para publicar viajes):
   *  - approved: existe una foto aprobada y visible (aunque haya una nueva en revisión).
   *  - in_review / rejected: no hay aprobada; refleja la última entrega.
   *  - none: sin foto.
   */
  state: "none" | "in_review" | "approved" | "rejected";
  /** «Obligatoria para ambos perfiles». */
  required: true;
  /** Ruta relativa a la API de la foto aprobada visible para otros usuarios (`/v1/public/users/{id}/photo?v=…`). */
  publicPhotoUrl: string | null;
  /** Última entrega (puede ser distinta de la visible). */
  latest: TrustPhotoSubmission | null;
  /** false si el almacenamiento privado no está configurado: subir devolvería PRIVATE_STORAGE_DISABLED. */
  uploadAvailable: boolean;
}

/* ───────── Comprobación privada (pantallas 06, 07, 08) ───────── */

/** Máquina de estados: not_started → in_review → (completed | needs_retry | rejected); needs_retry → in_review. */
export type PrivateCheckStateName = "not_started" | "in_review" | "needs_retry" | "completed" | "rejected";
export type PrivateCheckMethod = "selfie" | "identity_document";
/** Qué debe hacer la UI a continuación. */
export type PrivateCheckNextAction =
  | "accept_notice"
  | "capture"
  | "retry_capture"
  | "wait_review"
  | "use_alternative"
  | "none";

export interface PrivateCheckConsent {
  noticeKind: "private_check_notice";
  /** Versión vigente del aviso de privacidad de la comprobación (pantalla 07); null si no existe ninguna. */
  noticeVersion: number | null;
  accepted: boolean;
  acceptedAt: IsoDateTime | null;
  /** false mientras el texto esté «pendiente de revisión legal» (aviso en borrador). */
  noticeLegallyReviewed: boolean;
}

export interface PrivateCheckAttempt {
  id: Uuid;
  attemptNo: number;
  status: "in_review" | "accepted" | "needs_retry" | "rejected" | "superseded";
  submittedAt: IsoDateTime;
  decidedAt: IsoDateTime | null;
  /** Vista previa firmada de SU propia captura (la UI la muestra desenfocada, pantalla 08). */
  previewUrl: string | null;
  previewExpiresAt: IsoDateTime | null;
}

export interface PrivateCheckState {
  state: PrivateCheckStateName;
  method: PrivateCheckMethod | null;
  /** «Intentos: 2 de 3». */
  attempts: { used: number; max: number; remaining: number };
  /** Presente en needs_retry y rejected. */
  reason: TrustReason | null;
  nextAction: PrivateCheckNextAction;
  /** «Otra forma de verificar»: aportar un documento de identidad. Siempre disponible salvo identidad ya verificada. */
  canUseAlternative: boolean;
  consent: PrivateCheckConsent;
  lastAttempt: PrivateCheckAttempt | null;
  /** Revisión humana; sin proveedor de biometría facial. */
  review: "human";
  biometricMatching: "not_activated";
  /** La selfie por sí sola nunca marca la identidad como verificada. */
  selfieAloneVerifiesIdentity: false;
  /** false si el almacenamiento privado no está configurado. */
  uploadAvailable: boolean;
  updatedAt: IsoDateTime | null;
}

/* ───────────── Identidad y documentos (alternativa) ───────────── */

export type TrustIdentityStatus = "unverified" | "pending" | "verified" | "rejected";
export type TrustDocumentKind = "identity_document" | "driver_license";

export interface TrustDocumentSubmission {
  id: Uuid;
  kind: TrustDocumentKind;
  status: "in_review" | "approved" | "rejected";
  submittedAt: IsoDateTime;
  decidedAt: IsoDateTime | null;
  reason: TrustReason | null;
}

export interface TrustIdentityState {
  /** Refleja `profiles.identity_status`. Solo un documento de identidad aprobado por personal lo pone en `verified`. */
  status: TrustIdentityStatus;
  verifiedBy: "identity_document" | null;
  /** Documentos de identidad entregados, más recientes primero. */
  documents: TrustDocumentSubmission[];
  /** Último permiso de conducir (solo si el usuario es conductor). */
  driverLicense: TrustDocumentSubmission | null;
  uploadAvailable: boolean;
}

export interface TrustDocumentUploadCompleted {
  document: TrustDocumentSubmission;
  privateCheck: PrivateCheckState;
  identity: TrustIdentityState;
}

export interface TrustVerificationOverview {
  roles: TrustSelfRole[];
  photo: ProfilePhotoState;
  privateCheck: PrivateCheckState;
  identity: TrustIdentityState;
}

export interface TrustRolesRequest {
  /** Al menos uno. Nunca roles de personal. */
  roles: TrustSelfRole[];
}
export interface TrustRolesResponse {
  roles: TrustSelfRole[];
}

/* ───────────────────────────── Legal ───────────────────────────── */

export type LegalDocumentKind = "terms" | "privacy" | "cancellation" | "private_check_notice";
/** `draft_pending_legal_review`: texto estructural SIN validez legal hasta que Legal lo revise y publique. */
export type LegalDocumentStatus = "draft_pending_legal_review" | "published" | "retired";
export type LegalAcceptanceContext = "registration" | "account" | "booking" | "private_check" | "other";

export interface LegalSection {
  heading: string;
  paragraphs: string[];
  bullets: string[];
}

export interface LegalDocumentSummary {
  id: Uuid;
  kind: LegalDocumentKind;
  version: number;
  status: LegalDocumentStatus;
  title: string;
  locale: "es-ES";
  /** true solo si `status === "published"`. */
  legallyEffective: boolean;
  /** true mientras `status === "draft_pending_legal_review"` (Bloqueado: revisión legal). */
  pendingLegalReview: boolean;
  effectiveFrom: IsoDateTime | null;
  publishedAt: IsoDateTime | null;
  contentSha256: string;
}
export interface LegalDocument extends LegalDocumentSummary {
  sections: LegalSection[];
}

export interface LegalAcceptance {
  id: Uuid;
  documentId: Uuid;
  kind: LegalDocumentKind;
  version: number;
  context: LegalAcceptanceContext;
  acceptedAt: IsoDateTime;
  /** true si el documento estaba publicado al aceptar; false si era un borrador pendiente de revisión legal. */
  legallyEffective: boolean;
}
export interface LegalAcceptRequest {
  kind: LegalDocumentKind;
  /** Debe ser la versión vigente (la que devuelve GET /v1/legal/documents). */
  version: number;
  context?: LegalAcceptanceContext;
}

export interface LegalStatusItem {
  kind: LegalDocumentKind;
  latestVersion: number;
  status: LegalDocumentStatus;
  pendingLegalReview: boolean;
  /** Dónde se exige: cuenta (términos+privacidad), reserva (cancelación) o comprobación privada. */
  scope: "account" | "booking" | "private_check";
  accepted: boolean;
  acceptedVersion: number | null;
  acceptedAt: IsoDateTime | null;
}
export interface LegalStatus {
  items: LegalStatusItem[];
  /** términos + privacidad aceptados en su versión vigente. */
  accountDocumentsAccepted: boolean;
}

/* ───────────────────── Administración · comunes ───────────────────── */

export type AdminResource =
  | "summary"
  | "finance_kpis"
  | "review"
  | "evidence"
  | "bookings"
  | "tariffs"
  | "tariff_activation"
  | "operations"
  | "alerts"
  | "audit"
  | "legal"
  | "support";
export type AdminPermission = "none" | "read" | "write";

export interface AdminMe {
  userId: Uuid;
  displayName: string | null;
  roles: TrustStaffRole[];
  permissions: Record<AdminResource, AdminPermission>;
}

export type AdminPeriod = "today" | "yesterday" | "last_7_days" | "last_30_days" | "this_month";

export interface AdminWindow {
  period: AdminPeriod;
  timeZone: "Europe/Madrid";
  from: IsoDateTime;
  to: IsoDateTime;
  /** Periodo de comparación de la misma duración inmediatamente anterior. */
  previousFrom: IsoDateTime;
  previousTo: IsoDateTime;
}

export interface AdminProvinceRef {
  id: Uuid;
  code: string;
  name: string;
}

/* ─────────────── Resumen de administración (pantalla 37) ─────────────── */

export type AdminTrend = "up" | "down" | "flat" | "new" | "unavailable";

export interface AdminCountKpi {
  /** null si la fuente no existe todavía (available=false): la UI muestra «—», nunca un 0 inventado. */
  value: number | null;
  previous: number | null;
  /** Entero redondeado: 12 → «+12 %», −8 → «−8 %». null si previous = 0 o no disponible. */
  deltaPercent: number | null;
  trend: AdminTrend;
  available: boolean;
  /** Definición exacta de lo que se cuenta (para tooltip/ayuda). */
  definition: string;
}

export interface AdminMoneyKpi {
  amount: Money;
  /** De dónde sale el importe; "none" cuando no hay fuente aprobada (→ pending_definition). */
  source: "commissions_of_confirmed_bookings" | "none";
  note: string | null;
}

export interface AdminFinanceKpis {
  grossRevenue: AdminMoneyKpi;
  operatingCosts: AdminMoneyKpi;
  result: AdminMoneyKpi;
  /** Hay una tarifa aprobada en vigor. Si es false, todo importe derivado es «Por definir». */
  economicsActivated: boolean;
}

export interface AdminSummary {
  generatedAt: IsoDateTime;
  window: AdminWindow;
  /** null = todas las provincias. */
  province: AdminProvinceRef | null;
  kpis: {
    /** «Viajes activos»: viajes publicados/en curso/completados con salida en el periodo. */
    activeTrips: AdminCountKpi;
    /** «Solicitudes»: solicitudes de plaza creadas en el periodo. */
    requests: AdminCountKpi;
    /** «Incidencias»: reportes de incidencia del periodo (fuente: módulo live si existe). */
    incidents: AdminCountKpi;
  };
  /** Instantánea del momento (no depende del periodo). */
  liveNow: { tripsInProgress: number };
  /** null para roles sin acceso a finanzas (verification_admin / support_admin). */
  finance: AdminFinanceKpis | null;
  notes: string[];
}

/** Actividad de vehículos (aproximada): celdas de ~2 km; NUNCA posiciones precisas ni identidades. */
export interface AdminVehicleCluster {
  id: string;
  kind: "vehicle" | "cluster";
  count: number;
  /** Centro de la celda de la cuadrícula, no la posición real. */
  lat: number;
  lng: number;
  precisionMeters: number;
}
export interface AdminVehicleActivity {
  generatedAt: IsoDateTime;
  province: AdminProvinceRef | null;
  label: "Actividad de vehículos (aproximada)";
  precision: "approximate";
  gridDegrees: number;
  /** Solo cuentan posiciones recibidas hace menos de esto (nunca «en ruta» con una posición vieja). */
  freshnessSeconds: number;
  totalVehicles: number;
  items: AdminVehicleCluster[];
}

/* ──────────────── Usuarios y revisión (pantalla 38) ──────────────── */

export type AdminReviewItemKey = "identity" | "private_check" | "driver_license" | "profile_photo";
export type AdminReviewTab = "pending" | "approved" | "rejected";
export type AdminReviewDecision = "approved" | "rejected" | "needs_retry";

export interface AdminReviewRow {
  key: AdminReviewItemKey;
  /** «Identidad · En revisión», «DNI verificado», «Permiso de conducir», «Foto de perfil». */
  label: string;
  state: ReviewState;
  /** «Requiere revisión» cuando el elemento espera a personal; null en caso contrario. */
  badge: string | null;
}

export interface AdminReviewQueueItem {
  userId: Uuid;
  displayName: string;
  firstName: string;
  /** Foto pública aprobada (ruta relativa a la API) o null. */
  photoUrl: string | null;
  roles: TrustSelfRole[];
  /** Pestaña del panel. `none`: la persona no tiene nada entregado (no aparece en ninguna pestaña, pero su expediente sí se abre). */
  tab: AdminReviewTab | "none";
  /** «Pendiente». */
  statusLabel: string;
  /** Instante de la entrega más reciente que espera revisión (o de la última decisión). */
  submittedAt: IsoDateTime;
  rows: AdminReviewRow[];
  pendingCount: number;
  canDecide: boolean;
}

export interface AdminReviewQueuePage extends Page<AdminReviewQueueItem> {
  /** «Pendientes (5)»: respeta el filtro de rol y de elemento. */
  counts: { pending: number; approved: number; rejected: number };
}

export interface AdminReasonOption {
  code: TrustReasonCode;
  label: string;
  decisions: AdminReviewDecision[];
}

export type AdminEvidenceKind = "profile_photo" | "identity_selfie" | "private_document";
export interface AdminEvidenceRef {
  kind: AdminEvidenceKind;
  id: Uuid;
  label: string;
  contentType: string;
  sizeBytes: number;
  submittedAt: IsoDateTime;
  status: string;
}

export interface AdminDossierItem {
  key: AdminReviewItemKey;
  label: string;
  state: ReviewState;
  badge: string | null;
  submittedAt: IsoDateTime | null;
  decidedAt: IsoDateTime | null;
  decidedBy: { id: Uuid; displayName: string | null } | null;
  /** Motivo interno de la última decisión (solo personal). */
  reason: string | null;
  evidence: AdminEvidenceRef[];
  allowedDecisions: AdminReviewDecision[];
  reasonOptions: AdminReasonOption[];
}

export interface AdminDossierVehicle {
  id: Uuid;
  label: string;
  plate: string;
  reviewStatus: "pending" | "approved" | "rejected";
  documentationStatus: "pending" | "approved" | "rejected";
  vehiclePhotoStatus: "pending" | "approved" | "rejected";
  insuranceStatus: "pending" | "approved" | "rejected";
  /** Se revisa con el endpoint existente POST /v1/admin/vehicles/{id}/review. */
  reviewEndpoint: string;
}

export interface AdminDossierEvent {
  at: IsoDateTime;
  action: string;
  actor: { id: Uuid; displayName: string | null } | null;
  summary: string;
}

export interface AdminDossier {
  user: {
    id: Uuid;
    displayName: string;
    firstName: string;
    photoUrl: string | null;
    roles: TrustSelfRole[];
    status: "active" | "suspended" | "deleted";
    /** Teléfono enmascarado («+34 ••• ••• 222»): nunca completo. */
    phoneMasked: string | null;
    createdAt: IsoDateTime;
  };
  summary: AdminReviewQueueItem;
  items: AdminDossierItem[];
  vehicles: AdminDossierVehicle[];
  history: AdminDossierEvent[];
  /** «Acceso a documentación privada solo para personal autorizado de MVC». */
  accessNote: string;
}

export interface AdminReviewDecisionRequest {
  decision: AdminReviewDecision;
  /** Obligatorio (≥3 caracteres) si decision = rejected (`422 REVIEW_REASON_REQUIRED`). Máximo 1000 caracteres. */
  reason?: string;
  /**
   * Obligatorio si decision = needs_retry (uno de TRUST_CHECK_RETRY_REASON_CODES; `422 REVIEW_REASON_REQUIRED` si falta).
   * Opcional en rejected (uno de los motivos de `reasonOptions` del elemento; `422 REVIEW_REASON_CODE_INVALID` si no encaja).
   */
  reasonCode?: TrustReasonCode;
  /** Omitido = todos los elementos que esperan revisión. */
  items?: AdminReviewItemKey[];
}
export interface AdminReviewItemResult {
  item: AdminReviewItemKey;
  outcome: AdminReviewDecision | "skipped";
  /**
   * Solo si `outcome = "skipped"`: `NOTHING_TO_REVIEW` (sin entrega pendiente) o `REVIEW_ITEM_INVALID` (needs_retry fuera de la
   * comprobación privada).
   */
  errorCode: string | null;
  message: string | null;
}
export interface AdminReviewDecisionResult {
  userId: Uuid;
  results: AdminReviewItemResult[];
  /** null solo si la persona dejó de existir entre la decisión y la lectura. */
  summary: AdminReviewQueueItem | null;
}

export type AdminEvidencePurpose =
  | "identity_review"
  | "photo_moderation"
  | "license_review"
  | "vehicle_review"
  | "support_case"
  | "legal_request";
export interface AdminEvidenceAccessRequest {
  purpose: AdminEvidencePurpose;
  note?: string;
}
export interface AdminEvidenceAccess {
  /** URL firmada de lectura de vida corta; el acceso queda auditado. */
  url: string;
  expiresAt: IsoDateTime;
  ttlSeconds: number;
  contentType: string;
  evidence: { kind: AdminEvidenceKind; id: Uuid };
}

/* ─────────────── Reservas y devoluciones (pantalla 39) ─────────────── */

export type AdminBookingStatusFilter = "all" | "cancelled" | "refunded";
export type AdminBookingStatus = "confirmed" | "completed" | "cancelled" | "driver_cancelled" | "no_show";

export interface AdminBookingParty {
  id: Uuid;
  displayName: string;
  firstName: string;
  photoUrl: string | null;
}

export interface AdminBookingRow {
  bookingId: Uuid;
  tripId: Uuid;
  status: AdminBookingStatus;
  /** «Cancelada». */
  statusLabel: string;
  passenger: AdminBookingParty;
  driver: AdminBookingParty;
  /** «5 oct 2026 · 08:12». */
  tripDepartureAt: IsoDateTime | null;
  /** «Sevilla - Los Bermejales» → «Sevilla - Cartuja (Universidad)». */
  route: { originLabel: string | null; destinationLabel: string | null };
  cancelledBy: "passenger" | "driver" | null;
  /** «Cancelada por el pasajero · 08:26». */
  cancelledAt: IsoDateTime | null;
  money: {
    /** «Importe pagado (pasajero)»: lo registrado en la reserva. */
    amountPaid: Money;
    /**
     * «Devolución propuesta»: la propuesta de devolución del módulo money para esa reserva (`defined`); sin propuesta o sin esa
     * fuente, `pending_definition` («Por definir»). Este módulo nunca la calcula (no hay política de cancelación versionada aprobada).
     */
    proposedRefund: Money;
    /** «Comisión plataforma (propuesta)»: comisión retenida de esa propuesta; si no hay, «Por definir». */
    platformCommission: Money;
    /** «Coste final pasajero»: pagado − devolución (aprobada o propuesta); si no hay propuesta, «Por definir». */
    finalPassengerCost: Money;
  };
  refund: {
    status: "not_applicable" | "pending_definition" | "proposed" | "refunded";
    /** Las acciones de devolución pertenecen al módulo money (docs/contracts/money.md). */
    actionOwner: "money";
  };
}

export interface AdminBookingsPage extends Page<AdminBookingRow> {
  /** «Todas (12) · Canceladas (5) · Devueltas (3)». `refunded` es null mientras no exista la tabla de devoluciones del módulo money. */
  counts: { all: number; cancelled: number; refunded: number | null };
}

/* ─────────────── Tarifas y operaciones (pantalla 40) ─────────────── */

export type AdminTariffStatus = "draft" | "approved" | "retired";

export interface AdminTariffVersion {
  id: Uuid;
  version: number;
  status: AdminTariffStatus;
  /** Micro-euros por km: 300000 = 0,30 €/km. null = «Por definir». */
  ratePerKmMicros: number | null;
  /** Puntos básicos: 1000 = 10 %. null = «Por definir». */
  passengerCommissionBps: number | null;
  driverCommissionBps: number | null;
  sharedCostCapCents: number | null;
  /** «Cuota Premium (propuesta)», céntimos/mes. null = «Por definir». */
  premiumMonthlyCents: number | null;
  effectiveFrom: IsoDateTime | null;
  notes: string | null;
  approvalReference: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  createdBy: { id: Uuid; displayName: string | null } | null;
  updatedBy: { id: Uuid; displayName: string | null } | null;
}

export interface AdminTariffOverview {
  /** Tarifa aprobada en vigor. Hoy: null (economía no activada). */
  active: AdminTariffVersion | null;
  draft: AdminTariffVersion | null;
  activation: {
    mode: "disabled" | "enabled";
    /** Con "disabled", publicar devuelve 409 ECONOMICS_ACTIVATION_DISABLED. */
    canPublish: boolean;
    message: string;
  };
  /** «Los cambios de tarifas afectan solo a futuras reservas. No se modifican reservas confirmadas.» */
  applyNote: string;
  auditNote: string;
}

export interface AdminTariffDraftInput {
  ratePerKmMicros: number | null;
  passengerCommissionBps: number | null;
  driverCommissionBps: number | null;
  premiumMonthlyCents: number | null;
  sharedCostCapCents?: number | null;
  notes?: string | null;
}

export interface AdminTariffExampleRequest {
  /** Distancia del trayecto de ejemplo en metros, de 1 a 2 000 000 (18 km = 18000). */
  distanceMeters: number;
  /** Lo que se omite (o es null) queda «Por definir» en la respuesta: no se inventa nada. */
  ratePerKmMicros?: number | null;
  passengerCommissionBps?: number | null;
  driverCommissionBps?: number | null;
}
/** Cálculo de ejemplo: los importes son `illustrative` (texto «Ejemplo») o `pending_definition` si falta un dato. */
export interface AdminTariffExample {
  distanceMeters: number;
  ratePerKmMicros: number | null;
  /** «18 km × 0,30 €/km = 5,40 €». */
  contribution: Money;
  passengerCommission: Money;
  driverCommission: Money;
  /** «Precio final para el pasajero (ejemplo)»: pending_definition si la comisión del pasajero no está definida. */
  passengerTotal: Money;
  driverNet: Money;
  /** «Antes de gestión y del límite de gastos compartidos.» */
  disclaimer: string;
  roundingRule: "half_up_cents";
}

/**
 * Con `ECONOMICS_ACTIVATION=disabled` (por defecto) el servidor responde SIEMPRE 409 `ECONOMICS_ACTIVATION_DISABLED` antes de mirar
 * este cuerpo (incluso si falta o es inválido) y deja el intento auditado. Solo con `enabled` se exige lo siguiente.
 */
export interface AdminTariffPublishRequest {
  /** Referencia de la decisión económica aprobada (acta/ticket), de 3 a 300 caracteres. */
  approvalReference: string;
  /** Instante futuro (ISO-8601) desde el que rige para NUEVAS reservas. */
  effectiveFrom: IsoDateTime;
}

export type AdminAlertKind = "unusual_cancellations" | "schedule_price_changes" | "route_incidents";
export type AdminAlertSeverity = "info" | "warning" | "critical";
export type AdminAlertStatus = "open" | "acknowledged" | "resolved";

export interface AdminAlertRuleParams {
  thresholdCount?: number;
  windowMinutes?: number;
  maxPendingMinutes?: number;
}
export interface AdminAlertRule {
  kind: AdminAlertKind;
  /** «Cancelaciones inusuales», «Cambios de horario o precio (requiere aceptación)», «Incidencias en ruta». */
  label: string;
  enabled: boolean;
  params: AdminAlertRuleParams;
  /** "unavailable" si la fuente de eventos aún no existe (p. ej. incidencias del módulo live). */
  source: "available" | "unavailable";
  sourceNote: string | null;
}

export interface AdminOperations {
  /** «Solo trayectos dentro de la provincia»: siempre activo y bloqueado. */
  provinceOnly: { enabled: true; locked: true; label: string };
  /** «Alertas en tiempo real». */
  realtimeAlerts: { enabled: boolean; rules: AdminAlertRule[] };
  updatedAt: IsoDateTime | null;
  updatedBy: { id: Uuid; displayName: string | null } | null;
}
export interface AdminOperationsUpdate {
  realtimeAlertsEnabled?: boolean;
  rules?: { kind: AdminAlertKind; enabled?: boolean; params?: AdminAlertRuleParams }[];
  /** Solo se acepta `true`; `false` → 422 PROVINCE_ONLY_LOCKED. */
  provinceOnly?: true;
}

export interface AdminAlert {
  id: Uuid;
  kind: AdminAlertKind;
  severity: AdminAlertSeverity;
  status: AdminAlertStatus;
  title: string;
  body: string;
  detectedAt: IsoDateTime;
  province: AdminProvinceRef | null;
  /** Solo identificadores y recuentos (sin datos personales). */
  data: Record<string, unknown>;
  acknowledgedAt: IsoDateTime | null;
  resolvedAt: IsoDateTime | null;
}
export interface AdminAlertEvaluation {
  evaluatedAt: IsoDateTime;
  /** Alertas nuevas creadas en esta evaluación. */
  created: number;
  /** Alertas «cambio de horario o precio» cerradas solas porque su propuesta ya no está pendiente. */
  autoResolved: number;
  rules: {
    kind: AdminAlertKind;
    enabled: boolean;
    evaluated: boolean;
    created: number;
    skippedReason: "disabled" | "realtime_alerts_off" | "source_unavailable" | null;
  }[];
}

/* ───────────────────────── Auditoría (pestaña) ───────────────────────── */

export interface AdminAuditEvent {
  /** bigint serializado como cadena. */
  id: string;
  createdAt: IsoDateTime;
  actor: { id: Uuid; displayName: string | null } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string | null;
  /** Con datos personales ocultos («[oculto]»). */
  metadata: Record<string, unknown>;
  redactions: number;
}

export type AdminAuditPage = Page<AdminAuditEvent>;

/* ───────────────────── Documentos legales (admin) ───────────────────── */

export interface AdminLegalDocumentCreate {
  kind: LegalDocumentKind;
  title: string;
  sections: LegalSection[];
}
export interface AdminLegalPublishRequest {
  /** Quién/qué aprobó el texto (revisión legal). Obligatorio. */
  legalReviewReference: string;
  effectiveFrom?: IsoDateTime;
}

/* ───────────────────── Atención al cliente (personal) ─────────────────────
 * Lee y escribe las consultas del centro de ayuda del módulo comms. Sin esas tablas: 503 SUPPORT_UNAVAILABLE. */

export type AdminSupportTicketStatus = "open" | "answered" | "closed";
export type AdminSupportTicketCategory = "trip_issue" | "payment_issue" | "account_profile";

export interface AdminSupportAttachment {
  id: Uuid;
  contentType: string;
  sizeBytes: number;
  createdAt: IsoDateTime;
}

export interface AdminSupportTicketRow {
  id: Uuid;
  /** «MVC-2026-000123». */
  reference: string;
  status: AdminSupportTicketStatus;
  category: AdminSupportTicketCategory;
  /** «Problema con un viaje», «Problema de pago», «Cuenta y perfil». */
  categoryLabel: string;
  user: { id: Uuid; displayName: string; firstName: string; photoUrl: string | null };
  /** Primeros 140 caracteres de la consulta. */
  preview: string;
  createdAt: IsoDateTime;
  lastUserMessageAt: IsoDateTime;
  lastStaffMessageAt: IsoDateTime | null;
  assignedTo: { id: Uuid; displayName: string | null } | null;
  messageCount: number;
  attachmentCount: number;
  /** true mientras la última palabra es de la persona usuaria (`status = open`). */
  waitingForStaff: boolean;
}

export interface AdminSupportTicketsPage extends Page<AdminSupportTicketRow> {
  /** Contadores globales por estado (no dependen del filtro aplicado). */
  counts: { open: number; answered: number; closed: number };
}

export interface AdminSupportMessage {
  id: Uuid;
  authorType: "user" | "staff";
  author: { id: Uuid; displayName: string | null } | null;
  body: string;
  createdAt: IsoDateTime;
  attachments: AdminSupportAttachment[];
}

export interface AdminSupportTicketDetail extends AdminSupportTicketRow {
  tripId: Uuid | null;
  bookingId: Uuid | null;
  closedAt: IsoDateTime | null;
  closedBy: "user" | "staff" | null;
  messages: AdminSupportMessage[];
  /** Adjuntos de la consulta que no cuelgan de un mensaje concreto. */
  attachments: AdminSupportAttachment[];
}

export interface AdminSupportReplyRequest {
  /** De 1 a 4000 caracteres (se recortan los espacios). */
  body: string;
}
export interface AdminSupportAssignRequest {
  /** `me`: asignármela; `none`: quitar la asignación. */
  assignee: "me" | "none";
}
export interface AdminSupportAttachmentAccessRequest {
  note?: string;
}
export interface AdminSupportAttachmentAccess {
  /** URL firmada de lectura de vida corta; el acceso queda auditado ANTES de devolverla. */
  url: string;
  expiresAt: IsoDateTime;
  ttlSeconds: number;
  contentType: string;
  attachmentId: Uuid;
}

/* ───────────────────────── Errores del módulo ───────────────────────── */

/**
 * Códigos estables que emite este módulo (además de AUTH_REQUIRED, AUTH_INVALID, AUTH_INVALID_OR_EXPIRED,
 * ACCOUNT_NOT_ACTIVE y AUTH_FORBIDDEN del núcleo). Un test unitario (tests/unit/trust-contract-sync.test.ts) verifica que esta lista
 * y los códigos que emite `src/modules/trust` coinciden en los dos sentidos.
 */
export const TRUST_ERROR_CODES = [
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "CURSOR_INVALID",
  "PRIVATE_STORAGE_DISABLED",
  "UPLOAD_INTENT_NOT_FOUND",
  "UPLOAD_INTENT_EXPIRED",
  "UPLOAD_OBJECT_MISSING",
  "UPLOAD_TYPE_NOT_ALLOWED",
  "UPLOAD_SIZE_INVALID",
  "UPLOAD_SIZE_MISMATCH",
  "UPLOAD_TYPE_MISMATCH",
  "UPLOAD_CONTENT_INVALID",
  "UPLOAD_STORAGE_MISMATCH",
  "UPLOAD_RATE_LIMITED",
  "PRIVATE_CHECK_CONSENT_REQUIRED",
  "PRIVATE_CHECK_IN_REVIEW",
  "PRIVATE_CHECK_ALREADY_COMPLETED",
  "PRIVATE_CHECK_MAX_ATTEMPTS_REACHED",
  "PRIVATE_CHECK_REJECTED",
  "DOCUMENT_IN_REVIEW",
  "IDENTITY_ALREADY_VERIFIED",
  "DRIVER_ROLE_REQUIRED",
  "ROLES_INVALID",
  "ROLE_IN_USE",
  "PHOTO_NOT_FOUND",
  "LEGAL_DOCUMENT_NOT_FOUND",
  "LEGAL_VERSION_OUTDATED",
  "LEGAL_DOCUMENT_RETIRED",
  "LEGAL_ALREADY_PUBLISHED",
  "LEGAL_REVIEW_REFERENCE_REQUIRED",
  "LEGAL_CONTENT_INVALID",
  "PROVINCE_NOT_FOUND",
  "USER_NOT_FOUND",
  "SELF_REVIEW_FORBIDDEN",
  "REVIEW_REASON_REQUIRED",
  "REVIEW_REASON_CODE_INVALID",
  "REVIEW_ITEM_INVALID",
  "NOTHING_TO_REVIEW",
  "EVIDENCE_NOT_FOUND",
  "EVIDENCE_STORAGE_MISMATCH",
  "TARIFF_NOT_FOUND",
  "TARIFF_NOT_DRAFT",
  "TARIFF_INVALID",
  "TARIFF_DRAFT_INCOMPLETE",
  "TARIFF_EFFECTIVE_FROM_INVALID",
  "APPROVAL_REFERENCE_REQUIRED",
  "ECONOMICS_ACTIVATION_DISABLED",
  "PROVINCE_ONLY_LOCKED",
  "ALERT_NOT_FOUND",
  "ALERT_INVALID_TRANSITION",
  "AUDIT_FILTER_INVALID",
  "SUPPORT_UNAVAILABLE",
  "TICKET_NOT_FOUND",
  "TICKET_CLOSED",
  "TICKET_ALREADY_CLOSED",
  "ATTACHMENT_NOT_FOUND",
] as const;
export type TrustErrorCode = (typeof TRUST_ERROR_CODES)[number];
