// Pruebas de «Tu plaza semanal» (14): fechas, estado inicial, validación en español, cuerpo y lectura de la vista previa.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TripQuote, WeeklyOccurrence, WeeklyRequestPreview } from "@/api/types";
import {
  addDays,
  bookableDates,
  defaultStartDate,
  exceptionCandidates,
  exceptionsRowText,
  initialForm,
  isFormValid,
  occurrenceRows,
  previewKey,
  setExceptions,
  setStartDate,
  setWeeks,
  summarizePreview,
  toWeeklyBody,
  toggleException,
  toggleLeg,
  toggleWeekday,
  todayIso,
  validateForm,
  weekdayOf,
  windowDates,
} from "./weekly";

/** Lunes 5 de octubre de 2026, 07:17 en Madrid (+02:00): el reloj de las láminas. */
const MON_0717 = Date.parse("2026-10-05T07:17:00+02:00");
/** Lunes 7 de abril de 2025, 07:17 (+02:00). */
const MON_APR_2025 = Date.parse("2025-04-07T07:17:00+02:00");
/** Lunes 5 de octubre de 2026, 09:30: la recogida de las 08:00 ya ha pasado. */
const MON_0930 = Date.parse("2026-10-05T09:30:00+02:00");

const WORK = ["mon", "tue", "wed", "thu", "fri"] as const;
const recurrence = { weekdays: WORK, outboundLocal: "08:00", returnLocal: "18:00" } as const;

describe("fechas", () => {
  it("weekdayOf y addDays", () => {
    assert.equal(weekdayOf("2026-10-05"), "mon");
    assert.equal(weekdayOf("2026-10-11"), "sun");
    assert.equal(addDays("2026-10-30", 3), "2026-11-02");
  });
  it("todayIso usa el calendario de Madrid", () => {
    assert.equal(todayIso(Date.parse("2026-10-05T23:30:00Z")), "2026-10-06");
    assert.equal(todayIso(MON_0717), "2026-10-05");
  });
});

describe("defaultStartDate (lámina 14: «Lunes, 7 de abril de 2025» / «Lunes, 5 de octubre de 2026»)", () => {
  it("hoy, si el conductor ofrece hoy y la recogida aún no ha pasado", () => {
    assert.equal(defaultStartDate({ nowMs: MON_0717, weekdays: WORK, firstBoardLocal: "08:00" }), "2026-10-05");
    assert.equal(defaultStartDate({ nowMs: MON_APR_2025, weekdays: WORK, firstBoardLocal: "08:00" }), "2025-04-07");
  });
  it("si la recogida de hoy ya pasó, el siguiente día elegido", () => {
    assert.equal(defaultStartDate({ nowMs: MON_0930, weekdays: WORK, firstBoardLocal: "08:00" }), "2026-10-06");
  });
  it("salta los días que el conductor no ofrece (viernes tarde → lunes)", () => {
    const friday = Date.parse("2026-10-09T19:00:00+02:00");
    assert.equal(defaultStartDate({ nowMs: friday, weekdays: WORK, firstBoardLocal: "08:00" }), "2026-10-12");
  });
});

describe("formulario", () => {
  const form = initialForm({ recurrence, nowMs: MON_0717 });
  it("estado inicial: lunes a viernes, ida y vuelta, una semana, sin excepciones", () => {
    assert.deepEqual(form.weekdays, WORK);
    assert.deepEqual(form.legs, ["outbound", "return"]);
    assert.equal(form.weeks, 1);
    assert.equal(form.startDate, "2026-10-05");
    assert.deepEqual(form.exceptionDates, []);
    assert.equal(form.allowPartial, false);
  });
  it("respeta los días que pidió la búsqueda, solo dentro de los que ofrece el conductor", () => {
    const f = initialForm({ recurrence, preferredWeekdays: ["tue", "thu", "sat"], nowMs: MON_0717 });
    assert.deepEqual(f.weekdays, ["tue", "thu"]);
  });
  it("sin vuelta ofrecida solo hay ida y no se puede añadir la vuelta", () => {
    const f = initialForm({ recurrence: { ...recurrence, returnLocal: null }, nowMs: MON_0717 });
    assert.deepEqual(f.legs, ["outbound"]);
    assert.deepEqual(toggleLeg(f, "return", false).legs, ["outbound"]);
  });
  it("toggleLeg deja siempre al menos un trayecto", () => {
    let f = toggleLeg(form, "return", true);
    assert.deepEqual(f.legs, ["outbound"]);
    f = toggleLeg(f, "outbound", true);
    assert.deepEqual(f.legs, ["outbound"]);
    f = toggleLeg(f, "return", true);
    assert.deepEqual(f.legs, ["outbound", "return"]);
  });
  it("toggleWeekday solo admite los días que ofrece el conductor y los mantiene ordenados", () => {
    assert.deepEqual(toggleWeekday(form, "sat", WORK).weekdays, WORK);
    assert.deepEqual(toggleWeekday(form, "wed", WORK).weekdays, ["mon", "tue", "thu", "fri"]);
    assert.deepEqual(toggleWeekday(toggleWeekday(form, "wed", WORK), "wed", WORK).weekdays, WORK);
  });
  it("setWeeks limita a 1–4 semanas", () => {
    assert.equal(setWeeks(form, 0).weeks, 1);
    assert.equal(setWeeks(form, 9).weeks, 4);
    assert.equal(setWeeks(form, 3).weeks, 3);
  });
});

describe("ventana de días y excepciones", () => {
  const form = initialForm({ recurrence, nowMs: MON_0717 });
  it("una semana de lunes a viernes = 5 fechas desde el inicio", () => {
    assert.deepEqual(windowDates(form), ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  });
  it("las excepciones solo valen dentro de la ventana y se pueden marcar y desmarcar", () => {
    let f = toggleException(form, "2026-10-07");
    assert.deepEqual(f.exceptionDates, ["2026-10-07"]);
    f = toggleException(f, "2026-10-12"); // fuera de la ventana de una semana
    assert.deepEqual(f.exceptionDates, ["2026-10-07"]);
    f = toggleException(f, "2026-10-07");
    assert.deepEqual(f.exceptionDates, []);
  });
  it("cambiar los días o el inicio descarta las excepciones que dejan de aplicar", () => {
    const withExc = setExceptions(form, ["2026-10-07", "2026-10-08"]);
    assert.deepEqual(toggleWeekday(withExc, "wed", WORK).exceptionDates, ["2026-10-08"]);
    assert.deepEqual(setStartDate(withExc, "2026-10-08").exceptionDates, ["2026-10-08"]);
  });
  it("bookableDates resta las excepciones y exceptionCandidates ofrece las fechas de hoy en adelante", () => {
    const f = setExceptions(setWeeks(form, 2), ["2026-10-07"]);
    assert.equal(bookableDates(f).length, 9);
    const candidates = exceptionCandidates(f, MON_0717);
    assert.equal(candidates.length, 10);
    assert.equal(candidates.find((c) => c.date === "2026-10-07")?.selected, true);
    assert.equal(exceptionCandidates(f, MON_0930 + 3 * 86_400_000).length, 7);
  });
  it("exceptionsRowText: literal de la lámina, fechas sueltas o recuento", () => {
    assert.equal(exceptionsRowText([]), "Añadir fechas (vacaciones, festivos, etc.)");
    assert.equal(exceptionsRowText(["2026-10-07"]), "7 oct");
    assert.equal(exceptionsRowText(["2026-10-07", "2026-10-08"]), "7 oct y 8 oct");
    assert.match(exceptionsRowText(["2026-10-07", "2026-10-08", "2026-10-09"]), /^3\s+fechas con excepciones$/);
  });
});

describe("validación", () => {
  const form = initialForm({ recurrence, nowMs: MON_0717 });
  it("un formulario inicial es válido", () => assert.equal(isFormValid(validateForm(form, MON_0717)), true));
  it("sin días: mensaje en español", () => {
    const errors = validateForm({ ...form, weekdays: [] }, MON_0717);
    assert.equal(errors.weekdays, "Elige al menos un día de la semana.");
    assert.equal(isFormValid(errors), false);
  });
  it("una fecha de inicio pasada o inválida no se admite", () => {
    assert.equal(validateForm({ ...form, startDate: "2026-10-04" }, MON_0717).startDate, "Elige una fecha de inicio que no haya pasado.");
    assert.equal(validateForm({ ...form, startDate: "2026-13-40" }, MON_0717).startDate, "Elige una fecha de inicio que no haya pasado.");
  });
  it("si las excepciones se comen todos los días no queda nada que reservar", () => {
    const all = setExceptions(form, windowDates(form));
    assert.equal(validateForm(all, MON_0717).occurrences, "Con estos días y fechas no queda ningún día que reservar.");
  });
});

describe("toWeeklyBody", () => {
  const form = setExceptions(initialForm({ recurrence, nowMs: MON_0717 }), ["2026-10-07"]);
  it("lleva días ordenados, trayectos, inicio, semanas, excepciones y declara que no hay política de cancelación", () => {
    const body = toWeeklyBody(form, { pickupPointId: "pp1_x", dropoffStopSeq: 3 });
    assert.deepEqual(body, {
      pickupPointId: "pp1_x",
      dropoffStopSeq: 3,
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      legs: ["outbound", "return"],
      startDate: "2026-10-05",
      weeks: 1,
      exceptionDates: ["2026-10-07"],
      cancellationPolicyVersion: null,
    });
  });
  it("allowPartial y mensaje solo si existen; el mensaje se recorta", () => {
    const body = toWeeklyBody({ ...form, allowPartial: true }, { pickupPointId: "pp1_x", message: "  Voy con mochila  " });
    assert.equal(body.allowPartial, true);
    assert.equal(body.message, "Voy con mochila");
    assert.equal("message" in toWeeklyBody(form, { pickupPointId: "pp1_x", message: "   " }), false);
  });
  it("previewKey cambia con cualquier campo del cuerpo", () => {
    const a = previewKey("t", toWeeklyBody(form, { pickupPointId: "p" }));
    const b = previewKey("t", toWeeklyBody({ ...form, weeks: 2 }, { pickupPointId: "p" }));
    assert.notDeepEqual(a, b);
  });
});

function occurrence(date: string, state: WeeklyOccurrence["state"], over: Partial<WeeklyOccurrence> = {}): WeeklyOccurrence {
  return {
    date,
    weekday: weekdayOf(date),
    leg: "outbound",
    tripId: "t",
    boardsAtLocal: "08:00",
    arrivesAtLocal: "08:19",
    state,
    seatsAvailable: 2,
    requestId: null,
    requestStatus: null,
    ...over,
  };
}

const quote: TripQuote = {
  state: "pending_definition",
  tariff: { state: "none_approved", version: null },
  basis: { roadDistanceM: 6000, rateMicrosPerKm: null },
  contribution: { cents: null, currency: "EUR", status: "pending_definition" },
  managementFee: { cents: null, currency: "EUR", status: "pending_definition" },
  total: { cents: null, currency: "EUR", status: "pending_definition" },
  weekly: null,
  lockedAt: null,
};

function previewOf(occurrences: WeeklyOccurrence[], over: Partial<WeeklyRequestPreview> = {}): WeeklyRequestPreview {
  return { tripId: "t", seriesId: "s", legs: [], occurrences, quote, canSubmit: true, issues: [], ...over };
}

describe("summarizePreview (plazas parciales)", () => {
  it("todo con plaza: nada que consentir", () => {
    const s = summarizePreview(previewOf([occurrence("2026-10-05", "available"), occurrence("2026-10-06", "available")]));
    assert.equal(s.requestable, 2);
    assert.equal(s.needsPartialConsent, false);
    assert.equal(s.nothingAvailable, false);
  });
  it("algún día sin plaza y otros con plaza: hace falta consentimiento y se listan las fechas sin repetir", () => {
    const s = summarizePreview(
      previewOf([
        occurrence("2026-10-05", "available"),
        occurrence("2026-10-07", "skipped_full"),
        occurrence("2026-10-07", "skipped_full", { leg: "return" }),
        occurrence("2026-10-08", "skipped_exception"),
      ]),
    );
    assert.deepEqual(s.fullDates, ["2026-10-07"]);
    assert.equal(s.needsPartialConsent, true);
    assert.equal(s.exceptions, 1);
  });
  it("sin ningún día con plaza: nothingAvailable y no se ofrece reservar solo algunos", () => {
    const s = summarizePreview(previewOf([occurrence("2026-10-05", "skipped_full")]));
    assert.equal(s.nothingAvailable, true);
    assert.equal(s.needsPartialConsent, false);
  });
});

describe("occurrenceRows", () => {
  it("ordena por fecha (ida antes que vuelta) y etiqueta cada estado", () => {
    const rows = occurrenceRows([
      occurrence("2026-10-06", "skipped_full", { leg: "return", boardsAtLocal: "18:00" }),
      occurrence("2026-10-06", "available"),
      occurrence("2026-10-05", "skipped_exception"),
    ]);
    assert.deepEqual(
      rows.map((r) => `${r.date} ${r.legLabel}`),
      ["2026-10-05 Ida", "2026-10-06 Ida", "2026-10-06 Vuelta"],
    );
    assert.equal(rows[0]?.stateLabel, "Excepción");
    assert.match(rows[1]?.stateLabel ?? "", /^Hay plaza · 2\s+plazas libres$/);
    assert.equal(rows[2]?.stateLabel, "Sin plaza");
    assert.equal(rows[2]?.tone, "warning");
  });
});
