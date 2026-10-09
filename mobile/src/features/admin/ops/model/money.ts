/**
 * Importes y porcentajes de la configuración de tarifas (pantalla 40): texto escrito en español ↔ enteros del contrato.
 *
 *   · tarifa por km  → micro-euros por km (300000 = 0,30 €/km), de 0 a 5 000 000 (≤ 5 €/km)
 *   · comisiones     → puntos básicos (1000 = 10 %), de 0 a 10 000
 *   · importes       → céntimos enteros (cuota Premium al mes y límite de gastos compartidos), de 0 a 1 000 000
 *
 * Nunca se usan decimales binarios: el texto se descompone en parte entera y parte decimal y se reconstruye con
 * enteros. Funciones puras (se prueban en Node).
 */
import { NBSP, formatDecimal } from "@/i18n";

export const MAX_RATE_MICROS_PER_KM = 5_000_000;
export const MAX_BPS = 10_000;
export const MAX_CENTS_FIELD = 1_000_000;

const MICROS_PER_EURO = 1_000_000;

/** Resultado de leer un campo: `value: null` = campo vacío («Por definir»). */
export type FieldParse = { ok: true; value: number | null } | { ok: false; message: string };

type FixedParse = { ok: true; value: number | null } | { ok: false; reason: "format" | "decimals" | "size" };

/**
 * Convierte un texto decimal («0,30», «0.3», «10», «7,5») en un entero multiplicado por 10^`decimals`.
 * Acepta coma o punto como separador; rechaza letras, signos, miles y más de un separador.
 */
export function parseFixed(text: string, decimals: number): FixedParse {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const match = /^(\d*)(?:[.,](\d*))?$/.exec(trimmed);
  if (match === null) return { ok: false, reason: "format" };
  const intDigits = match[1] ?? "";
  const fracDigits = match[2] ?? "";
  if (intDigits === "" && fracDigits === "") return { ok: false, reason: "format" };
  if (intDigits.length > 9) return { ok: false, reason: "size" };
  if (fracDigits.length > decimals) return { ok: false, reason: "decimals" };
  const whole = intDigits === "" ? 0 : Number(intDigits);
  const frac = fracDigits === "" ? 0 : Number(fracDigits.padEnd(decimals, "0"));
  return { ok: true, value: whole * 10 ** decimals + frac };
}

/** Texto de un entero escalado: `scaledToText(300000, 6, 2)` → «0,30» · `(1250, 2, 0)` → «12,5». */
function scaledToText(scaled: number, decimals: number, minDecimals: number): string {
  const factor = 10 ** decimals;
  const whole = Math.floor(scaled / factor);
  const frac = String(scaled % factor).padStart(decimals, "0");
  let trimmed = frac;
  while (trimmed.length > minDecimals && trimmed.endsWith("0")) trimmed = trimmed.slice(0, -1);
  return trimmed === "" ? String(whole) : `${whole},${trimmed}`;
}

// ── Tarifa por km (micro-euros) ───────────────────────────────────────────────────────────────────────────────────

export function ratePerKmToText(micros: number | null): string {
  return micros === null ? "" : scaledToText(micros, 6, 2);
}

export function parseRatePerKm(text: string): FieldParse {
  const parsed = parseFixed(text, 4);
  if (!parsed.ok) {
    if (parsed.reason === "decimals") return { ok: false, message: "Usa como máximo 4 decimales (por ejemplo 0,3050)." };
    if (parsed.reason === "size") return { ok: false, message: "La tarifa por km debe estar entre 0 y 5 € por km." };
    return { ok: false, message: "Escribe un importe en euros, por ejemplo 0,30." };
  }
  if (parsed.value === null) return parsed;
  const micros = parsed.value * 100;
  if (micros > MAX_RATE_MICROS_PER_KM) return { ok: false, message: "La tarifa por km debe estar entre 0 y 5 € por km." };
  return { ok: true, value: micros };
}

// ── Comisión (puntos básicos) ─────────────────────────────────────────────────────────────────────────────────────

export function commissionToText(bps: number | null): string {
  return bps === null ? "" : scaledToText(bps, 2, 0);
}

export function parseCommission(text: string): FieldParse {
  const parsed = parseFixed(text.replace(/\s*%\s*$/, ""), 2);
  if (!parsed.ok) {
    if (parsed.reason === "decimals") return { ok: false, message: "Usa como máximo 2 decimales (por ejemplo 7,5)." };
    if (parsed.reason === "size") return { ok: false, message: "La comisión debe estar entre 0 % y 100 %." };
    return { ok: false, message: "Escribe un porcentaje, por ejemplo 10 o 7,5." };
  }
  if (parsed.value === null) return parsed;
  if (parsed.value > MAX_BPS) return { ok: false, message: "La comisión debe estar entre 0 % y 100 %." };
  return { ok: true, value: parsed.value };
}

// ── Importes en céntimos (Premium al mes, límite de gastos compartidos) ──────────────────────────────────────────

export function centsToText(cents: number | null): string {
  return cents === null ? "" : scaledToText(cents, 2, 2);
}

export function parseCentsAmount(text: string, label: string): FieldParse {
  const parsed = parseFixed(text.replace(/\s*€\s*$/, ""), 2);
  if (!parsed.ok) {
    if (parsed.reason === "decimals") return { ok: false, message: "Usa como máximo 2 decimales (por ejemplo 2,99)." };
    if (parsed.reason === "size") return { ok: false, message: `${label} debe estar entre 0 y 10.000 €.` };
    return { ok: false, message: "Escribe un importe en euros, por ejemplo 2,99." };
  }
  if (parsed.value === null) return parsed;
  if (parsed.value > MAX_CENTS_FIELD) return { ok: false, message: `${label} debe estar entre 0 y 10.000 €.` };
  return { ok: true, value: parsed.value };
}

// ── Presentación de solo lectura ──────────────────────────────────────────────────────────────────────────────────

/** `300000` → «0,30 €/km» · `null` → «Por definir». */
export function formatRateLabel(micros: number | null, pending: string): string {
  return micros === null ? pending : `${ratePerKmToText(micros)}${NBSP}€/km`;
}

/** `1000` → «10 %» · `750` → «7,5 %» · `null` → «Por definir». */
export function formatCommissionLabel(bps: number | null, pending: string): string {
  return bps === null ? pending : `${commissionToText(bps)}${NBSP}%`;
}

/** `299` → «2,99 € al mes» · `null` → «Por definir». */
export function formatPremiumLabel(cents: number | null, pending: string): string {
  return cents === null ? pending : `${formatDecimal(cents / 100, 2)}${NBSP}€ al mes`;
}

/** `300` → «3,00 € por trayecto» · `null` → «Sin límite definido». */
export function formatCapLabel(cents: number | null, none: string): string {
  return cents === null ? none : `${formatDecimal(cents / 100, 2)}${NBSP}€ por trayecto`;
}

/** Redondeo de «mitad hacia arriba» en céntimos para un cociente de enteros no negativos (el servidor manda; solo se usa en pruebas y rótulos). */
export function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** Micro-euros por km × metros → céntimos de aportación (tope opcional): la misma regla que `POST /v1/admin/tariffs/example`. */
export function contributionCents(micros: number, meters: number, capCents: number | null = null): number {
  const raw = roundHalfUp(meters * micros, 10_000_000);
  return capCents === null ? raw : Math.min(raw, capCents);
}

export { MICROS_PER_EURO };
