import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLOCK_HOURS, CLOCK_MINUTE_STEPS, compareClock, formatClock, isClock, nearestMinuteStep, parseClock } from "./time";

describe("parseClock / formatClock", () => {
  it("lee horas con y sin cero inicial", () => {
    assert.deepEqual(parseClock("07:30"), { hour: 7, minute: 30 });
    assert.deepEqual(parseClock("7:05"), { hour: 7, minute: 5 });
    assert.deepEqual(parseClock(" 23:59 "), { hour: 23, minute: 59 });
  });

  it("rechaza lo que no es una hora", () => {
    for (const bad of ["", "24:00", "07:60", "7", "07-30", "ab:cd", "7:5", "07:300"]) {
      assert.equal(parseClock(bad), null, bad);
      assert.equal(isClock(bad), false, bad);
    }
  });

  it("formatea con dos dígitos", () => {
    assert.equal(formatClock({ hour: 7, minute: 5 }), "07:05");
    assert.equal(formatClock({ hour: 0, minute: 0 }), "00:00");
    assert.equal(formatClock({ hour: 18, minute: 45 }), "18:45");
  });
});

describe("selector de hora", () => {
  it("ofrece 24 horas y minutos de 5 en 5", () => {
    assert.equal(CLOCK_HOURS.length, 24);
    assert.deepEqual(CLOCK_MINUTE_STEPS, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });

  it("redondea al minuto de selector más cercano sin pasar de 55", () => {
    assert.equal(nearestMinuteStep(32), 30);
    assert.equal(nearestMinuteStep(33), 35);
    assert.equal(nearestMinuteStep(58), 55);
    assert.equal(nearestMinuteStep(0), 0);
    assert.equal(nearestMinuteStep(-4), 0);
  });
});

describe("compareClock", () => {
  it("ordena como el reloj", () => {
    assert.ok(compareClock("07:30", "08:00") < 0);
    assert.ok(compareClock("18:00", "07:30") > 0);
    assert.equal(compareClock("07:30", "7:30"), 0);
    assert.deepEqual(["18:00", "07:30", "12:05"].sort(compareClock), ["07:30", "12:05", "18:00"]);
  });
});
