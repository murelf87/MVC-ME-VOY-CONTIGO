/**
 * Constructores de `LiveConsole` para las PRUEBAS de la lógica (no se importa desde la app). Tipados contra el contrato,
 * así un cambio en `docs/contracts/live.md` rompe la compilación aquí.
 */
import type { LiveConsole, LiveConsolePassenger, LiveEta, LivePosition, PublicUser } from "@/api/types";

export const NOW_ISO = "2026-10-05T05:17:00.000Z"; // 07:17 en Madrid

export function user(firstName: string, id = firstName.toLowerCase()): PublicUser {
  return { id, displayName: `${firstName} Pérez`, firstName, photoUrl: null, ratingAverage: 4.8, ratingCount: 12 };
}

export function eta(at: string, distanceM: number | null = 2400, approximate = false): LiveEta {
  return { at, minutes: 0, distanceM, source: "live_route", approximate };
}

export function position(overrides: Partial<LivePosition> = {}): LivePosition {
  return {
    location: { lat: 37.33, lng: -5.93 },
    headingDegrees: 20,
    speedMps: 9,
    accuracyM: 6,
    recordedAt: "2026-10-05T05:16:55.000Z",
    receivedAt: "2026-10-05T05:16:55.500Z",
    ageSeconds: 5,
    stale: false,
    precision: "precise",
    ...overrides,
  };
}

export function passenger(firstName: string, overrides: Partial<LiveConsolePassenger> = {}): LiveConsolePassenger {
  return {
    bookingId: `booking-${firstName.toLowerCase()}`,
    passenger: user(firstName),
    bookingStatus: "confirmed",
    pickup: { seq: 0, label: "Montequinto", location: { lat: 37.3317, lng: -5.9365 } },
    dropoff: { seq: 2, label: "Sevilla – Universidad", location: { lat: 37.3573, lng: -5.9871 } },
    pickedUp: false,
    pickedUpAt: null,
    code: { status: "active", attemptsRemaining: 5 },
    etaToPickup: eta("2026-10-05T05:25:00.000Z"),
    ratedByMe: false,
    ...overrides,
  };
}

export function makeConsole(overrides: Partial<LiveConsole> = {}): LiveConsole {
  const passengers = overrides.passengers ?? [passenger("Laura"), passenger("Miguel", { pickup: { seq: 1, label: "Dos Hermanas", location: { lat: 37.283, lng: -5.921 } } })];
  const waiting = passengers.filter((p) => p.bookingStatus === "confirmed" && !p.pickedUp);
  return {
    tripId: "trip-1",
    status: "active",
    serverTime: NOW_ISO,
    departureAt: "2026-10-05T06:05:00.000Z",
    startedAt: "2026-10-05T05:13:00.000Z",
    completedAt: null,
    vehicle: { make: "SEAT", model: "Arona", color: "Gris", plate: "1234 MBC" },
    seats: { offered: 3, occupied: passengers.length },
    signal: "live",
    position: position(),
    next: waiting[0]
      ? { bookingId: waiting[0].bookingId, passenger: waiting[0].passenger, pickup: waiting[0].pickup, etaToPickup: waiting[0].etaToPickup }
      : null,
    passengers,
    counts: { total: passengers.length, verified: passengers.filter((p) => p.pickedUp).length, pending: waiting.length },
    pendingRouteChange: null,
    actions: { canStart: false, canComplete: true, canProposeRouteChange: true, willMarkNoShow: waiting.length },
    ...overrides,
  };
}
