/**
 * Fase de la reserva (derivada por el servidor) → qué dice y cómo se comporta la pantalla «Esperando el coche» y la de
 * «En el coche»: texto de la franja superior, a dónde redirigir y cada cuánto sondear.
 */
import type { LiveBookingStatusView, LivePhase } from "@/api/types";
import { formatTime } from "@/i18n";
import { liveStrings } from "../strings";

const copy = liveStrings.waiting;

/** «Esperando el coche»: sondeo cada 8 s (el contrato recomienda 5–10 s). */
export const LIVE_POLL_MS = 8_000;
/** «En el coche»: sondeo cada 20 s (el contrato recomienda 15–30 s). */
export const IN_CAR_POLL_MS = 20_000;
/** Viaje aún sin iniciar: basta con mirar cada 30 s por si arranca. */
export const SCHEDULED_POLL_MS = 30_000;

export type WaitingKind = "enRoute" | "arriving" | "atPickup" | "scheduled" | "cancelled";

export interface WaitingBanner {
  kind: WaitingKind;
  title: string;
  message: string;
}

type BannerInput = Pick<LiveBookingStatusView, "phase" | "driver" | "eta" | "pickup">;

export function waitingBanner(view: BannerInput): WaitingBanner {
  const name = view.driver.firstName;
  switch (view.phase) {
    case "arriving":
      return { kind: "arriving", title: copy.arrivingTitle(name), message: copy.arrivingMessage };
    case "at_pickup":
      return { kind: "atPickup", title: copy.atPickupTitle(name), message: copy.atPickupMessage };
    case "scheduled": {
      const planned = view.pickup.plannedAt;
      return { kind: "scheduled", title: copy.scheduledTitle, message: copy.scheduledMessage(name, planned === null ? null : formatTime(planned)) };
    }
    case "cancelled":
      return { kind: "cancelled", title: copy.cancelledTitle, message: copy.cancelledMessage };
    case "driver_en_route":
    case "in_vehicle":
    case "completed":
      return {
        kind: "enRoute",
        title: copy.enRouteTitle(name),
        message: view.eta === null ? copy.enRouteNoEta : copy.enRouteMessage(view.eta.minutes),
      };
  }
}

/** Pantalla a la que hay que pasar cuando la fase ya no es de espera (la 21 es solo para esperar). */
export function redirectFromWaiting(phase: LivePhase): "InCar" | "TripFinished" | null {
  if (phase === "in_vehicle") return "InCar";
  if (phase === "completed") return "TripFinished";
  return null;
}

/** «En el coche» solo se queda mientras el viaje no ha terminado. */
export function redirectFromInCar(phase: LivePhase): "TripFinished" | null {
  return phase === "completed" ? "TripFinished" : null;
}

/** Fases en las que hay un coche en marcha que merece sondeo frecuente. */
export function isTrackingPhase(phase: LivePhase): boolean {
  return phase === "driver_en_route" || phase === "arriving" || phase === "at_pickup";
}

/** Fases finales: no cambian más (se deja de sondear). */
export function isTerminalPhase(phase: LivePhase): boolean {
  return phase === "completed" || phase === "cancelled";
}

/** Intervalo de sondeo de «Esperando el coche» según la fase (`false` = no sondear). */
export function waitingPollInterval(phase: LivePhase | undefined): number | false {
  if (phase === undefined) return LIVE_POLL_MS;
  if (isTrackingPhase(phase)) return LIVE_POLL_MS;
  if (phase === "scheduled") return SCHEDULED_POLL_MS;
  if (phase === "in_vehicle") return IN_CAR_POLL_MS;
  return false;
}

/** Intervalo de sondeo de «En el coche» según la fase (`false` = no sondear). */
export function inCarPollInterval(phase: LivePhase | undefined): number | false {
  if (phase === undefined) return IN_CAR_POLL_MS;
  if (phase === "completed" || phase === "cancelled") return false;
  if (phase === "scheduled") return SCHEDULED_POLL_MS;
  return IN_CAR_POLL_MS;
}
