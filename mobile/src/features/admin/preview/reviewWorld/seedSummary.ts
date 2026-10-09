/**
 * Cifras de ejemplo del «Resumen de administración» (SIMULACIÓN, solo vista previa).
 *
 * Con las pocas decenas de filas del mundo simulado no se pueden derivar «42 viajes activos» ni «18 solicitudes» (las
 * láminas 37a/37b): esta ficha las fija. Los importes son `illustrative` («Datos ilustrativos»); el servidor real no los
 * emite. Las dos variaciones de la lámina (+12 % y −8 %) no las produce ningún par de enteros con esos valores, así que se
 * guardan fijadas; el resto se calcula (`compare`) como en el servidor.
 *
 * La actividad de vehículos (≈ 25 en ruta, en celdas de unos 2 km) está repartida por Sevilla como en la lámina: una celda de
 * 12 hacia Nervión/San Pablo, otra de 8 en Triana y vehículos sueltos.
 */
import type { AdminPeriod } from "@/api/types";
import type { PreviewDb } from "@/preview";
import { reviewTables, type PeriodSeed, type SummarySeedRow, type VehicleCellSeed } from "./store";

const kpi = (value: number, previous: number, delta: number | null = null): PeriodSeed["trips"] => ({ value, previous, delta_percent: delta });
const money = (gross: number, costs: number): NonNullable<PeriodSeed["finance"]> => ({ gross_cents: gross, costs_cents: costs, result_cents: gross - costs });

const PERIODS: Record<AdminPeriod, PeriodSeed> = {
  today: { trips: kpi(42, 38, 12), requests: kpi(18, 20, -8), incidents: kpi(3, 3), live_now: 25, finance: money(52_000, 43_000) },
  yesterday: { trips: kpi(61, 55), requests: kpi(44, 47), incidents: kpi(5, 4), live_now: 25, finance: money(71_000, 58_000) },
  last_7_days: { trips: kpi(318, 297), requests: kpi(221, 240), incidents: kpi(19, 19), live_now: 25, finance: money(389_000, 310_000) },
  last_30_days: { trips: kpi(1_204, 1_123), requests: kpi(866, 902), incidents: kpi(57, 52), live_now: 25, finance: money(1_624_000, 1_342_000) },
  this_month: { trips: kpi(357, 340), requests: kpi(262, 281), incidents: kpi(16, 21), live_now: 25, finance: money(468_000, 387_000) },
};

/** Celdas aproximadas (centro de celda de 0,02°) sobre el centro de Sevilla. */
const VEHICLES: readonly VehicleCellSeed[] = [
  { id: "37.40:-5.98", count: 12, lat: 37.4, lng: -5.98 },
  { id: "37.36:-6.02", count: 8, lat: 37.36, lng: -6.02 },
  { id: "37.40:-6.00", count: 1, lat: 37.4, lng: -6.0 },
  { id: "37.40:-5.96", count: 1, lat: 37.4, lng: -5.96 },
  { id: "37.38:-6.02", count: 1, lat: 37.38, lng: -6.02 },
  { id: "37.36:-5.98", count: 1, lat: 37.36, lng: -5.98 },
  { id: "37.38:-5.94", count: 1, lat: 37.38, lng: -5.94 },
];

export function seedSummary(db: PreviewDb): void {
  const row: SummarySeedRow = { id: "summary", periods: PERIODS, vehicles: [...VEHICLES] };
  reviewTables(db).summarySeed.put(row);
}
