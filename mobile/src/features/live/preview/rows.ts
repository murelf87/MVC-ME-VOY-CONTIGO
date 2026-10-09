/**
 * Filas propias del slice `live` en el backend en memoria de la vista previa (SIMULACIÓN; solo con `EXPO_PUBLIC_PREVIEW=1`).
 * Tablas del contrato (`docs/contracts/live.md` §10) que el núcleo de la vista previa no tiene: valoraciones, incidencias con
 * sus adjuntos, enlaces compartidos y preferencias de privacidad. Los nombres llevan el prefijo `live_`. Las fechas son
 * milisegundos desde epoch (convención de `preview/core/rows.ts`).
 */
import type { Collection, PreviewDb } from "@/preview";

export type RaterRole = "driver" | "passenger";

export interface LiveRatingRow {
  id: string;
  trip_id: string;
  booking_id: string | null;
  rater_user_id: string;
  ratee_user_id: string;
  rater_role: RaterRole;
  stars: number;
  comment: string | null;
  created_at: number;
}

export type IncidentCategoryValue =
  | "safety"
  | "driver_behavior"
  | "passenger_behavior"
  | "vehicle"
  | "route_or_schedule"
  | "payment"
  | "lost_item"
  | "other";

export type IncidentStatusValue = "open" | "in_review" | "resolved" | "dismissed";

export interface LiveIncidentRow {
  id: string;
  reporter_user_id: string;
  reporter_role: RaterRole;
  trip_id: string;
  booking_id: string | null;
  category: IncidentCategoryValue;
  description: string;
  status: IncidentStatusValue;
  /** `Idempotency-Key` con el que se creó (para devolver la misma entidad al reintentar). */
  idempotency_key: string | null;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
}

export interface LiveAttachmentRow {
  id: string;
  report_id: string;
  owner_user_id: string;
  storage_key: string;
  content_type: string;
  expected_size_bytes: number;
  size_bytes: number | null;
  status: "pending" | "uploaded";
  expires_at: number;
  created_at: number;
  completed_at: number | null;
}

export interface LiveShareRow {
  id: string;
  booking_id: string;
  trip_id: string;
  owner_user_id: string;
  /** Huella (SHA-256) del token: el servidor nunca guarda el token en claro. */
  token_hash: string;
  include_plate: boolean;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  last_viewed_at: number | null;
  view_count: number;
}

export interface LivePrivacyRow {
  /** = user_id */
  id: string;
  show_profile_to_co_passengers: boolean;
  updated_at: number;
}

/**
 * «Compartir ubicación en viaje» de la persona que conduce. En el backend real vive en `comms`
 * (`user_settings.share_live_location_in_trip`, contrato `comms.md` §5) y `live` solo lo LEE; en la vista previa lo
 * escribe el paquete `account-help` en `comms_user_settings` (clave primaria `user_id`). Sin fila vale el valor por
 * defecto: compartir la posición precisa.
 */
export interface CommsSettingsRow {
  /** = user_id */
  user_id: string;
  share_live_location_in_trip: boolean;
  font_scale: string;
  language: string;
  updated_at: number;
}

export const liveRatings = (db: PreviewDb): Collection<LiveRatingRow> => db.collection<LiveRatingRow>("live_ratings");
export const liveIncidents = (db: PreviewDb): Collection<LiveIncidentRow> => db.collection<LiveIncidentRow>("live_incident_reports");
export const liveAttachments = (db: PreviewDb): Collection<LiveAttachmentRow> => db.collection<LiveAttachmentRow>("live_incident_attachments");
export const liveShares = (db: PreviewDb): Collection<LiveShareRow> => db.collection<LiveShareRow>("live_trip_shares");
export const livePrivacy = (db: PreviewDb): Collection<LivePrivacyRow> => db.collection<LivePrivacyRow>("live_privacy_preferences");
/** Ajustes de `comms` (propiedad de `account-help`): `live` solo lee `share_live_location_in_trip`; la escritura es solo de las semillas de este slice. */
export const commsSettings = (db: PreviewDb): Collection<CommsSettingsRow> => db.collection<CommsSettingsRow>("comms_user_settings", { pk: "user_id" });

/** ¿Comparte esta persona su ubicación exacta durante el viaje? (por defecto sí) */
export function sharesLiveLocation(db: PreviewDb, userId: string): boolean {
  return commsSettings(db).get(userId)?.share_live_location_in_trip !== false;
}

/**
 * Ajustes de la vista previa (no del contrato): el almacenamiento privado está «sin configurar»
 * (`503 PRIVATE_STORAGE_NOT_CONFIGURED`). Es UN solo proveedor para todo el backend: vale el ajuste de este slice o el del
 * paquete `account-help` (`help.storageDisabled`).
 */
export const STORAGE_OFF_SETTING = "live.privateStorageOff";
const HELP_STORAGE_OFF_SETTING = "help.storageDisabled";

export function privateStorageConfigured(db: PreviewDb): boolean {
  return db.getSetting<boolean>(STORAGE_OFF_SETTING) !== true && db.getSetting<boolean>(HELP_STORAGE_OFF_SETTING) !== true;
}
