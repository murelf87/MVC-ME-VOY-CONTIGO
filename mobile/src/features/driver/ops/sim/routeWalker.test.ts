// Pruebas del conductor virtual de la vista previa (driver-ops). Solo lógica pura.
// Ejecutar:  cd mobile && node --import tsx --test "src/features/driver/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { polylineLengthM, projectOnPolyline, type LngLat } from "../logic/geo";
import { SIM_SPEED_MPS, createRouteWalker } from "./routeWalker";

const ROUTE: LngLat[] = [
  [-6.0, 37.38],
  [-5.99, 37.38],
  [-5.98, 37.39],
];

describe("conductor virtual", () => {
  it("sin ruta no hay recorrido", () => {
    assert.equal(createRouteWalker([]), null);
    assert.equal(createRouteWalker([[-6, 37]]), null);
    assert.equal(createRouteWalker([[-6, 37], [-6, 37]]), null);
  });

  it("empieza al principio y avanza a velocidad constante", () => {
    const walker = createRouteWalker(ROUTE);
    assert.ok(walker);
    const start = walker.current();
    assert.deepEqual([start.lng, start.lat], [-6, 37.38]);
    assert.equal(start.finished, false);
    const after = walker.step(5);
    assert.ok(Math.abs(after.distanceAlongM - 5 * SIM_SPEED_MPS) < 1e-9);
    assert.equal(after.speedMps, SIM_SPEED_MPS);
  });

  it("las posiciones siguen sobre la ruta", () => {
    const walker = createRouteWalker(ROUTE);
    assert.ok(walker);
    for (let i = 0; i < 20; i += 1) {
      const s = walker.step(10);
      const projection = projectOnPolyline(ROUTE, s.lat, s.lng);
      assert.ok(projection && projection.offRouteM < 1, `fuera de ruta ${projection?.offRouteM}`);
    }
  });

  it("al llegar al final se queda ahí, parado", () => {
    const walker = createRouteWalker(ROUTE);
    assert.ok(walker);
    const end = walker.step(1e6);
    assert.equal(end.finished, true);
    assert.equal(end.speedMps, 0);
    assert.ok(Math.abs(end.distanceAlongM - polylineLengthM(ROUTE)) < 1e-6);
    const again = walker.step(10);
    assert.equal(again.lat, end.lat);
  });

  it("puede continuar desde una posición conocida", () => {
    const total = polylineLengthM(ROUTE);
    const mid = createRouteWalker(ROUTE, { start: { lat: 37.38, lng: -5.99 } });
    assert.ok(mid);
    const state = mid.current();
    assert.ok(state.distanceAlongM > 0 && state.distanceAlongM < total);
    assert.ok(Math.abs(state.distanceAlongM - polylineLengthM(ROUTE.slice(0, 2))) < 2);
  });

  it("el tiempo negativo no hace retroceder", () => {
    const walker = createRouteWalker(ROUTE);
    assert.ok(walker);
    walker.step(10);
    const before = walker.current().distanceAlongM;
    assert.equal(walker.step(-5).distanceAlongM, before);
  });
});
