/**
 * Resumen de administración (pantalla 37): qué se pinta en cada baldosa y cómo se lee la actividad de vehículos.
 * Reglas de docs/contracts/trust.md §4.3: un indicador sin fuente se muestra «—» (nunca un 0 inventado), un importe sin
 * tarifa aprobada es «Por definir» y un importe de ejemplo lleva la etiqueta «Datos ilustrativos».
 * Funciones puras: se prueban en Node.
 */
import type { AdminCountKpi, AdminMoneyKpi, AdminSummary, AdminTrend, AdminVehicleActivity, AdminVehicleCluster } from "@/api/types";
import type { IconName, IconTileTone } from "@/icons";
import { NBSP, formatDecimal, moneyParts } from "@/i18n";
import type { MapMarkerSpec } from "@/maps";
import { reviewStrings } from "../strings";

const s = reviewStrings.summary;

export type KpiKey = "activeTrips" | "requests" | "incidents" | "grossRevenue" | "operatingCosts" | "result";

/** `positive` = verde, `negative` = rojo, `neutral` = tinta apagada. */
export type KpiTrendTone = "positive" | "negative" | "neutral";

export interface KpiTrendView {
  direction: "up" | "down" | "flat";
  text: string;
  tone: KpiTrendTone;
}

export interface KpiTileView {
  key: KpiKey;
  icon: IconName;
  iconTone: IconTileTone;
  value: string;
  /** El valor es un texto («Por definir»), no una cifra: se pinta más pequeño para que quepa. */
  textual: boolean;
  label: string;
  trend: KpiTrendView | null;
  caption: string | null;
  a11y: string;
}

const ICONS: Record<KpiKey, { icon: IconName; tone: IconTileTone }> = {
  activeTrips: { icon: "car", tone: "blue" },
  requests: { icon: "people", tone: "blue" },
  incidents: { icon: "warning", tone: "red" },
  grossRevenue: { icon: "euro", tone: "green" },
  operatingCosts: { icon: "receipt", tone: "blue" },
  result: { icon: "chart", tone: "green" },
};

/** Más incidencias es malo: la flecha sube pero el color es el de aviso. */
const UNFAVORABLE_WHEN_UP: Readonly<Record<KpiKey, boolean>> = {
  activeTrips: false,
  requests: false,
  incidents: true,
  grossRevenue: false,
  operatingCosts: true,
  result: false,
};

/** `+12%` · `−8%` · `0%`. Sin espacio antes del `%`, como en la lámina; el menos es el tipográfico. */
export function trendView(key: KpiKey, trend: AdminTrend, deltaPercent: number | null): KpiTrendView | null {
  const unfavorable = UNFAVORABLE_WHEN_UP[key];
  switch (trend) {
    case "up":
      return {
        direction: "up",
        text: deltaPercent !== null ? `+${formatDecimal(Math.abs(deltaPercent), 0)}%` : "Sube",
        tone: unfavorable ? "negative" : "positive",
      };
    case "down":
      return {
        direction: "down",
        text: deltaPercent !== null ? `−${formatDecimal(Math.abs(deltaPercent), 0)}%` : "Baja",
        tone: unfavorable ? "positive" : "negative",
      };
    case "flat":
      return { direction: "flat", text: s.flat, tone: "neutral" };
    case "new":
      return { direction: "up", text: s.isNew, tone: "neutral" };
    case "unavailable":
      return null;
  }
}

function a11yOf(label: string, value: string, trend: KpiTrendView | null, caption: string | null): string {
  const parts = [`${label}: ${value}`];
  if (trend !== null) {
    parts.push(trend.direction === "up" ? `sube ${trend.text}` : trend.direction === "down" ? `baja ${trend.text}` : `sin cambios, ${trend.text}`);
  }
  if (caption !== null) parts.push(caption);
  return parts.join(". ");
}

export function countKpiView(key: "activeTrips" | "requests" | "incidents", kpi: AdminCountKpi): KpiTileView {
  const label = s.tiles[key];
  const unavailable = !kpi.available || kpi.value === null;
  const value = unavailable ? reviewStrings.common.notAvailable : formatDecimal(kpi.value ?? 0, 0);
  const trend = unavailable ? null : trendView(key, kpi.trend, kpi.deltaPercent);
  const caption = unavailable ? s.noSource : null;
  return { key, ...tile(key), value, textual: false, label, trend, caption, a11y: a11yOf(label, value, trend, caption) };
}

function tile(key: KpiKey): { icon: IconName; iconTone: IconTileTone } {
  const spec = ICONS[key];
  return { icon: spec.icon, iconTone: spec.tone };
}

/** `520 €` si son euros enteros; `520,50 €` si no (la lámina muestra «520 €»). */
export function formatKpiMoney(cents: number): string {
  const euros = cents / 100;
  const whole = Math.round(cents) % 100 === 0;
  return `${formatDecimal(euros, whole ? 0 : 2)}${NBSP}€`;
}

export function moneyKpiView(key: "grossRevenue" | "operatingCosts" | "result", kpi: AdminMoneyKpi): KpiTileView {
  const label = s.tiles[key];
  const parts = moneyParts(kpi.amount);
  const value = parts.pending || kpi.amount.cents === null ? s.pendingDefinition : formatKpiMoney(kpi.amount.cents);
  let caption: string | null = null;
  if (parts.pending) caption = kpi.note ?? s.noRate;
  else if (parts.illustrative) caption = s.illustrative;
  else caption = kpi.note;
  return { key, ...tile(key), value, textual: parts.pending, label, trend: null, caption, a11y: a11yOf(label, value, null, caption) };
}

export interface SummaryView {
  /** Primero los tres de actividad y, si el rol los puede ver, los tres económicos (en la lámina, dos columnas). */
  tiles: KpiTileView[];
  /** Hay indicadores económicos para este rol. */
  hasFinance: boolean;
  /** Frase bajo la rejilla cuando el rol no ve los económicos. */
  financeHidden: string | null;
  notes: string[];
}

export function summaryView(summary: AdminSummary): SummaryView {
  const tiles: KpiTileView[] = [
    countKpiView("activeTrips", summary.kpis.activeTrips),
    countKpiView("requests", summary.kpis.requests),
    countKpiView("incidents", summary.kpis.incidents),
  ];
  if (summary.finance !== null) {
    tiles.push(
      moneyKpiView("grossRevenue", summary.finance.grossRevenue),
      moneyKpiView("operatingCosts", summary.finance.operatingCosts),
      moneyKpiView("result", summary.finance.result),
    );
  }
  return {
    tiles,
    hasFinance: summary.finance !== null,
    financeHidden: summary.finance === null ? s.financeHidden : null,
    notes: summary.notes,
  };
}

// ── Actividad de vehículos ────────────────────────────────────────────────────────────────────────────────────────

/** Marcas del mapa: coche suelto o disco con el número de vehículos de la celda. Posiciones aproximadas (centro de celda). */
export function activityMarkers(items: readonly AdminVehicleCluster[]): MapMarkerSpec[] {
  return items.map((item): MapMarkerSpec => {
    const position = { lat: item.lat, lng: item.lng };
    if (item.kind === "cluster" && item.count > 1) {
      return { kind: "cluster", id: item.id, position, count: item.count, accessibilityLabel: s.clusterA11y(item.count) };
    }
    return { kind: "car", id: item.id, position, variant: "badge", accessibilityLabel: s.clusterA11y(1) };
  });
}

/** Lado de la celda en km (`0,02°` ≈ 2 km). */
export function gridKm(gridDegrees: number): string {
  return formatDecimal(Math.max(1, Math.round(gridDegrees * 111)), 0);
}

export function freshnessMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

export function activityInfoBody(activity: Pick<AdminVehicleActivity, "gridDegrees" | "freshnessSeconds">): string {
  return s.infoBody(gridKm(activity.gridDegrees), freshnessMinutes(activity.freshnessSeconds));
}
