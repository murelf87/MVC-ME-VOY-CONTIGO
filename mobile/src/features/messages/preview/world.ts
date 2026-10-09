/**
 * Mundo sembrado del slice `messages` (SIMULACIÓN, solo vista previa): lo que necesitan las láminas 25–28 para verse como
 * el diseño, sobre el mundo base de «default» (lunes 5 de octubre de 2026).
 *
 * Quien mira es Miguel Torres (perfil «Pasajero»):
 *   · Ana García es la conductora de «Sevilla Centro → Isla Mágica» (07:25–07:45, hoy, ruta recurrente al trabajo). Miguel,
 *     Laura y Hugo tienen reserva confirmada en ella → chat directo con Ana + grupo «Ruta Sevilla · Trabajo».
 *   · Miguel Ángel conduce «Universidad → Mairena» (17:45): chat directo «Miguel · Universidad · Sevilla».
 *   · Laura (que aquí también conduce) lleva a Miguel a un hospital: chat directo «Laura · Hospital · Sevilla».
 *
 * Las horas son relativas al reloj virtual (`localAt`: hoy a las 07:12, ayer a las 18:30…), de modo que sirven con cualquier
 * reloj y la bandeja muestra «07:12» y «Ayer» como la lámina. Las filas se insertan directamente (sin pasar por los eventos
 * de dominio): sembrar un mensaje no genera avisos, que se siembran a mano donde la lámina los muestra.
 */
import type { DirectMessageRow, PreviewDb, PreviewProfileId, SeedStop, TripRow } from "@/preview";
import {
  SEED_IDS,
  SEED_TRIP_IDS,
  SEED_USER_IDS,
  SEED_VEHICLE_IDS,
  addRole,
  historyTripIds,
  insertTripWithPlan,
  localAt,
  planFor,
  profileUserId,
  registerSeedRef,
  seedConfirmedRider,
  stableUuid,
} from "@/preview";
import { accessibleConversations, directConversationId, findConversation, groupConversationId, routeKeyOf, seatsKey, setPointers, visibleMessages } from "./access";
import { tablesOf } from "./rows";

// ── Personas, viajes y sitios ────────────────────────────────────────────────────────────────────────────────────

const ME = SEED_USER_IDS.miguel;
const ANA = SEED_USER_IDS.ana;
const LAURA = SEED_USER_IDS.laura;
const HUGO = SEED_USER_IDS.hugo;
const MIGUEL_ANGEL = SEED_USER_IDS.miguelAngel;

export const WORLD = {
  tripIsla: stableUuid("messages:trip:isla-magica"),
  tripHospital: stableUuid("messages:trip:laura-hospital"),
  vehicleLaura: stableUuid("messages:vehicle:laura"),
} as const;

const SEVILLA_CENTRO: SeedStop = { latitude: 37.3891, longitude: -5.9845, label: "Sevilla Centro" };
const ISLA_MAGICA: SeedStop = { latitude: 37.405, longitude: -6.0025, label: "Isla Mágica" };
const DOS_HERMANAS: SeedStop = { latitude: 37.2829, longitude: -5.9209, label: "Dos Hermanas" };
const HOSPITAL_ROCIO: SeedStop = { latitude: 37.3643, longitude: -5.976, label: "Hospital Universitario Virgen del Rocío" };

/** Punto de recogida de la lámina 26: «Aparcamiento P1 · Isla Mágica». */
export const PICKUP_P1 = { lat: 37.4057, lng: -6.0035, label: "Aparcamiento P1 · Isla Mágica" } as const;
/** Lo que comparte Miguel en la lámina 26: tres líneas («Aparcamiento P1 / Isla Mágica / Sevilla»). */
const SHARED_LABEL = "Aparcamiento P1 · Isla Mágica · Sevilla";

/** Aporte «Propuesta: 4,00 €» de las láminas 26–28 (importe ILUSTRATIVO de la vista previa; el servidor real emite «Por definir»). */
export const ILLUSTRATIVE_CONTRIBUTION_CENTS = 400;

// ── Variantes ────────────────────────────────────────────────────────────────────────────────────────────────────

export const messagesSeedVariants: Readonly<Record<string, string>> = {
  "messages-inbox": "Lámina 25 (reloj 07:17): Mensajes de Miguel con Ana (2 sin leer), «Ruta Sevilla · Trabajo» (3), Miguel (Universidad) y Laura (Hospital).",
  "messages-inbox-empty": "Miguel sin ninguna reserva: bandeja vacía («Aún no tienes más mensajes»).",
  "messages-inbox-many": "Bandeja larga (más de 20 conversaciones) para probar la paginación con cursor y la búsqueda.",
  "messages-chat": "Lámina 26 (reloj 07:22): chat de Miguel con Ana (Sevilla Centro → Isla Mágica, 07:25–07:45, «2 plazas»), dentro de la ventana de llamada.",
  "messages-chat-early": "Igual que «messages-chat» pero el viaje es mañana: la ventana de «Llamar a Ana» aún no se ha abierto.",
  "messages-chat-blocked": "Miguel ha bloqueado a Ana: el chat responde 403 CHAT_BLOCKED.",
  "messages-chat-closed": "La reserva de Miguel con Ana está cancelada: el chat responde 403 CHAT_FORBIDDEN y la conversación sale de la bandeja.",
};

// ── Piezas ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Borra el historial de 12 viajes de Miguel con Ana (reservas completadas): sin ello la bandeja llevaría 12 chats vacíos de Ana. */
function pruneHistory(db: PreviewDb): void {
  const trips = new Set(historyTripIds(db));
  for (const request of db.rideRequests.filter((r) => trips.has(r.trip_id))) {
    for (const booking of db.bookings.filter((b) => b.request_id === request.id)) db.bookings.delete(booking.id);
    for (const hold of db.seatHolds.filter((h) => h.request_id === request.id)) db.seatHolds.delete(hold.id);
    db.rideRequests.delete(request.id);
  }
}

interface SeedTripInput {
  id: string;
  driverUserId: string;
  vehicleId: string;
  category: TripRow["category"];
  at: string;
  dayOffset: number;
  seats: number;
  stops: readonly SeedStop[];
  segments?: ReadonlyArray<{ distanceM: number; durationS: number }>;
}

function insertTrip(db: PreviewDb, input: SeedTripInput): Readonly<TripRow> {
  const departureAt = localAt(db, input.at, input.dayOffset);
  const plan = planFor(db, input.stops, input.segments, departureAt);
  const [origin, ...rest] = input.stops;
  const destination = rest[rest.length - 1];
  if (!origin || !destination) throw new Error("Un viaje necesita al menos origen y destino");
  const trip = insertTripWithPlan(
    db,
    {
      id: input.id,
      driverUserId: input.driverUserId,
      vehicleId: input.vehicleId,
      provinceId: SEED_IDS.province,
      category: input.category,
      leg: "outbound",
      departureAtMs: departureAt,
      flexibilityMinutes: 5,
      maxDetourM: 2000,
      offeredSeats: input.seats,
      origin,
      destination,
      intermediates: rest.slice(0, -1),
      status: "published",
      stopLabels: input.stops.map((s) => s.label),
    },
    plan,
  );
  const createdAt = Math.min(db.nowMs(), departureAt) - 2 * 86_400_000;
  db.trips.update(trip.id, { created_at: createdAt, updated_at: createdAt });
  return db.trips.get(trip.id) ?? trip;
}

interface Booked {
  requestId: string;
  bookingId: string;
}

/** Reserva confirmada de `user` en `trip` (sin pasar por el flujo de solicitud y pago). */
function book(db: PreviewDb, trip: Readonly<TripRow>, user: "miguel" | "laura" | "hugo", bookedAt: number): Booked {
  const booked = seedConfirmedRider(db, trip, { user, from: 0, to: 1 }, { bookedAt });
  return { requestId: booked.requestId, bookingId: booked.bookingId };
}

/** Viaje de Isla Mágica de Ana (ruta recurrente al trabajo) con Miguel, Laura y Hugo; devuelve la reserva de Miguel. */
function seedIslaTrip(db: PreviewDb, dayOffset: number, seats: number): { trip: Readonly<TripRow>; mine: Booked } {
  const created = insertTrip(db, {
    id: WORLD.tripIsla,
    driverUserId: ANA,
    vehicleId: SEED_VEHICLE_IDS.anaArona,
    category: "work",
    at: "07:25",
    dayOffset,
    seats: 4,
    stops: [SEVILLA_CENTRO, ISLA_MAGICA],
    segments: [{ distanceM: 6200, durationS: 1200 }],
  });
  db.trips.update(created.id, { kind: "recurring" });
  const trip = db.trips.get(created.id) ?? created;
  const mine = book(db, trip, "miguel", localAt(db, "16:03", -1));
  book(db, trip, "laura", localAt(db, "16:41", -1));
  book(db, trip, "hugo", localAt(db, "17:10", -1));
  db.rideRequests.update(mine.requestId, {
    pickup_lat: PICKUP_P1.lat,
    pickup_lng: PICKUP_P1.lng,
    pickup_label: PICKUP_P1.label,
    pickup_walk_minutes: 0,
    pickup_detour_minutes: 0,
  });
  db.bookings.update(mine.bookingId, { amount_cents: ILLUSTRATIVE_CONTRIBUTION_CENTS });
  if (seats !== 1) db.setSetting(seatsKey(mine.bookingId), seats);
  return { trip, mine };
}

/** Laura también conduce: vehículo aprobado y viaje al hospital de mañana con Miguel. */
function seedHospitalTrip(db: PreviewDb): Booked {
  addRole(db, LAURA, "driver");
  const now = localAt(db, "10:00", -20);
  db.vehicles.insert({
    id: WORLD.vehicleLaura,
    driver_user_id: LAURA,
    make: "Citroën",
    model: "C3",
    plate: "4871 KLM",
    plate_normalized: "4871KLM",
    passenger_seats: 3,
    color: "Blanco",
    review_status: "approved",
    documentation_status: "approved",
    vehicle_photo_status: "approved",
    vehicle_photo_document_id: null,
    insurance_status: "approved",
    insurance_expires_on: null,
    insurance_document_id: null,
    insurance_reviewed_at: now,
    review_reason: null,
    reviewed_by_user_id: SEED_USER_IDS.staff,
    reviewed_at: now,
    created_at: now,
    updated_at: now,
  });
  const trip = insertTrip(db, {
    id: WORLD.tripHospital,
    driverUserId: LAURA,
    vehicleId: WORLD.vehicleLaura,
    category: "hospital",
    at: "07:35",
    dayOffset: 1,
    seats: 3,
    stops: [DOS_HERMANAS, HOSPITAL_ROCIO],
  });
  return book(db, trip, "miguel", localAt(db, "17:58", -1));
}

// ── Mensajes ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface Line {
  tripId: string;
  from: string;
  to: string;
  at: number;
  body: string;
  place?: { lat: number; lng: number; label: string };
}

/** Mensaje directo (siempre en orden cronológico dentro de cada conversación: el `seq` lo marca la inserción). */
function say(db: PreviewDb, line: Line): Readonly<DirectMessageRow> {
  const seq = db.ids.seq("trip_direct_messages");
  return db.messages.insert({
    id: stableUuid(`messages:direct:${line.tripId}:${seq}`),
    trip_id: line.tripId,
    sender_user_id: line.from,
    recipient_user_id: line.to,
    client_message_id: stableUuid(`messages:direct:client:${line.tripId}:${seq}`),
    body: line.body,
    created_at: line.at,
    seq,
    kind: line.place ? "location" : "text",
    location_lat: line.place?.lat ?? null,
    location_lng: line.place?.lng ?? null,
    location_label: line.place?.label ?? null,
    hidden_at: null,
    hidden_by_user_id: null,
    hidden_reason: null,
  });
}

function groupSay(db: PreviewDb, conversationId: string, sender: string, at: number, body: string): number {
  const seq = db.ids.seq("chat_group_messages");
  tablesOf(db).groupMessages.insert({
    id: stableUuid(`messages:group:${conversationId}:${seq}`),
    conversation_id: conversationId,
    sender_user_id: sender,
    client_message_id: stableUuid(`messages:group:client:${conversationId}:${seq}`),
    kind: "text",
    body,
    location_lat: null,
    location_lng: null,
    location_label: null,
    hidden_at: null,
    hidden_by_user_id: null,
    hidden_reason: null,
    created_at: at,
    seq,
  });
  return seq;
}

/** Bandeja de la lámina 25 en el chat con Ana: 5 mensajes, los dos últimos de Ana sin leer. */
function seedAnaInboxMessages(db: PreviewDb): void {
  const t = (hhmm: string): number => localAt(db, hhmm);
  const id = WORLD.tripIsla;
  say(db, { tripId: id, from: ME, to: ANA, at: t("07:02"), body: "Buenos días, Ana. ¿Seguimos a las 07:25?" });
  const reply = say(db, { tripId: id, from: ANA, to: ME, at: t("07:05"), body: "Buenos días, Miguel. Sí, a las 07:25." });
  const mine = say(db, { tripId: id, from: ME, to: ANA, at: t("07:08"), body: "Perfecto, estaré en el aparcamiento P1." });
  say(db, { tripId: id, from: ANA, to: ME, at: t("07:10"), body: "Genial, te escribo cuando esté llegando." });
  say(db, { tripId: id, from: ANA, to: ME, at: t("07:12"), body: "Perfecto, nos vemos en el aparcamiento." });
  const conversationId = directConversationId(id, ME);
  setPointers(db, ME, conversationId, { read: reply.seq ?? 0, delivered: reply.seq ?? 0 });
  setPointers(db, ANA, conversationId, { read: mine.seq ?? 0, delivered: mine.seq ?? 0 });
}

/** Chat de la lámina 26: cuatro mensajes entre las 07:18 y las 07:21; los míos, leídos por Ana (dobles ticks azules). */
function seedAnaChatMessages(db: PreviewDb): void {
  const t = (hhmm: string): number => localAt(db, hhmm);
  const id = WORLD.tripIsla;
  say(db, {
    tripId: id,
    from: ANA,
    to: ME,
    at: t("07:18"),
    body: "Hola Miguel, salgo en 5 min. Nos vemos en el aparcamiento P1 de Isla Mágica, junto a la entrada principal.",
  });
  say(db, { tripId: id, from: ME, to: ANA, at: t("07:20"), body: "Genial, ahí estaré. Te adjunto mi ubicación exacta." });
  const place = say(db, { tripId: id, from: ME, to: ANA, at: t("07:20"), body: SHARED_LABEL, place: { lat: PICKUP_P1.lat, lng: PICKUP_P1.lng, label: SHARED_LABEL } });
  say(db, { tripId: id, from: ANA, to: ME, at: t("07:21"), body: "Perfecto, nos vemos allí." });
  setPointers(db, ANA, directConversationId(id, ME), { read: place.seq ?? 0, delivered: place.seq ?? 0 });
}

/** Grupo «Ruta Sevilla · Trabajo»: el de ayer, leído, y tres de esta mañana sin leer (el último, de Ana). */
function seedGroupMessages(db: PreviewDb, trip: Readonly<TripRow>): void {
  const conversationId = groupConversationId(routeKeyOf(trip));
  const t = (hhmm: string, day = 0): number => localAt(db, hhmm, day);
  const yesterday = groupSay(db, conversationId, ANA, t("18:30", -1), "Mañana salimos a las 07:25 como siempre.");
  groupSay(db, conversationId, HUGO, t("06:50"), "Yo llego en 10 minutos.");
  groupSay(db, conversationId, LAURA, t("06:52"), "Perfecto, os veo allí.");
  groupSay(db, conversationId, ANA, t("06:58"), "Salgo en 5 min. Nos vemos en P1.");
  setPointers(db, ME, conversationId, { read: yesterday, delivered: yesterday });
}

/** «Miguel · Universidad · Sevilla»: Miguel Ángel conduce de vuelta a Mairena y Miguel viaja con él. */
function seedUniversityChat(db: PreviewDb): void {
  const trip = db.trips.get(SEED_TRIP_IDS.miguelAngelReturn);
  if (!trip) return;
  book(db, trip, "miguel", localAt(db, "19:00", -1));
  const id = trip.id;
  const mine = say(db, { tripId: id, from: ME, to: MIGUEL_ANGEL, at: localAt(db, "19:12", -1), body: "Hola, Miguel Ángel. Te confirmo que estaré en la puerta de Derecho a las 17:45." });
  const last = say(db, { tripId: id, from: MIGUEL_ANGEL, to: ME, at: localAt(db, "19:20", -1), body: "Genial, gracias por la info." });
  const conversationId = directConversationId(id, ME);
  setPointers(db, ME, conversationId, { read: last.seq ?? 0, delivered: last.seq ?? 0 });
  setPointers(db, MIGUEL_ANGEL, conversationId, { read: mine.seq ?? 0, delivered: mine.seq ?? 0 });
}

/** «Laura · Hospital · Sevilla»: un único mensaje de Laura, ya leído. */
function seedHospitalChat(db: PreviewDb): void {
  seedHospitalTrip(db);
  const last = say(db, { tripId: WORLD.tripHospital, from: LAURA, to: ME, at: localAt(db, "18:10", -1), body: "¿Sigues con plazas?" });
  setPointers(db, ME, directConversationId(WORLD.tripHospital, ME), { read: last.seq ?? 0, delivered: last.seq ?? 0 });
}

/** Otras reservas de Miguel en viajes de la oferta de la mañana: engordan la bandeja para la paginación y la búsqueda. */
function seedManyConversations(db: PreviewDb): void {
  const extra: Array<{ trip: string; driver: string; line: string }> = [
    { trip: SEED_TRIP_IDS.carlosWork, driver: SEED_USER_IDS.carlos, line: "Te recojo en la rotonda de Mairena." },
    { trip: SEED_TRIP_IDS.danielAlcala, driver: SEED_USER_IDS.daniel, line: "Voy por la A-92, nos vemos en la gasolinera." },
    { trip: SEED_TRIP_IDS.carmenHospital, driver: SEED_USER_IDS.carmen, line: "Llevo el coche rojo, un 208." },
    { trip: SEED_TRIP_IDS.carmenSport, driver: SEED_USER_IDS.carmen, line: "El partido empieza a las 21:00, salimos a las 19:45." },
    { trip: SEED_TRIP_IDS.anaReturn, driver: ANA, line: "A las 18:00 en la puerta de la Facultad de Derecho." },
    { trip: SEED_TRIP_IDS.anaTomorrow, driver: ANA, line: "Mañana a la misma hora, como siempre." },
    { trip: SEED_TRIP_IDS.martaTomorrow, driver: SEED_USER_IDS.marta, line: "Hay un atasco en la SE-30, salgo diez minutos antes." },
  ];
  extra.forEach((item, index) => {
    const trip = db.trips.get(item.trip);
    if (!trip) return;
    const rider = book(db, trip, "miguel", localAt(db, "09:00", -2) + index * 60_000);
    void rider;
    const last = say(db, { tripId: trip.id, from: item.driver, to: ME, at: localAt(db, "12:00", -1) + index * 3_600_000, body: item.line });
    setPointers(db, ME, directConversationId(trip.id, ME), { read: index % 3 === 0 ? 0 : (last.seq ?? 0), delivered: last.seq ?? 0 });
  });
}

// ── Estados del chat de Ana ──────────────────────────────────────────────────────────────────────────────────────

function blockAna(db: PreviewDb): void {
  db.blocks.insert({ id: `${ME}:${ANA}`, blocker_user_id: ME, blocked_user_id: ANA, created_at: localAt(db, "07:19") });
}

function cancelMine(db: PreviewDb, mine: Booked): void {
  db.bookings.update(mine.bookingId, { status: "cancelled", updated_at: db.nowMs() });
  db.rideRequests.update(mine.requestId, { status: "cancelled", updated_at: db.nowMs() });
}

// ── Construcción ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface WorldPlan {
  /** Mensajes del chat con Ana: los de la bandeja (lámina 25), los del chat (lámina 26) o ninguno. */
  ana: "inbox" | "chat" | "none";
  /** Días hasta la salida del viaje de Isla Mágica (0 = hoy: dentro de la ventana de llamada; 1 = mañana: aún cerrada). */
  islaDayOffset: number;
  /** Plazas de la reserva de Miguel con Ana (la lámina 26 dice «2 plazas»; la 28, «1 plaza»). */
  seats: number;
  /** El resto de la bandeja de la lámina 25 (grupo, Miguel y Laura). */
  others: boolean;
  /** Conserva el historial de 12 viajes y añade siete reservas más (bandeja larga). */
  many: boolean;
  state: "open" | "blocked" | "closed";
}

const DEFAULT_PLAN: WorldPlan = { ana: "chat", islaDayOffset: 0, seats: 1, others: true, many: false, state: "open" };

export const WORLD_PLANS: Readonly<Record<string, Partial<WorldPlan>>> = {
  "messages-inbox": { ana: "inbox" },
  "messages-inbox-empty": { ana: "none", others: false, state: "open" },
  "messages-inbox-many": { ana: "inbox", many: true },
  "messages-chat": { ana: "chat", seats: 2 },
  "messages-chat-early": { ana: "chat", seats: 2, islaDayOffset: 1 },
  "messages-chat-blocked": { ana: "chat", seats: 2, state: "blocked" },
  "messages-chat-closed": { ana: "chat", seats: 2, state: "closed" },
};

/** Mundo de una variante cuyo plan es «solo conversaciones» (las de avisos y cancelación lo amplían en sus módulos). */
export function buildWorld(db: PreviewDb, partial: Partial<WorldPlan>): { trip: Readonly<TripRow> | null; mine: Booked | null } {
  const plan: WorldPlan = { ...DEFAULT_PLAN, ...partial };
  if (!plan.many) pruneHistory(db);
  if (plan.ana === "none" && !plan.others) return { trip: null, mine: null };
  const { trip, mine } = seedIslaTrip(db, plan.islaDayOffset, plan.seats);
  if (plan.ana === "inbox") seedAnaInboxMessages(db);
  if (plan.ana === "chat") seedAnaChatMessages(db);
  if (plan.others) {
    seedGroupMessages(db, trip);
    seedUniversityChat(db);
    seedHospitalChat(db);
  }
  if (plan.many) seedManyConversations(db);
  if (plan.state === "blocked") blockAna(db);
  if (plan.state === "closed") cancelMine(db, mine);
  return { trip, mine };
}

/** Siembra la variante `seed` si es una de las de conversaciones; devuelve `false` si es de otro módulo del slice. */
export function seedConversationVariant(db: PreviewDb, _profile: PreviewProfileId, seed: string): boolean {
  const plan = WORLD_PLANS[seed];
  if (plan === undefined) return false;
  buildWorld(db, plan);
  return true;
}

// ── Referencias para los escenarios (`{"$ref":"conversation.ana"}`) ──────────────────────────────────────────────

function existing(db: PreviewDb, id: string): string | undefined {
  return findConversation(db, id) === undefined ? undefined : id;
}

/** La conversación con actividad más reciente de la persona (las rutas de «Ir a pantalla» abren esta en cualquier mundo). */
function latestConversationId(db: PreviewDb, userId: string): string | undefined {
  let best: { id: string; at: number } | undefined;
  for (const conversation of accessibleConversations(db, userId)) {
    const last = visibleMessages(db, conversation, userId).at(-1);
    const at = last?.createdAt ?? (conversation.kind === "direct" ? (conversation.booking?.created_at ?? 0) : conversation.startedAt);
    if (best === undefined || at > best.at || (at === best.at && conversation.id < best.id)) best = { id: conversation.id, at };
  }
  return best?.id;
}

/** La reserva más reciente de la persona, con preferencia por las vigentes. */
function latestBookingId(db: PreviewDb, userId: string): string | undefined {
  const mine = db.bookings.filter((booking) => db.rideRequests.get(booking.request_id)?.passenger_user_id === userId);
  const rank = (status: string): number => (status === "confirmed" ? 1 : 0);
  const sorted = [...mine].sort((a, b) => rank(b.status) - rank(a.status) || b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
  return sorted[0]?.id;
}

export function registerMessagesRefs(): void {
  registerSeedRef("conversation.mine", (db) => {
    const me = profileUserId(db.profile);
    return me === null ? undefined : latestConversationId(db, me);
  });
  registerSeedRef("booking.mine", (db) => {
    const me = profileUserId(db.profile);
    return me === null ? undefined : latestBookingId(db, me);
  });
  registerSeedRef("conversation.ana", (db) => (db.trips.has(WORLD.tripIsla) ? existing(db, directConversationId(WORLD.tripIsla, ME)) : undefined));
  registerSeedRef("conversation.group", (db) => {
    const trip = db.trips.get(WORLD.tripIsla);
    return trip === undefined ? undefined : existing(db, groupConversationId(routeKeyOf(trip)));
  });
  registerSeedRef("conversation.miguelAngel", (db) => existing(db, directConversationId(SEED_TRIP_IDS.miguelAngelReturn, ME)));
  registerSeedRef("conversation.laura", (db) => existing(db, directConversationId(WORLD.tripHospital, ME)));
  registerSeedRef("trip.isla", (db) => (db.trips.has(WORLD.tripIsla) ? WORLD.tripIsla : undefined));
  registerSeedRef("trip.lauraHospital", (db) => (db.trips.has(WORLD.tripHospital) ? WORLD.tripHospital : undefined));
  registerSeedRef("booking.isla", (db) => {
    const request = db.rideRequests.find((r) => r.trip_id === WORLD.tripIsla && r.passenger_user_id === ME);
    return request === undefined ? undefined : db.bookings.find((b) => b.request_id === request.id)?.id;
  });
}
