/**
 * Tipos de contrato compartidos por todos los módulos (backend ↔ app ↔ vista previa).
 * Fuente de verdad del formato en el cable: los schemas Fastify del backend deben producir exactamente esto.
 */
export type Uuid = string;
/** Instante en UTC, ISO-8601 con milisegundos: 2026-10-09T13:38:00.000Z */
export type IsoDateTime = string;
/** Fecha de calendario sin zona (Europe/Madrid): 2026-10-09 */
export type IsoDate = string;
/** Hora local de reloj "HH:mm" (Europe/Madrid) */
export type LocalTime = string;
/** Importes SIEMPRE en céntimos enteros; nunca float. */
export type Cents = number;

/**
 * Dinero tal y como viaja en la API.
 *  - "defined":            importe real calculado con política/tarifa aprobada.
 *  - "pending_definition": la economía aún no está definida → la UI muestra «Por definir» (cents = null).
 *  - "illustrative":       ejemplo didáctico; SOLO lo emite la vista previa o textos «Ejemplo»; la UI muestra la etiqueta «ilustrativo».
 */
export type MoneyStatus = "defined" | "pending_definition" | "illustrative";
export interface Money {
  cents: Cents | null;
  currency: "EUR";
  status: MoneyStatus;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type TripCategory = "work" | "university" | "fp_academies" | "hospital" | "sport" | "other";
/** Días de la semana ISO en minúsculas, lunes primero. */
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** Persona tal y como la ve otro usuario (nunca teléfono ni datos privados). */
export interface PublicUser {
  id: Uuid;
  displayName: string;
  firstName: string;
  /** URL pública de la foto aprobada; null si no existe o no está aprobada. */
  photoUrl: string | null;
  ratingAverage: number | null;
  ratingCount: number;
}

export interface Page<T> {
  items: T[];
  /** Cursor opaco para la siguiente página; null si no hay más. */
  nextCursor: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
  requestId?: string;
}

/** Estado de revisión genérico de elementos privados (foto, documento, identidad). */
export type ReviewState = "none" | "in_review" | "needs_retry" | "approved" | "rejected";
