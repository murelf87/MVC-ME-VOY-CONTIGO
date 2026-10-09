/**
 * Filas del backend en memoria del slice `messages` (SIMULACIÓN, solo vista previa; docs/contracts/comms.md §9–§10).
 *
 * El núcleo ya guarda los mensajes directos en `trip_direct_messages` (`db.messages`, ampliada con `seq`, `kind` y ubicación)
 * y los bloqueos en `user_blocks` (`db.blocks`). Aquí solo viven las tablas propias del módulo `comms`, con el prefijo
 * `comms_` de la vista previa y la convención del núcleo: columnas en snake_case, instantes en milisegundos.
 *
 * NO hay tabla de conversaciones: como en el contrato (§2.1) una conversación directa es «un viaje + un pasajero con reserva
 * vigente» y un grupo es «una ruta recurrente», y su pertenencia se DERIVA en cada petición (`access.ts`).
 */
import type { NotificationCategory, PushPlatform, PushTokenProvider, UserReportReason, UserReportStatus } from "@/api/types";
import type { Collection, PreviewDb } from "@/preview";

/** Mensaje de un grupo de ruta (tabla `chat_group_messages`). */
export interface GroupMessageRow {
  id: string;
  /** Id derivado de la ruta (`groupConversationId`). */
  conversation_id: string;
  sender_user_id: string;
  client_message_id: string;
  kind: "text" | "location";
  body: string;
  location_lat: number | null;
  location_lng: number | null;
  location_label: string | null;
  hidden_at: number | null;
  hidden_by_user_id: string | null;
  hidden_reason: string | null;
  created_at: number;
  seq: number;
}

/** Puntero de lectura/entrega de una persona en una conversación (tabla `chat_participants`). */
export interface ReadStateRow {
  /** `${user_id}:${conversation_id}` */
  id: string;
  user_id: string;
  conversation_id: string;
  last_read_seq: number;
  last_delivered_seq: number;
  updated_at: number;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  category: NotificationCategory;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  essential: boolean;
  read_at: number | null;
  created_at: number;
  /** `suppressed` = oculta por las preferencias de la persona (no se lista ni se cuenta). */
  delivery_state: "delivered" | "suppressed";
}

export interface PreferencesRow {
  user_id: string;
  arrival_alerts: boolean;
  messages: boolean;
  updated_at: number;
}

export interface PushTokenRow {
  id: string;
  user_id: string;
  token: string;
  platform: PushPlatform;
  provider: PushTokenProvider;
  device_id: string | null;
  app_version: string | null;
  locale: string | null;
  created_at: number;
  last_seen_at: number;
}

export interface UserReportRow {
  id: string;
  reporter_user_id: string;
  reported_user_id: string;
  reason: UserReportReason;
  details: string | null;
  trip_id: string | null;
  conversation_id: string | null;
  status: UserReportStatus;
  /** Solo interna: nunca se muestra a la persona que denuncia. */
  resolution_note: string | null;
  resolved_by_user_id: string | null;
  resolved_at: number | null;
  /** `Idempotency-Key` con la que se creó (repetirla devuelve la misma denuncia). */
  idempotency_key: string | null;
  /** Huella del cuerpo con el que se creó la denuncia (misma clave + otro cuerpo → 409). */
  idempotency_fingerprint: string | null;
  created_at: number;
  updated_at: number;
}

/** Copia LITERAL de un mensaje tomada al denunciar (tabla `user_report_evidence`). */
export interface UserReportEvidenceRow {
  id: string;
  report_id: string;
  message_source: "direct" | "group";
  message_id: string;
  sender_user_id: string;
  kind: "text" | "location";
  body: string;
  location_lat: number | null;
  location_lng: number | null;
  message_created_at: number;
  created_at: number;
}

/** Importe guardado: céntimos enteros o `null` mientras no exista tarifa (misma forma que `AmountRow` de «pagos y cobros»). */
export interface AmountRow {
  cents: number | null;
  status: "defined" | "pending_definition" | "illustrative";
}

/**
 * Devolución del pasajero (`money_refunds`). La forma es la de `RefundRow` de `features/account/preview/moneyRows.ts`: la
 * crea este slice al cancelar una reserva y la leen «Mis devoluciones» (`GET /v1/me/refunds`) y el panel de finanzas.
 */
export interface MoneyRefundRow {
  id: string;
  user_id: string;
  status: "pending_review" | "approved" | "executing" | "refunded" | "rejected" | "failed" | "not_applicable";
  origin: "passenger_cancellation" | "driver_cancellation" | "platform_cancellation" | "force_majeure" | "no_show" | "late_payment" | "other";
  booking_id: string | null;
  request_id: string;
  payment_id: string | null;
  paid: AmountRow;
  proposed: AmountRow;
  approved: AmountRow;
  platform_fee: AmountRow;
  final_cost: AmountRow;
  execution_status: "not_started" | "awaiting_provider" | "submitted" | "succeeded" | "failed";
  policy_status: "pending_review" | "approved";
  policy_version: number | null;
  created_at: number;
  decided_at: number | null;
  refunded_at: number | null;
}

export interface CommsTables {
  groupMessages: Collection<GroupMessageRow>;
  readStates: Collection<ReadStateRow>;
  notifications: Collection<NotificationRow>;
  preferences: Collection<PreferencesRow>;
  pushTokens: Collection<PushTokenRow>;
  reports: Collection<UserReportRow>;
  evidence: Collection<UserReportEvidenceRow>;
  refunds: Collection<MoneyRefundRow>;
}

export function tablesOf(db: PreviewDb): CommsTables {
  return {
    groupMessages: db.collection<GroupMessageRow>("comms_group_messages"),
    readStates: db.collection<ReadStateRow>("comms_read_states"),
    notifications: db.collection<NotificationRow>("comms_notifications"),
    preferences: db.collection<PreferencesRow>("comms_notification_preferences", { pk: "user_id" }),
    pushTokens: db.collection<PushTokenRow>("comms_push_tokens"),
    reports: db.collection<UserReportRow>("comms_user_reports"),
    evidence: db.collection<UserReportEvidenceRow>("comms_user_report_evidence"),
    refunds: db.collection<MoneyRefundRow>("money_refunds"),
  };
}

/**
 * Crea las tablas y declara sus índices únicos. Se llama UNA vez desde `registerPreview` (antes de cualquier siembra o
 * restauración de instantánea, para que las filas cargadas queden indexadas).
 */
export function declareTables(db: PreviewDb): void {
  const t = tablesOf(db);
  t.groupMessages.unique("sender_client_message", (row) => `${row.sender_user_id}|${row.client_message_id}`);
  t.pushTokens.unique("token", (row) => row.token);
}
