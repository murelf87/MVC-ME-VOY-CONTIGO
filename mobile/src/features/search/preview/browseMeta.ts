/**
 * Datos propios del paquete «buscar y ver viajes» que el núcleo de la vista previa no modela: serie semanal (días y
 * vuelta), «Recoger en ruta», desvío máximo en minutos y paradas opcionales; y la tarifa de EJEMPLO de la vista previa.
 *
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`). Nada de esto existe en producción: allí lo sirve `src/modules/trips`.
 *
 * Tarifa de ejemplo — ajuste `trips.previewTariff` (JSON): mientras no exista, el servidor simulado se comporta como el real
 * SIN tarifa aprobada (todo importe `pending_definition`, «Por definir»). Si existe, los importes salen como `illustrative`
 * (la app los muestra con la etiqueta «ilustrativo»): nunca como `defined`, porque en la vista previa no hay tarifa aprobada
 * por administración. Quien necesite importes de ejemplo (p. ej. «Revisa tu solicitud») usa la variante `browse-example-tariff`
 * o llama a `setPreviewTariff`.
 */
import type { LocalTime, Weekday } from "@/api/types";
import { SEED_IDS, madridParts, stableUuid, type JsonObject, type PreviewDb } from "@/preview";

export const PREVIEW_TARIFF_KEY = "trips.previewTariff";

export const WORKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri"];
export const WEEKDAY_ORDER: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Fila de `trips_browse_meta`: lo que el contrato `trips` exige y las filas base (`trips`) no guardan. */
export interface TripMetaRow {
  /** = trip_id */
  id: string;
  /** Serie semanal a la que pertenece la ocurrencia (null = viaje puntual). */
  seriesId: string | null;
  /** Días en los que se repite la serie (null = viaje puntual). */
  weekdays: Weekday[] | null;
  /** Hora local de salida de la vuelta, si el conductor la ofrece. */
  returnLocal: LocalTime | null;
  /** «Recoger en ruta»: el coche recoge en cualquier punto de la ruta, no solo en las paradas declaradas. */
  pickupOnRoute: boolean;
  maxDetourMinutes: number;
  /** Paradas intermedias opcionales (solo se usan si alguien las pide) y su desvío aproximado. */
  optionalStops: Array<{ seq: number; detourMinutes: number }>;
}

export function tripMetaTable(db: PreviewDb) {
  return db.collection<TripMetaRow>("trips_browse_meta");
}

/** Metadatos de un viaje; si no hay fila (viaje publicado en la sesión) se deducen de la fila base. */
export function metaFor(db: PreviewDb, tripId: string): TripMetaRow {
  const row = tripMetaTable(db).get(tripId);
  if (row) return row;
  const trip = db.trips.get(tripId);
  const recurring = trip?.kind === "recurring";
  return {
    id: tripId,
    seriesId: recurring ? tripId : null,
    weekdays: recurring ? [...WORKDAYS] : null,
    returnLocal: null,
    pickupOnRoute: false,
    maxDetourMinutes: Math.max(1, Math.round((trip?.max_detour_m ?? 2000) / 500)),
    optionalStops: [],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Tarifa de ejemplo
// ---------------------------------------------------------------------------------------------------------------

export interface PreviewTariff {
  version: number;
  /** Micro-euros por km de carretera (132 500 = 0,1325 €/km). `null`: la tarifa no define la aportación. */
  rateMicrosPerKm: number | null;
  /** Comisión de pasajero en puntos básicos sobre la aportación. `null`: no definida → total «Por definir». */
  passengerCommissionBps: number | null;
  /** Tope de aportación por trayecto y pasajero. */
  sharedCostCapCents: number | null;
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Tarifa de ejemplo vigente en la vista previa, o `null` (sin tarifa: todo «Por definir»). */
export function readPreviewTariff(db: PreviewDb): PreviewTariff | null {
  const raw = db.getSetting<JsonObject>(PREVIEW_TARIFF_KEY);
  if (!raw || typeof raw !== "object") return null;
  const version = intOrNull(raw.version);
  if (version === null || version < 1) return null;
  return {
    version,
    rateMicrosPerKm: intOrNull(raw.rateMicrosPerKm),
    passengerCommissionBps: intOrNull(raw.passengerCommissionBps),
    sharedCostCapCents: intOrNull(raw.sharedCostCapCents),
  };
}

export function setPreviewTariff(db: PreviewDb, tariff: PreviewTariff | null): void {
  if (tariff === null) {
    db.deleteSetting(PREVIEW_TARIFF_KEY);
    return;
  }
  db.setSetting(PREVIEW_TARIFF_KEY, {
    version: tariff.version,
    rateMicrosPerKm: tariff.rateMicrosPerKm,
    passengerCommissionBps: tariff.passengerCommissionBps,
    sharedCostCapCents: tariff.sharedCostCapCents,
  });
}

/** Tarifa de ejemplo que usan las láminas 12, 15 y 16: 24 km → aportación 3,18 € + gestión 0,32 € = 3,50 €. */
export const EXAMPLE_TARIFF: PreviewTariff = {
  version: 1,
  rateMicrosPerKm: 132_500,
  passengerCommissionBps: 1000,
  sharedCostCapCents: null,
};

// ---------------------------------------------------------------------------------------------------------------
// Sembrado de los metadatos de los viajes de las láminas
// ---------------------------------------------------------------------------------------------------------------

interface SeedMeta {
  /** Nombre de la serie (null = puntual). */
  series: string | null;
  weekdays: readonly Weekday[] | null;
  returnLocal: LocalTime | null;
  pickupOnRoute: boolean;
  maxDetourMinutes: number;
  optionalStops: ReadonlyArray<{ seq: number; detourMinutes: number }>;
}

const T = SEED_IDS.trips;

const SEED_META: ReadonlyArray<readonly [string, SeedMeta]> = [
  // Lámina 12: Montequinto 08:05 → Dos Hermanas (opcional, desvío 5 min) → Universidad 08:28.
  [T.anaMorning, { series: "ana-morning", weekdays: WORKDAYS, returnLocal: "18:00", pickupOnRoute: false, maxDetourMinutes: 10, optionalStops: [{ seq: 1, detourMinutes: 5 }] }],
  [T.anaTomorrow, { series: "ana-morning", weekdays: WORKDAYS, returnLocal: "18:00", pickupOnRoute: false, maxDetourMinutes: 10, optionalStops: [{ seq: 1, detourMinutes: 5 }] }],
  [T.anaReturn, { series: "ana-morning", weekdays: WORKDAYS, returnLocal: null, pickupOnRoute: false, maxDetourMinutes: 10, optionalStops: [] }],
  [T.miguelAngelMorning, { series: "miguel-angel-morning", weekdays: WORKDAYS, returnLocal: "17:45", pickupOnRoute: false, maxDetourMinutes: 5, optionalStops: [] }],
  [T.miguelAngelReturn, { series: "miguel-angel-morning", weekdays: WORKDAYS, returnLocal: null, pickupOnRoute: false, maxDetourMinutes: 5, optionalStops: [] }],
  // «Recoger en ruta»: recoge en cualquier punto del trayecto dentro del desvío máximo.
  [T.carlosWork, { series: "carlos-work", weekdays: WORKDAYS, returnLocal: "18:15", pickupOnRoute: true, maxDetourMinutes: 6, optionalStops: [] }],
  [T.carlosReturn, { series: "carlos-work", weekdays: WORKDAYS, returnLocal: null, pickupOnRoute: true, maxDetourMinutes: 6, optionalStops: [] }],
  [T.martaWork, { series: "marta-work", weekdays: WORKDAYS, returnLocal: null, pickupOnRoute: false, maxDetourMinutes: 4, optionalStops: [] }],
  [T.martaTomorrow, { series: "marta-work", weekdays: WORKDAYS, returnLocal: null, pickupOnRoute: false, maxDetourMinutes: 4, optionalStops: [] }],
  // Viajes puntuales (sin serie).
  [T.danielAlcala, { series: null, weekdays: null, returnLocal: null, pickupOnRoute: false, maxDetourMinutes: 5, optionalStops: [] }],
  [T.carmenHospital, { series: "carmen-hospital", weekdays: ["mon", "wed", "fri"], returnLocal: null, pickupOnRoute: false, maxDetourMinutes: 4, optionalStops: [] }],
  [T.carmenSport, { series: null, weekdays: null, returnLocal: null, pickupOnRoute: false, maxDetourMinutes: 4, optionalStops: [] }],
];

/** Días de una serie con el de la ocurrencia sembrada incluido (cae en el día que sea «hoy» del reloj virtual). */
export function seriesWeekdaysFor(base: readonly Weekday[], departureAtMs: number): Weekday[] {
  const key = WEEKDAY_ORDER[madridParts(departureAtMs).isoWeekday - 1];
  return WEEKDAY_ORDER.filter((day) => base.includes(day) || day === key);
}

/** Siembra los metadatos de los viajes que existan en la base (las variantes «sin conductor» no los tienen todos). */
export function seedTripMeta(db: PreviewDb): void {
  const table = tripMetaTable(db);
  for (const [tripId, meta] of SEED_META) {
    const trip = db.trips.get(tripId);
    if (!trip) continue;
    const weekdays = meta.weekdays && trip.departure_at !== null ? seriesWeekdaysFor(meta.weekdays, trip.departure_at) : meta.weekdays ? [...meta.weekdays] : null;
    table.put({
      id: tripId,
      seriesId: meta.series ? stableUuid(`series:${meta.series}`) : null,
      weekdays,
      returnLocal: meta.returnLocal,
      pickupOnRoute: meta.pickupOnRoute,
      maxDetourMinutes: meta.maxDetourMinutes,
      optionalStops: meta.optionalStops.map((stop) => ({ ...stop })),
    });
  }
}
