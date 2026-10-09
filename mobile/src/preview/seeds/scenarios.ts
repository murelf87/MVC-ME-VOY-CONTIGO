/**
 * Variantes del mundo sembrado («seed» de un escenario de diseño). Cada variante parte del mundo base y aplica, con
 * los MISMOS servicios de dominio que usan los endpoints (así emiten los mismos eventos y respetan las mismas reglas),
 * el estado que necesita una pantalla: una solicitud pendiente, una plaza retenida con cuenta atrás, una reserva
 * confirmada, el coche llegando, el trayecto en curso, el viaje terminado…
 *
 * Todas las horas son relativas a «ahora» del reloj virtual (`db.nowMs()`), de modo que sirven con cualquier reloj.
 */
import type { PreviewDb } from "../core/db";
import { lerpPoint, pointAlong, polylineLengthM } from "../core/geo";
import type { RideRequestRow } from "../core/rows";
import { sha256Hex } from "../core/sha256";
import { isoReq } from "../core/wire";
import { completeOwnedTrip, generateOwnPickupCode, startOwnedTrip, verifyPickupCode } from "../domain/execution";
import { sendTripDirectMessage } from "../domain/chat";
import { recordDriverLocation } from "../domain/live";
import { createRideRequestForTrip, decideRideRequest, confirmProviderPayment, type RideRequestExtras } from "../domain/requests";
import { userStats } from "../domain/users";
import { actingAs } from "./actors";
import { illustrativeFareCents } from "./fares";
import { SEED_IDS, SEED_USER_IDS, type SeedUserKey } from "./ids";

const T1 = SEED_IDS.trips.anaMorning;
const MIN = 60_000;

export interface SeedBaseOptions {
  /** Siembra la oferta de viajes. */
  trips: boolean;
  /** Siembra el historial de Miguel con Ana. */
  history: boolean;
  /** Dos solicitudes pendientes de otras personas en el viaje de Ana. */
  pendingForAna: boolean;
  /** Personas cuyos vehículos y viajes no se siembran. */
  skipDrivers: readonly SeedUserKey[];
}

export const DEFAULT_BASE_OPTIONS: SeedBaseOptions = { trips: true, history: true, pendingForAna: true, skipDrivers: [] };

export interface SeedVariant {
  description: string;
  base?: Partial<SeedBaseOptions>;
  apply?: (db: PreviewDb) => void;
}

// ---------------------------------------------------------------------------------------------------------------
// Piezas reutilizables
// ---------------------------------------------------------------------------------------------------------------

function pickupExtras(kind: "montequinto" | "dosHermanas", message: string | null): Partial<RideRequestExtras> {
  if (kind === "dosHermanas") {
    return {
      pickup_lat: 37.283,
      pickup_lng: -5.921,
      pickup_label: "Dos Hermanas",
      pickup_address: null,
      pickup_source: "driver_stop",
      pickup_offset_s: 600,
      pickup_walk_minutes: 6,
      pickup_detour_minutes: 5,
      dropoff_stop_seq: 2,
      road_distance_m: 15000,
      message,
    };
  }
  return {
    pickup_lat: 37.3317,
    pickup_lng: -5.9365,
    pickup_label: "Montequinto",
    pickup_address: null,
    pickup_source: "driver_stop",
    pickup_offset_s: 0,
    pickup_walk_minutes: 21,
    pickup_detour_minutes: 0,
    dropoff_stop_seq: 2,
    road_distance_m: 24000,
    message,
  };
}

function backdate(db: PreviewDb, requestId: string, minutesAgo: number): Readonly<RideRequestRow> {
  const at = db.nowMs() - minutesAgo * MIN;
  return db.rideRequests.update(requestId, { requested_at: at, updated_at: at });
}

/** Solicitudes pendientes de otras personas en el viaje de Ana (lo que ve la conductora en «Solicitudes»). */
export function seedPendingForAna(db: PreviewDb): void {
  const hugo = createRideRequestForTrip(
    db,
    actingAs(db, "hugo"),
    { tripId: T1, fromSegmentSeq: 1, toSegmentSeq: 2 },
    pickupExtras("dosHermanas", "¿Me recogéis en Dos Hermanas, en la parada del tranvía?")
  );
  backdate(db, hugo.request.id, 26);
  const nuria = createRideRequestForTrip(
    db,
    actingAs(db, "nuria"),
    { tripId: T1, fromSegmentSeq: 0, toSegmentSeq: 2 },
    pickupExtras("montequinto", "Voy a la Facultad de Derecho. ¿Os viene bien?")
  );
  backdate(db, nuria.request.id, 11);
}

export const MIGUEL_MESSAGE = "Hola Ana, estaré en la parada de Montequinto con una mochila gris.";

/** Miguel pide plaza a Ana (solicitud pendiente) hace `minutesAgo` minutos. */
export function seedMiguelRequest(db: PreviewDb, minutesAgo = 3): Readonly<RideRequestRow> {
  const { request } = createRideRequestForTrip(
    db,
    actingAs(db, "miguel"),
    { tripId: T1, fromSegmentSeq: 0, toSegmentSeq: 2 },
    pickupExtras("montequinto", MIGUEL_MESSAGE)
  );
  return backdate(db, request.id, minutesAgo);
}

/** Ana acepta la solicitud de Miguel: la plaza queda retenida `holdTtlSeconds`, ya han pasado `secondsAgo` s. */
export function seedAccepted(db: PreviewDb, requestId: string, secondsAgo = 8, holdTtlSeconds = 900): void {
  const outcome = decideRideRequest(db, actingAs(db, "ana"), requestId, "accept", holdTtlSeconds);
  if (!outcome.hold) return;
  const now = db.nowMs();
  db.seatHolds.update(outcome.hold.id, { created_at: now - secondsAgo * 1000, expires_at: now - secondsAgo * 1000 + holdTtlSeconds * 1000 });
  db.rideRequests.update(requestId, { updated_at: now - secondsAgo * 1000 });
}

/** Miguel paga (hace `secondsAgo` s): la reserva queda confirmada. Devuelve el id de la reserva. */
export function seedPaid(db: PreviewDb, requestId: string, secondsAgo = 0): string {
  const result = confirmProviderPayment(db, {
    requestId,
    providerPaymentId: `pi_preview_${sha256Hex(`miguel:${requestId}`).slice(0, 16)}`,
    amountCents: illustrativeFareCents(24000),
  });
  if (result.status !== "confirmed") throw new Error("El pago sembrado no pudo confirmarse");
  if (secondsAgo > 0) {
    const at = db.nowMs() - secondsAgo * 1000;
    db.bookings.update(result.bookingId, { created_at: at, updated_at: at });
    db.rideRequests.update(requestId, { updated_at: at });
    const hold = db.seatHolds.find((h) => h.request_id === requestId);
    if (hold) db.seatHolds.update(hold.id, { consumed_at: at });
  }
  return result.bookingId;
}

/** Conversación de Ana y Miguel sobre la recogida. */
export function seedMiguelChat(db: PreviewDb): void {
  const ana = actingAs(db, "ana");
  const miguel = actingAs(db, "miguel");
  const lines: Array<{ from: "ana" | "miguel"; body: string; minutesAgo: number }> = [
    { from: "miguel", body: MIGUEL_MESSAGE, minutesAgo: 6 },
    { from: "ana", body: "Perfecto, Miguel. Salgo a las 08:05 y te aviso cuando esté llegando.", minutesAgo: 5 },
  ];
  lines.forEach((line, index) => {
    const sender = line.from === "ana" ? ana : miguel;
    const peer = line.from === "ana" ? SEED_USER_IDS.miguel : SEED_USER_IDS.ana;
    const sent = sendTripDirectMessage(db, sender, {
      tripId: T1,
      peerUserId: peer,
      clientMessageId: `seed-chat-${index + 1}`,
      body: line.body,
    });
    db.messages.update(sent.id, { created_at: db.nowMs() - line.minutesAgo * MIN });
  });
}

function routeOf(db: PreviewDb, tripId: string): Array<[number, number]> {
  const trip = db.trips.get(tripId);
  if (!trip) throw new Error(`Viaje sembrado desconocido: ${tripId}`);
  return trip.route_geometry;
}

function publishLocation(db: PreviewDb, tripId: string, point: { latitude: number; longitude: number }, secondsAgo: number, speedMps: number, heading: number): void {
  recordDriverLocation(db, {
    eventId: db.ids.uuid(),
    tripId,
    driverUserId: SEED_USER_IDS.ana,
    recordedAt: isoReq(db.nowMs() - secondsAgo * 1000),
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyM: 6 + (secondsAgo % 4),
    speedMps,
    headingDegrees: heading,
  });
}

/** Ana ha iniciado el viaje y se acerca a la parada de Montequinto (2,4 km → 600 m). */
function seedApproaching(db: PreviewDb): void {
  const route = routeOf(db, T1);
  const first = route[0];
  if (!first) return;
  const origin = { latitude: first[1], longitude: first[0] };
  const far = { latitude: origin.latitude - 0.0205, longitude: origin.longitude - 0.0085 };
  const steps: Array<{ t: number; ago: number; speed: number }> = [
    { t: 1, ago: 120, speed: 9.4 },
    { t: 0.8, ago: 90, speed: 10.1 },
    { t: 0.6, ago: 60, speed: 9.8 },
    { t: 0.4, ago: 30, speed: 8.7 },
    { t: 0.25, ago: 8, speed: 8.2 },
  ];
  for (const step of steps) publishLocation(db, T1, lerpPoint(origin, far, step.t), step.ago, step.speed, 20);
}

/** Ana va de camino a la Universidad, ya con Laura y Miguel a bordo. */
function seedInTransit(db: PreviewDb, progress: number): void {
  const route = routeOf(db, T1);
  const total = polylineLengthM(route);
  for (const [offset, ago] of [
    [-0.06, 90],
    [-0.03, 60],
    [-0.01, 30],
    [0, 8],
  ] as const) {
    const point = pointAlong(route, Math.max(0, (progress + offset) * total));
    publishLocation(db, T1, point, ago, 11.2, 340);
  }
}

function startTrip(db: PreviewDb, minutesAgo: number): void {
  startOwnedTrip(db, actingAs(db, "ana"), T1);
  db.trips.update(T1, { started_at: db.nowMs() - minutesAgo * MIN });
}

function pickUpLaura(db: PreviewDb): void {
  const booking = db.bookings.find((b) => {
    const request = db.rideRequests.get(b.request_id);
    return request?.trip_id === T1 && request.passenger_user_id === SEED_USER_IDS.laura;
  });
  if (booking) db.bookings.update(booking.id, { picked_up_at: db.nowMs() - 14 * MIN });
}

function pickUpMiguel(db: PreviewDb, bookingId: string): void {
  const generated = generateOwnPickupCode(db, actingAs(db, "miguel"), bookingId);
  verifyPickupCode(db, actingAs(db, "ana"), bookingId, generated.code);
  const at = db.nowMs() - 11 * MIN;
  db.bookings.update(bookingId, { picked_up_at: at });
  db.pickupCodes.update(bookingId, { verified_at: at });
}

// ---------------------------------------------------------------------------------------------------------------
// Variantes
// ---------------------------------------------------------------------------------------------------------------

export const SEED_VARIANTS: Readonly<Record<string, SeedVariant>> = {
  default: {
    description:
      "Lunes 5 de octubre de 2026, 07:17. Oferta de la mañana en Sevilla (láminas 09, 11, 12), reservas confirmadas de otras personas y dos solicitudes pendientes en el viaje de Ana.",
  },
  "driver-requests": {
    description: "Igual que «default»: Ana (conductora) tiene dos solicitudes pendientes en su viaje de las 08:05.",
  },
  empty: {
    description: "Sin viajes, sin solicitudes y sin historial: estados vacíos («Sin coincidencias», «Aún no has publicado»).",
    base: { trips: false, history: false, pendingForAna: false },
  },
  "fresh-driver": {
    description: "Ana acaba de hacerse conductora: sin vehículo, sin documentos y sin viajes (alta de vehículo desde cero).",
    base: { history: false, pendingForAna: false, skipDrivers: ["ana"] },
    apply(db) {
      userStats(db).update(SEED_USER_IDS.ana, { rating_average: null, rating_count: 0, trips_completed: 0 });
    },
  },
  "request-pending": {
    description: "Miguel envió hace 3 minutos una solicitud a Ana para el viaje de las 08:05 (esperando respuesta).",
    apply(db) {
      seedMiguelRequest(db, 3);
    },
  },
  "request-accepted": {
    description: "Ana aceptó la solicitud de Miguel hace 8 s: plaza retenida 15 min (cuenta atrás 14:52) y pago pendiente.",
    apply(db) {
      const request = seedMiguelRequest(db, 6);
      seedAccepted(db, request.id, 8, 900);
    },
  },
  "booking-confirmed": {
    description: "Miguel pagó: reserva confirmada en el viaje de las 08:05, con la conversación con Ana abierta.",
    apply(db) {
      const request = seedMiguelRequest(db, 9);
      seedAccepted(db, request.id, 300, 900);
      seedPaid(db, request.id, 240);
      seedMiguelChat(db);
    },
  },
  "trip-live-waiting": {
    description: "El viaje de Ana está en curso y el coche se acerca a la parada de Montequinto, donde espera Miguel.",
    apply(db) {
      const request = seedMiguelRequest(db, 40);
      seedAccepted(db, request.id, 1800, 3600);
      seedPaid(db, request.id, 1700);
      seedMiguelChat(db);
      startTrip(db, 4);
      seedApproaching(db);
    },
  },
  "trip-live-in-car": {
    description: "Miguel y Laura ya van en el coche (código de recogida verificado) camino de la Universidad, al 40 % del trayecto.",
    apply(db) {
      const request = seedMiguelRequest(db, 60);
      seedAccepted(db, request.id, 3000, 3600);
      const bookingId = seedPaid(db, request.id, 2880);
      seedMiguelChat(db);
      startTrip(db, 15);
      pickUpLaura(db);
      pickUpMiguel(db, bookingId);
      seedInTransit(db, 0.4);
    },
  },
  "trip-finished": {
    description: "El viaje terminó hace 2 minutos: Miguel y Laura llegaron a la Universidad (pantalla de valoración).",
    apply(db) {
      const request = seedMiguelRequest(db, 80);
      seedAccepted(db, request.id, 3500, 3600);
      const bookingId = seedPaid(db, request.id, 3420);
      seedMiguelChat(db);
      startTrip(db, 28);
      pickUpLaura(db);
      pickUpMiguel(db, bookingId);
      seedInTransit(db, 0.97);
      completeOwnedTrip(db, actingAs(db, "ana"), T1);
      const completedAt = db.nowMs() - 2 * MIN;
      db.trips.update(T1, { completed_at: completedAt, updated_at: completedAt });
    },
  },
};

export type SeedVariantName = keyof typeof SEED_VARIANTS;

export function seedVariantNames(): string[] {
  return Object.keys(SEED_VARIANTS);
}

export function isKnownSeedVariant(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(SEED_VARIANTS, name);
}

export function baseOptionsFor(name: string): SeedBaseOptions {
  const variant = isKnownSeedVariant(name) ? SEED_VARIANTS[name] : undefined;
  return { ...DEFAULT_BASE_OPTIONS, ...(variant?.base ?? {}) };
}

export function applySeedVariant(db: PreviewDb, name: string): void {
  const variant = isKnownSeedVariant(name) ? SEED_VARIANTS[name] : undefined;
  variant?.apply?.(db);
}
