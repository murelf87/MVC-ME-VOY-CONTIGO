// Pruebas de las horas y fechas del recorrido (search-browse).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_ADVANCE_DAYS,
  MINUTE_STEPS,
  addDaysIso,
  clockMinutes,
  clockString,
  compareIso,
  compareMonths,
  dateFieldLabel,
  dayA11yLabel,
  isSelectableDate,
  isValidIso,
  monthGrid,
  monthOf,
  monthTitle,
  normalizeClock,
  nowClock,
  parseClock,
  shiftMonth,
  todayIso,
} from "./schedule";

// Lunes 5 de octubre de 2026, 07:17 en Madrid (CEST, UTC+2).
const NOW = new Date("2026-10-05T07:17:00+02:00");

describe("reloj", () => {
  it("lee y escribe HH:mm", () => {
    assert.deepEqual(parseClock("08:30"), { hour: 8, minute: 30 });
    assert.deepEqual(parseClock("7:05"), { hour: 7, minute: 5 });
    assert.equal(clockString({ hour: 7, minute: 5 }), "07:05");
    assert.equal(normalizeClock("7:05"), "07:05");
    assert.equal(normalizeClock("tarde"), "tarde");
  });

  it("rechaza horas que no existen", () => {
    for (const value of ["24:00", "08:60", "8:7", "abc", "", "08-30"]) assert.equal(parseClock(value), null, value);
  });

  it("cuenta minutos desde medianoche", () => {
    assert.equal(clockMinutes("00:00"), 0);
    assert.equal(clockMinutes("08:30"), 510);
    assert.equal(clockMinutes("23:59"), 1439);
    assert.equal(clockMinutes("nada"), null);
  });

  it("la hora de Madrid sale del instante, no de la zona del móvil", () => {
    assert.equal(nowClock(NOW), "07:17");
    assert.equal(nowClock(new Date("2026-10-05T05:17:00Z")), "07:17");
    // Invierno: UTC+1.
    assert.equal(nowClock(new Date("2026-12-01T07:17:00Z")), "08:17");
  });

  it("los minutos del selector van de 5 en 5", () => {
    assert.equal(MINUTE_STEPS.length, 12);
    assert.deepEqual(MINUTE_STEPS.slice(0, 3), [0, 5, 10]);
    assert.equal(MINUTE_STEPS[11], 55);
  });
});

describe("fechas", () => {
  it("hoy es el día de Madrid", () => {
    assert.equal(todayIso(NOW), "2026-10-05");
    // 23:30 del domingo en UTC ya es lunes en Madrid.
    assert.equal(todayIso(new Date("2026-10-04T22:30:00Z")), "2026-10-05");
  });

  it("suma días cruzando mes y año", () => {
    assert.equal(addDaysIso("2026-10-05", 1), "2026-10-06");
    assert.equal(addDaysIso("2026-10-31", 1), "2026-11-01");
    assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
    assert.equal(addDaysIso("2026-03-01", -1), "2026-02-28");
    assert.equal(addDaysIso("2028-02-28", 1), "2028-02-29");
  });

  it("compara días", () => {
    assert.ok(compareIso("2026-10-04", "2026-10-05") < 0);
    assert.equal(compareIso("2026-10-05", "2026-10-05"), 0);
    assert.ok(compareIso("2027-01-01", "2026-12-31") > 0);
  });

  it("valida formatos", () => {
    assert.equal(isValidIso("2026-10-05"), true);
    assert.equal(isValidIso("2026-02-30"), false);
    assert.equal(isValidIso("5/10/2026"), false);
  });

  it("solo se pueden elegir de hoy a 90 días vista", () => {
    assert.equal(isSelectableDate("2026-10-04", "2026-10-05"), false);
    assert.equal(isSelectableDate("2026-10-05", "2026-10-05"), true);
    const last = addDaysIso("2026-10-05", MAX_ADVANCE_DAYS);
    assert.equal(isSelectableDate(last, "2026-10-05"), true);
    assert.equal(isSelectableDate(addDaysIso(last, 1), "2026-10-05"), false);
  });

  it("etiqueta el día elegido", () => {
    assert.equal(dateFieldLabel("2026-10-05", NOW), "Hoy · Lun, 5 oct");
    assert.equal(dateFieldLabel("2026-10-06", NOW), "Mañana · Mar, 6 oct");
    assert.equal(dateFieldLabel("2026-10-16", NOW), "Vie, 16 oct");
    assert.equal(dayA11yLabel("2026-10-05"), "lunes 5 de octubre");
  });
});

describe("calendario del mes", () => {
  it("octubre de 2026 empieza en jueves y ocupa cinco semanas de lunes a domingo", () => {
    const weeks = monthGrid({ year: 2026, month: 10 }, "2026-10-05", null);
    assert.equal(weeks.length, 5);
    for (const week of weeks) assert.equal(week.length, 7);
    // 1 de octubre de 2026 es jueves: tres días de relleno de septiembre.
    assert.deepEqual(
      weeks[0]?.map((day) => day.iso),
      ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"],
    );
    assert.equal(weeks[0]?.[2]?.inMonth, false);
    assert.equal(weeks[0]?.[3]?.inMonth, true);
    assert.equal(weeks[4]?.[6]?.iso, "2026-11-01");
  });

  it("marca hoy, el elegido y los días que no se pueden elegir", () => {
    const weeks = monthGrid({ year: 2026, month: 10 }, "2026-10-05", "2026-10-08");
    const days = new Map(weeks.flat().map((day) => [day.iso, day]));
    assert.equal(days.get("2026-10-05")?.today, true);
    assert.equal(days.get("2026-10-05")?.disabled, false);
    assert.equal(days.get("2026-10-04")?.disabled, true);
    assert.equal(days.get("2026-10-08")?.selected, true);
    assert.equal(days.get("2026-10-07")?.selected, false);
  });

  it("febrero de 2027 cabe en cuatro semanas (empieza en lunes y tiene 28 días)", () => {
    assert.equal(monthGrid({ year: 2027, month: 2 }, "2026-10-05", null).length, 4);
  });

  it("un mes que acaba en domingo con seis filas posibles", () => {
    // Marzo de 2026 empieza en domingo: 6 filas.
    assert.equal(monthGrid({ year: 2026, month: 3 }, "2026-03-01", null).length, 6);
  });

  it("cambia de mes con la vuelta de año", () => {
    assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
    assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
    assert.deepEqual(shiftMonth({ year: 2026, month: 10 }, 0), { year: 2026, month: 10 });
    assert.deepEqual(monthOf("2026-10-05"), { year: 2026, month: 10 });
    assert.ok(compareMonths({ year: 2026, month: 10 }, { year: 2026, month: 9 }) > 0);
    assert.equal(monthTitle({ year: 2026, month: 10 }), "octubre 2026");
  });
});
