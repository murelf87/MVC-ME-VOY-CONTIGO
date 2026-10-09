// Pruebas de la geometría pura de la consola del conductor (driver-ops).
// Ejecutar:  cd mobile && node --import tsx --test "src/features/driver/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bearingDegrees, boundsOf, haversineM, pointAtDistance, polylineLengthM, projectOnPolyline, type LngLat } from "./geo";

// Línea casi recta de oeste a este por Sevilla, ~1,1 km por cada 0,0125° de longitud.
const ROUTE: LngLat[] = [
  [-6.0, 37.38],
  [-5.99, 37.38],
  [-5.98, 37.38],
  [-5.97, 37.38],
];

describe("distancias", () => {
  it("haversine: 0,01° de latitud son ~1,11 km", () => {
    const d = haversineM({ lat: 37.38, lng: -6 }, { lat: 37.39, lng: -6 });
    assert.ok(d > 1100 && d < 1125, `d=${d}`);
  });

  it("la longitud de la ruta es la suma de sus tramos", () => {
    const total = polylineLengthM(ROUTE);
    const parts = haversineM({ lat: 37.38, lng: -6 }, { lat: 37.38, lng: -5.99 }) * 3;
    assert.ok(Math.abs(total - parts) < 1, `${total} vs ${parts}`);
    assert.equal(polylineLengthM([]), 0);
    assert.equal(polylineLengthM([[0, 0]]), 0);
  });

  it("rumbo: este = 90°, norte = 0°", () => {
    assert.ok(Math.abs(bearingDegrees({ lat: 37, lng: -6 }, { lat: 37, lng: -5.9 }) - 90) < 0.1);
    assert.ok(Math.abs(bearingDegrees({ lat: 37, lng: -6 }, { lat: 37.1, lng: -6 })) < 0.1);
  });
});

describe("proyección sobre la ruta", () => {
  it("un punto sobre la ruta queda a 0 m de ella y a mitad de camino", () => {
    const total = polylineLengthM(ROUTE);
    const p = projectOnPolyline(ROUTE, 37.38, -5.985);
    assert.ok(p);
    assert.ok(p.offRouteM < 0.5, `off=${p.offRouteM}`);
    assert.ok(Math.abs(p.distanceAlongM - total / 2) < 2, `along=${p.distanceAlongM}`);
    assert.ok(Math.abs(p.fraction - 0.5) < 0.001);
  });

  it("un punto al norte de la ruta se proyecta en su pie y mide la distancia", () => {
    const p = projectOnPolyline(ROUTE, 37.381, -5.985);
    assert.ok(p);
    assert.ok(Math.abs(p.offRouteM - 111) < 3, `off=${p.offRouteM}`);
    assert.ok(Math.abs(p.fraction - 0.5) < 0.01);
  });

  it("antes del inicio y después del final se queda en los extremos", () => {
    const before = projectOnPolyline(ROUTE, 37.38, -6.05);
    const after = projectOnPolyline(ROUTE, 37.38, -5.9);
    assert.ok(before && after);
    assert.equal(before.distanceAlongM, 0);
    assert.ok(Math.abs(after.distanceAlongM - after.totalM) < 0.001);
    assert.ok(after.fraction === 1);
  });

  it("ruta vacía → null; un solo punto → distancia al punto", () => {
    assert.equal(projectOnPolyline([], 37, -6), null);
    const single = projectOnPolyline([[-6, 37]], 37.01, -6);
    assert.ok(single);
    assert.ok(single.offRouteM > 1100 && single.offRouteM < 1125);
    assert.equal(single.fraction, 0);
  });

  it("segmentos repetidos (longitud 0) no producen NaN", () => {
    const p = projectOnPolyline(
      [
        [-6, 37],
        [-6, 37],
        [-5.99, 37],
      ],
      37,
      -5.995,
    );
    assert.ok(p);
    assert.ok(Number.isFinite(p.distanceAlongM) && Number.isFinite(p.offRouteM));
  });
});

describe("punto a una distancia", () => {
  it("0 m es el inicio y pasarse devuelve el final con su rumbo", () => {
    const start = pointAtDistance(ROUTE, 0);
    const end = pointAtDistance(ROUTE, 1e9);
    assert.ok(start && end);
    assert.deepEqual([start.lng, start.lat], [-6, 37.38]);
    assert.deepEqual([end.lng, end.lat], [-5.97, 37.38]);
    assert.ok(Math.abs(end.headingDegrees - 90) < 0.5);
  });

  it("a mitad de ruta cae a mitad de camino y proyectarlo devuelve la misma distancia", () => {
    const total = polylineLengthM(ROUTE);
    const mid = pointAtDistance(ROUTE, total / 2);
    assert.ok(mid);
    const back = projectOnPolyline(ROUTE, mid.lat, mid.lng);
    assert.ok(back);
    assert.ok(Math.abs(back.distanceAlongM - total / 2) < 1);
  });

  it("ruta vacía → null", () => {
    assert.equal(pointAtDistance([], 10), null);
  });
});

describe("caja", () => {
  it("contiene todos los puntos", () => {
    const box = boundsOf([
      { lat: 37.3, lng: -6 },
      { lat: 37.4, lng: -5.9 },
      { lat: 37.35, lng: -5.95 },
    ]);
    assert.deepEqual(box, { minLat: 37.3, maxLat: 37.4, minLng: -6, maxLng: -5.9 });
    assert.equal(boundsOf([]), null);
  });
});
