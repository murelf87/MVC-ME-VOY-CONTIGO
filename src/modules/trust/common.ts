import { DomainError } from "../../errors.js";
import type { MoneyDto } from "../../lib/dto.js";

/** Error de dominio del módulo. Los códigos viven en mobile/src/api/types/trust.ts (TRUST_ERROR_CODES); un test lo verifica. */
export function trustError(code: string, message: string, statusCode = 400, details?: unknown): DomainError {
  return new DomainError(code, message, statusCode, details);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export type NameParts = { displayName: string; firstName: string };

/** Mismo criterio que live/comms: sin nombre → «Usuario». */
export function nameParts(raw: string | null | undefined): NameParts {
  const normalized = (raw ?? "").trim().replace(/\s+/g, " ");
  const displayName = normalized.length > 0 ? normalized : "Usuario";
  return { displayName, firstName: displayName.split(" ")[0] ?? displayName };
}

/** Longitud (1–3 dígitos) del prefijo telefónico internacional según el plan UIT E.164 (los prefijos no se solapan). */
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

/** «+34600111222» → «+34 ••• ••• 222». Nunca devuelve el teléfono completo. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const match = /^\+([1-9]\d{7,14})$/.exec(phone);
  if (!match) return "••• ••• •••";
  const digits = match[1] ?? "";
  const length = callingCodeLength(digits);
  const national = digits.slice(length);
  const tail = national.length >= 6 ? ` ${national.slice(-3)}` : "";
  return `+${digits.slice(0, length)} ••• •••${tail}`;
}

/* ───────────── Dinero ───────────── */

export function moneyIllustrative(cents: number): MoneyDto {
  if (!Number.isInteger(cents)) throw new Error("money must be integer cents");
  return { cents, currency: "EUR", status: "illustrative" };
}

/* ───────────── Cursores opacos ───────────── */

export function encodeCursor(payload: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Devuelve el objeto del cursor o lanza 400 CURSOR_INVALID. `shape` valida clave a clave. */
export function decodeCursor<T extends Record<string, "string" | "number" | "iso" | "uuid" | "bigint">>(
  raw: string,
  shape: T
): { [K in keyof T]: string | number } {
  const invalid = () => trustError("CURSOR_INVALID", "El cursor de paginación no es válido.", 400);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw invalid();
  const record = parsed as Record<string, unknown>;
  const out: Record<string, string | number> = {};
  for (const [key, kind] of Object.entries(shape)) {
    const value = record[key];
    if (kind === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) throw invalid();
      out[key] = value;
    } else {
      if (typeof value !== "string" || value.length === 0 || value.length > 100) throw invalid();
      if (kind === "uuid" && !UUID_RE.test(value)) throw invalid();
      if (kind === "iso" && Number.isNaN(Date.parse(value))) throw invalid();
      if (kind === "bigint" && !/^\d{1,18}$/.test(value)) throw invalid();
      out[key] = value;
    }
  }
  return out as { [K in keyof T]: string | number };
}

export function clampLimit(limit: number | undefined, fallback = 20, max = 50): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(limit)));
}

/** Respuesta de lista paginada con «una fila de más» (patrón limit+1). */
export function sliceOverflow<T>(rows: T[], limit: number): { page: T[]; hasMore: boolean } {
  return rows.length > limit ? { page: rows.slice(0, limit), hasMore: true } : { page: rows, hasMore: false };
}
