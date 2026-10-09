/**
 * Filtros compartidos por 37 y 39: provincia y periodo. Funciones puras: se prueban en Node.
 */
import type { AdminPeriod, AdminRefundPeriod, Province } from "@/api/types";
import { reviewStrings } from "../strings";

/** Valor de la opción «Todas las provincias» (el servidor entiende `provinceId` ausente como «todas»). */
export const PROVINCE_ALL = "__all__";

export interface ProvinceView {
  /** `null` = todas las provincias. */
  id: string | null;
  code: string | null;
  label: string;
}

const ALL_PROVINCES: ProvinceView = { id: null, code: null, label: reviewStrings.provinces.all };

/**
 * Provincia que se está mirando. `choice === null` significa «aún no ha elegido»: se usa la primera que da el servidor
 * (hoy solo hay Sevilla) y, si no hay ninguna, todas. Una elección que ya no existe también vuelve a «todas».
 */
export function resolveProvince(choice: string | null, provinces: readonly Province[] | undefined): ProvinceView {
  if (choice === PROVINCE_ALL) return ALL_PROVINCES;
  const list = provinces ?? [];
  const picked = choice === null ? list[0] : list.find((province) => province.id === choice);
  return picked !== undefined ? { id: picked.id, code: picked.code, label: picked.name } : ALL_PROVINCES;
}

export interface FilterOption<T extends string> {
  value: T;
  label: string;
}

export function provinceOptions(provinces: readonly Province[] | undefined): Array<FilterOption<string>> {
  return [
    { value: PROVINCE_ALL, label: reviewStrings.provinces.all },
    ...(provinces ?? []).map((province) => ({ value: province.id, label: province.name })),
  ];
}

// ── Periodos ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const REFUND_PERIOD_ORDER: readonly AdminRefundPeriod[] = ["7d", "30d", "90d", "365d", "all"];
export const SUMMARY_PERIOD_ORDER: readonly AdminPeriod[] = ["today", "yesterday", "last_7_days", "last_30_days", "this_month"];
export const BOOKING_PERIOD_ORDER: readonly AdminPeriod[] = SUMMARY_PERIOD_ORDER;

export const DEFAULT_REFUND_PERIOD: AdminRefundPeriod = "30d";
export const DEFAULT_BOOKING_PERIOD: AdminPeriod = "last_30_days";
export const DEFAULT_SUMMARY_PERIOD: AdminPeriod = "today";

export function refundPeriodOptions(): Array<FilterOption<AdminRefundPeriod>> {
  return REFUND_PERIOD_ORDER.map((value) => ({ value, label: reviewStrings.bookings.refundPeriods[value] }));
}

export function bookingPeriodOptions(): Array<FilterOption<AdminPeriod>> {
  return BOOKING_PERIOD_ORDER.map((value) => ({ value, label: reviewStrings.bookings.bookingPeriods[value] }));
}

export function summaryPeriodOptions(): Array<FilterOption<AdminPeriod>> {
  return SUMMARY_PERIOD_ORDER.map((value) => ({ value, label: reviewStrings.summary.periods[value] }));
}
