/**
 * Reloj virtual (modos congelado / en marcha / del anfitrión), `Date` sustituible y hora local de Madrid.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { DEFAULT_PREVIEW_NOW, DEFAULT_PREVIEW_NOW_MS, PreviewClock, parseClockInput, realNowMs } from "./clock";
import {
  addDaysToDate,
  isoWeekdayOf,
  madridDate,
  madridDateTimeMs,
  madridHHmm,
  madridLocalToMs,
  madridOffsetMinutes,
  madridParts,
} from "./time";
import { installVirtualDate, isVirtualDateInstalled } from "./virtualDate";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("PreviewClock", () => {
  it("por defecto es el instante de las láminas: lunes 5 de octubre de 2026, 07:17 en Madrid", () => {
    const clock = new PreviewClock();
    assert.equal(DEFAULT_PREVIEW_NOW, "2026-10-05T07:17:00+02:00");
    assert.equal(clock.iso(), "2026-10-05T05:17:00.000Z");
    assert.equal(clock.nowMs(), DEFAULT_PREVIEW_NOW_MS);
    assert.equal(clock.getMode(), "frozen");
    assert.equal(madridHHmm(clock.nowMs()), "07:17");
    assert.equal(madridParts(clock.nowMs()).isoWeekday, 1);
  });

  it("congelado: el tiempo real no lo mueve; advance sí", async () => {
    const clock = new PreviewClock();
    const before = clock.nowMs();
    await sleep(25);
    assert.equal(clock.nowMs(), before);
    clock.advance(90_000);
    assert.equal(clock.nowMs(), before + 90_000);
  });

  it("en marcha: avanza a ritmo real desde el anclaje", async () => {
    const clock = new PreviewClock({ mode: "running", now: "2026-10-05T07:17:00+02:00" });
    const before = clock.nowMs();
    await sleep(40);
    const elapsed = clock.nowMs() - before;
    assert.ok(elapsed >= 30 && elapsed < 2000, `avanzó ${elapsed} ms`);
  });

  it("modo anfitrión: sigue a Date.now() del documento (el visor mueve el reloj con setClock)", () => {
    const clock = new PreviewClock({ mode: "host" });
    const original = Date.now;
    try {
      Date.now = () => 1_800_000_000_000;
      assert.equal(clock.nowMs(), 1_800_000_000_000);
      Date.now = () => 1_800_000_060_000;
      assert.equal(clock.nowMs(), 1_800_000_060_000);
      clock.advance(5_000); // en modo anfitrión no hace nada
      assert.equal(clock.nowMs(), 1_800_000_060_000);
    } finally {
      Date.now = original;
    }
  });

  it("setMode conserva el instante actual al pasar de en marcha a congelado", async () => {
    const clock = new PreviewClock({ mode: "running", now: "2026-10-05T07:17:00+02:00" });
    await sleep(20);
    clock.setMode("frozen");
    const frozenAt = clock.nowMs();
    assert.ok(frozenAt > DEFAULT_PREVIEW_NOW_MS);
    await sleep(20);
    assert.equal(clock.nowMs(), frozenAt);
  });

  it("set fija el instante (y el modo) y avisa a los oyentes", () => {
    const clock = new PreviewClock();
    const seen: number[] = [];
    const off = clock.onChange((c) => seen.push(c.nowMs()));
    clock.set("2026-10-05T07:58:00+02:00");
    assert.equal(madridHHmm(clock.nowMs()), "07:58");
    clock.set(Date.UTC(2026, 9, 6, 6, 0, 0), "running");
    assert.equal(clock.getMode(), "running");
    off();
    clock.advance(1);
    assert.equal(seen.length, 2);
  });

  it("state/restore: un reloj en marcha recupera el tiempo transcurrido (recarga de la página) y uno congelado no", async () => {
    const running = new PreviewClock({ mode: "running", now: "2026-10-05T07:17:00+02:00" });
    const savedRunning = { ...running.state(), anchorHostMs: realNowMs() - 5_000 };
    running.restore(savedRunning);
    assert.ok(running.nowMs() >= savedRunning.baseMs + 5_000);

    const frozen = new PreviewClock();
    const savedFrozen = { ...frozen.state(), anchorHostMs: realNowMs() - 5_000 };
    frozen.restore(savedFrozen);
    assert.equal(frozen.nowMs(), savedFrozen.baseMs);
  });

  it("state() de un reloj congelado o «host» es determinista (sin hora real): dos relojes iguales dan el mismo estado", () => {
    const a = new PreviewClock({ now: "2026-10-05T07:17:00+02:00" });
    const b = new PreviewClock({ now: "2026-10-05T07:17:00+02:00" });
    assert.deepEqual(a.state(), b.state());
    assert.equal(a.state().anchorHostMs, 0);
    assert.equal(new PreviewClock({ mode: "host" }).state().anchorHostMs, 0);
    assert.ok(new PreviewClock({ mode: "running" }).state().anchorHostMs > 0, "en marcha sí guarda el ancla real");
  });

  it("parseClockInput acepta ISO, milisegundos y Date, y rechaza basura", () => {
    assert.equal(parseClockInput("2026-10-05T07:17:00+02:00"), DEFAULT_PREVIEW_NOW_MS);
    assert.equal(parseClockInput(DEFAULT_PREVIEW_NOW_MS), DEFAULT_PREVIEW_NOW_MS);
    assert.equal(parseClockInput(new Date(DEFAULT_PREVIEW_NOW_MS)), DEFAULT_PREVIEW_NOW_MS);
    assert.throws(() => parseClockInput("no es una fecha"), /Instante no válido/);
  });
});

describe("hora local de Madrid", () => {
  it("el desfase es +2 h en verano y +1 h en invierno, con el cambio el último domingo de marzo y de octubre", () => {
    assert.equal(madridOffsetMinutes(Date.UTC(2026, 9, 5, 5, 17)), 120);
    assert.equal(madridOffsetMinutes(Date.UTC(2026, 11, 1, 12)), 60);
    assert.equal(madridOffsetMinutes(Date.UTC(2026, 2, 29, 0, 59, 59)), 60, "justo antes del cambio de marzo");
    assert.equal(madridOffsetMinutes(Date.UTC(2026, 2, 29, 1, 0, 0)), 120, "en el cambio de marzo (domingo 29)");
    assert.equal(madridOffsetMinutes(Date.UTC(2026, 9, 25, 0, 59, 59)), 120, "justo antes del cambio de octubre");
    assert.equal(madridOffsetMinutes(Date.UTC(2026, 9, 25, 1, 0, 0)), 60, "en el cambio de octubre (domingo 25)");
  });

  it("madridDate/madridHHmm cruzan la medianoche local, no la UTC", () => {
    const lateNight = Date.UTC(2026, 9, 5, 21, 30); // 23:30 en Madrid
    assert.equal(madridDate(lateNight), "2026-10-05");
    assert.equal(madridHHmm(lateNight), "23:30");
    const afterMidnight = Date.UTC(2026, 9, 5, 22, 30); // 00:30 del día 6 en Madrid
    assert.equal(madridDate(afterMidnight), "2026-10-06");
    assert.equal(madridHHmm(afterMidnight), "00:30");
  });

  it("madridLocalToMs y madridDateTimeMs son la inversa de madridParts", () => {
    const ms = madridLocalToMs(2026, 10, 5, 8, 5);
    assert.equal(new Date(ms).toISOString(), "2026-10-05T06:05:00.000Z");
    assert.equal(madridDateTimeMs("2026-10-05", "08:05"), ms);
    assert.equal(madridDateTimeMs("2026-12-01", "08:05"), Date.UTC(2026, 11, 1, 7, 5));
    const parts = madridParts(ms);
    assert.deepEqual([parts.year, parts.month, parts.day, parts.hour, parts.minute], [2026, 10, 5, 8, 5]);
  });

  it("fechas de calendario: sumar días, día de la semana ISO", () => {
    assert.equal(addDaysToDate("2026-10-31", 1), "2026-11-01");
    assert.equal(addDaysToDate("2026-03-01", -1), "2026-02-28");
    assert.equal(addDaysToDate("2028-02-28", 1), "2028-02-29");
    assert.equal(isoWeekdayOf("2026-10-05"), 1);
    assert.equal(isoWeekdayOf("2026-10-11"), 7);
    assert.throws(() => addDaysToDate("5/10/2026", 1), /Fecha de calendario no válida/);
    assert.throws(() => madridDateTimeMs("2026-10-05", "8:5"), /Hora no válida/);
  });
});

describe("Date virtual", () => {
  afterEach(() => {
    // por si una prueba falla a medias
    if (isVirtualDateInstalled()) installVirtualDate(new PreviewClock())();
  });

  it("new Date() y Date.now() devuelven la hora virtual; new Date(valor), Date.parse y instanceof siguen igual", () => {
    const clock = new PreviewClock();
    const restore = installVirtualDate(clock);
    try {
      assert.equal(isVirtualDateInstalled(), true);
      assert.equal(new Date().toISOString(), "2026-10-05T05:17:00.000Z");
      assert.equal(Date.now(), DEFAULT_PREVIEW_NOW_MS);
      assert.equal(new Date(0).toISOString(), "1970-01-01T00:00:00.000Z");
      assert.equal(new Date("2030-01-01T00:00:00Z").getUTCFullYear(), 2030);
      assert.equal(Date.parse("2026-10-05T07:17:00+02:00"), DEFAULT_PREVIEW_NOW_MS);
      assert.equal(Date.UTC(2026, 9, 5), 1_791_158_400_000);
      assert.ok(new Date() instanceof Date);
      clock.advance(60_000);
      assert.equal(new Date().toISOString(), "2026-10-05T05:18:00.000Z");
      assert.equal(typeof Date(), "string");
    } finally {
      restore();
    }
    assert.equal(isVirtualDateInstalled(), false);
    assert.notEqual(Date.now(), DEFAULT_PREVIEW_NOW_MS + 60_000);
  });

  it("instalarlo dos veces no apila sustituciones", () => {
    const clock = new PreviewClock();
    const first = installVirtualDate(clock);
    const second = installVirtualDate(clock);
    assert.equal(first, second);
    first();
    assert.equal(isVirtualDateInstalled(), false);
  });
});
