/**
 * Variantes de datos del paquete «buscar y ver viajes» (el `seed` de un escenario de diseño o de `?mvcSeed=`). Todas parten
 * del mundo base («default») y lo dejan en el estado que necesita una lámina o un estado de pantalla. Prefijo `browse-`.
 *
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`): personas y viajes ficticios del diseño.
 */
import { SEED_IDS, actingAs, anchorDate, isoReq, isoWeekdayOf, recordDriverLocation, seedConfirmedRider, seedTrip, stableUuid, startOwnedTrip } from "@/preview";
import type { PreviewDb, TripSpec } from "@/preview";
import { EXAMPLE_TARIFF, WORKDAYS, seriesWeekdaysFor, setPreviewTariff, tripMetaTable } from "./browseMeta";

const T = SEED_IDS.trips;

export const browseSeedVariants: Readonly<Record<string, string>> = {
  "browse-example-tariff": "Mundo base con la tarifa de EJEMPLO de la vista previa: los importes salen «ilustrativos» en vez de «Por definir».",
  "browse-board-09": "Lámina 09: cuatro coches en el mapa de Sevilla (2 plazas, 1 plaza, Completo, 2 plazas).",
  "browse-board-11": "Lámina 11: hay un coche que llega a la hora pedida y otros que aparecerían ampliando el horario o los días (tarjeta «Sin coincidencias»).",
  "browse-board-12": "Lámina 12: viaje de Ana (Seat Arona gris, matrícula acabada en LKM) con la tarifa de ejemplo: «Propuesta: 3,50 €» ilustrativa.",
  "browse-empty-map": "Provincia sin ningún coche publicado: mapa vacío y búsquedas sin resultados.",
  "browse-live-cars": "Dos coches en marcha: uno con posición en directo reciente y otro con la posición caducada (no se presenta como «en directo»).",
};

/** Siembra la variante `seed` si es de este paquete; cualquier otro nombre no hace nada. */
export function seedBrowseVariant(db: PreviewDb, seed: string): void {
  switch (seed) {
    case "browse-example-tariff":
      setPreviewTariff(db, EXAMPLE_TARIFF);
      return;
    case "browse-board-09":
      applyBoard09(db);
      return;
    case "browse-board-11":
      applyBoard11(db);
      return;
    case "browse-board-12":
      applyBoard12(db);
      return;
    case "browse-empty-map":
      cancelPublishedExcept(db, new Set());
      return;
    case "browse-live-cars":
      applyLiveCars(db);
      return;
    default:
      return;
  }
}

/** Oculta del mapa y de la búsqueda todos los viajes publicados salvo `keep` (pasan a «cancelado»). */
function cancelPublishedExcept(db: PreviewDb, keep: ReadonlySet<string>): void {
  const now = db.nowMs();
  for (const trip of db.trips.filter((t) => t.status === "published" && !keep.has(t.id))) {
    db.trips.update(trip.id, { status: "cancelled", updated_at: now });
  }
}

/**
 * Dónde salen los cuatro coches de la lámina 09 (rejilla de 0,01°, que es lo que el mapa enseña): con el encuadre de Sevilla
 * del móvil de la lámina (393 × 841 pt) los pines caen donde el diseño los dibuja. Cada salida lleva el nombre del lugar real
 * más cercano a esa casilla para que el viaje sea coherente si se abre su detalle.
 */
const BOARD_09_CARS: ReadonlyArray<{ tripId: string; lat: number; lng: number; label: string }> = [
  { tripId: T.carmenHospital, lat: 37.43, lng: -6.02, label: "Santiponce" }, // «2 plazas», arriba
  { tripId: T.carlosWork, lat: 37.37, lng: -6.09, label: "Bormujos" }, // «1 plaza», a la izquierda
  { tripId: T.danielAlcala, lat: 37.37, lng: -5.97, label: "Sevilla (Nervión)" }, // «Completo», gris, a la derecha
  { tripId: T.anaMorning, lat: 37.33, lng: -5.98, label: "Bellavista" }, // «2 plazas», abajo
];

function applyBoard09(db: PreviewDb): void {
  cancelPublishedExcept(db, new Set(BOARD_09_CARS.map((car) => car.tripId)));
  // El coche de Daniel sale completo (pin gris «Completo»): tres plazas ocupadas.
  const daniel = db.trips.get(T.danielAlcala);
  if (daniel) {
    seedConfirmedRider(db, daniel, { user: "elena", from: 0, to: 1 });
    seedConfirmedRider(db, daniel, { user: "pablo", from: 0, to: 1 });
  }
  for (const car of BOARD_09_CARS) {
    if (db.tripStops.get(`${car.tripId}:0`)) db.tripStops.update(`${car.tripId}:0`, { lat: car.lat, lng: car.lng, label: car.label });
  }
}

function applyBoard12(db: PreviewDb): void {
  setPreviewTariff(db, EXAMPLE_TARIFF);
  // La lámina enseña «Seat Arona · Gris» y una matrícula que acaba en LKM.
  const vehicle = db.vehicles.get(db.trips.get(T.anaMorning)?.vehicle_id ?? "");
  if (vehicle) db.vehicles.update(vehicle.id, { make: "Seat", plate: "1234 LKM", plate_normalized: "1234LKM" });
}

function applyBoard11(db: PreviewDb): void {
  const stops = [
    { latitude: 37.332, longitude: -5.937, label: "Montequinto" },
    { latitude: 37.383, longitude: -5.992, label: "Sevilla – Universidad" },
  ];
  const base: Omit<TripSpec, "id" | "at" | "dayOffset"> = {
    driver: "carmen",
    vehicle: "carmen208",
    category: "university",
    leg: "outbound",
    seats: 3,
    flexibilityMinutes: 5,
    maxDetourM: 2000,
    stops,
    segments: [{ distanceM: 24000, durationS: 1380 }],
  };
  const table = tripMetaTable(db);
  // Llega a las 09:03: fuera de la franja de ±20 min de las 08:30, dentro de la ampliada (±50 min).
  const lateId = stableUuid("trip:browse:board11-late");
  const late = seedTrip(db, { ...base, id: lateId, at: "08:40" });
  table.put({
    id: lateId,
    seriesId: stableUuid("series:browse-board11-late"),
    weekdays: seriesWeekdaysFor(WORKDAYS, late.departure_at ?? db.nowMs()),
    returnLocal: null,
    pickupOnRoute: false,
    maxDetourMinutes: 4,
    optionalStops: [],
  });
  // Sale el próximo sábado a las 08:05: solo aparece al buscar «más días».
  const weekday = isoWeekdayOf(anchorDate(db));
  const toSaturday = (6 - weekday + 7) % 7 || 7;
  const saturdayId = stableUuid("trip:browse:board11-saturday");
  seedTrip(db, { ...base, id: saturdayId, at: "08:05", dayOffset: toSaturday });
  table.put({
    id: saturdayId,
    seriesId: stableUuid("series:browse-board11-saturday"),
    weekdays: ["sat"],
    returnLocal: null,
    pickupOnRoute: false,
    maxDetourMinutes: 4,
    optionalStops: [],
  });
}

function applyLiveCars(db: PreviewDb): void {
  const live: ReadonlyArray<{ tripId: string; driver: "carlos" | "marta"; ageSeconds: number; latitude: number; longitude: number }> = [
    { tripId: T.carlosWork, driver: "carlos", ageSeconds: 12, latitude: 37.3612, longitude: -6.0187 },
    { tripId: T.martaWork, driver: "marta", ageSeconds: 6 * 60, latitude: 37.3731, longitude: -6.0239 },
  ];
  for (const car of live) {
    const trip = db.trips.get(car.tripId);
    if (!trip) continue;
    const principal = actingAs(db, car.driver);
    startOwnedTrip(db, principal, car.tripId);
    recordDriverLocation(db, {
      eventId: db.ids.uuid(),
      tripId: car.tripId,
      driverUserId: principal.userId,
      recordedAt: isoReq(db.nowMs() - car.ageSeconds * 1000),
      latitude: car.latitude,
      longitude: car.longitude,
      accuracyM: 8,
      speedMps: 13,
      headingDegrees: 70,
    });
  }
}
