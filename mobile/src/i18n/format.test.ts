import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NBSP,
  formatCents,
  formatCentsPerUnit,
  formatCountdown,
  formatDateLong,
  formatDateShort,
  formatDateTime,
  formatDayRelative,
  formatDayShort,
  formatDecimal,
  formatDistance,
  formatDuration,
  formatDurationSeconds,
  formatInboxStamp,
  formatMoney,
  formatMoneyLabelled,
  formatRating,
  formatRelative,
  formatTime,
  formatWeekdays,
  madridOffsetMinutes,
  moneyParts,
  pluralize,
  pluralWord,
  toCivilParts,
  weekdayInitials,
  weekdayLabel,
} from "./format";

const eur = (cents: number | null, status: "defined" | "pending_definition" | "illustrative" = "defined") =>
  ({ cents, currency: "EUR", status }) as const;

describe("importes", () => {
  it("formatCents usa coma decimal, símbolo tras espacio de no separación y puntos de millar", () => {
    assert.equal(formatCents(400), `4,00${NBSP}€`);
    assert.equal(formatCents(5), `0,05${NBSP}€`);
    assert.equal(formatCents(0), `0,00${NBSP}€`);
    assert.equal(formatCents(123456), `1.234,56${NBSP}€`);
    assert.equal(formatCents(-350), `-3,50${NBSP}€`);
    assert.equal(formatCents(100000000), `1.000.000,00${NBSP}€`);
  });

  it("formatCentsPerUnit añade la unidad", () => {
    assert.equal(formatCentsPerUnit(30, "km"), `0,30${NBSP}€/km`);
  });

  it("formatMoney: definido → importe; pendiente → «Por definir»", () => {
    assert.equal(formatMoney(eur(400)), `4,00${NBSP}€`);
    assert.equal(formatMoney(eur(null, "pending_definition")), "Por definir");
    // Un `cents: null` nunca se pinta como 0,00 €, aunque el estado venga mal marcado.
    assert.equal(formatMoney(eur(null, "defined")), "Por definir");
  });

  it("formatMoney: un importe ilustrativo se formatea igual, y moneyParts/Labelled lo marcan", () => {
    const illustrative = eur(600, "illustrative");
    assert.equal(formatMoney(illustrative), `6,00${NBSP}€`);
    assert.deepEqual(moneyParts(illustrative), { text: `6,00${NBSP}€`, illustrative: true, pending: false });
    assert.equal(formatMoneyLabelled(illustrative), `6,00${NBSP}€ (ilustrativo)`);
    assert.equal(formatMoneyLabelled(eur(600)), `6,00${NBSP}€`);
    assert.deepEqual(moneyParts(eur(null, "pending_definition")), { text: "Por definir", illustrative: false, pending: true });
  });

  it("formatDecimal redondea y evita «-0»", () => {
    assert.equal(formatDecimal(4.8, 1), "4,8");
    assert.equal(formatDecimal(4.85, 1), "4,9");
    assert.equal(formatDecimal(-0.004, 2), "0,00");
    assert.equal(formatDecimal(12345.678, 0), "12.346");
  });

  it("formatRating", () => {
    assert.equal(formatRating(4.8), "4,8");
    assert.equal(formatRating(5), "5,0");
    assert.equal(formatRating(null), "");
  });
});

describe("plurales", () => {
  it("pluralize", () => {
    assert.equal(pluralize(1, "plaza"), `1${NBSP}plaza`);
    assert.equal(pluralize(2, "plaza"), `2${NBSP}plazas`);
    assert.equal(pluralize(0, "plaza"), `0${NBSP}plazas`);
    assert.equal(pluralize(32, "valoración"), `32${NBSP}valoraciones`);
    assert.equal(pluralize(2, "pasajero"), `2${NBSP}pasajeros`);
    assert.equal(pluralize(2, "persona", "personas"), `2${NBSP}personas`);
  });

  it("pluralWord", () => {
    assert.equal(pluralWord("viaje"), "viajes");
    assert.equal(pluralWord("lápiz"), "lápices");
    assert.equal(pluralWord("mes"), "meses");
    assert.equal(pluralWord("conductor"), "conductores");
    assert.equal(pluralWord("reserva"), "reservas");
  });
});

describe("fechas (Europe/Madrid)", () => {
  it("formatDateLong sobre fecha de calendario", () => {
    assert.equal(formatDateLong("2026-04-07"), "Martes, 7 de abril de 2026");
    assert.equal(formatDateLong("2025-04-07"), "Lunes, 7 de abril de 2025");
    assert.equal(formatDateLong("2026-10-05"), "Lunes, 5 de octubre de 2026");
  });

  it("formatDayShort / formatDayMonth / formatDateShort", () => {
    assert.equal(formatDayShort("2025-05-16"), "Vie, 16 may");
    assert.equal(formatDayShort("2025-05-14"), "Mié, 14 may");
    assert.equal(formatDateShort("2026-10-05"), "5 oct 2026");
  });

  it("fechas inválidas devuelven cadena vacía", () => {
    assert.equal(formatDateLong("2026-02-30"), "");
    assert.equal(formatDayShort("no es una fecha"), "");
    assert.equal(formatTime("tampoco"), "");
  });

  it("formatTime convierte instantes a hora de Madrid con horario de verano", () => {
    // Octubre (CEST, UTC+2)
    assert.equal(formatTime("2026-10-05T05:17:00.000Z"), "07:17");
    // Enero (CET, UTC+1)
    assert.equal(formatTime("2026-01-15T06:25:00.000Z"), "07:25");
    // Desfase explícito en la entrada
    assert.equal(formatTime("2026-10-05T07:17:00+02:00"), "07:17");
    assert.equal(formatTime(Date.UTC(2026, 6, 1, 22, 30)), "00:30");
  });

  it("formatTime normaliza horas locales HH:mm", () => {
    assert.equal(formatTime("7:05"), "07:05");
    assert.equal(formatTime("18:00"), "18:00");
  });

  it("cambio de hora: último domingo de marzo y de octubre a las 01:00 UTC", () => {
    // 2026-03-29 es domingo; 01:00 UTC es el instante del cambio.
    assert.equal(madridOffsetMinutes(Date.UTC(2026, 2, 29, 0, 59, 59)), 60);
    assert.equal(madridOffsetMinutes(Date.UTC(2026, 2, 29, 1, 0, 0)), 120);
    // 2026-10-25 es domingo.
    assert.equal(madridOffsetMinutes(Date.UTC(2026, 9, 25, 0, 59, 59)), 120);
    assert.equal(madridOffsetMinutes(Date.UTC(2026, 9, 25, 1, 0, 0)), 60);
  });

  it("un instante cerca de medianoche cambia de día civil en Madrid", () => {
    const parts = toCivilParts("2026-10-05T22:30:00.000Z");
    assert.ok(parts);
    assert.equal(parts.day, 6);
    assert.equal(parts.hour, 0);
    assert.equal(formatDayShort("2026-10-05T22:30:00.000Z"), "Mar, 6 oct");
  });

  it("formatDateTime", () => {
    assert.equal(formatDateTime("2026-10-05T06:12:00.000Z"), "5 oct 2026 · 08:12");
  });

  it("formatDayRelative", () => {
    const now = "2026-10-05T08:00:00.000Z";
    assert.equal(formatDayRelative("2026-10-05T15:00:00.000Z", now), "Hoy");
    assert.equal(formatDayRelative("2026-10-06T05:00:00.000Z", now), "Mañana");
    assert.equal(formatDayRelative("2026-10-04T10:00:00.000Z", now), "Ayer");
    assert.equal(formatDayRelative("2026-10-09", now), "Vie, 9 oct");
  });
});

describe("antigüedad de datos en vivo", () => {
  const now = Date.parse("2026-10-05T10:00:00.000Z");
  it("segundos, minutos, horas", () => {
    assert.equal(formatRelative(now - 2_000, now), "ahora mismo");
    assert.equal(formatRelative(now - 5_000, now), "hace 5 s");
    assert.equal(formatRelative(now - 59_000, now), "hace 59 s");
    assert.equal(formatRelative(now - 2 * 60_000, now), "hace 2 min");
    assert.equal(formatRelative(now - 3 * 3_600_000, now), "hace 3 h");
  });

  it("ayer y más antiguo", () => {
    assert.equal(formatRelative(Date.parse("2026-10-04T12:00:00.000Z"), now), "Ayer");
    assert.equal(formatRelative(Date.parse("2026-10-01T12:00:00.000Z"), now), "Jue, 1 oct");
  });

  it("un instante futuro no produce «hace -N»", () => {
    assert.equal(formatRelative(now + 60_000, now), "ahora mismo");
  });

  it("formatInboxStamp", () => {
    assert.equal(formatInboxStamp("2026-10-05T05:12:00.000Z", now), "07:12");
    assert.equal(formatInboxStamp("2026-10-04T05:12:00.000Z", now), "Ayer");
    assert.equal(formatInboxStamp("2026-05-16T10:00:00.000Z", now), "16 may");
    assert.equal(formatInboxStamp("2025-05-16T10:00:00.000Z", now), "16 may 2025");
  });
});

describe("distancias y duraciones", () => {
  it("formatDistance", () => {
    assert.equal(formatDistance(800), `800${NBSP}m`);
    assert.equal(formatDistance(804), `800${NBSP}m`);
    assert.equal(formatDistance(1200), `1,2${NBSP}km`);
    assert.equal(formatDistance(6000), `6${NBSP}km`);
    assert.equal(formatDistance(6800), `6,8${NBSP}km`);
    assert.equal(formatDistance(12600), `12,6${NBSP}km`);
    assert.equal(formatDistance(24000), `24${NBSP}km`);
    assert.equal(formatDistance(2400), `2,4${NBSP}km`);
    assert.equal(formatDistance(996), `1${NBSP}km`);
    assert.equal(formatDistance(-1), "");
  });

  it("formatDuration (minutos)", () => {
    assert.equal(formatDuration(55), `55${NBSP}min`);
    assert.equal(formatDuration(8), `8${NBSP}min`);
    assert.equal(formatDuration(60), `1${NBSP}h`);
    assert.equal(formatDuration(65), `1${NBSP}h 5${NBSP}min`);
    assert.equal(formatDuration(0), `0${NBSP}min`);
  });

  it("formatDurationSeconds", () => {
    assert.equal(formatDurationSeconds(3300), `55${NBSP}min`);
    assert.equal(formatDurationSeconds(10), `1${NBSP}min`);
  });

  it("formatCountdown", () => {
    assert.equal(formatCountdown(892), "14:52");
    assert.equal(formatCountdown(32), "00:32");
    assert.equal(formatCountdown(3725), "1:02:05");
    assert.equal(formatCountdown(-4), "00:00");
  });
});

describe("días de la semana", () => {
  it("iniciales L M X J V S D", () => {
    assert.deepEqual([...weekdayInitials], ["L", "M", "X", "J", "V", "S", "D"]);
    assert.equal(weekdayLabel("wed", "initial"), "X");
    assert.equal(weekdayLabel("wed", "short"), "Mié");
    assert.equal(weekdayLabel("wed", "long"), "Miércoles");
  });

  it("formatWeekdays", () => {
    assert.equal(formatWeekdays(["mon", "tue", "wed", "thu", "fri"]), "Lunes a viernes");
    assert.equal(formatWeekdays(["fri", "mon", "wed", "tue", "thu"]), "Lunes a viernes");
    assert.equal(formatWeekdays(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]), "Todos los días");
    assert.equal(formatWeekdays(["sat", "sun"]), "Fines de semana");
    assert.equal(formatWeekdays(["mon", "wed", "fri"]), "Lun, Mié y Vie");
    assert.equal(formatWeekdays(["tue"]), "Martes");
    assert.equal(formatWeekdays([]), "");
  });
});
