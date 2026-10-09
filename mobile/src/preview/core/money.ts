/**
 * Dinero en el cable: `{ cents, currency: "EUR", status }` (espejo de `src/lib/dto.ts` y de la app).
 *
 *  - `defined`            importe calculado con una política/tarifa APROBADA. Hoy no hay tarifa aprobada.
 *  - `pending_definition` la economía aún no está definida → la app muestra «Por definir» (cents = null).
 *  - `illustrative`       ejemplo didáctico. SOLO la vista previa lo emite (la app añade la etiqueta «ilustrativo»).
 */
import type { MoneyDto } from "./moneyTypes";

export type { MoneyDto, MoneyStatus } from "./moneyTypes";

export function moneyDefined(cents: number): MoneyDto {
  if (!Number.isInteger(cents)) throw new Error("money must be integer cents");
  return { cents, currency: "EUR", status: "defined" };
}

export function moneyPending(): MoneyDto {
  return { cents: null, currency: "EUR", status: "pending_definition" };
}

export function moneyIllustrative(cents: number): MoneyDto {
  if (!Number.isInteger(cents)) throw new Error("money must be integer cents");
  return { cents, currency: "EUR", status: "illustrative" };
}

/** «4,00 €» con espacio duro, para textos generados en el servidor simulado (notificaciones, recibos). */
export function formatEuros(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped},${rest} €`;
}
