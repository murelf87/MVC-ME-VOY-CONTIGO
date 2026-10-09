/**
 * Importes del panel: texto, lectura de lo que se escribe («4,5», «1.234,56») y validación de las decisiones de
 * devolución (docs/contracts/money.md §8.5). El servidor repite todas las comprobaciones; aquí solo se evita el viaje
 * de ida y vuelta y se explica el error en español junto al campo.
 *
 * Todo en céntimos enteros: nunca un `float` para dinero.
 */
import type { Money } from "@/api/types";
import { formatCents, formatMoney } from "@/i18n";

export const NOTE_MAX_LENGTH = 1000;

/** `5,00 €` · `Por definir` (un importe `illustrative` se formatea igual: la etiqueta la pone quien lo pinta). */
export function moneyText(money: Money): string {
  return formatMoney(money);
}

/** `true` si el importe aún no está definido (cents null o `pending_definition`). */
export function isPendingMoney(money: Money): boolean {
  return money.cents === null || money.status === "pending_definition";
}

/** Céntimos de un `Money` definido, o `null` si está pendiente. */
export function centsOf(money: Money): number | null {
  return isPendingMoney(money) ? null : money.cents;
}

export function centsText(cents: number): string {
  return formatCents(cents);
}

/**
 * Lee un importe en euros escrito a mano y lo devuelve en céntimos, o `null` si no es un importe válido.
 * Acepta coma o punto decimal («4,5», «4.50»), puntos de millar («1.234,56») y el símbolo «€». Rechaza negativos,
 * notación científica y más de dos decimales.
 */
export function parseEuroInput(raw: string): number | null {
  const compact = raw.replace(/[\s €]/g, "");
  if (compact === "" || !/^[0-9.,]+$/.test(compact)) return null;

  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  let integerPart: string;
  let fractionPart = "";

  if (lastComma !== -1 && lastDot !== -1) {
    // «1.234,56» (coma decimal) o «1,234.56» (punto decimal): decide el último separador.
    const decimalAt = Math.max(lastComma, lastDot);
    const thousandsChar = decimalAt === lastComma ? "." : ",";
    integerPart = compact.slice(0, decimalAt);
    fractionPart = compact.slice(decimalAt + 1);
    if (integerPart.includes(decimalAt === lastComma ? "," : ".")) return null;
    if (!isValidThousands(integerPart, thousandsChar)) return null;
    integerPart = integerPart.split(thousandsChar).join("");
  } else if (lastComma !== -1) {
    if (compact.indexOf(",") !== lastComma) return null;
    integerPart = compact.slice(0, lastComma);
    fractionPart = compact.slice(lastComma + 1);
  } else if (lastDot !== -1) {
    const dots = compact.split(".").length - 1;
    const tail = compact.slice(lastDot + 1);
    if (dots > 1 || tail.length === 3) {
      // «1.234» o «1.234.567»: puntos de millar.
      if (!isValidThousands(compact, ".")) return null;
      integerPart = compact.split(".").join("");
    } else {
      integerPart = compact.slice(0, lastDot);
      fractionPart = tail;
    }
  } else {
    integerPart = compact;
  }

  if (integerPart === "") integerPart = "0";
  if (!/^[0-9]+$/.test(integerPart)) return null;
  if (fractionPart !== "" && !/^[0-9]{1,2}$/.test(fractionPart)) return null;
  if (integerPart.length > 7) return null;
  const euros = Number(integerPart);
  const cents = Number((fractionPart + "00").slice(0, 2));
  return euros * 100 + cents;
}

function isValidThousands(text: string, separator: string): boolean {
  const groups = text.split(separator);
  if (groups.length === 1) return true;
  const [first, ...rest] = groups;
  if (first === undefined || first.length < 1 || first.length > 3 || !/^[0-9]+$/.test(first)) return false;
  return rest.every((group) => /^[0-9]{3}$/.test(group));
}

export type AmountCheck =
  | { ok: true; cents: number }
  | { ok: false; reason: "required" | "invalid" | "too_low" | "too_high" };

/** Importe aprobado: entre 0,01 € y lo que queda por devolver (si se conoce). */
export function checkApprovedAmount(text: string, maxCents: number | null): AmountCheck {
  if (text.trim() === "") return { ok: false, reason: "required" };
  const cents = parseEuroInput(text);
  if (cents === null) return { ok: false, reason: "invalid" };
  if (cents < 1) return { ok: false, reason: "too_low" };
  if (maxCents !== null && cents > maxCents) return { ok: false, reason: "too_high" };
  return { ok: true, cents };
}

/** La nota de la aprobación es obligatoria sin política aprobada o si cambia el importe propuesto. */
export function approvalNoteRequired(input: {
  policyApproved: boolean;
  proposedCents: number | null;
  approvedCents: number | null;
}): boolean {
  if (!input.policyApproved) return true;
  if (input.proposedCents === null) return true;
  return input.approvedCents !== null && input.approvedCents !== input.proposedCents;
}

export type NoteCheck = { ok: true; note: string | undefined } | { ok: false; reason: "required" | "too_long" };

export function checkNote(text: string, required: boolean): NoteCheck {
  const note = text.trim();
  if (note === "") return required ? { ok: false, reason: "required" } : { ok: true, note: undefined };
  if (note.length > NOTE_MAX_LENGTH) return { ok: false, reason: "too_long" };
  return { ok: true, note };
}

/** Euros con coma para precargar un campo de importe: 450 → «4,50». */
export function centsToInput(cents: number): string {
  const euros = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `${euros},${rest}`;
}
