/**
 * Utilidades del backend en memoria de «admin-ops» (SIMULACIÓN, solo con `EXPO_PUBLIC_PREVIEW=1`).
 * Espejo de `src/modules/trust/common.ts` y `redaction.ts`: fechas ISO, nombres, cursores opacos y redacción de metadatos.
 */
import { fail, type JsonSchema, type PreviewDb } from "@/preview";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function isoOrNull(ms: number | null | undefined): string | null {
  return ms === null || ms === undefined ? null : iso(ms);
}

export interface NameParts {
  displayName: string;
  firstName: string;
}

/** Mismo criterio que live/comms: sin nombre → «Usuario». */
export function nameParts(raw: string | null | undefined): NameParts {
  const normalized = (raw ?? "").trim().replace(/\s+/g, " ");
  const displayName = normalized.length > 0 ? normalized : "Usuario";
  return { displayName, firstName: displayName.split(" ")[0] ?? displayName };
}

/** Nombre visible de una persona (o `null` si no tiene perfil con nombre). */
export function displayNameOf(db: PreviewDb, userId: string | null | undefined): string | null {
  if (userId === null || userId === undefined) return null;
  const name = db.profiles.get(userId)?.display_name;
  return name === undefined || name === null || name.trim() === "" ? null : nameParts(name).displayName;
}

export function actorRef(db: PreviewDb, userId: string | null | undefined): { id: string; displayName: string | null } | null {
  if (userId === null || userId === undefined) return null;
  return { id: userId, displayName: displayNameOf(db, userId) };
}

// ── Paginación por desplazamiento con cursor opaco ────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function encodeCursor(offset: number): string {
  return btoa(`o:${offset}`);
}

function decodeCursor(cursor: string): number {
  try {
    const match = /^o:(\d{1,9})$/.exec(atob(cursor));
    if (match?.[1] !== undefined) return Number(match[1]);
  } catch {
    // cae al error de abajo
  }
  return fail("CURSOR_INVALID", "El cursor de paginación no es válido.", 400);
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

export interface PageSlice<T> {
  items: T[];
  nextCursor: string | null;
}

/** Corta `all` (ya ordenado) en la página pedida. Un cursor inválido es `400 CURSOR_INVALID`. */
export function sliceOf<T>(all: readonly T[], cursor: string | undefined, limit: number | undefined): PageSlice<T> {
  const size = clampLimit(limit);
  const offset = cursor === undefined || cursor === "" ? 0 : decodeCursor(cursor);
  const items = all.slice(offset, offset + size);
  const next = offset + items.length;
  return { items, nextCursor: next < all.length ? encodeCursor(next) : null };
}

/** Esquema de los parámetros de paginación (`limit` 1–50, `cursor` opaco). */
export const pageQueryProperties: Readonly<Record<string, JsonSchema>> = {
  limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
  cursor: { type: "string", minLength: 1, maxLength: 200 },
};

export function queryOf(extra: Readonly<Record<string, JsonSchema>> = {}): JsonSchema {
  return { type: "object", additionalProperties: false, properties: { ...pageQueryProperties, ...extra } };
}

// ── Redacción de datos personales en la auditoría (espejo de `src/modules/trust/redaction.ts`) ─────────────────────

export const REDACTED = "[oculto]";

const SENSITIVE_WORDS = new Set([
  "phone", "telefono", "tel", "mobile", "movil", "email", "mail", "correo",
  "name", "nombre", "address", "direccion",
  "ip", "token", "secret", "password", "contrasena", "cookie", "authorization", "signature",
  "storage", "url", "key",
  "lat", "lng", "lon", "latitude", "longitude", "coords", "coordinates", "location",
  "contact", "iban", "card", "dni", "nif", "passport",
]);

const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE_PLUS = /\+\d[\d\s().-]{7,}\d/g;
const PHONE_ES = /(?<![\d.])[6-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?![\d.])/g;
const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
const MAX_DEPTH = 6;
const MAX_ITEMS = 50;

function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

export function isSensitiveKey(key: string): boolean {
  return words(key).some((word) => SENSITIVE_WORDS.has(word));
}

function scrubString(value: string, counter: { n: number }): string {
  if (UUID_ONLY.test(value)) return value;
  let out = value;
  for (const pattern of [EMAIL, PHONE_PLUS, PHONE_ES, IPV4]) {
    out = out.replace(pattern, () => {
      counter.n += 1;
      return REDACTED;
    });
  }
  return out;
}

function redactValue(value: unknown, depth: number, counter: { n: number }): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return scrubString(value, counter);
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => redactValue(item, depth + 1, counter));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
        counter.n += 1;
      } else {
        out[key] = redactValue(inner, depth + 1, counter);
      }
    }
    return out;
  }
  return String(value);
}

export function redactMetadata(metadata: unknown): { value: Record<string, unknown>; redactions: number } {
  const counter = { n: 0 };
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return { value: {}, redactions: 0 };
  const value = redactValue(metadata, 0, counter) as Record<string, unknown>;
  return { value, redactions: counter.n };
}

// ── Dinero de céntimos enteros con redondeo «mitad hacia arriba» ────────────────────────────────────────────────────

/** `round(numerador / denominador)` con la mitad hacia arriba, solo para enteros no negativos seguros. */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new Error("denominator must be positive");
  if (numerator < 0) throw new Error("negative monetary values are not supported here");
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}
