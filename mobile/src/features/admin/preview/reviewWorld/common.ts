/**
 * Utilidades del backend en memoria de «admin-review» (SIMULACIÓN, solo con `EXPO_PUBLIC_PREVIEW=1`).
 * Espejo de `src/modules/trust/common.ts`: fechas ISO, nombres, teléfono enmascarado y cursores opacos.
 */
import { fail } from "@/preview";

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

/** Longitud (1–3 dígitos) del prefijo telefónico internacional según el plan UIT E.164. */
function callingCodeLength(digits: string): number {
  const first = digits[0];
  const two = digits.slice(0, 2);
  if (first === "1" || first === "7") return 1;
  if (first === "2") return two === "20" || two === "27" ? 2 : 3;
  if (first === "3") return two === "35" || two === "37" || two === "38" ? 3 : 2;
  if (first === "4") return two === "42" ? 3 : 2;
  if (first === "5") return two === "50" || two === "59" ? 3 : 2;
  if (first === "6") return two === "67" || two === "68" || two === "69" ? 3 : 2;
  if (first === "8") return two === "85" || two === "88" ? 3 : 2;
  if (first === "9") return two === "96" || two === "97" || two === "99" ? 3 : 2;
  return 2;
}

/** «+34611000102» → «+34 ••• ••• 102». Nunca devuelve el teléfono completo. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (phone === null || phone === undefined || phone === "") return null;
  const match = /^\+([1-9]\d{7,14})$/.exec(phone);
  if (match === null) return "••• ••• •••";
  const digits = match[1] ?? "";
  const length = callingCodeLength(digits);
  const national = digits.slice(length);
  const tail = national.length >= 6 ? ` ${national.slice(-3)}` : "";
  return `+${digits.slice(0, length)} ••• •••${tail}`;
}

// ── Paginación por desplazamiento con cursor opaco ────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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
