/**
 * Modelo de vista de la consola del conductor (lógica PURA): convierte la respuesta de `GET /v1/me/trips/{id}/console`
 * en lo que pintan las pantallas. La app no «adivina» estados: el servidor dice si hay recogida verificada, código
 * bloqueado o acciones permitidas; aquí solo se traducen a texto, tono y orden.
 */
import type { LiveConsole, LiveConsolePassenger, LiveEta, LivePosition, LiveSignal, LiveStop, LiveTripStatus, PublicUser } from "@/api/types";
import { formatDistance, formatDuration, formatRelative, formatTime } from "@/i18n";
import { opsStrings } from "../strings";
import type { LatLng } from "./geo";

const S = opsStrings;

/** Umbral por defecto del servidor para dar una posición por obsoleta (`staleAfterSeconds`). */
export const STALE_AFTER_SECONDS = 60;

// ── Reloj del servidor ──────────────────────────────────────────────────────────────────────────────────────────────

/** «Ahora» según el servidor: su `serverTime` más lo que ha pasado en el móvil desde que llegó la respuesta. */
export function serverNowMs(serverTime: string, receivedAtMs: number, nowMs: number): number {
  const base = Date.parse(serverTime);
  if (!Number.isFinite(base)) return nowMs;
  return base + Math.max(0, nowMs - receivedAtMs);
}

/** Antigüedad (s) de la última posición, sumando el tiempo transcurrido desde que llegó la respuesta. */
export function positionAgeSeconds(position: LivePosition | null, receivedAtMs: number, nowMs: number): number | null {
  if (!position) return null;
  return Math.max(0, position.ageSeconds + Math.floor(Math.max(0, nowMs - receivedAtMs) / 1000));
}

/** «ahora mismo» · «hace 5 s» · «hace 2 min». */
export function formatAge(ageSeconds: number, nowMs: number): string {
  return formatRelative(nowMs - ageSeconds * 1000, nowMs);
}

/** Señal efectiva: una posición «en directo» que ya es vieja (sin red, mucho rato sin refrescar) deja de serlo. */
export function effectiveSignal(signal: LiveSignal, ageSeconds: number | null): LiveSignal {
  if (signal === "none") return "none";
  if (ageSeconds !== null && ageSeconds > STALE_AFTER_SECONDS) return "stale";
  return signal;
}

// ── ETA ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EtaView {
  /** «07:25». */
  time: string;
  minutes: number;
  /** «8 min» o «Ahora». */
  minutesText: string;
  /** «2,4 km»; null si el servidor no la da. */
  distanceText: string | null;
  /** Hora aproximada (señal vieja, fuera de ruta o prevista por horario). */
  approximate: boolean;
}

export function etaView(eta: LiveEta | null, nowServerMs: number): EtaView | null {
  if (!eta) return null;
  const at = Date.parse(eta.at);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.max(0, Math.ceil((at - nowServerMs) / 60_000));
  return {
    time: formatTime(eta.at),
    minutes,
    minutesText: minutes === 0 ? "Ahora" : formatDuration(minutes),
    distanceText: eta.distanceM === null ? null : formatDistance(eta.distanceM),
    approximate: eta.approximate,
  };
}

// ── Fase del viaje y banner ─────────────────────────────────────────────────────────────────────────────────────────

export type ConsolePhase = "scheduled" | "active" | "completed" | "cancelled";

export function consolePhase(status: LiveTripStatus): ConsolePhase {
  return status === "published" ? "scheduled" : status;
}

export interface ConsoleBannerView {
  phase: ConsolePhase;
  kind: "info" | "success" | "notice" | "error";
  title: string;
  message: string;
}

export function confirmedCount(console: Pick<LiveConsole, "passengers">): number {
  return console.passengers.filter((p) => p.bookingStatus === "confirmed").length;
}

export function bannerFor(console: LiveConsole): ConsoleBannerView {
  const phase = consolePhase(console.status);
  switch (phase) {
    case "scheduled": {
      const when = console.departureAt ? formatTime(console.departureAt) : "";
      return {
        phase,
        kind: "info",
        title: when ? S.console.banner.scheduledTitle(when) : "Tu viaje está publicado",
        message: S.console.banner.scheduledMessage(confirmedCount(console)),
      };
    }
    case "active":
      return {
        phase,
        kind: "success",
        title: S.console.banner.activeTitle,
        message: console.startedAt ? S.console.banner.activeMessage(formatTime(console.startedAt)) : S.console.banner.activeMessageNoTime,
      };
    case "completed":
      return {
        phase,
        kind: "success",
        title: S.console.banner.completedTitle,
        message: console.completedAt ? S.console.banner.completedMessage(formatTime(console.completedAt)) : S.console.banner.completedMessageNoTime,
      };
    case "cancelled":
      return { phase, kind: "error", title: S.console.banner.cancelledTitle, message: S.console.banner.cancelledMessage };
  }
}

// ── Pasajeros ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type PassengerState = "waiting" | "picked" | "code_locked" | "code_missing" | "completed" | "no_show" | "cancelled";
export type StatusTone = "blue" | "green" | "amber" | "red" | "gray";

export function passengerState(p: LiveConsolePassenger, tripStatus: LiveTripStatus): PassengerState {
  if (p.bookingStatus === "no_show") return "no_show";
  if (p.bookingStatus === "completed") return "completed";
  if (p.bookingStatus === "cancelled" || p.bookingStatus === "driver_cancelled") return "cancelled";
  if (p.pickedUp) return "picked";
  if (tripStatus === "active") {
    if (p.code.status === "locked") return "code_locked";
    if (p.code.status === "not_generated") return "code_missing";
  }
  return "waiting";
}

const TONES: Record<PassengerState, StatusTone> = {
  waiting: "blue",
  picked: "green",
  code_locked: "red",
  code_missing: "amber",
  completed: "green",
  no_show: "gray",
  cancelled: "gray",
};

const LABELS: Record<PassengerState, string> = {
  waiting: S.console.passengers.status.waiting,
  picked: S.console.passengers.status.picked,
  code_locked: S.console.passengers.status.codeLocked,
  code_missing: S.console.passengers.status.codeMissing,
  completed: S.console.passengers.status.completed,
  no_show: S.console.passengers.status.noShow,
  cancelled: S.console.passengers.status.cancelled,
};

export const stopLabel = (stop: Pick<LiveStop, "label" | "seq">): string => stop.label ?? S.common.unnamedStop(stop.seq);

export interface PassengerRowView {
  bookingId: string;
  passenger: PublicUser;
  state: PassengerState;
  tone: StatusTone;
  statusLabel: string;
  /** Primera línea bajo el nombre: dónde y cuándo sube / cómo terminó. */
  detail: string;
  /** Segunda línea opcional (dónde baja). */
  secondary: string | null;
  /** Se puede abrir «Verificar código» (viaje en curso, reserva confirmada y aún sin recoger). */
  canVerify: boolean;
  isNext: boolean;
  ratedByMe: boolean;
  pickup: LiveStop;
  dropoff: LiveStop;
  etaToPickup: EtaView | null;
}

function detailFor(p: LiveConsolePassenger, state: PassengerState, eta: EtaView | null): { detail: string; secondary: string | null } {
  const pickupPlace = stopLabel(p.pickup);
  const dropoff = S.console.passengers.dropoffAt(stopLabel(p.dropoff));
  switch (state) {
    case "picked":
      return {
        detail: p.pickedUpAt ? S.console.passengers.pickedAt(formatTime(p.pickedUpAt)) : S.console.passengers.pickedNoTime,
        secondary: dropoff,
      };
    case "completed":
      return { detail: S.console.passengers.completedLine, secondary: dropoff };
    case "no_show":
      return { detail: S.console.passengers.noShowLine, secondary: S.console.passengers.pickupAt(pickupPlace) };
    case "cancelled":
      return { detail: S.console.passengers.pickupAt(pickupPlace), secondary: null };
    default:
      return {
        detail: eta ? S.console.passengers.pickupPlanned(pickupPlace, eta.time) : S.console.passengers.pickupAt(pickupPlace),
        secondary: dropoff,
      };
  }
}

export function passengerRows(console: LiveConsole, nowServerMs: number): PassengerRowView[] {
  const nextId = console.status === "active" ? (console.next?.bookingId ?? null) : null;
  const rows = console.passengers.map<PassengerRowView>((p) => {
    const state = passengerState(p, console.status);
    const eta = etaView(p.etaToPickup, nowServerMs);
    const text = detailFor(p, state, eta);
    return {
      bookingId: p.bookingId,
      passenger: p.passenger,
      state,
      tone: TONES[state],
      statusLabel: LABELS[state],
      detail: text.detail,
      secondary: text.secondary,
      canVerify: console.status === "active" && p.bookingStatus === "confirmed" && !p.pickedUp,
      isNext: p.bookingId === nextId,
      ratedByMe: p.ratedByMe,
      pickup: p.pickup,
      dropoff: p.dropoff,
      etaToPickup: eta,
    };
  });
  return orderPassengers(rows);
}

const ORDER: Record<PassengerState, number> = {
  waiting: 0,
  code_missing: 0,
  code_locked: 0,
  picked: 1,
  completed: 2,
  no_show: 3,
  cancelled: 4,
};

/** Primero los que faltan por recoger (el siguiente arriba), luego los que ya van en el coche y al final los cerrados. */
export function orderPassengers(rows: readonly PassengerRowView[]): PassengerRowView[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const byState = ORDER[a.row.state] - ORDER[b.row.state];
      if (byState !== 0) return byState;
      if (a.row.isNext !== b.row.isNext) return a.row.isNext ? -1 : 1;
      const ea = a.row.etaToPickup ? a.row.etaToPickup.minutes : Number.POSITIVE_INFINITY;
      const eb = b.row.etaToPickup ? b.row.etaToPickup.minutes : Number.POSITIVE_INFINITY;
      if (ea !== eb) return ea - eb;
      const bySeq = a.row.pickup.seq - b.row.pickup.seq;
      return bySeq !== 0 ? bySeq : a.index - b.index;
    })
    .map((entry) => entry.row);
}

// ── Siguiente recogida ──────────────────────────────────────────────────────────────────────────────────────────────

export interface NextPickupView {
  bookingId: string;
  passenger: PublicUser;
  place: string;
  eta: EtaView | null;
}

export function nextPickup(console: LiveConsole, nowServerMs: number): NextPickupView | null {
  if (console.status !== "active" || !console.next) return null;
  return {
    bookingId: console.next.bookingId,
    passenger: console.next.passenger,
    place: stopLabel(console.next.pickup),
    eta: etaView(console.next.etaToPickup, nowServerMs),
  };
}

// ── Mapa ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ConsoleMapModel {
  car: {
    lat: number;
    lng: number;
    headingDegrees: number | null;
    precision: LivePosition["precision"];
    stale: boolean;
    accuracyM: number | null;
  } | null;
  /** `time` = hora prevista de recogida («07:25»), o null si el servidor no la da. */
  pickups: Array<{ bookingId: string; name: string; place: string; time: string | null; lat: number; lng: number; isNext: boolean }>;
  /** Todos los puntos (para encuadrar el mapa). */
  points: LatLng[];
}

export function mapModel(console: LiveConsole, effectiveStale: boolean): ConsoleMapModel {
  const nextId = console.next?.bookingId ?? null;
  const pickups = console.passengers
    .filter((p) => p.bookingStatus === "confirmed" && !p.pickedUp)
    .map((p) => ({
      bookingId: p.bookingId,
      name: p.passenger.firstName,
      place: stopLabel(p.pickup),
      time: p.etaToPickup ? formatTime(p.etaToPickup.at) : null,
      lat: p.pickup.location.lat,
      lng: p.pickup.location.lng,
      isNext: p.bookingId === nextId,
    }));
  const car = console.position
    ? {
        lat: console.position.location.lat,
        lng: console.position.location.lng,
        headingDegrees: console.position.headingDegrees,
        precision: console.position.precision,
        stale: effectiveStale,
        accuracyM: console.position.accuracyM,
      }
    : null;
  const points: LatLng[] = pickups.map((p) => ({ lat: p.lat, lng: p.lng }));
  if (car) points.push({ lat: car.lat, lng: car.lng });
  return { car, pickups, points };
}

/** Pasajeros recogidos / total que se muestra en la cabecera de la lista. */
export function passengerCounter(console: LiveConsole): string {
  return S.console.passengers.counter(console.counts.verified, console.counts.total);
}

/** ¿Hay una propuesta de cambio de ruta pendiente? Devuelve lo que pinta el aviso. */
export function routeChangeBanner(console: LiveConsole): { id: string; message: string; expires: string | null } | null {
  const pending = console.pendingRouteChange;
  if (!pending) return null;
  return {
    id: pending.id,
    message: S.console.routeChange.bannerMessage(pending.counts.accepted, pending.counts.required),
    expires: pending.expiresAt ? S.console.routeChange.bannerExpires(formatTime(pending.expiresAt)) : null,
  };
}
