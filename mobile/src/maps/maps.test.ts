// Pruebas de las partes PURAS del módulo de mapas (geografía, métricas de chips, geometría de marcadores, lugares y rutas).
// Ejecutar:  cd mobile && node --import tsx --test src/maps/maps.test.ts
// (No renderizan nada: el aspecto se comprueba con tools/preview/map/fidelity, ver docs/MAPS.md.)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHIP_HANDLE_GAP_AFTER, CHIP_HANDLE_GAP_BEFORE, CHIP_HANDLE_W, measureChip } from './chipLayout';
import {
  SEVILLA_CENTER,
  SEVILLA_PROVINCE_BOUNDS,
  SEVILLA_REGION,
  boundsOf,
  distanceMeters,
  fitBounds,
  latFromMercatorY,
  lngFromMercatorX,
  mercatorX,
  mercatorY,
  pointAlong,
  polylineLengthMeters,
  regionForZoom,
  sevillaCenter,
  zoomForRegion,
} from './geo';
import { MAP_COLORS, MARKER_METRICS, ROUTE_STYLE, chipToneColor } from './mapTheme';
import { capCardPath, capGlyphHeight, carSeatsChip, defaultZIndex, graphicFor, layoutMarker, seatsLabel } from './markerLayout';
import { SEVILLA_PLACES, SEVILLA_PLACE_BY_ID, findSevillaPlace, nearestSevillaPlace, sevillaPoint } from './places';
import { SEVILLA_ROAD_ROUTES, decodePolyline, encodePolyline, reverseRoadRoute, roadRouteBetween, roadRouteLngLat, sevillaRoadRoute } from './roadRoutes';
import { textWidth } from './textMetrics';
import type { MapMarkerSpec, MapPoint } from './types';

const P = (lat: number, lng: number): MapPoint => ({ lat, lng });

describe('geo', () => {
  it('sevillaCenter devuelve una copia del centro', () => {
    const c = sevillaCenter();
    assert.deepEqual(c, SEVILLA_CENTER);
    c.lat = 0;
    assert.equal(SEVILLA_CENTER.lat, 37.3859);
  });

  it('Mercator es invertible', () => {
    for (const p of [P(37.3891, -5.9845), P(36.9, -6.5), P(37.8, -4.95)]) {
      assert.ok(Math.abs(latFromMercatorY(mercatorY(p.lat)) - p.lat) < 1e-9);
      assert.ok(Math.abs(lngFromMercatorX(mercatorX(p.lng)) - p.lng) < 1e-9);
    }
  });

  it('distancia Sevilla (Catedral) – Dos Hermanas ≈ 13 km (línea recta) y simétrica', () => {
    const dh = sevillaPoint('dos-hermanas');
    const d = distanceMeters(SEVILLA_CENTER, dh);
    assert.ok(d > 12_000 && d < 14_500, `d=${d}`);
    assert.ok(Math.abs(d - distanceMeters(dh, SEVILLA_CENTER)) < 1e-6);
  });

  it('polylineLengthMeters y pointAlong', () => {
    const line = [P(37.38, -5.99), P(37.39, -5.99), P(37.39, -5.98)];
    const total = polylineLengthMeters(line);
    assert.ok(total > 1_900 && total < 2_100, `total=${total}`);
    const mid = pointAlong(line, total / 2);
    assert.ok(mid && Math.abs(mid.lat - 37.39) < 0.002);
    assert.deepEqual(pointAlong(line, 1e9), line[2]);
    assert.equal(pointAlong([], 5), null);
  });

  it('boundsOf ignora puntos inválidos y devuelve null si no queda ninguno', () => {
    assert.equal(boundsOf([null, undefined, P(Number.NaN, 0)]), null);
    const b = boundsOf([P(37.3, -6.1), null, P(37.5, -5.9)]);
    assert.deepEqual(b, { sw: P(37.3, -6.1), ne: P(37.5, -5.9) });
  });

  it('fitBounds encuadra todos los puntos dentro del viewport con el relleno pedido', () => {
    const pts = [sevillaPoint('palomares-del-rio'), sevillaPoint('universidad-de-sevilla'), sevillaPoint('montequinto')];
    const viewport = { width: 393, height: 500 };
    const padding = { top: 90, right: 24, bottom: 260, left: 24 };
    const r = fitBounds(pts, { viewport, padding });
    const world = 256 * 2 ** zoomForRegion(r, viewport.width);
    const cx = mercatorX(r.lng);
    const cy = mercatorY(r.lat);
    for (const p of pts) {
      const x = viewport.width / 2 + (mercatorX(p.lng) - cx) * world;
      const y = viewport.height / 2 + (mercatorY(p.lat) - cy) * world;
      assert.ok(x >= padding.left - 0.5 && x <= viewport.width - padding.right + 0.5, `x=${x}`);
      assert.ok(y >= padding.top - 0.5 && y <= viewport.height - padding.bottom + 0.5, `y=${y}`);
    }
  });

  it('fitBounds: un punto → zoom máximo; sin puntos → región de Sevilla', () => {
    const one = fitBounds([SEVILLA_CENTER], { viewport: { width: 400, height: 400 }, maxZoom: 14 });
    assert.ok(Math.abs(zoomForRegion(one, 400) - 14) < 1e-6);
    assert.deepEqual(fitBounds([]), SEVILLA_REGION);
  });

  it('regionForZoom ↔ zoomForRegion', () => {
    const r = regionForZoom(SEVILLA_CENTER, 12.5, { width: 364, height: 385 });
    assert.ok(Math.abs(zoomForRegion(r, 364) - 12.5) < 1e-9);
  });

  it('la provincia contiene todos los lugares', () => {
    const { sw, ne } = SEVILLA_PROVINCE_BOUNDS;
    for (const p of SEVILLA_PLACES) assert.ok(p.lat >= sw.lat && p.lat <= ne.lat && p.lng >= sw.lng && p.lng <= ne.lng, p.id);
  });
});

describe('lugares', () => {
  it('ids únicos, nombres no vacíos y coordenadas de Sevilla', () => {
    const ids = new Set<string>();
    for (const p of SEVILLA_PLACES) {
      assert.ok(!ids.has(p.id), `id duplicado ${p.id}`);
      ids.add(p.id);
      assert.ok(p.name.length > 1);
    }
    assert.ok(SEVILLA_PLACES.length >= 60);
    assert.equal(Object.keys(SEVILLA_PLACE_BY_ID).length, SEVILLA_PLACES.length);
  });

  it('findSevillaPlace ignora tildes y mayúsculas', () => {
    assert.equal(findSevillaPlace('universidad de sevilla')?.id, 'universidad-de-sevilla');
    assert.equal(findSevillaPlace('NERVION')?.id, 'nervion');
    assert.equal(findSevillaPlace('Atlantis'), undefined);
  });

  it('nearestSevillaPlace', () => {
    const near = nearestSevillaPlace(P(37.3773, -5.9871), { kinds: ['landmark'] });
    assert.equal(near?.id, 'plaza-de-espana');
    assert.equal(nearestSevillaPlace(P(0, 0), { maxKm: 5 }), undefined);
  });
});

describe('chips', () => {
  it('«Completo» (sm) es más estrecho que «2 plazas» (lg) y ambos tienen altura de una línea', () => {
    const full = measureChip(carSeatsChip(0));
    const two = measureChip(carSeatsChip(2));
    assert.ok(full.width < two.width);
    assert.equal(full.titleLines.length, 1);
    assert.ok(two.height >= 30 && two.height <= 40, `h=${two.height}`);
  });

  it('titleWeight: «medium» no es más ancho que «bold»; «Completo» usa medium', () => {
    const bold = measureChip({ title: 'Completo', size: 'sm' });
    const medium = measureChip({ title: 'Completo', size: 'sm', titleWeight: 'medium' });
    assert.ok(medium.width <= bold.width);
    assert.equal(carSeatsChip(0).titleWeight, 'medium');
    assert.equal(carSeatsChip(2).titleWeight, undefined);
  });

  it('seatsLabel', () => {
    assert.equal(seatsLabel(0), 'Completo');
    assert.equal(seatsLabel(1), '1 plaza');
    assert.equal(seatsLabel(3), '3 plazas');
  });

  it('el ancho crece con el texto, el icono, la hora y el asa', () => {
    const base = measureChip({ title: 'Mairena del Aljarafe' });
    assert.ok(measureChip({ title: 'Mairena del Aljarafe', icon: 'walk' }).width > base.width);
    assert.ok(measureChip({ title: 'Mairena del Aljarafe', trailing: '07:25' }).width > base.width);
    const withTime = measureChip({ title: 'Mairena del Aljarafe', trailing: '07:25' });
    assert.ok(measureChip({ title: 'Mairena del Aljarafe', trailing: '07:25', handle: true }).width > withTime.width);
    assert.ok(measureChip({ title: 'Mairena del Aljarafe', subtitle: 'Origen' }).height > base.height);
  });

  it('hora en línea: cabe bajo el título y no ocupa columna; el asa lleva siempre su línea fina', () => {
    const inline = measureChip({ title: '1. Palomares del Río', subtitle: 'Origen', trailing: '07:00', handle: true });
    assert.equal(inline.trailingInline, true);
    const column = measureChip({ title: '3. Sevilla', subtitle: 'Destino', trailing: '07:25', handle: true, size: 'lg' });
    assert.equal(column.trailingInline, false);
    assert.ok(column.trailBlock > inline.trailBlock);
    const handleOnly = measureChip({ title: '2. Mairena del Aljarafe', handle: true });
    assert.equal(handleOnly.trailBlock, CHIP_HANDLE_GAP_BEFORE + 1 + CHIP_HANDLE_GAP_AFTER + CHIP_HANDLE_W);
    // sin subtítulo, la hora siempre es una columna
    assert.equal(measureChip({ title: 'Sevilla', trailing: '07:25' }).trailingInline, false);
  });

  it('varias líneas con «\\n»: usa la más ancha', () => {
    const c = measureChip({ title: 'Universidad\nde Sevilla', align: 'center' });
    assert.equal(c.titleLines.length, 2);
    assert.ok(c.width >= Math.ceil(textWidth('Universidad', c.metrics.title, 'bold')));
  });
});

const everyKind: MapMarkerSpec[] = [
  { id: 'car', kind: 'car', seats: 2, position: SEVILLA_CENTER },
  { id: 'carFull', kind: 'car', seats: 0, position: SEVILLA_CENTER },
  { id: 'carLive', kind: 'car', variant: 'live', position: SEVILLA_CENTER },
  { id: 'carBadge', kind: 'car', variant: 'badge', position: SEVILLA_CENTER },
  { id: 'a', kind: 'pickupA', position: SEVILLA_CENTER, chip: { title: 'Tu recogida', subtitle: '07:25' } },
  { id: 'b', kind: 'pickupB', position: SEVILLA_CENTER },
  { id: 'o', kind: 'origin', position: SEVILLA_CENTER, chip: { title: 'Montequinto', subtitle: '08:05', size: 'sm' } },
  { id: 'd', kind: 'destination', position: SEVILLA_CENTER, chip: { title: 'Tu destino', side: 'left' } },
  { id: 'cap', kind: 'destinationCap', position: SEVILLA_CENTER, chip: { title: 'Universidad\nde Sevilla', side: 'bottom', align: 'center' } },
  { id: 'cap2', kind: 'destinationCap', position: SEVILLA_CENTER, chip: { title: 'Universidad\nde Sevilla', subtitle: '08:28', side: 'top', align: 'center' } },
  { id: 's', kind: 'stop', index: 2, position: SEVILLA_CENTER, chip: { title: '2. Mairena del Aljarafe', handle: true } },
  { id: 's12', kind: 'stop', index: 12, position: SEVILLA_CENTER },
  { id: 'u', kind: 'user', position: SEVILLA_CENTER },
  { id: 'c', kind: 'cluster', count: 12, position: SEVILLA_CENTER },
  { id: 'c3', kind: 'cluster', count: 3, position: SEVILLA_CENTER },
  { id: 'f', kind: 'flag', position: SEVILLA_CENTER },
  { id: 'l', kind: 'label', position: SEVILLA_CENTER, chip: { title: '4 min', icon: 'walk' } },
];

describe('geometría de marcadores', () => {
  for (const m of everyKind) {
    it(`${m.id}: el anclaje, el desplazamiento y el gráfico son coherentes`, () => {
      const l = layoutMarker(m);
      assert.ok(l.width > 0 && l.height > 0);
      // anclaje fraccionario y centerOffset describen el MISMO punto dentro del conjunto
      const px = l.anchor.x * l.width;
      const py = l.anchor.y * l.height;
      assert.ok(Math.abs(l.centerOffset.x - (l.width / 2 - px)) < 1e-6, `offset x ${l.centerOffset.x} vs ${l.width / 2 - px}`);
      assert.ok(Math.abs(l.centerOffset.y - (l.height / 2 - py)) < 1e-6, `offset y ${l.centerOffset.y} vs ${l.height / 2 - py}`);
      assert.ok(l.anchor.x >= 0 && l.anchor.x <= 1 && l.anchor.y >= 0 && l.anchor.y <= 1);
      // el gráfico y el chip caben dentro del conjunto
      if (m.kind !== 'label' && !l.capCard) {
        assert.ok(l.graphic.x >= -1e-6 && l.graphic.x + l.graphic.w <= l.width + 1e-6, 'gráfico dentro (x)');
        assert.ok(l.graphic.y >= -1e-6 && l.graphic.y + l.graphic.h <= l.height + 1e-6, 'gráfico dentro (y)');
        assert.ok(Math.abs(l.graphic.x + l.graphic.ax - px) < 1e-6 && Math.abs(l.graphic.y + l.graphic.ay - py) < 1e-6, 'el anclaje cae en el punto del gráfico');
      }
      if (l.chip) {
        assert.ok(l.chip.x >= -1e-6 && l.chip.x + l.chip.w <= l.width + 1e-6, 'chip dentro (x)');
        assert.ok(l.chip.y >= -1e-6 && l.chip.y + l.chip.h <= l.height + 1e-6, 'chip dentro (y)');
      }
    });
  }

  it('el coche con cola ancla en la punta; los coches sin cola, en el centro', () => {
    const pin = graphicFor({ id: 'p', kind: 'car', position: SEVILLA_CENTER });
    assert.equal(pin.ay, MARKER_METRICS.carPin.body + MARKER_METRICS.carPin.tail);
    const live = graphicFor({ id: 'l', kind: 'car', variant: 'live', position: SEVILLA_CENTER });
    assert.equal(live.ay, live.h / 2);
  });

  it('la etiqueta («label») se ancla por su centro', () => {
    const l = layoutMarker({ id: 'l', kind: 'label', position: SEVILLA_CENTER, chip: { title: 'A 6 km\nde tu destino' } });
    assert.deepEqual(l.anchor, { x: 0.5, y: 0.5 });
  });

  it('tarjeta de universidad: el anclaje cae en el centro del birrete y el contorno es una ruta cerrada coherente', () => {
    const k = MARKER_METRICS.capCard;
    const m: MapMarkerSpec = { id: 'cap', kind: 'destinationCap', position: SEVILLA_CENTER, chip: { title: 'Universidad\nde Sevilla', side: 'bottom', align: 'center' } };
    const l = layoutMarker(m);
    assert.equal(l.capCard, true);
    assert.ok(l.width >= k.minWidth);
    // el centro del birrete está dentro de la lengüeta
    const ay = l.anchor.y * l.height;
    assert.ok(Math.abs(ay - (k.iconTop + capGlyphHeight(k.iconW) / 2)) < 1e-6);
    assert.ok(ay > 0 && ay < k.tabH);
    // la tarjeta del nombre (dos líneas) cabe debajo de la lengüeta
    assert.ok(l.height > k.tabH + k.padTop + k.padBottom + k.shadowPad);
    const d = capCardPath(l.width, l.height - k.shadowPad);
    assert.match(d, /^M[\d.]+ 0H/);
    assert.ok(d.endsWith('Z'));
    // todos los números son finitos y caen dentro de la silueta
    for (const n of d.match(/-?\d+(?:\.\d+)?/g) ?? []) assert.ok(Number.isFinite(Number(n)));
    // los empalmes y esquinas no se solapan en el ancho mínimo (si no, el trazo retrocede)
    const x0 = (k.minWidth - k.tabW) / 2;
    assert.ok(x0 - k.fillet >= k.radius, 'x0 − empalme ≥ radio de la tarjeta');
    assert.ok(k.tabW >= 2 * k.tabRadius, 'la lengüeta admite el radio superior');
  });

  it('el glifo del birrete conserva su proporción', () => {
    assert.ok(Math.abs(capGlyphHeight(33) - 29.5) < 0.1);
  });

  it('orden de apilado: usuario < paradas < pins < coche < etiqueta', () => {
    assert.ok(defaultZIndex('user') < defaultZIndex('stop'));
    assert.ok(defaultZIndex('stop') < defaultZIndex('pickupA'));
    assert.ok(defaultZIndex('pickupA') < defaultZIndex('car'));
    assert.ok(defaultZIndex('car') < defaultZIndex('label'));
  });
});

describe('tema', () => {
  it('cada tipo de ruta tiene estilo y los tonos de chip devuelven colores hex', () => {
    for (const k of ['route', 'walk', 'alt', 'approach'] as const) assert.ok(ROUTE_STYLE[k].width > 0);
    for (const t of ['brand', 'neutral', 'success', 'warning', 'danger', 'muted'] as const) assert.match(chipToneColor(t), /^#[0-9A-Fa-f]{6}$/);
    assert.match(MAP_COLORS.pin, /^#[0-9A-Fa-f]{6}$/);
  });
});

describe('rutas ilustrativas', () => {
  it('hay rutas y todas decodifican a ≥ 2 puntos que empiezan y acaban en sus lugares', () => {
    assert.ok(SEVILLA_ROAD_ROUTES.length >= 30);
    for (const r of SEVILLA_ROAD_ROUTES) {
      assert.ok(r.points.length >= 2, r.id);
      const first = r.points[0] as MapPoint;
      const last = r.points[r.points.length - 1] as MapPoint;
      assert.ok(distanceMeters(first, sevillaPoint(r.from)) < 60, `${r.id}: inicio a ${distanceMeters(first, sevillaPoint(r.from))} m`);
      assert.ok(distanceMeters(last, sevillaPoint(r.to)) < 60, `${r.id}: final a ${distanceMeters(last, sevillaPoint(r.to))} m`);
      for (const via of r.via) assert.ok(SEVILLA_PLACE_BY_ID[via], `${r.id}: vía desconocida ${via}`);
      assert.ok(r.durationS > 60 && r.distanceM > 500, r.id);
    }
  });

  it('ids únicos y la distancia estimada es coherente con la polilínea (±8 %)', () => {
    const ids = new Set<string>();
    for (const r of SEVILLA_ROAD_ROUTES) {
      assert.ok(!ids.has(r.id), r.id);
      ids.add(r.id);
      const len = polylineLengthMeters(r.points);
      assert.ok(Math.abs(len - r.distanceM) / r.distanceM < 0.08, `${r.id}: polilínea ${Math.round(len)} m vs distanceM ${r.distanceM}`);
    }
  });

  it('polyline: ida y vuelta sin pérdida (1e-5°)', () => {
    const r = sevillaRoadRoute('mairena-universidad');
    const again = decodePolyline(encodePolyline(r.points));
    assert.equal(again.length, r.points.length);
    again.forEach((p, i) => {
      assert.ok(Math.abs(p.lat - (r.points[i] as MapPoint).lat) < 1.1e-5);
      assert.ok(Math.abs(p.lng - (r.points[i] as MapPoint).lng) < 1.1e-5);
    });
    assert.deepEqual(decodePolyline(''), []);
    assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@').map((p) => [p.lat, p.lng]), [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it('roadRouteBetween devuelve la ruta en el sentido pedido (invierte si hace falta)', () => {
    const fwd = roadRouteBetween('mairena-del-aljarafe', 'universidad-de-sevilla');
    const back = roadRouteBetween('universidad-de-sevilla', 'mairena-del-aljarafe');
    assert.ok(fwd && back);
    assert.equal(back.from, 'universidad-de-sevilla');
    assert.deepEqual(back.points[0], fwd.points[fwd.points.length - 1]);
    assert.equal(back.distanceM, fwd.distanceM);
    assert.deepEqual(reverseRoadRoute(back).points, fwd.points);
    assert.equal(roadRouteBetween('carmona', 'gelves'), undefined);
  });

  it('roadRouteLngLat usa [lng, lat] (GeoJSON)', () => {
    const r = sevillaRoadRoute('luis-montoto-universidad');
    const first = roadRouteLngLat(r)[0] as [number, number];
    assert.equal(first[0], (r.points[0] as MapPoint).lng);
    assert.equal(first[1], (r.points[0] as MapPoint).lat);
  });
});
