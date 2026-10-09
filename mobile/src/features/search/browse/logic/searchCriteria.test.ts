// Pruebas del formulario «Define tu recorrido» (search-browse).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Province } from "@/api/types";
import type { PlaceParam } from "../../routes";
import type { ProvinceCheck } from "../api";
import { browseStrings } from "../strings";
import {
  DEFAULT_ARRIVE_BY,
  DEFAULT_RETURN_AT,
  formFromCriteria,
  hasErrors,
  initialRouteForm,
  provinceVerdict,
  scheduleSummary,
  sortWeekdays,
  swapPlaces,
  toCriteria,
  toggleWeekday,
  validateRouteForm,
  type RouteFormState,
} from "./searchCriteria";

const copy = browseStrings.defineRoute;
// Lunes 5 de octubre de 2026, 07:17 en Madrid.
const NOW = new Date("2026-10-05T07:17:00+02:00");

const montequinto: PlaceParam = { label: "Montequinto", latitude: 37.3222, longitude: -5.9425 };
const universidad: PlaceParam = { label: "Universidad de Sevilla", latitude: 37.3825, longitude: -5.9919 };
const sevilla: Province = { id: "prov-41", code: "41", name: "Sevilla" };
const madrid: Province = { id: "prov-28", code: "28", name: "Madrid" };

function form(overrides: Partial<RouteFormState> = {}): RouteFormState {
  return { ...initialRouteForm({ origin: montequinto, destination: universidad }), ...overrides };
}

describe("estado inicial", () => {
  it("es el de la lámina 10: semanal, lunes a viernes, llegada 08:30 y regreso 18:00", () => {
    const initial = initialRouteForm();
    assert.equal(initial.origin, null);
    assert.equal(initial.destination, null);
    assert.equal(initial.mode, "weekly");
    assert.equal(initial.arriveBy, DEFAULT_ARRIVE_BY);
    assert.equal(initial.returnAt, DEFAULT_RETURN_AT);
    assert.deepEqual(initial.weekdays, ["mon", "tue", "wed", "thu", "fri"]);
    assert.equal(initial.date, null);
    assert.equal(initial.category, null);
  });

  it("recoge lo que trae la ruta (destino desde el mapa, categoría elegida)", () => {
    const initial = initialRouteForm({ destination: universidad, category: "university" });
    assert.equal(initial.destination, universidad);
    assert.equal(initial.category, "university");
  });
});

describe("días de la semana", () => {
  it("quedan ordenados de lunes a domingo", () => {
    assert.deepEqual(sortWeekdays(["fri", "mon", "wed"]), ["mon", "wed", "fri"]);
  });

  it("se activan y desactivan uno a uno", () => {
    assert.deepEqual(toggleWeekday(["mon", "tue"], "sat"), ["mon", "tue", "sat"]);
    assert.deepEqual(toggleWeekday(["mon", "tue"], "mon"), ["tue"]);
    assert.deepEqual(toggleWeekday([], "sun"), ["sun"]);
  });
});

describe("intercambiar origen y destino", () => {
  it("los cambia de sitio", () => {
    const swapped = swapPlaces(form());
    assert.equal(swapped.origin, universidad);
    assert.equal(swapped.destination, montequinto);
  });

  it("también con un solo lado relleno", () => {
    const swapped = swapPlaces(form({ origin: null }));
    assert.equal(swapped.origin, universidad);
    assert.equal(swapped.destination, null);
  });
});

describe("validación sin red", () => {
  it("un formulario correcto no tiene errores", () => {
    assert.equal(hasErrors(validateRouteForm(form(), NOW)), false);
  });

  it("pide origen y destino", () => {
    const errors = validateRouteForm(form({ origin: null, destination: null }), NOW);
    assert.equal(errors.origin, copy.originRequired);
    assert.equal(errors.destination, copy.destinationRequired);
  });

  it("origen y destino no pueden ser el mismo sitio (a menos de 60 m)", () => {
    const near: PlaceParam = { label: "Otra puerta", latitude: montequinto.latitude + 0.0002, longitude: montequinto.longitude };
    assert.equal(validateRouteForm(form({ destination: montequinto }), NOW).destination, copy.samePlace);
    assert.equal(validateRouteForm(form({ destination: near }), NOW).destination, copy.samePlace);
    // A 1 km ya son sitios distintos.
    const far: PlaceParam = { label: "Más allá", latitude: montequinto.latitude + 0.01, longitude: montequinto.longitude };
    assert.equal(validateRouteForm(form({ destination: far }), NOW).destination, undefined);
  });

  it("el viaje semanal pide al menos un día", () => {
    assert.equal(validateRouteForm(form({ weekdays: [] }), NOW).weekdays, copy.daysRequired);
  });

  it("el viaje puntual pide el día y no mira los días de la semana", () => {
    assert.equal(validateRouteForm(form({ mode: "one_off", date: null }), NOW).date, copy.dateRequired);
    assert.equal(hasErrors(validateRouteForm(form({ mode: "one_off", date: "2026-10-07", weekdays: [] }), NOW)), false);
  });

  it("el viaje puntual no admite días pasados ni a más de 90 días", () => {
    assert.equal(validateRouteForm(form({ mode: "one_off", date: "2026-10-04" }), NOW).date, copy.datePast);
    assert.equal(validateRouteForm(form({ mode: "one_off", date: "2027-03-01" }), NOW).date, copy.dateTooFar);
    assert.equal(validateRouteForm(form({ mode: "one_off", date: "2026-10-05", arriveBy: "09:00" }), NOW).date, undefined);
  });

  it("una llegada de hoy que ya pasó no vale", () => {
    // Son las 07:17: las 07:00 de hoy ya pasaron, las 09:00 no.
    assert.equal(validateRouteForm(form({ mode: "one_off", date: "2026-10-05", arriveBy: "07:00" }), NOW).arriveBy, copy.arrivalPast);
    assert.equal(validateRouteForm(form({ mode: "one_off", date: "2026-10-05", arriveBy: "07:17" }), NOW).arriveBy, copy.arrivalPast);
    assert.equal(validateRouteForm(form({ mode: "one_off", date: "2026-10-06", arriveBy: "07:00" }), NOW).arriveBy, undefined);
    // En semanal la hora no depende de hoy.
    assert.equal(validateRouteForm(form({ arriveBy: "07:00" }), NOW).arriveBy, undefined);
  });

  it("el regreso tiene que ser posterior a la llegada y es opcional", () => {
    assert.equal(validateRouteForm(form({ returnAt: "08:00" }), NOW).returnAt, copy.returnAfterArrival);
    assert.equal(validateRouteForm(form({ returnAt: "08:30" }), NOW).returnAt, copy.returnAfterArrival);
    assert.equal(validateRouteForm(form({ returnAt: "08:31" }), NOW).returnAt, undefined);
    assert.equal(validateRouteForm(form({ returnAt: null }), NOW).returnAt, undefined);
  });

  it("las horas con formato raro se señalan", () => {
    assert.equal(validateRouteForm(form({ arriveBy: "25:00" }), NOW).arriveBy, copy.arrivalInvalid);
    assert.equal(validateRouteForm(form({ returnAt: "ya" }), NOW).returnAt, copy.returnInvalid);
  });
});

describe("criterios de búsqueda", () => {
  it("semanal: lleva los días ordenados y no lleva fecha", () => {
    const criteria = toCriteria(form({ weekdays: ["fri", "mon"], category: "work" }));
    assert.deepEqual(criteria, {
      origin: montequinto,
      destination: universidad,
      arriveBy: "08:30",
      returnAt: "18:00",
      category: "work",
      mode: "weekly",
      weekdays: ["mon", "fri"],
    });
  });

  it("puntual: lleva la fecha y no lleva días", () => {
    const criteria = toCriteria(form({ mode: "one_off", date: "2026-10-07", returnAt: null }));
    assert.deepEqual(criteria, {
      origin: montequinto,
      destination: universidad,
      arriveBy: "08:30",
      mode: "one_off",
      date: "2026-10-07",
    });
    assert.equal(criteria !== null && "weekdays" in criteria, false);
  });

  it("sin categoría ni regreso no se envían claves vacías", () => {
    const criteria = toCriteria(form({ category: null, returnAt: null }));
    assert.ok(criteria !== null);
    assert.equal("category" in criteria, false);
    assert.equal("returnAt" in criteria, false);
  });

  it("falta algo: no hay criterios", () => {
    assert.equal(toCriteria(form({ origin: null })), null);
    assert.equal(toCriteria(form({ destination: null })), null);
    assert.equal(toCriteria(form({ weekdays: [] })), null);
    assert.equal(toCriteria(form({ mode: "one_off", date: null })), null);
  });

  it("de los criterios vuelve al mismo formulario (Editar desde Resultados)", () => {
    const original = form({ weekdays: ["mon", "wed"], category: "university" });
    const criteria = toCriteria(original);
    assert.ok(criteria !== null);
    assert.deepEqual(formFromCriteria(criteria), original);
    const oneOff = form({ mode: "one_off", date: "2026-10-07", returnAt: null });
    const oneOffCriteria = toCriteria(oneOff);
    assert.ok(oneOffCriteria !== null);
    assert.deepEqual(formFromCriteria(oneOffCriteria).date, "2026-10-07");
    assert.equal(formFromCriteria(oneOffCriteria).mode, "one_off");
  });
});

describe("resumen", () => {
  it("semanal: «Lunes a viernes · Llegada 08:30» (literal de la lámina 11)", () => {
    assert.equal(scheduleSummary({ mode: "weekly", weekdays: ["mon", "tue", "wed", "thu", "fri"], arriveBy: "08:30" }), "Lunes a viernes · Llegada 08:30");
  });

  it("semanal sin días indicados usa lunes a viernes", () => {
    assert.equal(scheduleSummary({ mode: "weekly", arriveBy: "8:30" }), "Lunes a viernes · Llegada 08:30");
  });

  it("puntual: la fecha va delante", () => {
    assert.equal(scheduleSummary({ mode: "one_off", arriveBy: "09:15" }, "Mañana · Mar, 6 oct"), "Mañana · Mar, 6 oct · Llegada 09:15");
    assert.equal(scheduleSummary({ mode: "one_off", arriveBy: "09:15" }), "Llegada 09:15");
  });
});

describe("provincia de origen y destino", () => {
  const ok = (province: Province): ProvinceCheck => ({ ok: true, province });
  const outside: ProvinceCheck = { ok: false, reason: "outside" };
  const failed: ProvinceCheck = { ok: false, reason: "error", error: new Error("sin red") };

  it("los dos en la misma provincia: sigue", () => {
    const verdict = provinceVerdict(ok(sevilla), ok(sevilla), "Sevilla");
    assert.equal(verdict.kind, "ok");
    if (verdict.kind === "ok") assert.equal(verdict.province.id, sevilla.id);
  });

  it("uno fuera de las provincias disponibles: error en ese campo, en español", () => {
    const verdict = provinceVerdict(ok(sevilla), outside, "Sevilla");
    assert.equal(verdict.kind, "invalid");
    if (verdict.kind === "invalid") {
      assert.equal(verdict.errors.origin, undefined);
      assert.match(verdict.errors.destination ?? "", /provincia de Sevilla/);
    }
    const origin = provinceVerdict(outside, ok(sevilla), "Sevilla");
    assert.equal(origin.kind === "invalid" && origin.errors.origin !== undefined, true);
  });

  it("los dos fuera: error en los dos campos", () => {
    const verdict = provinceVerdict(outside, outside, null);
    assert.equal(verdict.kind, "invalid");
    if (verdict.kind === "invalid") {
      assert.ok(verdict.errors.origin);
      assert.ok(verdict.errors.destination);
    }
  });

  it("dos provincias distintas: solo se viaja dentro de una", () => {
    const verdict = provinceVerdict(ok(sevilla), ok(madrid), "Sevilla");
    assert.equal(verdict.kind, "invalid");
    if (verdict.kind === "invalid") assert.equal(verdict.errors.destination, copy.sameProvinceRequired);
  });

  it("un fallo de red no acusa a la persona: se puede reintentar", () => {
    assert.equal(provinceVerdict(failed, ok(sevilla), "Sevilla").kind, "failed");
    assert.equal(provinceVerdict(ok(sevilla), failed, "Sevilla").kind, "failed");
    // Si uno está fuera y el otro falló, lo cierto es lo que sí sabemos: está fuera.
    assert.equal(provinceVerdict(outside, failed, "Sevilla").kind, "invalid");
  });
});
