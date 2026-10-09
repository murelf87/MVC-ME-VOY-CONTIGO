/**
 * Variantes de datos del paquete «solicitar plaza y pagar» (el `seed` de un escenario de diseño o de `?mvcSeed=`). Todas
 * parten del mundo base y dejan a Miguel (el pasajero de la vista previa) con una solicitud en el estado que necesita una
 * lámina o un estado de pantalla. Prefijo `request-`.
 *
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`): personas y viajes ficticios del diseño.
 */
import { SEED_IDS, seedConfirmedRider, stableUuid, type PreviewDb, type PreviewProfileId, type RideRequestRow } from "@/preview";
import { addPaymentMethod } from "@/features/account/preview/moneyDomain";
import { writeConfig } from "@/features/account/preview/moneyRows";
import { loadTripGeometry } from "./browseGeometry";
import { EXAMPLE_TARIFF, metaFor, readPreviewTariff, setPreviewTariff, tripMetaTable } from "./browseMeta";
import { computeQuote } from "./browseQuote";
import { quoteLocks } from "./requestDetail";
import { stopAddresses } from "./requestPickup";

const TRIP = SEED_IDS.trips.anaMorning;
const MIGUEL = SEED_IDS.users.miguel;
/** 14:52 — la cuenta atrás que enseña la lámina 16. */
const HOLD_LAB_MS = (14 * 60 + 52) * 1000;

export const requestSeedVariants: Readonly<Record<string, string>> = {
  "req-example-tariff": "Mundo base con la tarifa de EJEMPLO: «Revisa tu solicitud» y el pago enseñan importes «ilustrativos».",
  "req-board-13": "Lámina 13: dos puntos de recogida junto a «Sevilla Centro» — A «Aparcamiento público» (4 min a pie, desvío +2) y B «Av. de la Buhaira» (6 min a pie, desvío +3).",
  "req-pending": "Miguel ha pedido plaza en el viaje de Ana y espera su respuesta (paso «Solicitud» activo).",
  "req-awaiting-payment": "Ana aceptó la solicitud de Miguel: plaza retenida 14:52 y pago por hacer; proveedor de pagos DESACTIVADO («Pagos aún no disponibles»).",
  "req-awaiting-payment-live": "Como «awaiting-payment», pero con proveedor de pagos simulado ACTIVO y una Visa guardada: se puede pagar de punta a punta.",
  "req-hold-expired": "Ana aceptó pero Miguel no pagó a tiempo: la plaza se liberó y la solicitud caducó.",
  "req-rejected": "Ana rechazó la solicitud de Miguel.",
  "req-confirmed": "Plaza confirmada: Miguel ya tiene reserva en el viaje de Ana.",
};

function seedViewerRequest(
  db: PreviewDb,
  status: RideRequestRow["status"],
  holdMs: number | null,
  holdStatus: "active" | "released"
): Readonly<RideRequestRow> | null {
  const trip = db.trips.get(TRIP);
  if (!trip) return null;
  const meta = metaFor(db, trip.id);
  const geo = loadTripGeometry(db, trip, meta);
  const last = geo.stops.length - 1;
  const first = geo.stops[0];
  const now = db.nowMs();
  const roadDistanceM = geo.distances[last] ?? 0;
  const row = db.rideRequests.insert({
    id: stableUuid(`request:viewer:${status}`),
    trip_id: trip.id,
    passenger_user_id: MIGUEL,
    from_segment_seq: 0,
    to_segment_seq: last,
    status,
    requested_at: now - 20 * 60_000,
    updated_at: now - 2 * 60_000,
    pickup_lat: first?.lat ?? null,
    pickup_lng: first?.lng ?? null,
    pickup_label: first?.label ?? null,
    pickup_address: null,
    pickup_source: "driver_stop",
    pickup_offset_s: 0,
    pickup_walk_minutes: 4,
    pickup_detour_minutes: 0,
    dropoff_stop_seq: last,
    road_distance_m: roadDistanceM,
    message: null,
    weekly_reservation_id: null,
  });
  quoteLocks(db).put({ id: row.id, quote: computeQuote(readPreviewTariff(db), roadDistanceM), locked_at: now - 20 * 60_000 });
  if (holdMs !== null) {
    db.seatHolds.insert({
      id: stableUuid(`hold:viewer:${status}`),
      request_id: row.id,
      status: holdStatus,
      expires_at: now + holdMs,
      released_at: holdStatus === "released" ? now - 60_000 : null,
      consumed_at: null,
      created_at: now - 5 * 60_000,
    });
  }
  return row;
}

/** Siembra la variante `seed` si es de este paquete; cualquier otro nombre no hace nada. */
export function seedRequestVariant(db: PreviewDb, _profile: PreviewProfileId, seed: string): void {
  switch (seed) {
    case "req-example-tariff":
      setPreviewTariff(db, EXAMPLE_TARIFF);
      return;
    case "req-board-13":
      applyBoard13(db);
      return;
    case "req-pending":
      setPreviewTariff(db, EXAMPLE_TARIFF);
      seedViewerRequest(db, "pending", null, "active");
      return;
    case "req-awaiting-payment":
      setPreviewTariff(db, EXAMPLE_TARIFF);
      seedViewerRequest(db, "payment_pending", HOLD_LAB_MS, "active");
      return;
    case "req-awaiting-payment-live":
      setPreviewTariff(db, EXAMPLE_TARIFF);
      writeConfig(db, { provider_enabled: true });
      addPaymentMethod(db, MIGUEL, { purpose: "charge", providerToken: "tok_sim_visa_4242", setAsDefault: true });
      seedViewerRequest(db, "payment_pending", HOLD_LAB_MS, "active");
      return;
    case "req-hold-expired":
      setPreviewTariff(db, EXAMPLE_TARIFF);
      seedViewerRequest(db, "expired", -60_000, "released");
      return;
    case "req-rejected":
      setPreviewTariff(db, EXAMPLE_TARIFF);
      seedViewerRequest(db, "rejected", null, "active");
      return;
    case "req-confirmed": {
      setPreviewTariff(db, EXAMPLE_TARIFF);
      const trip = db.trips.get(TRIP);
      if (!trip) return;
      const last = loadTripGeometry(db, trip, metaFor(db, trip.id)).stops.length - 1;
      seedConfirmedRider(db, trip, { user: "miguel", from: 0, to: last });
      return;
    }
    default:
      return;
  }
}

/**
 * Lámina 13: junto al origen de la búsqueda (37,3403 / −5,937) el viaje de Ana ofrece DOS paradas declaradas. A está a ~230 m
 * (4 min a pie) y B a ~350 m (6 min); ambas son «paradas opcionales» con su desvío (+2 y +3 min).
 */
function applyBoard13(db: PreviewDb): void {
  setPreviewTariff(db, EXAMPLE_TARIFF);
  const stops: ReadonlyArray<{ seq: number; lat: number; lng: number; label: string; address: string; detourMinutes: number }> = [
    { seq: 0, lat: 37.3424, lng: -5.937, label: "Aparcamiento público", address: "Av. Manuel Siurot", detourMinutes: 2 },
    { seq: 1, lat: 37.3403, lng: -5.9331, label: "Av. de la Buhaira", address: "(Frente al centro deportivo)", detourMinutes: 3 },
  ];
  for (const stop of stops) {
    const id = `${TRIP}:${stop.seq}`;
    if (!db.tripStops.get(id)) continue;
    db.tripStops.update(id, { lat: stop.lat, lng: stop.lng, label: stop.label });
    stopAddresses(db).put({ id, address: stop.address });
  }
  // Viaje habitual de 6 km, sale a las 08:00 y vuelve a las 18:00 (lunes a viernes).
  const trip = db.trips.get(TRIP);
  if (trip) {
    db.trips.update(TRIP, {
      kind: "recurring",
      departure_at: (trip.departure_at ?? db.nowMs()) - 5 * 60_000,
      route_distance_m: 6000,
      route_duration_s: 840,
    });
  }
  for (const seq of [0, 1]) {
    const id = `${TRIP}:${seq}`;
    if (db.tripSegments.get(id)) db.tripSegments.update(id, { distance_m: 3000, duration_s: 420 });
  }
  const table = tripMetaTable(db);
  const meta = table.get(TRIP);
  if (meta) {
    table.put({
      ...meta,
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      returnLocal: "18:00",
      optionalStops: stops.map((s) => ({ seq: s.seq, detourMinutes: s.detourMinutes })),
    });
  }
}
