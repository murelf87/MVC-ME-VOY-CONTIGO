/**
 * Teléfonos: el contrato del backend exige E.164 (`+34612345678`). La V1 es solo España, así que un número
 * sin prefijo se interpreta como español (+34). Funciones puras (con pruebas).
 */

export const DEFAULT_COUNTRY_CALLING_CODE = "+34";

export type PhoneParseResult =
  | { ok: true; e164: string }
  | { ok: false; reason: "empty" | "invalid" | "not_spanish_mobile" };

const E164 = /^\+[1-9][0-9]{7,14}$/;

/** `612 345 678` | `+34 612-345-678` | `0034612345678` → `+34612345678`. */
export function normalizePhoneE164(
  input: string,
  defaultCallingCode: string = DEFAULT_COUNTRY_CALLING_CODE
): PhoneParseResult {
  const compact = input.trim().replace(/[\s().-]/g, "");
  if (!compact) return { ok: false, reason: "empty" };

  let candidate: string;
  if (compact.startsWith("+")) candidate = compact;
  else if (compact.startsWith("00")) candidate = `+${compact.slice(2)}`;
  else candidate = `${defaultCallingCode}${compact}`;

  if (!E164.test(candidate)) return { ok: false, reason: "invalid" };

  // España: un SMS solo llega a móviles (6xx / 7xx). Fijos y números de otro tipo se rechazan antes de gastar un SMS.
  if (candidate.startsWith("+34") && !/^\+34[67][0-9]{8}$/.test(candidate)) {
    return { ok: false, reason: "not_spanish_mobile" };
  }
  return { ok: true, e164: candidate };
}

/** `+34612345678` → `+34 612 *** 678` (como en la pantalla «Confirma tu móvil»). */
export function maskPhoneE164(e164: string): string {
  if (/^\+34[0-9]{9}$/.test(e164)) {
    return `+34 ${e164.slice(3, 6)} *** ${e164.slice(9)}`;
  }
  if (e164.length <= 7) return e164;
  return `${e164.slice(0, 4)} *** ${e164.slice(-3)}`;
}

/** `+34612345678` → `612 345 678` (campo «Número de móvil»). Otros prefijos se devuelven sin tocar. */
export function formatNationalSpanishPhone(e164: string): string {
  const match = /^\+34([0-9]{3})([0-9]{3})([0-9]{3})$/.exec(e164);
  return match ? `${match[1]} ${match[2]} ${match[3]}` : e164;
}
