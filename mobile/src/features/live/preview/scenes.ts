/**
 * Escenas sembradas del slice `live` (SIMULACIÓN, solo vista previa): cada variante `live-*` deja el mundo base y añade UN
 * viaje de Ana (Seat León blanco, 1234 LBC) en el que Miguel —la persona de prueba «pasajero»— tiene plaza confirmada
 * junto a Laura, en el estado que necesita una pantalla de las láminas 21 a 24. Se construyen con los MISMOS servicios de
 * dominio que usan los endpoints (iniciar viaje, publicar posición, generar y verificar el código, completar) y todas las
 * horas son relativas al «ahora» del reloj virtual, así que valen con cualquier reloj.
 *
 * Recorrido (Sevilla), con los tramos de la lámina: 0 Dos Hermanas (origen del conductor) → 1 C. Luis Montoto (recogida de
 * Miguel) → 2 C. Kansas City (parada) → 3 Universidad de Sevilla (destino). Con la parada de 60 s entre tramos, la
 * planificación es recogida 07:25, parada 08:05 y destino 08:20 (55 min · 12,6 km para quien sube en la recogida).
 */
import {
  SEED_IDS,
  SEED_USER_IDS,
  SEED_VEHICLE_IDS,
  actingAs,
  createRouteChange,
  bearingDeg,
  completeOwnedTrip,
  generateOwnPickupCode,
  insertTripWithPlan,
  isoReq,
  loadRouteModel,
  planFor,
  pointAlong,
  polylineLengthM,
  projectOnRoute,
  recordDriverLocation,
  seedConfirmedRider,
  sha256Hex,
  stableUuid,
  startOwnedTrip,
  verifyPickupCode,
} from "@/preview";
import type { PreviewDb, SeedStop, TripRow } from "@/preview";
import { liveAttachments, liveIncidents, liveRatings, liveShares, commsSettings, STORAGE_OFF_SETTING, type IncidentCategoryValue, type IncidentStatusValue } from "./rows";
import { tokenFromSeed } from "./shares";

const MIN = 60_000;
const DAY = 86_400_000;

/** Id del viaje de todas las escenas (cada variante es su propio mundo, así que no choca). */
export const SCENE_TRIP_ID = stableUuid("live:scene:trip");
/** Misma clave que usa `seedConfirmedRider` (`booking:<viaje>:<persona>`). */
export const SCENE_BOOKING_ID = stableUuid(`booking:${SCENE_TRIP_ID}:miguel`);
export const SCENE_CO_PASSENGER_BOOKING_ID = stableUuid(`booking:${SCENE_TRIP_ID}:laura`);
/** Identificador que no existe en ningún mundo: abre la pantalla en su estado «no encontrado». */
export const ABSENT_ID = stableUuid("live:absent");
export const ABSENT_SHARE_TOKEN = `mvc_share_${"x".repeat(43)}`;

const STOPS: readonly SeedStop[] = [
  { latitude: 37.2829, longitude: -5.9209, label: "Dos Hermanas" },
  { latitude: 37.3849, longitude: -5.9738, label: "C. Luis Montoto" },
  { latitude: 37.3869, longitude: -5.9664, label: "C. Kansas City" },
  { latitude: 37.3589, longitude: -5.9865, label: "Universidad de Sevilla" },
];

const SEGMENTS = [
  { distanceM: 9_600, durationS: 1_920 },
  { distanceM: 5_800, durationS: 2_340 },
  { distanceM: 6_800, durationS: 840 },
] as const;

const TO_PICKUP_S = SEGMENTS[0].durationS;
/** Desde que se pasa por la recogida hasta el destino, con 60 s de parada en la recogida y en la parada intermedia. */
const PICKUP_TO_DESTINATION_S = SEGMENTS[1].durationS + SEGMENTS[2].durationS + 120;
const CODE_DWELL_S = 60;
/** Importe de ejemplo de la lámina 24 («4,00 €»): lo emite el servidor simulado como `illustrative`. */
const ILLUSTRATIVE_FARE_CENTS = 400;

const floorMinute = (ms: number): number => Math.floor(ms / MIN) * MIN;

// ---------------------------------------------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------------------------------------------

function createTrip(db: PreviewDb, departureAtMs: number): Readonly<TripRow> {
  const plan = planFor(db, STOPS, SEGMENTS, departureAtMs);
  const [origin, ...rest] = STOPS;
  const destination = rest[rest.length - 1];
  if (!origin || !destination) throw new Error("La escena necesita origen y destino");
  const trip = insertTripWithPlan(
    db,
    {
      id: SCENE_TRIP_ID,
      driverUserId: SEED_USER_IDS.ana,
      vehicleId: SEED_VEHICLE_IDS.anaLeon,
      provinceId: SEED_IDS.province,
      category: "university",
      leg: "outbound",
      departureAtMs,
      flexibilityMinutes: 10,
      maxDetourM: 3000,
      offeredSeats: 3,
      origin,
      destination,
      intermediates: rest.slice(0, -1),
      status: "published",
      stopLabels: STOPS.map((s) => s.label),
    },
    plan
  );
  const createdAt = Math.min(db.nowMs(), departureAtMs) - 2 * DAY;
  db.trips.update(trip.id, { created_at: createdAt, updated_at: createdAt });
  return db.trips.get(trip.id) ?? trip;
}

/** Miguel (la persona de prueba) y Laura suben en la recogida (parada 1) y bajan en el destino (parada 3). */
function addRiders(db: PreviewDb, trip: Readonly<TripRow>): void {
  const miguel = seedConfirmedRider(db, trip, { user: "miguel", from: 1, to: 3 });
  seedConfirmedRider(db, trip, { user: "laura", from: 1, to: 3 });
  db.bookings.update(miguel.bookingId, { amount_cents: ILLUSTRATIVE_FARE_CENTS });
}

function startTrip(db: PreviewDb, departureAtMs: number): void {
  startOwnedTrip(db, actingAs(db, "ana"), SCENE_TRIP_ID);
  db.trips.update(SCENE_TRIP_ID, { started_at: departureAtMs });
}

interface Spot {
  latitude: number;
  longitude: number;
  heading: number;
}

/** Punto de la ruta guardada en el tramo `segment` (entre la parada `segment` y la siguiente), a la fracción `q` de ese tramo. */
function spotOnSegment(db: PreviewDb, segment: number, q: number): Spot {
  const trip = db.trips.get(SCENE_TRIP_ID);
  if (!trip) throw new Error("La escena no tiene viaje");
  const route = trip.route_geometry;
  const model = loadRouteModel(db, SCENE_TRIP_ID);
  const from = model.stops[segment]?.frac ?? 0;
  const to = model.stops[segment + 1]?.frac ?? 1;
  const span = Math.max(to - from, 1e-9);
  const total = polylineLengthM(route);
  const target = Math.min(1, Math.max(0, q));
  let fraction = from + target * span;
  // La proyección sobre la ruta no es exactamente la longitud acumulada: se corrige hasta que ambas coinciden.
  for (let i = 0; i < 4; i += 1) {
    const probe = pointAlong(route, fraction * total);
    const projected = projectOnRoute(route, probe.latitude, probe.longitude);
    if (!projected) break;
    fraction += (target - (projected.fraction - from) / span) * span;
  }
  fraction = Math.min(to, Math.max(from, fraction));
  const point = pointAlong(route, fraction * total);
  const ahead = pointAlong(route, Math.min(1, fraction + 0.002) * total);
  const behind = pointAlong(route, Math.max(0, fraction - 0.002) * total);
  return { latitude: point.latitude, longitude: point.longitude, heading: Math.round(bearingDeg(behind, ahead) * 10) / 10 };
}

function publishFix(db: PreviewDb, spot: Spot, ageSeconds: number, speedMps: number): void {
  recordDriverLocation(db, {
    eventId: db.ids.uuid(),
    tripId: SCENE_TRIP_ID,
    driverUserId: SEED_USER_IDS.ana,
    recordedAt: isoReq(db.nowMs() - ageSeconds * 1000),
    latitude: spot.latitude,
    longitude: spot.longitude,
    accuracyM: 6 + (ageSeconds % 4),
    speedMps,
    headingDegrees: spot.heading,
  });
}

/** El coche va hacia la recogida: la última posición tiene `ageSeconds` y a esa hora faltaban `remainingS` s de ruta planificada. */
function approachPickup(db: PreviewDb, remainingS: number, ageSeconds: number): void {
  for (const [extra, speed] of [
    [45, 9.1],
    [25, 8.8],
    [0, 9.4],
  ] as const) {
    const q = 1 - (remainingS + extra) / TO_PICKUP_S;
    if (q >= 0) publishFix(db, spotOnSegment(db, 0, q), ageSeconds + extra, speed);
  }
}

/** Código de recogida generado y verificado, con las marcas de tiempo de la escena. */
function pickUp(db: PreviewDb, bookingId: string, pickedUpAt: number): void {
  const generated = generateOwnPickupCode(db, actingAs(db, "miguel"), bookingId);
  verifyPickupCode(db, actingAs(db, "ana"), bookingId, generated.code);
  db.bookings.update(bookingId, { picked_up_at: pickedUpAt, updated_at: pickedUpAt });
  db.pickupCodes.update(bookingId, { generated_at: pickedUpAt - 90_000, verified_at: pickedUpAt });
}

function pickUpCoPassenger(db: PreviewDb, pickedUpAt: number): void {
  db.bookings.update(SCENE_CO_PASSENGER_BOOKING_ID, { picked_up_at: pickedUpAt + 20_000, updated_at: pickedUpAt });
}

// ---------------------------------------------------------------------------------------------------------------
// Etapas del viaje
// ---------------------------------------------------------------------------------------------------------------

/** El coche de camino a la recogida. */
function sceneEnRoute(db: PreviewDb, options: { remainingS: number; ageSeconds: number; sharesLocation?: boolean }): void {
  const now = db.nowMs();
  const fixAt = now - options.ageSeconds * 1000;
  const pickupAt = floorMinute(fixAt + options.remainingS * 1000);
  const departureAt = pickupAt - TO_PICKUP_S * 1000;
  const trip = createTrip(db, departureAt);
  addRiders(db, trip);
  startTrip(db, departureAt);
  if (options.sharesLocation === false) setSharesLocation(db, false);
  approachPickup(db, options.remainingS, options.ageSeconds);
}

function setSharesLocation(db: PreviewDb, shares: boolean): void {
  const settings = commsSettings(db);
  const now = db.nowMs();
  const existing = settings.get(SEED_USER_IDS.ana);
  if (existing) settings.update(SEED_USER_IDS.ana, { share_live_location_in_trip: shares, updated_at: now });
  else settings.insert({ user_id: SEED_USER_IDS.ana, share_live_location_in_trip: shares, font_scale: "normal", language: "es", updated_at: now });
}

/** Ya van en el coche: recogida verificada hace `minutesAgo` min y el coche entre la recogida y la parada intermedia. */
function sceneInCar(db: PreviewDb, minutesAgo: number): number {
  const now = db.nowMs();
  const pickedUpAt = now - minutesAgo * MIN;
  const pickupAt = floorMinute(pickedUpAt - 12_000);
  const departureAt = pickupAt - TO_PICKUP_S * 1000;
  const trip = createTrip(db, departureAt);
  addRiders(db, trip);
  startTrip(db, departureAt);
  pickUp(db, SCENE_BOOKING_ID, pickedUpAt);
  pickUpCoPassenger(db, pickedUpAt);
  const ageSeconds = 6;
  const sincePickupS = (now - ageSeconds * 1000 - pickupAt) / 1000 - CODE_DWELL_S;
  for (const [extra, speed] of [
    [40, 11.2],
    [20, 11.5],
    [0, 11.1],
  ] as const) {
    const q = Math.min(0.97, Math.max(0.02, (sincePickupS - extra) / SEGMENTS[1].durationS));
    publishFix(db, spotOnSegment(db, 1, q), ageSeconds + extra, speed);
  }
  return pickedUpAt;
}

/** Viaje terminado hace `endedAgoMs`: Miguel y Laura llegaron al destino. */
function sceneFinished(db: PreviewDb, endedAgoMs: number): void {
  const now = db.nowMs();
  const completedAt = now - endedAgoMs;
  const pickupAt = completedAt - PICKUP_TO_DESTINATION_S * 1000;
  const pickedUpAt = pickupAt + 12_000;
  const departureAt = pickupAt - TO_PICKUP_S * 1000;
  const trip = createTrip(db, departureAt);
  addRiders(db, trip);
  startTrip(db, departureAt);
  pickUp(db, SCENE_BOOKING_ID, pickedUpAt);
  pickUpCoPassenger(db, pickedUpAt);
  completeOwnedTrip(db, actingAs(db, "ana"), SCENE_TRIP_ID);
  db.trips.update(SCENE_TRIP_ID, { started_at: departureAt, completed_at: completedAt, updated_at: completedAt });
  for (const id of [SCENE_BOOKING_ID, SCENE_CO_PASSENGER_BOOKING_ID]) db.bookings.update(id, { updated_at: completedAt });
}

function rateDriver(db: PreviewDb, stars: number, comment: string | null, createdAt: number): void {
  liveRatings(db).insert({
    id: db.ids.uuid(),
    trip_id: SCENE_TRIP_ID,
    booking_id: SCENE_BOOKING_ID,
    rater_user_id: SEED_USER_IDS.miguel,
    ratee_user_id: SEED_USER_IDS.ana,
    rater_role: "passenger",
    stars,
    comment,
    created_at: createdAt,
  });
}

interface IncidentSeed {
  category: IncidentCategoryValue;
  status: IncidentStatusValue;
  description: string;
  createdAgoMs: number;
  attachments?: number;
}

function seedIncidents(db: PreviewDb, list: readonly IncidentSeed[]): void {
  const now = db.nowMs();
  for (const item of list) {
    const createdAt = now - item.createdAgoMs;
    const closed = item.status === "resolved" || item.status === "dismissed";
    const report = liveIncidents(db).insert({
      id: db.ids.uuid(),
      reporter_user_id: SEED_USER_IDS.miguel,
      reporter_role: "passenger",
      trip_id: SCENE_TRIP_ID,
      booking_id: SCENE_BOOKING_ID,
      category: item.category,
      description: item.description,
      status: item.status,
      idempotency_key: null,
      created_at: createdAt,
      updated_at: closed ? createdAt + 6 * 3_600_000 : createdAt + 30 * MIN,
      resolved_at: closed ? createdAt + 6 * 3_600_000 : null,
    });
    for (let index = 0; index < (item.attachments ?? 0); index += 1) {
      const id = db.ids.uuid();
      const key = ["users", SEED_USER_IDS.miguel, "incidents", report.id, `${id}.jpg`].join("/");
      db.blobs.putMetadataOnly({ key, sizeBytes: 482_113 + index * 1_024, contentType: "image/jpeg", uploadedAt: createdAt + MIN });
      liveAttachments(db).insert({
        id,
        report_id: report.id,
        owner_user_id: SEED_USER_IDS.miguel,
        storage_key: key,
        content_type: "image/jpeg",
        expected_size_bytes: 482_113 + index * 1_024,
        size_bytes: 482_113 + index * 1_024,
        status: "uploaded",
        expires_at: createdAt + 11 * MIN,
        created_at: createdAt + MIN,
        completed_at: createdAt + 2 * MIN,
      });
    }
  }
}

function seedActiveShare(db: PreviewDb): void {
  const now = db.nowMs();
  liveShares(db).insert({
    id: db.ids.uuid(),
    booking_id: SCENE_BOOKING_ID,
    trip_id: SCENE_TRIP_ID,
    owner_user_id: SEED_USER_IDS.miguel,
    token_hash: sha256Hex(sceneShareToken()),
    include_plate: false,
    created_at: now - 20 * MIN,
    expires_at: now - 20 * MIN + 360 * MIN,
    revoked_at: null,
    last_viewed_at: now - 4 * MIN,
    view_count: 3,
  });
}

/** Token del enlace compartido sembrado (la vista previa lo calcula; el servidor real nunca lo guarda). */
export function sceneShareToken(): string {
  return tokenFromSeed("live:scene:share-token");
}

// ---------------------------------------------------------------------------------------------------------------
// Variantes
// ---------------------------------------------------------------------------------------------------------------

interface Scene {
  description: string;
  build(db: PreviewDb): void;
}

const SCENES: Readonly<Record<string, Scene>> = {
  "live-waiting": {
    description: "Lámina 21: Ana va de camino (llega a la recogida en 8 min · 2,4 km, posición de hace 5 s) y Miguel espera en C. Luis Montoto.",
    build: (db) => sceneEnRoute(db, { remainingS: 480, ageSeconds: 5 }),
  },
  "live-arriving": {
    description: "El coche llega a la recogida en unos 3 min (aviso «está llegando»).",
    build: (db) => sceneEnRoute(db, { remainingS: 180, ageSeconds: 4 }),
  },
  "live-at-pickup": {
    description: "Lámina 23: el coche está en la recogida (a menos de 100 m) y Miguel aún no ha dado el código; la llegada al destino es a las 08:20.",
    build: (db) => sceneEnRoute(db, { remainingS: 5, ageSeconds: 12 }),
  },
  "live-route-change": {
    description: "Lámina 22: Ana, de camino a la recogida (sin señal desde hace 2 min), propone una parada nueva (Plaza de Armas) que cambia la hora de llegada de Miguel; Miguel aún no ha respondido.",
    build: (db) => {
      sceneEnRoute(db, { remainingS: 480, ageSeconds: 130 });
      // Con 10 min de margen casi nada es «material»: Ana ha dejado 3 min de margen para este viaje.
      db.trips.update(SCENE_TRIP_ID, { flexibility_minutes: 3 });
      // El tramo recogida → parada intermedia de las láminas es muy lento (39 min para 5,8 km): aquí se deja a ritmo urbano
      // real (10 min) para que dar un rodeo por la parada nueva sí sume minutos y el cambio sea material.
      const segment = db.tripSegments.get(`${SCENE_TRIP_ID}:1`);
      if (segment) db.tripSegments.update(`${SCENE_TRIP_ID}:1`, { duration_s: 600 });
      createRouteChange(db, actingAs(db, "ana"), { tripId: SCENE_TRIP_ID, stop: { lat: 37.3896, lng: -5.9993, label: "Plaza de Armas" } });
    },
  },
  "live-stale": {
    description: "Sin señal: la última posición del coche es de hace 2 min (nunca se presenta como «en directo»).",
    build: (db) => sceneEnRoute(db, { remainingS: 300, ageSeconds: 130 }),
  },
  "live-no-signal": {
    description: "El viaje ha empezado pero el coche aún no ha enviado ninguna posición (la llegada sale de la hora prevista).",
    build: (db) => {
      const now = db.nowMs();
      const departureAt = floorMinute(now) - 3 * MIN;
      const trip = createTrip(db, departureAt);
      addRiders(db, trip);
      startTrip(db, departureAt);
    },
  },
  "live-scheduled": {
    description: "El viaje de Ana aún no ha empezado: sale en unos 8 min y recoge a Miguel en unos 40.",
    build: (db) => {
      const pickupAt = floorMinute(db.nowMs()) + 40 * MIN;
      const trip = createTrip(db, pickupAt - TO_PICKUP_S * 1000);
      addRiders(db, trip);
    },
  },
  "live-approximate": {
    description: "Ana tiene desactivado «Compartir ubicación en viaje»: Miguel ve una zona de ~1 km, sin rumbo, y la hora de llegada sin distancia.",
    build: (db) => sceneEnRoute(db, { remainingS: 480, ageSeconds: 5, sharesLocation: false }),
  },
  "live-in-car": {
    description: "Miguel y Laura van en el coche desde hace 14 min (código verificado), de camino a C. Kansas City.",
    build: (db) => {
      sceneInCar(db, 14);
    },
  },
  "live-cancelled": {
    description: "Ana canceló el viaje hace unos minutos: la reserva de Miguel queda cancelada por la persona que conducía.",
    build: (db) => {
      const now = db.nowMs();
      const trip = createTrip(db, floorMinute(now) + 30 * MIN);
      addRiders(db, trip);
      db.trips.update(trip.id, { status: "cancelled", updated_at: now });
      for (const id of [SCENE_BOOKING_ID, SCENE_CO_PASSENGER_BOOKING_ID]) db.bookings.update(id, { status: "driver_cancelled", updated_at: now });
    },
  },
  "live-finished": {
    description: "Lámina 24: el viaje terminó hace 2 min (55 min · 12,6 km, pago pendiente de definir) y Miguel aún no ha valorado a Ana.",
    build: (db) => sceneFinished(db, 2 * MIN),
  },
  "live-finished-rated": {
    description: "Viaje terminado hace 2 min y Miguel ya valoró a Ana con 5 estrellas.",
    build: (db) => {
      sceneFinished(db, 2 * MIN);
      rateDriver(db, 5, "Puntual y muy amable.", db.nowMs() - MIN);
    },
  },
  "live-rating-closed": {
    description: "El viaje terminó hace 15 días: ya pasó el plazo de 14 días para valorarlo.",
    build: (db) => sceneFinished(db, 15 * DAY),
  },
  "live-incidents": {
    description: "Viaje terminado hace 3 días con tres incidencias de Miguel: una en revisión con una foto, una abierta y una resuelta.",
    build: (db) => {
      sceneFinished(db, 3 * DAY);
      seedIncidents(db, [
        { category: "route_or_schedule", status: "in_review", description: "La parada extra no estaba acordada y llegué 5 minutos tarde.", createdAgoMs: 2 * DAY + 3 * 3_600_000, attachments: 1 },
        { category: "lost_item", status: "open", description: "Me dejé una mochila negra en el asiento de atrás del coche.", createdAgoMs: 20 * 3_600_000 },
        { category: "vehicle", status: "resolved", description: "El cinturón de seguridad de atrás a la izquierda no se abrochaba bien.", createdAgoMs: 2 * DAY + 20 * 3_600_000 },
      ]);
    },
  },
  "live-shared": {
    description: "Miguel va en el coche y tiene un enlace privado activo de «Compartir viaje» (creado hace 20 min, 3 visitas).",
    build: (db) => {
      sceneInCar(db, 14);
      seedActiveShare(db);
    },
  },
  "live-storage-off": {
    description: "Viaje terminado hace 2 min y el almacenamiento privado está sin configurar: los adjuntos de una incidencia devuelven 503.",
    build: (db) => {
      sceneFinished(db, 2 * MIN);
      db.setSetting(STORAGE_OFF_SETTING, true);
    },
  },
};

export const LIVE_SEED_VARIANTS: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(SCENES).map(([name, scene]) => [name, scene.description]));

/** Construye la escena de `seed` (si es de este slice) sobre el mundo base. */
export function buildLiveScene(db: PreviewDb, seed: string): void {
  if (!Object.prototype.hasOwnProperty.call(SCENES, seed)) return;
  SCENES[seed]?.build(db);
}
