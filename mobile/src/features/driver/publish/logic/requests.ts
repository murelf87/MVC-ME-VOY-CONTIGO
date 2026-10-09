/**
 * Bandeja de solicitudes del conductor (pantalla 20): de `DriverRequestItem` (contrato `trips` §7) a lo que se dibuja.
 * Lógica pura: sin React ni red. El servidor decide si se puede aceptar (`canAccept`, `blockedReason`); aquí solo se
 * presenta, se ordena en secciones y se calcula la cuenta atrás de la plaza retenida.
 */
import type { RideRequestStatus } from "@/api/types/trips";
import { formatDateShort, formatTime, formatWeekdays } from "@/i18n";
import { publishStrings } from "../strings";
import type { HoldMap, InboxItem } from "../types";

const copy = publishStrings.requests;

export type PillTone = "amber" | "blue" | "green" | "gray" | "red";

export interface RequestPill {
  label: string;
  tone: PillTone;
}

export type RequestSection = "pending" | "payment" | "closed";

export interface OccupancyView {
  /** Un punto por parada; `true` = parada del tramo que pide el pasajero. */
  dots: readonly boolean[];
  /** Un tramo entre cada par de paradas; `true` = dentro del tramo que pide el pasajero. */
  links: readonly boolean[];
  occupied: number;
  total: number;
  /** «1 / 3 plazas». Vacío si no hay capacidad conocida. */
  seatsText: string;
  /** «Mairena → Sevilla». */
  rangeText: string;
  accessibilityLabel: string;
}

export interface WeeklyView {
  /** «Lunes a viernes · 4 viajes». */
  summary: string;
  /** «Ida y vuelta». */
  legs: string;
  /** «Desde el 12 oct 2026». */
  start: string;
  occurrences: number;
}

export interface RequestCardView {
  id: string;
  kind: "single" | "weekly";
  tripId: string;
  status: RideRequestStatus;
  passengerId: string;
  name: string;
  photoUrl: string | null;
  ratingAverage: number | null;
  ratingCount: number;
  pill: RequestPill;
  section: RequestSection;
  fromLabel: string;
  fromTime: string;
  toLabel: string;
  toTime: string;
  /** «+2 min», «Sin desvío»; `null` si el servidor no lo ha calculado. */
  detourText: string | null;
  occupancy: OccupancyView;
  message: string | null;
  weekly: WeeklyView | null;
  /** Se puede aceptar ahora mismo (lo dice el servidor). */
  canAccept: boolean;
  /** Se puede decidir (aceptar o rechazar): solo mientras está pendiente. */
  decidable: boolean;
  /** Por qué no se puede aceptar, en español. */
  blockedText: string | null;
  /** Segundos que le quedan al pasajero para pagar; `null` = no aplica o no se conoce. */
  holdSeconds: number | null;
  accessibilityLabel: string;
}

// ── Etiquetas ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const CUT_MARKERS = [" del ", " de la ", " de los ", " de las ", " de ", " (", " · ", " - "];

/**
 * Nombre corto de un lugar para los pies de la tarjeta: «Mairena del Aljarafe» → «Mairena», «Sevilla (Trabajo)» →
 * «Sevilla», «Dos Hermanas» → «Dos Hermanas». Solo para mostrar; nunca se envía.
 */
export function shortPlace(label: string | null, fallback: string): string {
  const text = (label ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return fallback;
  let end = text.length;
  for (const marker of CUT_MARKERS) {
    const at = text.indexOf(marker);
    if (at > 0 && at < end) end = at;
  }
  return text.slice(0, end);
}

export function pillFor(status: RideRequestStatus): RequestPill {
  switch (status) {
    case "pending":
      return { label: copy.pending, tone: "amber" };
    case "accepted":
    case "payment_pending":
      return { label: copy.waitingPayment, tone: "blue" };
    case "confirmed":
      return { label: copy.confirmed, tone: "green" };
    case "rejected":
      return { label: copy.rejected, tone: "red" };
    case "expired":
    case "payment_late":
      return { label: copy.expired, tone: "gray" };
    case "cancelled":
      return { label: copy.cancelled, tone: "gray" };
  }
}

export function sectionFor(status: RideRequestStatus): RequestSection {
  if (status === "pending") return "pending";
  if (status === "accepted" || status === "payment_pending") return "payment";
  return "closed";
}

// ── Ocupación ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function buildOccupancy(item: InboxItem): OccupancyView {
  const segments = [...item.occupancy.perSegment].sort((a, b) => a.seq - b.seq);
  const links = segments.map((segment) => segment.inRequestedRange);
  const dots: boolean[] = [];
  if (links.length > 0) {
    dots.push(links[0] === true);
    for (let index = 1; index < links.length; index += 1) dots.push(links[index - 1] === true || links[index] === true);
    dots.push(links[links.length - 1] === true);
  }
  const inRange = segments.filter((segment) => segment.inRequestedRange);
  const firstLabel = inRange.length > 0 ? inRange[0]?.fromLabel ?? null : item.from.label;
  const lastLabel = inRange.length > 0 ? inRange[inRange.length - 1]?.toLabel ?? null : item.to.label;
  const fromShort = shortPlace(firstLabel ?? item.from.label, copy.stopFallback(1));
  const toShort = shortPlace(lastLabel ?? item.to.label, copy.stopFallback(2));
  const occupied = item.occupancy.occupiedSeats;
  const total = item.occupancy.totalSeats;
  return {
    dots,
    links,
    occupied,
    total,
    seatsText: total > 0 ? copy.occupancySeats(occupied, total) : "",
    rangeText: copy.occupancyRange(fromShort, toShort),
    accessibilityLabel: total > 0 ? copy.occupancyA11y(occupied, total, fromShort, toShort) : copy.occupancyRange(fromShort, toShort),
  };
}

// ── Retención de plaza ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Segundos que quedan hasta `expiresAt` (0 si ya pasó; `null` si la fecha no es válida). */
export function secondsUntil(expiresAt: string, nowMs: number): number | null {
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

/** Cuenta atrás de una solicitud aceptada: la del servidor (`hold`) si viene; si no, la de la decisión tomada aquí. */
export function holdSecondsFor(item: InboxItem, holds: HoldMap, nowMs: number): number | null {
  if (sectionFor(item.status) !== "payment") return null;
  const expiresAt = item.hold?.expiresAt ?? holds[item.id];
  return expiresAt === undefined ? null : secondsUntil(expiresAt, nowMs);
}

// ── Tarjeta ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function detourText(minutes: number | null): string | null {
  if (minutes === null) return null;
  return minutes <= 0 ? copy.detourNone : copy.detourValue(minutes);
}

function blockedTextFor(item: InboxItem): string | null {
  if (item.status !== "pending" || item.canAccept) return null;
  if (item.blockedReason === null) return copy.blockedFallback;
  return copy.blocked[item.blockedReason] ?? copy.blockedFallback;
}

export function passengerName(item: InboxItem): string {
  const first = item.passenger.firstName.trim();
  return first !== "" ? first : item.passenger.displayName.trim();
}

export function buildCard(item: InboxItem, options: { nowMs: number; holds: HoldMap }): RequestCardView {
  const name = passengerName(item);
  const occupancy = buildOccupancy(item);
  const fromLabel = (item.from.label ?? "").trim() !== "" ? (item.from.label as string).trim() : copy.stopFallback(1);
  const toLabel = (item.to.label ?? "").trim() !== "" ? (item.to.label as string).trim() : copy.stopFallback(2);
  const fromTime = formatTime(item.from.atLocal);
  const toTime = formatTime(item.to.atLocal);
  const weekly: WeeklyView | null =
    item.weekly === null
      ? null
      : {
          summary: copy.weeklySummary(formatWeekdays(item.weekly.weekdays), item.weekly.occurrences),
          legs: copy.weeklyLegs(item.weekly.legs),
          start: copy.weeklyStart(formatDateShort(item.weekly.startDate)),
          occurrences: item.weekly.occurrences,
        };
  const pill = pillFor(item.status);
  const detour = detourText(item.detourMinutes);
  const holdSeconds = holdSecondsFor(item, options.holds, options.nowMs);
  const parts = [
    `${name}`,
    pill.label,
    `${fromLabel} ${fromTime}`,
    `${toLabel} ${toTime}`,
    ...(detour !== null ? [`${copy.detourLabel} ${detour}`] : []),
    occupancy.accessibilityLabel,
    ...(weekly !== null ? [weekly.summary] : []),
  ];
  return {
    id: item.id,
    kind: item.kind,
    tripId: item.tripId,
    status: item.status,
    passengerId: item.passenger.id,
    name,
    photoUrl: item.passenger.photoUrl,
    ratingAverage: item.passenger.ratingAverage,
    ratingCount: item.passenger.ratingCount,
    pill,
    section: sectionFor(item.status),
    fromLabel,
    fromTime,
    toLabel,
    toTime,
    detourText: detour,
    occupancy,
    message: item.message !== null && item.message.trim() !== "" ? item.message.trim() : null,
    weekly,
    canAccept: item.status === "pending" && item.canAccept,
    decidable: item.status === "pending",
    blockedText: blockedTextFor(item),
    holdSeconds,
    accessibilityLabel: parts.join(". "),
  };
}

export interface InboxGroups {
  pending: RequestCardView[];
  payment: RequestCardView[];
  closed: RequestCardView[];
}

/** Ordena las tarjetas en secciones conservando el orden del servidor (salida más próxima primero). */
export function groupCards(cards: readonly RequestCardView[]): InboxGroups {
  const groups: InboxGroups = { pending: [], payment: [], closed: [] };
  for (const card of cards) groups[card.section].push(card);
  return groups;
}

/** Hay alguna cuenta atrás en marcha (la pantalla solo refresca el reloj si es así). */
export function hasRunningHold(cards: readonly RequestCardView[]): boolean {
  return cards.some((card) => card.holdSeconds !== null && card.holdSeconds > 0);
}

/** Texto de la franja de plaza retenida. */
export function holdMessage(card: RequestCardView): string {
  if (card.holdSeconds === null) return copy.holdMessageNoClock(card.name);
  if (card.holdSeconds <= 0) return copy.holdExpired;
  return copy.holdMessage(card.name, copy.holdCountdown(card.holdSeconds));
}
