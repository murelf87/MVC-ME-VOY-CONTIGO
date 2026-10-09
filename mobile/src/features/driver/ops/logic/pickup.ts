/**
 * Verificación del código de recogida (lógica PURA). El conductor teclea el código de 6 cifras que enseña el pasajero;
 * el servidor lo comprueba (hash + intentos). Aquí solo se decide QUÉ pantalla corresponde según lo que dice la consola
 * y cómo se interpretan los intentos que devuelve el servidor.
 */
import type { LiveConsole, LiveConsolePassenger, LiveTripStatus } from "@/api/types";

export const PICKUP_CODE_LENGTH = 6;
/** Intentos máximos que concede el servidor por código (`details.maxAttempts`). */
export const DEFAULT_MAX_ATTEMPTS = 5;

/** Solo cifras, como mucho 6 (pegar «123 456» o «123-456» funciona). */
export function sanitizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, PICKUP_CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function missingDigits(code: string): number {
  return Math.max(0, PICKUP_CODE_LENGTH - code.length);
}

export type PickupMode =
  | { kind: "missing_booking" }
  | { kind: "trip_not_live"; tripStatus: LiveTripStatus }
  | { kind: "not_eligible"; reason: "completed" | "no_show" | "cancelled" }
  | { kind: "already_verified"; at: string | null }
  | { kind: "locked" }
  | { kind: "not_generated" }
  | { kind: "enter"; attemptsRemaining: number | null };

export interface PickupContext {
  passenger: LiveConsolePassenger | null;
  mode: PickupMode;
}

/** Qué ofrece la pantalla para esta reserva, según la consola. El servidor sigue siendo quien decide al verificar. */
export function pickupContext(console: LiveConsole, bookingId: string): PickupContext {
  const passenger = console.passengers.find((p) => p.bookingId === bookingId) ?? null;
  if (!passenger) return { passenger: null, mode: { kind: "missing_booking" } };
  if (passenger.bookingStatus === "cancelled" || passenger.bookingStatus === "driver_cancelled") {
    return { passenger, mode: { kind: "not_eligible", reason: "cancelled" } };
  }
  if (passenger.pickedUp || passenger.code.status === "verified") {
    return { passenger, mode: { kind: "already_verified", at: passenger.pickedUpAt } };
  }
  if (passenger.bookingStatus === "no_show") return { passenger, mode: { kind: "not_eligible", reason: "no_show" } };
  if (passenger.bookingStatus === "completed") return { passenger, mode: { kind: "not_eligible", reason: "completed" } };
  if (console.status !== "active") return { passenger, mode: { kind: "trip_not_live", tripStatus: console.status } };
  switch (passenger.code.status) {
    case "locked":
      return { passenger, mode: { kind: "locked" } };
    case "not_generated":
      return { passenger, mode: { kind: "not_generated" } };
    default:
      return { passenger, mode: { kind: "enter", attemptsRemaining: passenger.code.attemptsRemaining } };
  }
}

/** Reservas que aún esperan: confirmadas y sin recoger. Orden: la de menor ETA primero y, a igualdad, por parada. */
export function pendingPickups(console: LiveConsole): LiveConsolePassenger[] {
  return console.passengers
    .filter((p) => p.bookingStatus === "confirmed" && !p.pickedUp)
    .map((p, index) => ({ p, index }))
    .sort((a, b) => {
      const ea = a.p.etaToPickup ? Date.parse(a.p.etaToPickup.at) : Number.POSITIVE_INFINITY;
      const eb = b.p.etaToPickup ? Date.parse(b.p.etaToPickup.at) : Number.POSITIVE_INFINITY;
      if (ea !== eb) return ea < eb ? -1 : 1;
      const bySeq = a.p.pickup.seq - b.p.pickup.seq;
      return bySeq !== 0 ? bySeq : a.index - b.index;
    })
    .map((entry) => entry.p);
}

/** La siguiente recogida pendiente DISTINTA de `bookingId` (para «Siguiente recogida» tras verificar una). */
export function nextPendingAfter(console: LiveConsole, bookingId: string): LiveConsolePassenger | null {
  return pendingPickups(console).find((p) => p.bookingId !== bookingId) ?? null;
}

export interface AttemptsView {
  used: number;
  max: number;
  remaining: number;
}

/** Lee `details` de `PICKUP_CODE_INVALID` (`{ attempts, maxAttempts }`). */
export function attemptsFromDetails(details: unknown): AttemptsView | null {
  if (typeof details !== "object" || details === null) return null;
  const record = details as Record<string, unknown>;
  const used = record.attempts;
  const max = record.maxAttempts;
  if (typeof used !== "number" || !Number.isFinite(used)) return null;
  const maxAttempts = typeof max === "number" && Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_ATTEMPTS;
  return { used, max: maxAttempts, remaining: Math.max(0, maxAttempts - used) };
}

/** ¿Se puede pulsar «Verificar código»? Código completo, sin petición en curso y con conexión. */
export function canSubmitCode(code: string, state: { pending: boolean; offline: boolean }): boolean {
  return isCompleteCode(code) && !state.pending && !state.offline;
}
