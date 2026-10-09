/**
 * «Detalle de la aportación» de la pantalla 15 (y el resumen de la 16) a partir de un `TripQuote` del servidor.
 * Función pura: NUNCA calcula un importe; solo da formato a lo que dice la API. Mientras la economía no esté definida
 * (`pending_definition`) escribe «Por definir»; un importe de ejemplo (`illustrative`) se rotula «ejemplo»/«ilustrativo».
 *
 * Dos composiciones, ambas de las láminas:
 *  - `perTrip` (15a): «Aportación según recorrido · Ejemplo orientativo (6 km) · 6,00 €» + «Gestión MVC · Por definir» +
 *    «Total antes de confirmar · Por definir».
 *  - `weekly` (15b, cuando `quote.weekly` existe): «Ejemplo · 0,30 €/km» · «6 km por trayecto · 1,80 €» ·
 *    «5 días, ida y vuelta · 18,00 €/semana» + «Gestión MVC · Por definir» + «Total · Pendiente de tarifa final».
 */
import type { Money, TripQuote } from "@/api/types";
import { MONEY_ILLUSTRATIVE_TAG, NBSP, formatCents, formatCentsPerUnit, formatDecimal, formatDistance, moneyParts } from "@/i18n";
import { requestStrings } from "../strings";

const copy = requestStrings.review;

export type QuoteLayout = "perTrip" | "weekly";

export interface QuoteLine {
  key: string;
  label: string;
  /** Segunda línea más pequeña (solo en `perTrip`). */
  caption?: string;
  /** Importe a la derecha (solo en `perTrip`). */
  value?: string;
}

export interface QuoteView {
  layout: QuoteLayout;
  heading: string;
  lines: QuoteLine[];
  /** «Gestión MVC · Por definir» (valor null) o «Gestión MVC … 0,32 €». */
  fee: { label: string; value: string | null; illustrative: boolean };
  total: { label: string; value: string; illustrative: boolean };
  /** Algún importe es de ejemplo: la lámina lo rotula «(ejemplo)». */
  illustrative: boolean;
  /** Algún importe está «Por definir». */
  pending: boolean;
}

/** `300000` µ€/km → «0,30 €/km»; `132500` → «0,1325 €/km». */
export function formatRatePerKm(micros: number): string {
  if (micros % 10_000 === 0) return formatCentsPerUnit(micros / 10_000, "km");
  const text = formatDecimal(micros / 1_000_000, 4).replace(/0+$/, "");
  const decimals = text.length - text.indexOf(",") - 1;
  return `${decimals < 2 ? `${text}0` : text}${NBSP}€/km`;
}

function amount(money: Money): string {
  return moneyParts(money).text;
}

const isIllustrative = (money: Money): boolean => money.status === "illustrative";
const isPending = (money: Money): boolean => moneyParts(money).pending;

export function buildQuoteView(quote: TripQuote, roadDistanceM: number): QuoteView {
  const weekly = quote.weekly;
  const monies: Money[] = [quote.contribution, quote.managementFee, quote.total];
  if (weekly !== null) monies.push(weekly.contributionPerWeek, weekly.totalPerWeek);
  const illustrative = monies.some(isIllustrative);
  const pending = monies.some(isPending);
  const heading = illustrative ? copy.detailTitle : copy.detailTitleDefined;
  const distance = formatDistance(roadDistanceM);

  const fee = {
    label: isPending(quote.managementFee) ? copy.managementFee : copy.managementFeeDefined,
    value: isPending(quote.managementFee) ? null : amount(quote.managementFee),
    illustrative: isIllustrative(quote.managementFee),
  };

  if (weekly === null) {
    const caption = isIllustrative(quote.contribution) ? copy.contributionExample(roadDistanceM) : copy.contributionDistance(roadDistanceM);
    return {
      layout: "perTrip",
      heading,
      lines: [{ key: "contribution", label: copy.contribution, caption, value: amount(quote.contribution) }],
      fee,
      total: { label: copy.totalSingle, value: amount(quote.total), illustrative: isIllustrative(quote.total) },
      illustrative,
      pending,
    };
  }

  const lines: QuoteLine[] = [];
  const rate = quote.basis.rateMicrosPerKm;
  if (rate !== null) {
    const perKm = formatRatePerKm(rate);
    lines.push({ key: "rate", label: isIllustrative(quote.contribution) ? copy.weeklyRate(perKm) : copy.weeklyRateDefined(perKm) });
  }
  lines.push({ key: "trip", label: copy.weeklyPerTrip(distance, amount(quote.contribution)) });
  const days = weekly.weekdays.length;
  const perWeekPending = isPending(weekly.contributionPerWeek);
  lines.push({
    key: "week",
    label: perWeekPending
      ? copy.weeklyPerWeekPending(days, weekly.legsPerDay, amount(weekly.contributionPerWeek))
      : copy.weeklyPerWeek(days, weekly.legsPerDay, amount(weekly.contributionPerWeek)),
  });
  const totalPending = isPending(weekly.totalPerWeek);
  return {
    layout: "weekly",
    heading,
    lines,
    fee,
    total: {
      label: totalPending ? copy.totalWeekly : copy.totalWeeklyDefined,
      value: amount(weekly.totalPerWeek),
      illustrative: isIllustrative(weekly.totalPerWeek),
    },
    illustrative,
    pending,
  };
}

/** Importe con la etiqueta «ilustrativo» cuando es de ejemplo: «6,00 € (ilustrativo)». */
export function labelledAmount(money: Money): string {
  const parts = moneyParts(money);
  return parts.illustrative ? `${parts.text} (${MONEY_ILLUSTRATIVE_TAG})` : parts.text;
}

/** Céntimos → «1,80 €» (para las pruebas y las cuentas de la 16). */
export function centsText(cents: number): string {
  return formatCents(cents);
}
