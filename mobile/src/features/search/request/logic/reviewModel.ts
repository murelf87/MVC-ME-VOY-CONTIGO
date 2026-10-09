/**
 * «Revisa tu solicitud» (15): datos del servidor → modelo de pantalla. Función pura: no calcula importes ni decide si se
 * puede pedir plaza (eso lo dice el servidor con `canRequest` / `cannotRequestReason` / `canSubmit`); solo escoge qué
 * texto sale en cada fila y qué aviso explica por qué no se puede enviar.
 *
 * Una solicitud NO es una reserva: la pantalla lo recuerda con el aviso naranja «El conductor debe aceptar tu solicitud.
 * No se realiza ningún cobro todavía.»
 */
import type {
  CreateRideRequestBody,
  IsoDate,
  Money,
  TripCategory,
  TripDetail,
  TripLeg,
  TripQuote,
  TripQuoteResponse,
  Weekday,
  WeeklyRequestBody,
  WeeklyRequestPreview,
} from "@/api/types";
import { formatDistance, formatRating, formatWeekdays, strings } from "@/i18n";
import { requestStrings } from "../strings";
import type { PickupSummary } from "../types";
import { buildQuoteView, type QuoteView } from "./quoteView";
import { toWeeklyBody, type WeeklyForm } from "./weekly";

const copy = requestStrings.review;

export const MESSAGE_MAX = 300;

export type ReviewWeekly = {
  weekdays: Weekday[];
  startDate: IsoDate;
  weeks: number;
  legs: TripLeg[];
  exceptionDates?: IsoDate[];
  allowPartial?: boolean;
};

export interface ReviewSources {
  trip: TripDetail;
  /** Presupuesto de un trayecto (punto de recogida, destino y distancia). */
  quote: TripQuoteResponse | null;
  /** Vista previa semanal; solo en una reserva semanal. */
  preview: WeeklyRequestPreview | null;
  weekly: ReviewWeekly | null;
  /** Lo que enseñó la pantalla 13 del punto elegido (nombre, dirección, minutos a pie). */
  pickup: PickupSummary | null;
  dropoffStopSeq: number | null;
  /** Lo que la persona buscó (origen y destino con su nombre): la barra y el destino usan ESOS nombres. */
  criteria?: { origin: { label: string }; destination: { label: string } } | null;
}

export interface RouteBarModel {
  from: string;
  to: string;
  category: TripCategory;
}

export interface DriverCardModel {
  name: string;
  photoUrl: string | null;
  /** «4,8» o `null` si aún no tiene valoraciones. */
  rating: string | null;
  /** «(32 valoraciones)» o «Sin valoraciones todavía». */
  ratings: string;
  habit: string;
  vehicle: string;
}

export interface InfoRowModel {
  title: string;
  lines: string[];
}

export type ReviewBlock =
  | { kind: "noSeats" | "ownTrip" | "notBookable" | "auth" | "weekly" | "unknown"; message: string }
  | { kind: "openRequest"; message: string; requestId: string | null };

export interface ReviewModel {
  route: RouteBarModel;
  distance: string;
  driver: DriverCardModel;
  seat: InfoRowModel;
  pickup: InfoRowModel;
  dropoff: InfoRowModel;
  quote: QuoteView;
  weekly: boolean;
  block: ReviewBlock | null;
}

const clean = (text: string | null | undefined): string | null => {
  if (text === null || text === undefined) return null;
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * Barra «Sevilla Centro → Universidad»: el origen que la persona buscó (si lo hay; si no, el del viaje) y la categoría
 * del destino (o su nombre si es «Otros»).
 */
export function routeBar(trip: Pick<TripDetail, "stops" | "category">, searchedOrigin?: string | null): RouteBarModel {
  const first = trip.stops[0];
  const last = trip.stops[trip.stops.length - 1];
  const from = clean(searchedOrigin) ?? clean(first?.label) ?? copy.originFallback;
  const to = trip.category === "other" ? (clean(last?.label) ?? copy.destinationFallback) : strings.categories[trip.category];
  return { from, to, category: trip.category };
}

export function driverCard(trip: Pick<TripDetail, "driver" | "vehicle" | "kind">): DriverCardModel {
  const { driver, vehicle } = trip;
  const hasRating = driver.ratingAverage !== null && driver.ratingCount > 0;
  return {
    name: clean(driver.firstName) ?? driver.displayName,
    photoUrl: driver.photoUrl,
    rating: hasRating ? formatRating(driver.ratingAverage) : null,
    ratings: hasRating ? copy.ratings(driver.ratingCount) : copy.noRatings,
    habit: trip.kind === "recurring" ? copy.drivesHabitually : copy.drivesOnce,
    vehicle: vehicle.displayName,
  };
}

/** Nombre del destino de la persona: el de la bajada elegida o, si no, el del último punto del viaje. */
export function dropoffLabel(
  trip: Pick<TripDetail, "stops">,
  quote: TripQuoteResponse | null,
  dropoffStopSeq: number | null,
  searchedDestination?: string | null,
): string {
  const searched = clean(searchedDestination);
  if (searched !== null) return searched;
  const fromQuote = clean(quote?.dropoff.label);
  if (fromQuote !== null) return fromQuote;
  const stop = dropoffStopSeq !== null ? trip.stops.find((s) => s.seq === dropoffStopSeq) : undefined;
  return clean(stop?.label) ?? clean(trip.stops[trip.stops.length - 1]?.label) ?? copy.destinationFallback;
}

function legTime(preview: WeeklyRequestPreview | null, trip: TripDetail, leg: TripLeg): string | null {
  const fromPreview = preview?.legs.find((l) => l.leg === leg)?.boardsAtLocal;
  if (fromPreview !== undefined) return fromPreview;
  if (trip.recurrence === null) return null;
  return leg === "outbound" ? trip.recurrence.outboundLocal : trip.recurrence.returnLocal;
}

function seatRow(sources: ReviewSources): InfoRowModel {
  const { trip, quote, preview, weekly } = sources;
  if (weekly !== null) {
    const out = weekly.legs.includes("outbound") ? legTime(preview, trip, "outbound") : null;
    const back = weekly.legs.includes("return") ? legTime(preview, trip, "return") : null;
    const lines = [formatWeekdays(weekly.weekdays)];
    const times = copy.seatLegs(out, back);
    if (times !== "") lines.push(times);
    return { title: copy.seat, lines };
  }
  const at = quote?.pickup.at ?? trip.departureAt;
  const lines = [copy.seatSingle(at)];
  if (quote !== null) lines.push(copy.seatSingleTimes(quote.pickup.atLocal, quote.dropoff.atLocal));
  return { title: copy.seat, lines };
}

function pickupRow(sources: ReviewSources): InfoRowModel {
  const { quote, pickup } = sources;
  const name = clean(pickup?.name) ?? clean(quote?.pickup.label);
  const address = clean(pickup?.address) ?? clean(quote?.pickup.address);
  const walk = pickup?.walkMinutes ?? quote?.pickup.walkMinutes ?? null;
  const walkText = walk !== null && walk !== undefined ? copy.pickupWalk(walk) : null;
  const lines: string[] = [];
  if (name !== null && name !== address) lines.push(name);
  else if (name === null && address === null) lines.push(copy.pickupFallbackName);
  const second = [address, walkText].filter((part): part is string => part !== null).join(" ");
  if (second !== "") lines.push(second);
  return { title: copy.pickup, lines };
}

/** ¿Por qué no se puede enviar la solicitud? `null` si se puede. Los códigos son los de `cannotRequestReason` del contrato. */
export function blockFromReason(reason: string | null, openRequestId: string | null): ReviewBlock | null {
  if (reason === null) return null;
  switch (reason) {
    case "DRIVER_CANNOT_REQUEST_OWN_TRIP":
      return { kind: "ownTrip", message: copy.ownTrip };
    case "TRIP_NOT_BOOKABLE":
      return { kind: "notBookable", message: copy.notBookable };
    case "OPEN_REQUEST_EXISTS":
      return { kind: "openRequest", message: copy.openRequestMessage, requestId: openRequestId };
    case "AUTH_REQUIRED":
      return { kind: "auth", message: copy.authRequired };
    default:
      return reason.includes("CAPACITY") ? { kind: "noSeats", message: copy.noSeats } : { kind: "unknown", message: copy.blockedTitle };
  }
}

/** Primer motivo por el que la reserva semanal no se puede enviar (lo que dice el servidor, o un texto de reserva). */
function weeklyBlock(preview: WeeklyRequestPreview): ReviewBlock | null {
  if (preview.canSubmit) return null;
  const first = preview.issues[0];
  return { kind: "weekly", message: first !== undefined ? first.message : requestStrings.weekly.noneMessage };
}

export function blockOf(sources: ReviewSources): ReviewBlock | null {
  const { trip, quote, preview, weekly } = sources;
  const openId = trip.viewer.openRequest?.id ?? null;
  if (weekly !== null) {
    // En una reserva semanal «sin plaza» en UN viaje no bloquea: lo decide la vista previa día a día.
    const own = blockFromReason(trip.cannotRequestReason === "NO_CAPACITY" ? null : trip.cannotRequestReason, openId);
    if (own !== null) return own;
    return preview === null ? null : weeklyBlock(preview);
  }
  if (quote !== null && !quote.canRequest) return blockFromReason(quote.cannotRequestReason ?? "NO_CAPACITY", openId);
  if (!trip.canRequest && quote === null) return blockFromReason(trip.cannotRequestReason, openId);
  return null;
}

export function buildReviewModel(sources: ReviewSources): ReviewModel {
  const { trip, quote, preview, weekly, dropoffStopSeq, criteria } = sources;
  const source: TripQuote | null = weekly !== null && preview !== null ? preview.quote : (quote?.quote ?? preview?.quote ?? null);
  const distanceM = quote?.roadDistanceM ?? source?.basis.roadDistanceM ?? trip.totals.roadDistanceM;
  const quoteView = buildQuoteView(source ?? emptyQuote(distanceM), distanceM);
  return {
    route: routeBar(trip, criteria?.origin.label),
    distance: formatDistance(distanceM),
    driver: driverCard(trip),
    seat: seatRow(sources),
    pickup: pickupRow(sources),
    dropoff: { title: copy.dropoff, lines: [dropoffLabel(trip, quote, dropoffStopSeq, criteria?.destination.label)] },
    quote: quoteView,
    weekly: weekly !== null,
    block: blockOf(sources),
  };
}

const PENDING: Money = { cents: null, currency: "EUR", status: "pending_definition" };

/** Presupuesto vacío («Por definir» en todo) mientras el servidor aún no ha contestado. */
function emptyQuote(roadDistanceM: number): TripQuote {
  return {
    state: "pending_definition",
    tariff: { state: "none_approved", version: null },
    basis: { roadDistanceM, rateMicrosPerKm: null },
    contribution: PENDING,
    managementFee: PENDING,
    total: PENDING,
    weekly: null,
    lockedAt: null,
  };
}

// ── Bajada elegible ────────────────────────────────────────────────────────────────────────────────────────────

export interface DropoffOption {
  seq: number;
  label: string;
  /** Hora estimada de llegada («08:25»). */
  time: string;
}

/**
 * Paradas donde se puede bajar, a partir del punto de recogida elegido. El servidor revalida (DROPOFF_BEFORE_PICKUP);
 * aquí solo se evita ofrecer lo que ya se ve que queda antes de la recogida.
 */
export function dropoffOptions(trip: Pick<TripDetail, "stops">, quote: TripQuoteResponse | null): DropoffOption[] {
  const after = quote !== null ? Date.parse(quote.pickup.at) : Number.NEGATIVE_INFINITY;
  return trip.stops
    .filter((s) => s.canAlight && s.seq > 0 && Date.parse(s.etaAt) > after)
    .map((s) => ({ seq: s.seq, label: clean(s.label) ?? copy.destinationFallback, time: s.etaLocal }));
}

/** Parada de bajada vigente: la elegida o, por defecto, el último punto del viaje. */
export function currentDropoffSeq(trip: Pick<TripDetail, "stops">, dropoffStopSeq: number | null): number {
  if (dropoffStopSeq !== null) return dropoffStopSeq;
  return trip.stops[trip.stops.length - 1]?.seq ?? 0;
}

// ── Cuerpos de las peticiones ──────────────────────────────────────────────────────────────────────────────────

export function cleanMessage(message: string): string | null {
  const trimmed = message.trim().slice(0, MESSAGE_MAX);
  return trimmed === "" ? null : trimmed;
}

export function singleRequestBody(input: { pickupPointId: string; dropoffStopSeq: number | null; message: string }): CreateRideRequestBody {
  const message = cleanMessage(input.message);
  return {
    pickupPointId: input.pickupPointId,
    ...(input.dropoffStopSeq !== null ? { dropoffStopSeq: input.dropoffStopSeq } : {}),
    ...(message !== null ? { message } : {}),
  };
}

export function weeklyForm(weekly: ReviewWeekly): WeeklyForm {
  return {
    weekdays: weekly.weekdays,
    legs: weekly.legs,
    startDate: weekly.startDate,
    weeks: weekly.weeks,
    exceptionDates: weekly.exceptionDates ?? [],
    allowPartial: weekly.allowPartial ?? false,
  };
}

export function weeklyRequestBody(input: {
  weekly: ReviewWeekly;
  pickupPointId: string;
  dropoffStopSeq: number | null;
  message: string;
}): WeeklyRequestBody {
  const message = cleanMessage(input.message);
  return toWeeklyBody(weeklyForm(input.weekly), {
    pickupPointId: input.pickupPointId,
    ...(input.dropoffStopSeq !== null ? { dropoffStopSeq: input.dropoffStopSeq } : {}),
    ...(message !== null ? { message } : {}),
  });
}
