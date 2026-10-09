/**
 * «Mis viajes»: de las tarjetas que devuelve `GET /v1/me/trips/overview` a lo que se pinta (título, hora, píldora, franja,
 * avatares) y a lo que hace cada pulsación (abrir el detalle, el viaje en curso, retirar la solicitud…). Funciones puras:
 * no navegan ni llaman a la red (eso lo hace `useCardActions`), así que se prueban en Node.
 */
import type { IconName } from "@/icons";
import type { OverviewCard, OverviewStatus, PublicUser, Role, TripCategory, TripsOverview } from "@/api/types";
import { formatDayRelative } from "@/i18n";
import { profileStrings } from "../strings";

const copy = profileStrings.myTrips;

/** Qué ocurre al pulsar. Datos serializables: la pantalla los convierte en navegación o en llamadas. */
export type CardAction =
  | { kind: "booking"; requestId: string }
  | { kind: "weekly"; reservationId: string }
  | { kind: "series"; seriesId: string }
  | { kind: "follow"; bookingId: string }
  | { kind: "pay"; requestId: string }
  | { kind: "cancel"; bookingId: string }
  | { kind: "tripFinished"; bookingId: string }
  | { kind: "tripDetail"; tripId: string }
  | { kind: "withdraw"; requestId: string }
  | { kind: "driverManage"; tripId: string }
  | { kind: "driverConsole"; tripId: string }
  | { kind: "driverFinished"; tripId: string }
  | { kind: "driverRequests"; tripId: string };

export interface CardMenuItem {
  id: string;
  label: string;
  icon: IconName;
  action: CardAction;
  destructive?: boolean;
}

export type CardTone = "blue" | "green" | "amber" | "orange" | "red" | "gray";

export interface CardPill {
  label: string;
  tone: CardTone;
  /** El visto verde de «En 12 min». */
  icon?: IconName;
}

export type CardStrip =
  | { kind: "status"; label: string; tone: CardTone; icon: IconName; action: CardAction | null }
  | { kind: "eta"; label: string; stale: boolean; action: CardAction | null };

export interface CardPerson {
  key: string;
  name: string;
  photoUrl: string | null;
}

export interface CardEndpoint {
  label: string;
  time: string;
}

export interface TripCardView {
  key: string;
  kind: "weekly" | "trip";
  category: TripCategory;
  title: string;
  subtitle: string;
  /** Píldora superior de las tarjetas de viaje («En 12 min», «Pendiente», «Completado»). */
  pill: CardPill | null;
  from: CardEndpoint;
  to: CardEndpoint;
  people: CardPerson[];
  seats: { label: string; a11y: string } | null;
  strip: CardStrip | null;
  primary: CardAction | null;
  menu: CardMenuItem[];
  a11yLabel: string;
}

export interface Viewer {
  id: string;
  name: string;
  photoUrl: string | null;
}

export interface BuildCardOptions {
  role: Role;
  /** Milisegundos desde epoch («ahora»: para «Hoy», «Mañana»). */
  now: number;
  /** La persona que mira (su avatar abre la fila de personas de sus viajes confirmados). */
  viewer: Viewer | null;
}

// ── Estado → tono e icono ─────────────────────────────────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<OverviewStatus["code"], CardTone> = {
  confirmed: "green",
  pending: "amber",
  payment_pending: "orange",
  scheduled: "blue",
  live: "green",
  completed: "gray",
  cancelled: "gray",
  no_show: "red",
  rejected: "red",
  expired: "gray",
};

const STATUS_ICON: Record<OverviewStatus["code"], IconName> = {
  confirmed: "calendarCheck",
  pending: "clock",
  payment_pending: "card",
  scheduled: "calendarCheck",
  live: "car",
  completed: "checkCircle",
  cancelled: "closeCircle",
  no_show: "closeCircle",
  rejected: "closeCircle",
  expired: "clock",
};

export function statusTone(code: OverviewStatus["code"]): CardTone {
  return STATUS_TONE[code];
}

/** Estados en los que la persona que mira ocupa una plaza (su foto abre la fila de avatares). */
const SEAT_HOLDING: ReadonlySet<OverviewStatus["code"]> = new Set(["confirmed", "live", "completed"]);

// ── Tarjetas ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function personOf(user: PublicUser): CardPerson {
  return { key: user.id, name: user.displayName, photoUrl: user.photoUrl };
}

function peopleOf(card: OverviewCard, options: BuildCardOptions): CardPerson[] {
  const riders = card.riders.map(personOf);
  const viewerSits = options.role === "passenger" && SEAT_HOLDING.has(card.status.code) && options.viewer !== null;
  if (!viewerSits || options.viewer === null) return riders;
  const viewer: CardPerson = { key: options.viewer.id, name: options.viewer.name, photoUrl: options.viewer.photoUrl };
  return [viewer, ...riders.filter((rider) => rider.key !== viewer.key)];
}

function seatsOf(card: OverviewCard): TripCardView["seats"] {
  if (card.occupancy === null) return null;
  const { occupied, total } = card.occupancy;
  return { label: copy.seats(occupied, total), a11y: copy.seatsA11y(occupied, total) };
}

function weeklyView(card: Extract<OverviewCard, { kind: "weekly_reservation" }>, options: BuildCardOptions): TripCardView {
  const passenger = options.role === "passenger";
  const primary: CardAction | null = passenger
    ? card.reservationId !== null
      ? { kind: "weekly", reservationId: card.reservationId }
      : null
    : { kind: "series", seriesId: card.seriesId };
  const menu: CardMenuItem[] =
    primary === null ? [] : [{ id: "open", label: passenger ? copy.menu.weekly : copy.menu.series, icon: "calendar", action: primary }];
  const strip: CardStrip = {
    kind: "status",
    label: card.status.label,
    tone: statusTone(card.status.code),
    icon: STATUS_ICON[card.status.code],
    action: primary,
  };
  return {
    key: `weekly-${card.id}`,
    kind: "weekly",
    category: card.category,
    title: card.title,
    subtitle: card.recurrence.label,
    pill: null,
    from: { label: card.from.label ?? "", time: card.from.timeLocal },
    to: { label: card.to.label ?? "", time: card.to.timeLocal },
    people: peopleOf(card, options),
    seats: seatsOf(card),
    strip,
    primary,
    menu,
    a11yLabel: accessibleLabel(card.title, card.recurrence.label, card, card.status.label),
  };
}

function passengerTripPrimary(card: Extract<OverviewCard, { kind: "trip" }>): CardAction {
  if (card.requestId !== null) return { kind: "booking", requestId: card.requestId };
  return { kind: "tripDetail", tripId: card.tripId };
}

function passengerMenu(card: Extract<OverviewCard, { kind: "trip" }>): CardMenuItem[] {
  const items: CardMenuItem[] = [];
  const code = card.status.code;
  if (card.requestId !== null) {
    items.push({ id: "detail", label: copy.menu.detail, icon: "document", action: { kind: "booking", requestId: card.requestId } });
  }
  if (code === "pending" && card.requestId !== null) {
    items.push({ id: "withdraw", label: copy.menu.withdraw, icon: "closeCircle", action: { kind: "withdraw", requestId: card.requestId }, destructive: true });
  }
  if (code === "payment_pending" && card.requestId !== null) {
    items.push({ id: "pay", label: copy.menu.pay, icon: "card", action: { kind: "pay", requestId: card.requestId } });
  }
  if ((code === "confirmed" || code === "live") && card.bookingId !== null && card.phase !== "finished") {
    items.push({ id: "follow", label: copy.menu.follow, icon: "navigate", action: { kind: "follow", bookingId: card.bookingId } });
  }
  if (code === "confirmed" && card.phase === "scheduled" && card.bookingId !== null) {
    items.push({ id: "cancel", label: copy.menu.cancel, icon: "close", action: { kind: "cancel", bookingId: card.bookingId }, destructive: true });
  }
  if (code === "completed" && card.bookingId !== null) {
    items.push({ id: "finished", label: copy.menu.finished, icon: "receipt", action: { kind: "tripFinished", bookingId: card.bookingId } });
  }
  return items;
}

function driverPrimary(card: Extract<OverviewCard, { kind: "trip" }>): CardAction {
  if (card.phase === "live") return { kind: "driverConsole", tripId: card.tripId };
  if (card.phase === "finished") return { kind: "driverFinished", tripId: card.tripId };
  return { kind: "driverManage", tripId: card.tripId };
}

function driverMenu(card: Extract<OverviewCard, { kind: "trip" }>): CardMenuItem[] {
  const items: CardMenuItem[] = [];
  if (card.phase === "live") {
    items.push({ id: "operate", label: copy.menu.operate, icon: "steering", action: { kind: "driverConsole", tripId: card.tripId } });
  } else if (card.phase === "finished") {
    items.push({ id: "finished", label: copy.menu.finished, icon: "receipt", action: { kind: "driverFinished", tripId: card.tripId } });
  } else {
    items.push({ id: "manage", label: copy.menu.manage, icon: "settings", action: { kind: "driverManage", tripId: card.tripId } });
    items.push({ id: "requests", label: copy.menu.requests, icon: "people", action: { kind: "driverRequests", tripId: card.tripId } });
  }
  return items;
}

/** «Hoy · 07:30 – 07:50». */
export function tripSubtitle(departureAt: string, fromTime: string, toTime: string, now: number): string {
  const day = formatDayRelative(departureAt, now);
  const range = `${fromTime} – ${toTime}`;
  return day === "" ? range : `${day} · ${range}`;
}

function tripView(card: Extract<OverviewCard, { kind: "trip" }>, options: BuildCardOptions): TripCardView {
  const passenger = options.role === "passenger";
  const code = card.status.code;
  const primary = passenger ? passengerTripPrimary(card) : driverPrimary(card);
  const subtitle = tripSubtitle(card.departureAt, card.from.timeLocal, card.to.timeLocal, options.now);

  // «En 12 min» solo acompaña a viajes que sí van a hacerse; una solicitud pendiente muestra su estado.
  const showsCountdown = card.startsInMinutes !== null && (code === "confirmed" || code === "scheduled" || code === "live");
  const pill: CardPill =
    showsCountdown && card.startsInMinutes !== null
      ? { label: copy.startsIn(card.startsInMinutes), tone: "green", icon: "check" }
      : { label: card.status.label, tone: statusTone(code) };

  let strip: CardStrip | null = null;
  if (card.liveEta !== null) {
    const follow: CardAction | null = card.bookingId !== null && passenger ? { kind: "follow", bookingId: card.bookingId } : null;
    strip = { kind: "eta", label: card.liveEta.phrase, stale: card.liveEta.stale, action: follow };
  }

  return {
    key: `trip-${card.id}-${card.leg}`,
    kind: "trip",
    category: card.category,
    title: card.title,
    subtitle,
    pill,
    from: { label: card.from.label ?? "", time: card.from.timeLocal },
    to: { label: card.to.label ?? "", time: card.to.timeLocal },
    people: peopleOf(card, options),
    seats: seatsOf(card),
    strip,
    primary,
    menu: passenger ? passengerMenu(card) : driverMenu(card),
    a11yLabel: accessibleLabel(card.title, subtitle, card, pill.label),
  };
}

function accessibleLabel(title: string, subtitle: string, card: OverviewCard, status: string): string {
  const route = `de ${card.from.label ?? ""} ${card.from.timeLocal} a ${card.to.label ?? ""} ${card.to.timeLocal}`;
  const seats = card.occupancy !== null ? `, ${copy.seatsA11y(card.occupancy.occupied, card.occupancy.total)}` : "";
  return `${title}. ${subtitle}. ${route}${seats}. ${status}`;
}

/** Tarjeta del servidor → lo que pinta `TripCard`. */
export function buildTripCardView(card: OverviewCard, options: BuildCardOptions): TripCardView {
  return card.kind === "weekly_reservation" ? weeklyView(card, options) : tripView(card, options);
}

// ── Secciones ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TripTab = "upcoming" | "in_progress" | "history";

export const TRIP_TABS: readonly TripTab[] = ["upcoming", "in_progress", "history"];

/** Etiquetas de las pestañas con sus contadores: «Próximos (2)», «En curso (1)», «Historial». */
export function tabLabels(counts: TripsOverview["counts"] | null): Record<TripTab, string> {
  const withCount = (label: string, count: number | undefined): string => (count !== undefined && count > 0 ? `${label} (${count})` : label);
  return {
    upcoming: withCount(copy.tabUpcoming, counts?.upcoming),
    in_progress: withCount(copy.tabInProgress, counts?.inProgress),
    history: copy.tabHistory,
  };
}

export interface UpcomingSections {
  weekly: OverviewCard[];
  next: OverviewCard | null;
  more: OverviewCard[];
}

/** Próximos: reservas semanales aparte; el primer viaje suelto es «Próximo viaje» y el resto «Más viajes». */
export function splitUpcoming(cards: readonly OverviewCard[]): UpcomingSections {
  const weekly = cards.filter((card) => card.kind === "weekly_reservation");
  const trips = cards.filter((card) => card.kind === "trip");
  return { weekly, next: trips[0] ?? null, more: trips.slice(1) };
}

/** Qué pestaña abre `MyTrips` según el parámetro de la ruta (`tab`). Acepta los valores históricos de `routes.ts`. */
export function tabFromParam(value: string | undefined): TripTab {
  switch (value) {
    case "in_progress":
      return "in_progress";
    case "history":
    case "past":
      return "history";
    default:
      return "upcoming";
  }
}
