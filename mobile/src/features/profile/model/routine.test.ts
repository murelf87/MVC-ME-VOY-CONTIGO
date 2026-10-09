import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RoutineEntry, Weekday } from "@/api/types";
import {
  canCreateEntries,
  clashingWeekdays,
  enabledWeekdays,
  entryRouteText,
  hasEntryErrors,
  offerLine,
  sortEntries,
  validateEntryDraft,
  weekRangeLabel,
  weekdayNames,
  weekdaysPhrase,
  type EntryDraft,
} from "./routine";

function entry(id: string, weekday: Weekday, time = "07:30", enabled = true, from = "casa", to = "campus"): RoutineEntry {
  return {
    id,
    weekday,
    time,
    enabled,
    fromPlace: { id: from, kind: "home", name: "Casa" },
    toPlace: { id: to, kind: "campus", name: "Campus" },
  };
}

describe("filas", () => {
  it("ordena de lunes a domingo y por hora", () => {
    const sorted = sortEntries([entry("c", "wed"), entry("b", "mon", "18:00"), entry("a", "mon", "07:30")]);
    assert.deepEqual(sorted.map((e) => e.id), ["a", "b", "c"]);
  });
  it("no modifica la lista original", () => {
    const original = [entry("b", "tue"), entry("a", "mon")];
    sortEntries(original);
    assert.deepEqual(original.map((e) => e.id), ["b", "a"]);
  });
  it("texto del trayecto como la lámina", () => {
    assert.equal(entryRouteText(entry("a", "mon")), "Casa → Campus");
  });
  it("días con filas activas", () => {
    assert.deepEqual(enabledWeekdays([entry("a", "fri"), entry("b", "mon"), entry("c", "tue", "07:30", false)]), ["mon", "fri"]);
  });
});

describe("weekdaysPhrase", () => {
  it("rangos, todos los días y fines de semana", () => {
    assert.equal(weekdaysPhrase(["mon", "tue", "wed", "thu", "fri"]), "de lunes a viernes");
    assert.equal(weekdaysPhrase(["wed", "thu", "fri"]), "de miércoles a viernes");
    assert.equal(weekdaysPhrase(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]), "todos los días");
    assert.equal(weekdaysPhrase(["sat", "sun"]), "los fines de semana");
  });
  it("días sueltos", () => {
    assert.equal(weekdaysPhrase(["mon"]), "los lunes");
    assert.equal(weekdaysPhrase(["sat"]), "los sábados");
    assert.equal(weekdaysPhrase(["mon", "wed", "fri"]), "los lunes, miércoles y viernes");
    assert.equal(weekdaysPhrase(["fri", "mon"]), "los lunes y viernes");
    assert.equal(weekdaysPhrase([]), "");
  });
});

describe("offerLine", () => {
  it("«Ofrezco 1 plaza de lunes a viernes» (con el espacio de no separación de las cifras)", () => {
    const line = offerLine({ enabled: true, seats: 1, weekdays: ["mon", "tue", "wed", "thu", "fri"] });
    assert.equal(line.replace(/ /g, " "), "Ofrezco 1 plaza de lunes a viernes");
    assert.equal(offerLine({ enabled: true, seats: 3, weekdays: ["mon", "wed"] }).replace(/ /g, " "), "Ofrezco 3 plazas los lunes y miércoles");
  });
  it("apagada o sin días", () => {
    assert.equal(offerLine({ enabled: false, seats: 1, weekdays: ["mon"] }), "No estás ofreciendo plaza semanal");
    assert.equal(offerLine({ enabled: true, seats: 1, weekdays: [] }), "No estás ofreciendo plaza semanal");
  });
});

describe("weekRangeLabel", () => {
  it("dentro de un mes y entre meses", () => {
    assert.equal(weekRangeLabel("2026-10-12", "2026-10-18"), "12 – 18 oct");
    assert.equal(weekRangeLabel("2026-09-28", "2026-10-04"), "28 sep – 4 oct");
    assert.equal(weekRangeLabel("nada", "nada"), "nada – nada");
  });
});

describe("validación de la fila", () => {
  const valid: EntryDraft = { weekdays: ["mon", "tue"], time: "07:30", fromPlaceId: "casa", toPlaceId: "campus", enabled: true };
  it("un borrador correcto no tiene errores", () => {
    assert.equal(hasEntryErrors(validateEntryDraft(valid)), false);
  });
  it("pide días, hora y destinos en español", () => {
    const errors = validateEntryDraft({ weekdays: [], time: "", fromPlaceId: null, toPlaceId: null, enabled: true });
    assert.equal(errors.weekdays, "Elige al menos un día.");
    assert.equal(errors.time, "Elige la hora de salida.");
    assert.equal(errors.fromPlaceId, "Elige el destino de salida.");
    assert.equal(errors.toPlaceId, "Elige el destino de llegada.");
  });
  it("origen y destino no pueden ser el mismo lugar", () => {
    const errors = validateEntryDraft({ ...valid, toPlaceId: "casa" });
    assert.equal(errors.toPlaceId, "El origen y el destino no pueden ser el mismo lugar.");
    assert.equal(errors.fromPlaceId, undefined);
  });
  it("una hora mal escrita no vale", () => {
    assert.equal(validateEntryDraft({ ...valid, time: "25:00" }).time, "Elige la hora de salida.");
  });
});

describe("filas repetidas", () => {
  const existing = [entry("a", "mon"), entry("b", "tue", "08:00"), entry("c", "wed")];
  const draft: EntryDraft = { weekdays: ["mon", "tue", "wed"], time: "07:30", fromPlaceId: "casa", toPlaceId: "campus", enabled: true };
  it("detecta los días en los que ya existe la misma fila", () => {
    assert.deepEqual(clashingWeekdays(existing, draft), ["mon", "wed"]);
  });
  it("ignora la fila que se edita", () => {
    assert.deepEqual(clashingWeekdays(existing, draft, "a"), ["wed"]);
  });
  it("sin destinos elegidos no hay choque", () => {
    assert.deepEqual(clashingWeekdays(existing, { ...draft, fromPlaceId: null }), []);
  });
  it("nombres de días para el aviso", () => {
    assert.equal(weekdayNames(["wed", "mon"]), "Lun y Mié");
    assert.equal(weekdayNames(["mon", "tue", "wed"]), "Lun, Mar y Mié");
    assert.equal(weekdayNames(["fri"]), "Vie");
  });
});

describe("crear filas", () => {
  it("necesita dos destinos guardados", () => {
    assert.equal(canCreateEntries([]), false);
    assert.equal(canCreateEntries([1]), false);
    assert.equal(canCreateEntries([1, 2]), true);
  });
});
