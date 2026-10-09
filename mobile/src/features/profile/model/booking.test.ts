import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RequestStepper, RideRequestDetail, WeeklyOccurrence, WeeklyReservation } from "@/api/types";
import {
  bookingActions,
  bookingBanner,
  buildOccurrenceRows,
  canWithdrawWeekly,
  holdRemainingSeconds,
  stepperOf,
  weeklyBanner,
  weeklyPayRequestId,
} from "./booking";

const NOW = Date.parse("2026-10-05T07:18:00+02:00");
const FUTURE = new Date(NOW + 14 * 60_000 + 52_000).toISOString();
const PAST = new Date(NOW - 5_000).toISOString();

function detail(overrides: Partial<Pick<RideRequestDetail, "status" | "booking" | "nextAction" | "weekly" | "hold">> = {}): Pick<RideRequestDetail, "status" | "booking" | "nextAction" | "weekly" | "hold"> {
  return {
    status: "pending",
    booking: null,
    nextAction: { kind: "wait_for_driver", deadlineAt: null },
    weekly: null,
    hold: null,
    ...overrides,
  };
}

describe("banner de la solicitud", () => {
  it("textos y tono por estado", () => {
    assert.deepEqual(bookingBanner("pending"), { kind: "info", title: "Esperando al conductor", message: "Te avisaremos en cuanto responda a tu solicitud." });
    assert.equal(bookingBanner("confirmed").kind, "success");
    assert.equal(bookingBanner("rejected").kind, "error");
    assert.equal(bookingBanner("expired").kind, "warning");
    assert.equal(bookingBanner("payment_late").title, "Plaza no confirmada");
  });
});

describe("pasos", () => {
  const stepper: RequestStepper = {
    steps: [
      { key: "requested", state: "done" },
      { key: "accepted", state: "current" },
      { key: "payment", state: "pending" },
      { key: "confirmed", state: "pending" },
    ],
    current: "accepted",
    terminal: null,
  };
  it("convierte los estados a los de StepProgress", () => {
    assert.deepEqual(stepperOf(stepper), {
      labels: ["Solicitud", "Aceptada", "Pago", "Confirmada"],
      states: ["reached", "complete", "upcoming", "upcoming"],
    });
  });
  it("no pinta pasos en un final no feliz", () => {
    assert.equal(stepperOf({ ...stepper, terminal: "rejected" }), null);
  });
});

describe("plaza retenida", () => {
  it("segundos restantes contra «ahora»", () => {
    assert.equal(holdRemainingSeconds({ expiresAt: FUTURE, remainingSeconds: 892, active: true }, NOW), 892);
    assert.equal(holdRemainingSeconds({ expiresAt: PAST, remainingSeconds: 0, active: true }, NOW), 0);
    assert.equal(holdRemainingSeconds({ expiresAt: FUTURE, remainingSeconds: 892, active: false }, NOW), null);
    assert.equal(holdRemainingSeconds(null, NOW), null);
  });
});

describe("acciones de la solicitud", () => {
  it("pendiente: retirar", () => {
    assert.deepEqual(bookingActions(detail(), NOW), ["withdraw"]);
  });
  it("aceptada con plaza retenida: confirmar y pagar", () => {
    const accepted = detail({ status: "payment_pending", nextAction: { kind: "pay", deadlineAt: FUTURE }, hold: { expiresAt: FUTURE, remainingSeconds: 892, active: true } });
    assert.deepEqual(bookingActions(accepted, NOW), ["pay"]);
  });
  it("aceptada pero con la retención caducada: buscar otro viaje, no pagar", () => {
    const late = detail({ status: "payment_pending", nextAction: { kind: "pay", deadlineAt: PAST }, hold: { expiresAt: PAST, remainingSeconds: 0, active: true } });
    assert.deepEqual(bookingActions(late, NOW), ["searchAgain"]);
  });
  it("confirmada: seguir, chat, compartir y cancelar solo si hay reserva", () => {
    const booking = { id: "b1", status: "confirmed" as const, amount: { cents: null, currency: "EUR" as const, status: "pending_definition" as const } };
    assert.deepEqual(bookingActions(detail({ status: "confirmed", booking }), NOW), ["follow", "chat", "share", "cancel"]);
    assert.deepEqual(bookingActions(detail({ status: "confirmed", booking: null }), NOW), []);
  });
  it("sin plaza: buscar otro viaje; con reserva semanal, enlace a ella", () => {
    assert.deepEqual(bookingActions(detail({ status: "rejected" }), NOW), ["searchAgain"]);
    assert.deepEqual(bookingActions(detail({ status: "cancelled", weekly: { reservationId: "r1", occurrenceDate: "2026-10-05", leg: "outbound" } }), NOW), ["searchAgain", "weekly"]);
  });
});

function occurrence(overrides: Partial<WeeklyOccurrence> = {}): WeeklyOccurrence {
  return {
    date: "2026-10-05",
    weekday: "mon",
    leg: "outbound",
    tripId: "t1",
    boardsAtLocal: "07:30",
    arrivesAtLocal: "07:50",
    state: "requested",
    seatsAvailable: 1,
    requestId: "q1",
    requestStatus: "pending",
    ...overrides,
  };
}

function reservation(overrides: Partial<WeeklyReservation> = {}): WeeklyReservation {
  const base: WeeklyReservation = {
    id: "r1",
    seriesId: "s1",
    status: "pending",
    passenger: { id: "p", displayName: "Miguel Torres", firstName: "Miguel", photoUrl: null, ratingAverage: null, ratingCount: 0 },
    driver: { id: "d", displayName: "Ana García López", firstName: "Ana", photoUrl: null, ratingAverage: 4.8, ratingCount: 32 },
    category: "university",
    weekdays: ["mon"],
    legs: [],
    startDate: "2026-10-05",
    weeks: 1,
    exceptionDates: [],
    cancellationPolicyVersion: null,
    occurrences: [occurrence()],
    hold: null,
    quote: {
      state: "pending_definition",
      tariff: { state: "none_approved", version: null },
      basis: { roadDistanceM: 6000, rateMicrosPerKm: null },
      contribution: { cents: null, currency: "EUR", status: "pending_definition" },
      managementFee: { cents: null, currency: "EUR", status: "pending_definition" },
      total: { cents: null, currency: "EUR", status: "pending_definition" },
      weekly: null,
      lockedAt: null,
    },
    nextAction: { kind: "wait_for_driver", deadlineAt: null },
    createdAt: "2026-10-05T05:00:00.000Z",
  };
  return { ...base, ...overrides };
}

describe("reserva semanal", () => {
  it("banner por estado", () => {
    assert.equal(weeklyBanner("confirmed").kind, "success");
    assert.equal(weeklyBanner("partially_confirmed").title, "Confirmada en parte");
    assert.equal(weeklyBanner("rejected").kind, "error");
    assert.equal(weeklyBanner("pending").kind, "info");
  });

  it("filas de ocurrencias ordenadas por día y ida antes que vuelta", () => {
    const rows = buildOccurrenceRows([
      occurrence({ date: "2026-10-06", weekday: "tue", requestId: "q2", requestStatus: "confirmed" }),
      occurrence({ date: "2026-10-05", leg: "return", requestId: "q3", boardsAtLocal: "17:30", arrivesAtLocal: "17:50" }),
      occurrence({ date: "2026-10-05", requestId: "q1" }),
    ]);
    assert.deepEqual(rows.map((row) => row.requestId), ["q1", "q3", "q2"]);
    assert.equal(rows[0]?.dateLabel, "Lun, 5 oct");
    assert.equal(rows[0]?.legLabel, "Ida");
    assert.equal(rows[0]?.timeLabel, "07:30 – 07:50");
    assert.equal(rows[0]?.statusLabel, "Pendiente");
    assert.equal(rows[0]?.tone, "amber");
    assert.equal(rows[1]?.legLabel, "Vuelta");
    assert.equal(rows[2]?.statusLabel, "Confirmada");
    assert.equal(rows[2]?.tone, "green");
  });

  it("un día sin solicitud muestra el estado de la ocurrencia", () => {
    const rows = buildOccurrenceRows([occurrence({ requestId: null, requestStatus: null, state: "skipped_full", tripId: null })]);
    assert.equal(rows[0]?.statusLabel, "Sin plaza");
    assert.equal(rows[0]?.tone, "gray");
    assert.equal(rows[0]?.requestId, null);
  });

  it("retirar solo si queda alguna solicitud pendiente y la reserva sigue viva", () => {
    assert.equal(canWithdrawWeekly(reservation()), true);
    assert.equal(canWithdrawWeekly(reservation({ occurrences: [occurrence({ requestStatus: "confirmed" })], status: "confirmed" })), false);
    assert.equal(canWithdrawWeekly(reservation({ status: "cancelled" })), false);
  });

  it("pagar lleva a la primera solicitud con el pago pendiente mientras haya plaza retenida", () => {
    const pay = reservation({
      status: "payment_pending",
      nextAction: { kind: "pay", deadlineAt: FUTURE },
      hold: { expiresAt: FUTURE, remainingSeconds: 892, active: true },
      occurrences: [occurrence({ requestId: "q9", requestStatus: "confirmed" }), occurrence({ date: "2026-10-06", requestId: "q10", requestStatus: "payment_pending" })],
    });
    assert.equal(weeklyPayRequestId(pay, NOW), "q10");
    assert.equal(weeklyPayRequestId({ ...pay, hold: { expiresAt: PAST, remainingSeconds: 0, active: true } }, NOW), null);
    assert.equal(weeklyPayRequestId(reservation(), NOW), null);
  });
});
