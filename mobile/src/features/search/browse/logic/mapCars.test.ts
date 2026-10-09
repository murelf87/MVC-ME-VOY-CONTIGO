// Pruebas del mapa de coches (09): filtros, marcadores y agrupación por cercanía (search-browse).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MapCar } from "@/api/types";
import {
  CLUSTER_MAX_ZOOM,
  DEFAULT_MAP_FILTER,
  MAP_CAR_LIMIT,
  carMarker,
  carRouteText,
  carsSummary,
  departureText,
  filterLabel,
  findGroup,
  groupCars,
  groupMarkers,
  groupTapAction,
  hasAnyFilter,
  hasFilterChanges,
  positionNote,
  seatsText,
  sortedForPanel,
  toMapQuery,
  toggleCategory,
  zoomTargetForCluster,
} from "./mapCars";

function car(id: string, lat: number, lng: number, over: Partial<MapCar> = {}): MapCar {
  return {
    tripId: id,
    category: "work",
    state: "scheduled",
    position: { lat, lng, precision: "approximate", source: "origin", recordedAt: null, stale: false, ageSeconds: null },
    seatsAvailable: 2,
    seatsOffered: 3,
    full: false,
    departureAt: "2026-10-05T06:05:00.000Z",
    originLabel: "Montequinto",
    destinationLabel: "Universidad de Sevilla",
    ...over,
  };
}

describe("filtros del mapa", () => {
  it("el filtro por defecto no oculta ningún coche y pide las próximas 12 horas", () => {
    const query = toMapQuery("prov-1", DEFAULT_MAP_FILTER);
    assert.deepEqual(query, { provinceId: "prov-1", onlyWithSeats: false, withinHours: 12, limit: MAP_CAR_LIMIT });
  });

  it("incluye la categoría solo cuando hay una elegida", () => {
    assert.equal("category" in toMapQuery("p", DEFAULT_MAP_FILTER), false);
    assert.equal(toMapQuery("p", { ...DEFAULT_MAP_FILTER, category: "university" }).category, "university");
  });

  it("el botón de filtro dice «Con plazas» o «Solo con plazas»", () => {
    assert.equal(filterLabel(DEFAULT_MAP_FILTER), "Con plazas");
    assert.equal(filterLabel({ ...DEFAULT_MAP_FILTER, onlyWithSeats: true }), "Solo con plazas");
  });

  it("distingue los cambios del filtro de la categoría", () => {
    assert.equal(hasFilterChanges(DEFAULT_MAP_FILTER), false);
    assert.equal(hasFilterChanges({ ...DEFAULT_MAP_FILTER, withinHours: 24 }), true);
    assert.equal(hasFilterChanges({ ...DEFAULT_MAP_FILTER, category: "work" }), false);
    assert.equal(hasAnyFilter({ ...DEFAULT_MAP_FILTER, category: "work" }), true);
    assert.equal(hasAnyFilter(DEFAULT_MAP_FILTER), false);
  });

  it("pulsar la categoría elegida la quita y otra la cambia", () => {
    assert.equal(toggleCategory(null, "work"), "work");
    assert.equal(toggleCategory("work", "work"), null);
    assert.equal(toggleCategory("work", "sport"), "sport");
  });
});

describe("textos de un coche", () => {
  it("plazas libres y «Completo»", () => {
    assert.equal(seatsText({ seatsAvailable: 2, full: false }), "2 plazas libres");
    assert.equal(seatsText({ seatsAvailable: 1, full: false }), "1 plaza libre");
    assert.equal(seatsText({ seatsAvailable: 0, full: true }), "Completo");
    assert.equal(seatsText({ seatsAvailable: 2, full: true }), "Completo");
  });

  it("recorrido con o sin etiquetas", () => {
    assert.equal(carRouteText({ originLabel: "Camas", destinationLabel: "Sevilla" }), "Camas → Sevilla");
    assert.equal(carRouteText({ originLabel: "Camas", destinationLabel: null }), "Camas");
    assert.equal(carRouteText({ originLabel: null, destinationLabel: null }), "Trayecto sin detallar");
  });

  it("«Sale a las» si falta para salir y «Salió a las» si ya salió", () => {
    const now = Date.parse("2026-10-05T05:17:00.000Z");
    assert.match(departureText({ departureAt: "2026-10-05T06:05:00.000Z", state: "scheduled" }, now), /^Sale a las 08:05$/);
    assert.match(departureText({ departureAt: "2026-10-05T05:40:00.000Z", state: "live" }, now), /^Salió a las 07:40$/);
    assert.match(departureText({ departureAt: "2026-10-05T05:00:00.000Z", state: "scheduled" }, now), /^Salió a las 07:00$/);
  });

  it("la posición en directo caducada no se presenta como «en directo»", () => {
    assert.equal(positionNote(car("a", 37, -6)), null);
    const live = car("b", 37, -6, {
      state: "live",
      position: { lat: 37, lng: -6, precision: "approximate", source: "live_gps", recordedAt: "x", stale: false, ageSeconds: 10 },
    });
    assert.equal(positionNote(live), "live");
    const stale = car("c", 37, -6, {
      state: "live",
      position: { lat: 37, lng: -6, precision: "approximate", source: "live_gps", recordedAt: "x", stale: true, ageSeconds: 300 },
    });
    assert.equal(positionNote(stale), "stale");
    const noGps = car("d", 37, -6, { state: "live" });
    assert.equal(positionNote(noGps), "stale");
  });
});

describe("marcadores", () => {
  it("un coche con plazas pinta «n plazas» y uno completo va en gris", () => {
    const marker = carMarker(car("a", 37.33, -5.94));
    assert.equal(marker.kind, "car");
    assert.equal(marker.seats, 2);
    assert.equal(marker.full, false);
    assert.equal(marker.id, "car:a");
    const full = carMarker(car("b", 37.36, -5.99, { seatsAvailable: 0, full: true }));
    assert.equal(full.seats, 0);
    assert.equal(full.full, true);
  });

  it("la etiqueta para lectores de pantalla incluye recorrido y plazas", () => {
    const marker = carMarker(car("a", 37.33, -5.94));
    assert.match(marker.accessibilityLabel ?? "", /Montequinto → Universidad de Sevilla/);
    assert.match(marker.accessibilityLabel ?? "", /2 plazas libres/);
  });

  it("no afina la posición: usa las coordenadas aproximadas recibidas", () => {
    const marker = carMarker(car("a", 37.33, -5.94));
    assert.deepEqual(marker.position, { lat: 37.33, lng: -5.94 });
  });
});

describe("agrupación por cercanía", () => {
  const far = [car("a", 37.33, -5.94), car("b", 37.4, -6.1), car("c", 37.2, -5.8)];

  it("coches lejanos entre sí no se agrupan", () => {
    const groups = groupCars(far, 11);
    assert.equal(groups.length, 3);
    assert.ok(groups.every((group) => group.cars.length === 1));
    assert.deepEqual(groups.map((group) => group.id).sort(), ["car:a", "car:b", "car:c"]);
  });

  it("coches casi juntos se agrupan al alejar el mapa y se separan al acercarlo", () => {
    const near = [car("a", 37.33, -5.94), car("b", 37.34, -5.94), car("c", 37.33, -5.93)];
    const zoomedOut = groupCars(near, 9);
    assert.equal(zoomedOut.length, 1);
    assert.equal(zoomedOut[0]?.cars.length, 3);
    // A zoom 13 dos de ellos siguen a menos de 60 pt (0,01° de longitud ≈ 58 pt); un poco más cerca ya se separan.
    assert.equal(groupCars(near, 13).length, 2);
    const zoomedIn = groupCars(near, 13.6);
    assert.equal(zoomedIn.length, 3);
  });

  it("el resultado no depende del orden de llegada", () => {
    const near = [car("a", 37.33, -5.94), car("b", 37.34, -5.94), car("c", 37.33, -5.93), car("d", 37.9, -5.0)];
    const one = groupCars(near, 9);
    const two = groupCars([...near].reverse(), 9);
    assert.deepEqual(
      one.map((g) => [g.id, g.cars.map((c) => c.tripId).sort()]),
      two.map((g) => [g.id, g.cars.map((c) => c.tripId).sort()]),
    );
  });

  it("con mucho zoom solo se juntan los coches de la MISMA posición", () => {
    const same = [car("a", 37.33, -5.94), car("b", 37.33, -5.94), car("c", 37.34, -5.94)];
    const groups = groupCars(same, CLUSTER_MAX_ZOOM);
    assert.equal(groups.length, 2);
    const together = groups.find((group) => group.cars.length === 2);
    assert.ok(together);
    assert.equal(together?.samePosition, true);
  });

  it("el id del grupo es el del coche suelto o el del primero por hora", () => {
    const first = car("zeta", 37.33, -5.94, { departureAt: "2026-10-05T06:00:00.000Z" });
    const second = car("alfa", 37.33, -5.94, { departureAt: "2026-10-05T07:00:00.000Z" });
    const groups = groupCars([second, first], 11);
    assert.equal(groups[0]?.id, "group:zeta");
  });

  it("el centro del grupo es la media de sus posiciones", () => {
    const groups = groupCars([car("a", 37.3, -5.9), car("b", 37.32, -5.9)], 8);
    assert.equal(groups.length, 1);
    assert.ok(Math.abs((groups[0]?.center.lat ?? 0) - 37.31) < 1e-9);
  });

  it("marcadores: coche suelto o clúster con su número", () => {
    const near = [car("a", 37.33, -5.94), car("b", 37.34, -5.94), car("z", 37.9, -5.0)];
    const markers = groupMarkers(groupCars(near, 9));
    const cluster = markers.find((marker) => marker.kind === "cluster");
    assert.equal(cluster?.kind === "cluster" ? cluster.count : 0, 2);
    assert.ok(markers.some((marker) => marker.kind === "car" && marker.id === "car:z"));
  });

  it("encuentra un grupo por el id del marcador", () => {
    const groups = groupCars(far, 11);
    assert.equal(findGroup(groups, "car:b")?.cars[0]?.tripId, "b");
    assert.equal(findGroup(groups, "car:nope"), null);
    assert.equal(findGroup(groups, null), null);
  });

  it("tocar un coche abre el panel; tocar un clúster separable acerca el mapa", () => {
    const near = [car("a", 37.33, -5.94), car("b", 37.34, -5.94)];
    const [cluster] = groupCars(near, 9);
    assert.ok(cluster);
    assert.equal(groupTapAction(cluster, 9), "zoom");
    assert.equal(groupTapAction(cluster, CLUSTER_MAX_ZOOM), "open");
    const [single] = groupCars([near[0] as MapCar], 9);
    assert.ok(single);
    assert.equal(groupTapAction(single, 9), "open");
    const stacked = groupCars([car("a", 37.33, -5.94), car("b", 37.33, -5.94)], 9)[0];
    assert.ok(stacked);
    assert.equal(groupTapAction(stacked, 9), "open");
  });

  it("acercar un clúster sube dos niveles sin pasar del máximo", () => {
    assert.equal(zoomTargetForCluster(9), 11);
    assert.equal(zoomTargetForCluster(13), CLUSTER_MAX_ZOOM);
    assert.equal(zoomTargetForCluster(20), CLUSTER_MAX_ZOOM);
  });
});

describe("lista del panel y resumen", () => {
  it("primero los coches con plazas y después por hora de salida", () => {
    const early = car("early", 37, -6, { departureAt: "2026-10-05T05:00:00.000Z", full: true, seatsAvailable: 0 });
    const late = car("late", 37, -6, { departureAt: "2026-10-05T07:00:00.000Z" });
    const mid = car("mid", 37, -6, { departureAt: "2026-10-05T06:00:00.000Z" });
    assert.deepEqual(sortedForPanel([early, late, mid]).map((c) => c.tripId), ["mid", "late", "early"]);
  });

  it("cuenta coches, coches con plazas y plazas libres", () => {
    const summary = carsSummary([
      car("a", 37, -6, { seatsAvailable: 2 }),
      car("b", 37, -6, { seatsAvailable: 1 }),
      car("c", 37, -6, { seatsAvailable: 0, full: true }),
    ]);
    assert.deepEqual(summary, { cars: 3, withSeats: 2, seats: 3 });
  });
});
