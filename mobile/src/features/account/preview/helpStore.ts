/**
 * Tablas y utilidades del backend en memoria de «ajustes, ayuda y datos» (paquete `account-help`).
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`).
 *
 * Los nombres de las tablas siguen `docs/contracts/comms.md` §9 con el prefijo `comms_` de la vista previa. Las de
 * tickets las comparte `admin-ops` (atención al cliente): `comms_support_tickets`, `comms_support_ticket_messages` y
 * `comms_support_attachments` tienen las columnas del contrato (§9.1); las columnas `idempotency_*` de los tickets son
 * propias de esta simulación y se pueden ignorar. Quien responda desde administración inserta un mensaje con
 * `author_type: "staff"` (y puede dejar `status` en `answered`: la vista del usuario deduce el estado por el último
 * mensaje, igual que el disparador `support_ticket_message_after_insert` del backend).
 */
import type { JsonSchema, PreviewDb } from "@/preview";
import { fail } from "@/preview";

export type FontScaleName = "small" | "normal" | "large" | "extra_large";
export type TicketCategory = "trip_issue" | "payment_issue" | "account_profile";
export type TicketStatus = "open" | "answered" | "closed";

export interface SettingsRow {
  /** = user_id */
  user_id: string;
  share_live_location_in_trip: boolean;
  font_scale: FontScaleName;
  language: "es";
  updated_at: number;
}

export interface TicketRow {
  id: string;
  /** «MVC-2026-000123» */
  reference: string;
  user_id: string;
  category: TicketCategory;
  status: TicketStatus;
  trip_id: string | null;
  booking_id: string | null;
  /** Consulta original (≤ 500). */
  body: string;
  assigned_to_user_id: string | null;
  last_user_message_at: number;
  last_staff_message_at: number | null;
  closed_at: number | null;
  closed_by: "user" | "staff" | null;
  created_at: number;
  updated_at: number;
  /** Solo de la simulación: `Idempotency-Key` de la creación y huella del contenido. */
  idempotency_key?: string | null;
  idempotency_hash?: string | null;
}

export interface TicketMessageRow {
  id: string;
  ticket_id: string;
  author_type: "user" | "staff";
  author_user_id: string;
  body: string;
  created_at: number;
}

export interface AttachmentRow {
  id: string;
  owner_user_id: string;
  ticket_id: string | null;
  message_id: string | null;
  storage_provider: string;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  created_at: number;
}

export interface SupportIntentRow {
  id: string;
  owner_user_id: string;
  storage_provider: string;
  storage_key: string;
  content_type: string;
  expected_size_bytes: number;
  expires_at: number;
  completed_at: number | null;
  attachment_id: string | null;
  created_at: number;
}

export type ExportStatus = "queued" | "processing" | "ready" | "failed" | "blocked_storage_disabled" | "expired";

export interface ExportRow {
  id: string;
  user_id: string;
  status: ExportStatus;
  requested_at: number;
  completed_at: number | null;
  expires_at: number | null;
  size_bytes: number | null;
  storage_key: string | null;
  error_code: string | null;
  /** Lecturas desde que se pidió: hace avanzar la simulación (en cola → preparando → lista) aunque el reloj esté parado. */
  polls: number;
  idempotency_key: string | null;
}

export type DeletionStatus = "scheduled" | "blocked" | "processing" | "completed" | "cancelled";

export interface DeletionRow {
  id: string;
  user_id: string;
  status: DeletionStatus;
  requested_at: number;
  scheduled_for: number;
  cancelled_at: number | null;
  completed_at: number | null;
  reason: string | null;
  blockers: Array<{ code: string; message: string; count: number }>;
}

export const settingsTable = (db: PreviewDb) => db.collection<SettingsRow>("comms_user_settings", { pk: "user_id" });
export const ticketsTable = (db: PreviewDb) => db.collection<TicketRow>("comms_support_tickets");
export const ticketMessagesTable = (db: PreviewDb) => db.collection<TicketMessageRow>("comms_support_ticket_messages");
export const attachmentsTable = (db: PreviewDb) => db.collection<AttachmentRow>("comms_support_attachments");
export const supportIntentsTable = (db: PreviewDb) => db.collection<SupportIntentRow>("comms_support_upload_intents");
export const exportsTable = (db: PreviewDb) => db.collection<ExportRow>("comms_data_exports");
export const deletionsTable = (db: PreviewDb) => db.collection<DeletionRow>("comms_account_deletions");

/** Ajuste de la simulación: el almacenamiento privado está «desactivado» (`PRIVATE_STORAGE_PROVIDER=disabled`). */
export const STORAGE_OFF_SETTING = "help.storageDisabled";

export function storageDisabled(db: PreviewDb): boolean {
  return db.getSetting<boolean>(STORAGE_OFF_SETTING) === true;
}

export function requireStorage(db: PreviewDb): void {
  if (storageDisabled(db)) {
    fail("PRIVATE_STORAGE_NOT_CONFIGURED", "El almacenamiento privado no está configurado en este servidor.", 503);
  }
}

// ── Paginación con cursor opaco (`Page<T>` del contrato) ───────────────────────────────────────────────────────────────

export interface PageQuery {
  limit?: number;
  cursor?: string;
}

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

function encodeCursor(offset: number): string {
  return btoa(`o:${offset}`);
}

function decodeCursor(cursor: string): number {
  try {
    const text = atob(cursor);
    const match = /^o:(\d{1,9})$/.exec(text);
    if (match?.[1] !== undefined) return Number(match[1]);
  } catch {
    // cae al error de abajo
  }
  return fail("INVALID_CURSOR", "El cursor no es válido.", 400);
}

export function pageOf<T>(all: readonly T[], query: PageQuery): PageResult<T> {
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const offset = query.cursor === undefined || query.cursor === "" ? 0 : decodeCursor(query.cursor);
  const items = all.slice(offset, offset + limit);
  const next = offset + items.length;
  return { items, nextCursor: next < all.length ? encodeCursor(next) : null };
}

export const pageQuerySchema: JsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 50 },
    cursor: { type: "string", maxLength: 200 },
  },
};
