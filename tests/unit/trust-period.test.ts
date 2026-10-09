import test from "node:test";
import assert from "node:assert/strict";
import { PERIODS, TIME_ZONE, compare, madridMidnight, resolveWindow, windowDto } from "../../src/modules/trust/period.js";

const iso = (d: Date) => d.toISOString();

test("trust/period: constantes del contrato", () => {
  assert.equal(TIME_ZONE, "Europe/Madrid");
  assert.deepEqual([...PERIODS], ["today", "yesterday", "last_7_days", "last_30_days", "this_month"]);
});

test("trust/period: madridMidnight respeta el horario de verano e invierno", () => {
  assert.equal(iso(madridMidnight(2026, 10, 9)), "2026-10-08T22:00:00.000Z"); // CEST (UTC+2)
  assert.equal(iso(madridMidnight(2026, 1, 15)), "2026-01-14T23:00:00.000Z"); // CET (UTC+1)
  assert.equal(iso(madridMidnight(2026, 3, 29)), "2026-03-28T23:00:00.000Z"); // día del cambio: todavía CET a las 00:00
  assert.equal(iso(madridMidnight(2026, 3, 30)), "2026-03-29T22:00:00.000Z");
  assert.equal(iso(madridMidnight(2026, 10, 25)), "2026-10-24T22:00:00.000Z");
  assert.equal(iso(madridMidnight(2026, 10, 26)), "2026-10-25T23:00:00.000Z");
});

test("trust/period: madridMidnight admite desbordes de día y de mes", () => {
  assert.equal(iso(madridMidnight(2026, 10, 0)), iso(madridMidnight(2026, 9, 30)));
  assert.equal(iso(madridMidnight(2026, 0, 1)), iso(madridMidnight(2025, 12, 1)));
  assert.equal(iso(madridMidnight(2026, 3, 0)), iso(madridMidnight(2026, 2, 28)));
});

test("trust/period: «hoy» compara con el mismo tramo del día anterior (ejemplo del contrato)", () => {
  const now = new Date("2026-10-09T13:41:00.000Z");
  assert.deepEqual(windowDto(resolveWindow("today", now)), {
    period: "today",
    timeZone: "Europe/Madrid",
    from: "2026-10-08T22:00:00.000Z",
    to: "2026-10-09T13:41:00.000Z",
    previousFrom: "2026-10-07T22:00:00.000Z",
    previousTo: "2026-10-08T13:41:00.000Z"
  });
});

test("trust/period: «ayer» es el día natural completo y su comparación el anterior", () => {
  const w = resolveWindow("yesterday", new Date("2026-10-09T13:41:00.000Z"));
  assert.equal(iso(w.from), "2026-10-07T22:00:00.000Z");
  assert.equal(iso(w.to), "2026-10-08T22:00:00.000Z");
  assert.equal(iso(w.previousFrom), "2026-10-06T22:00:00.000Z");
  assert.equal(iso(w.previousTo), "2026-10-07T22:00:00.000Z");
});

test("trust/period: «últimos 7/30 días» son ventanas deslizantes con un periodo previo contiguo de la misma duración", () => {
  const now = new Date("2026-10-09T13:41:00.000Z");
  for (const [period, days] of [["last_7_days", 7], ["last_30_days", 30]] as const) {
    const w = resolveWindow(period, now);
    const span = days * 86_400_000;
    assert.equal(w.to.getTime(), now.getTime());
    assert.equal(w.to.getTime() - w.from.getTime(), span);
    assert.equal(w.previousTo.getTime(), w.from.getTime());
    assert.equal(w.previousTo.getTime() - w.previousFrom.getTime(), span);
  }
  assert.equal(iso(resolveWindow("last_7_days", now).from), "2026-10-02T13:41:00.000Z");
});

test("trust/period: «este mes» compara con el mismo tramo transcurrido del mes anterior", () => {
  const w = resolveWindow("this_month", new Date("2026-10-09T13:41:00.000Z"));
  assert.equal(iso(w.from), "2026-09-30T22:00:00.000Z");
  assert.equal(iso(w.previousFrom), "2026-08-31T22:00:00.000Z");
  assert.equal(iso(w.previousTo), "2026-09-09T13:41:00.000Z");
});

test("trust/period: «este mes» nunca invade el mes siguiente cuando el anterior es más corto (31 de marzo → febrero)", () => {
  const w = resolveWindow("this_month", new Date("2026-03-31T10:00:00.000Z"));
  assert.equal(iso(w.from), "2026-02-28T23:00:00.000Z");
  assert.equal(iso(w.previousFrom), "2026-01-31T23:00:00.000Z");
  // 30 d 11 h transcurridos de marzo > 28 d de febrero ⇒ el tramo previo se recorta al fin de febrero.
  assert.equal(iso(w.previousTo), "2026-02-28T23:00:00.000Z");
  assert.ok(w.previousTo.getTime() <= w.from.getTime());
});

test("trust/period: «este mes» en enero toma diciembre del año anterior", () => {
  const w = resolveWindow("this_month", new Date("2026-01-15T12:00:00.000Z"));
  assert.equal(iso(w.from), "2025-12-31T23:00:00.000Z");
  assert.equal(iso(w.previousFrom), "2025-11-30T23:00:00.000Z");
  assert.equal(iso(w.previousTo), "2025-12-15T12:00:00.000Z");
});

test("trust/period: el día que empieza el horario de verano (29-mar-2026) dura 23 h", () => {
  // «Ayer» visto desde el 30 de marzo es el 29: 00:00 CET → 00:00 CEST = 23 horas.
  const w = resolveWindow("yesterday", new Date("2026-03-30T10:00:00.000Z"));
  assert.equal(iso(w.from), "2026-03-28T23:00:00.000Z");
  assert.equal(iso(w.to), "2026-03-29T22:00:00.000Z");
  assert.equal((w.to.getTime() - w.from.getTime()) / 3_600_000, 23);
  assert.equal((w.previousTo.getTime() - w.previousFrom.getTime()) / 3_600_000, 24);
});

test("trust/period: el día que termina el horario de verano (25-oct-2026) dura 25 h", () => {
  const w = resolveWindow("yesterday", new Date("2026-10-26T09:00:00.000Z"));
  assert.equal(iso(w.from), "2026-10-24T22:00:00.000Z");
  assert.equal(iso(w.to), "2026-10-25T23:00:00.000Z");
  assert.equal((w.to.getTime() - w.from.getTime()) / 3_600_000, 25);
});

test("trust/period: cerca de medianoche UTC el «hoy» es el de Madrid, no el de UTC", () => {
  // 23:30 UTC del 9 de octubre ya es 01:30 del día 10 en Madrid.
  const w = resolveWindow("today", new Date("2026-10-09T23:30:00.000Z"));
  assert.equal(iso(w.from), "2026-10-09T22:00:00.000Z");
  assert.equal(iso(w.to), "2026-10-09T23:30:00.000Z");
});

test("trust/period: compare() sin periodo previo no inventa un porcentaje", () => {
  assert.deepEqual(compare(0, 0), { deltaPercent: null, trend: "flat" });
  assert.deepEqual(compare(5, 0), { deltaPercent: null, trend: "new" });
});

test("trust/period: compare() redondea mitad lejos de cero y asigna tendencia", () => {
  assert.deepEqual(compare(42, 38), { deltaPercent: 11, trend: "up" });
  assert.deepEqual(compare(18, 20), { deltaPercent: -10, trend: "down" });
  assert.deepEqual(compare(9, 8), { deltaPercent: 13, trend: "up" }); // +12,5 → 13
  assert.deepEqual(compare(7, 8), { deltaPercent: -13, trend: "down" }); // −12,5 → −13
  assert.deepEqual(compare(1, 8), { deltaPercent: -88, trend: "down" }); // −87,5 → −88
  assert.deepEqual(compare(0, 4), { deltaPercent: -100, trend: "down" });
  assert.deepEqual(compare(8, 8), { deltaPercent: 0, trend: "flat" });
});

test("trust/period: compare() trata un cambio inferior al 0,5 % como «sin cambio» y nunca devuelve -0", () => {
  const up = compare(1001, 1000);
  assert.deepEqual(up, { deltaPercent: 0, trend: "flat" });
  const down = compare(999, 1000);
  assert.equal(Object.is(down.deltaPercent, 0), true);
  assert.equal(down.trend, "flat");
});
