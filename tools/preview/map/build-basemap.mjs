#!/usr/bin/env node
// Construye el mapa base ILUSTRATIVO de Sevilla para la vista previa web:  mobile/web-stubs/map-data/sevilla-basemap.js
//
//   tools/preview/map/fetch-sources.sh          (una vez: descarga es-atlas de npm a la caché)
//   node tools/preview/map/build-basemap.mjs    (≈10-20 s; determinista: dos ejecuciones dan el mismo fichero)
//
// Entradas:  data/sevilla-geometry.mjs (río, parques, contornos urbanos, barrios, carreteras: dibujo a mano),
//            data/places.json (rótulos), es-atlas (límites de provincia y municipios del IGN, caché).
// Salidas:   mobile/web-stubs/map-data/sevilla-basemap.js (capas empaquetadas, ver lib/pack.mjs)
//            tools/preview/map/out/road-graph.json (red viaria para gen-road-routes.mjs)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITY_OUTLINE_KM, DISTRICTS, PARKS, PEACH_ZONES, RIVER_BRANCHES, ROADS, TOWNS } from './data/sevilla-geometry.mjs';
import { loadEsAtlas } from './lib/esatlas.mjs';
import { blob, catmullRom, hash01, LineIndex, makeNoise, pathLength, resample, RingIndex, ringArea, ringBBox, simplify, toLL, toXY, wobbleRing, inRing, KX, KY } from './lib/geo.mjs';
import { pack } from './lib/pack.mjs';
import { generateStreets } from './lib/streets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const CACHE = process.env.MVC_MAP_CACHE ?? path.join(os.tmpdir(), 'mvc-map-cache');
const OUT_JS = path.join(ROOT, 'mobile', 'web-stubs', 'map-data', 'sevilla-basemap.js');
const OUT_GRAPH = path.join(HERE, 'out', 'road-graph.json');
const places = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'places.json'), 'utf8')).places;

const llRing = (ring) => ring.map(([x, y]) => {
  const [lat, lon] = toLL(x, y);
  return [lon, lat];
});
const xyRing = (pts) => pts.map(([lat, lon]) => toXY(lat, lon));

// ───────────────────────────── Río ─────────────────────────────
const riverChunks = []; // { pts: [[x,y]…] densos, w, branch }
const riverLines = []; // para máscara de agua
RIVER_BRANCHES.forEach((b, bi) => {
  const ctrl = b.pts.map(([lat, lon]) => toXY(lat, lon));
  const widths = b.pts.map((p) => p[2]);
  const dense = resample(catmullRom(ctrl, 10), 45);
  // anchura por vértice: interpolación lineal por longitud de arco sobre los puntos de control
  const cum = [0];
  for (let i = 1; i < ctrl.length; i++) cum.push(cum[i - 1] + Math.hypot(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1]));
  const total = cum[cum.length - 1];
  const widthAt = (s) => {
    for (let i = 1; i < cum.length; i++) {
      if (s <= cum[i]) {
        const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        return widths[i - 1] + (widths[i] - widths[i - 1]) * t;
      }
    }
    return widths[widths.length - 1];
  };
  // posición de arco aproximada de cada vértice denso (proyección sobre la dense acumulada)
  let acc = 0;
  const denseS = dense.map((p, i) => {
    if (i) acc += Math.hypot(p[0] - dense[i - 1][0], p[1] - dense[i - 1][1]);
    return acc;
  });
  const scale = total / (acc || 1);
  const CH = 4;
  for (let i = 0; i < dense.length - 1; i += CH) {
    const pts = dense.slice(i, Math.min(dense.length, i + CH + 1));
    const w = widthAt(denseS[Math.min(dense.length - 1, i + 2)] * scale);
    riverChunks.push({ pts, w: Math.round(w), branch: bi });
    riverLines.push({ pts, halfWidth: w / 2, margin: 16 });
  }
});
const waterIndex = new LineIndex(riverLines, 400);

// ───────────────────────────── Zonas urbanas ─────────────────────────────
const cityRing = wobbleRing(CITY_OUTLINE_KM.map(([x, y]) => [x * 1000, y * 1000]), 260, 1500, 5, 160);
const townRings = TOWNS.map(([id, lat, lon, rx, ry, rot], i) => {
  const [cx, cy] = toXY(lat, lon);
  return { id, ring: blob(cx, cy, rx * 1000, ry * 1000, rot, 0.2, 100 + i, 44) };
});
const urbanRings = [{ id: 'sevilla', ring: cityRing, kind: 0 }, ...townRings.map((t) => ({ ...t, kind: 1 }))];
const urbanIndex = new RingIndex(urbanRings.map((u) => u.ring), 500);

// ───────────────────────────── Parques ─────────────────────────────
const parkRings = PARKS.map(([id, , lat, lon, rx, ry, rot, wob], i) => {
  const [cx, cy] = toXY(lat, lon);
  return { id, ring: blob(cx, cy, rx * 1000, ry * 1000, rot, wob, 300 + i, 36), big: 1 };
});
const casco = DISTRICTS.filter((d) => ['casco', 'triana', 'macarena'].includes(d.id)).map((d) => xyRing(d.pts));
const cascoIndex = new RingIndex(casco, 500);
const pocketRings = [];
{
  const all = urbanRings.flatMap((u) => u.ring);
  const [x0, y0, x1, y1] = ringBBox(all);
  const CELL = 620;
  for (let gx = Math.floor(x0 / CELL); gx <= Math.ceil(x1 / CELL); gx++) {
    for (let gy = Math.floor(y0 / CELL); gy <= Math.ceil(y1 / CELL); gy++) {
      const x = (gx + hash01(gx, gy, 1) * 0.8 + 0.1) * CELL;
      const y = (gy + hash01(gx, gy, 2) * 0.8 + 0.1) * CELL;
      if (!urbanIndex.inside(x, y)) continue;
      const dense = cascoIndex.inside(x, y);
      if (hash01(gx, gy, 3) > (dense ? 0.3 : 0.62)) continue;
      if (waterIndex.near(x, y)) continue;
      const rx = 70 + hash01(gx, gy, 4) * 150;
      const ry = 55 + hash01(gx, gy, 5) * 125;
      pocketRings.push({ id: `p${gx}_${gy}`, ring: blob(x, y, rx, ry, hash01(gx, gy, 6) * 180, 0.28, gx * 31 + gy, 22), big: 0 });
    }
  }
}
const allParks = [...parkRings, ...pocketRings];
const parkIndex = new RingIndex(allParks.map((p) => p.ring), 400);

// ───────────────────────────── Campo ─────────────────────────────
// Manchas verdes pálidas (olivar, cultivos, vegetación de ribera) entre las poblaciones: dan al mapa la variación tonal de
// las láminas. Reparto procedural y determinista, sin significado cartográfico (mapa ilustrativo): no marcan parcelas reales.
const agriRings = [];
{
  const [xa, ya] = toXY(37.56, -6.2);
  const [xb, yb] = toXY(37.1, -5.5);
  const CELL = 2100;
  for (let gx = Math.floor(Math.min(xa, xb) / CELL); gx <= Math.ceil(Math.max(xa, xb) / CELL); gx++) {
    for (let gy = Math.floor(Math.min(ya, yb) / CELL); gy <= Math.ceil(Math.max(ya, yb) / CELL); gy++) {
      const x = (gx + hash01(gx, gy, 21) * 0.7 + 0.15) * CELL;
      const y = (gy + hash01(gx, gy, 22) * 0.7 + 0.15) * CELL;
      if (hash01(gx, gy, 23) > 0.72) continue;
      const rx = 450 + hash01(gx, gy, 24) * 1000;
      const ry = 350 + hash01(gx, gy, 25) * 800;
      const rot = hash01(gx, gy, 26) * 180;
      // fuera de las zonas urbanas: el centro y cuatro puntos del contorno
      const probe = [[0, 0], [rx * 0.7, 0], [-rx * 0.7, 0], [0, ry * 0.7], [0, -ry * 0.7]];
      const inUrban = probe.filter(([dx, dy]) => urbanIndex.inside(x + dx, y + dy)).length;
      if (inUrban >= 2 || waterIndex.near(x, y)) continue;
      agriRings.push({ id: `a${gx}_${gy}`, ring: blob(x, y, rx, ry, rot, 0.3, gx * 17 + gy * 3, 30) });
    }
  }
}

// ───────────────────────────── Carreteras ─────────────────────────────
const roadFeatures = ROADS.map((r) => {
  let ctrl = r.pts.map(([lat, lon]) => toXY(lat, lon));
  if (r.loop) {
    // bucle: se envuelve para que el spline sea suave en la unión
    const core = ctrl.slice(0, -1);
    const wrapped = [...core.slice(-3), ...core, ...core.slice(0, 3)];
    const sm = resample(catmullRom(wrapped, 8), 90);
    const start = sm.findIndex((p) => Math.hypot(p[0] - core[0][0], p[1] - core[0][1]) < 60);
    const end = sm.length - 1 - [...sm].reverse().findIndex((p) => Math.hypot(p[0] - core[0][0], p[1] - core[0][1]) < 60);
    ctrl = sm.slice(Math.max(0, start), Math.max(start + 2, end) + 1);
    ctrl[ctrl.length - 1] = ctrl[0];
  } else {
    ctrl = resample(catmullRom(ctrl, 8), 90);
  }
  return { id: r.id, ref: r.ref ?? '', name: r.name ?? '', cls: r.cls, pts: ctrl };
});

// ───────────────────────────── Callejero local ─────────────────────────────
const cityIndex = new RingIndex([cityRing], 500);
const lodLayers = [[], [], []];
const claimed = [];
let claimedIndex = new RingIndex([], 500);
const statsByZone = [];
const runZone = (id, ring, params, inZone) => {
  const t0 = Date.now();
  const { lod } = generateStreets({
    ring,
    allowed: (x, y) => inZone(x, y) && !claimedIndex.inside(x, y) && !waterIndex.near(x, y) && !parkIndex.inside(x, y),
    ...params,
  });
  lod.forEach((list, k) => lodLayers[k].push(...list));
  statsByZone.push([id, lod.map((l) => l.length).join('/'), `${Date.now() - t0} ms`]);
  claimed.push(ring);
  claimedIndex = new RingIndex(claimed, 500);
};

for (const d of DISTRICTS) {
  const ring = xyRing(d.pts);
  const idx = new RingIndex([ring], 400);
  runZone(d.id, ring, { theta: d.theta, spacing: d.spacing, warp: d.warp, gap: d.gap, jitter: d.jitter, seed: 40 + DISTRICTS.indexOf(d) }, (x, y) => idx.inside(x, y));
}
runZone('ciudad', cityRing, { theta: -4, spacing: 86, warp: 0.34, gap: 0.14, jitter: 0.08, seed: 7 }, (x, y) => cityIndex.inside(x, y));
townRings.forEach((t, i) => {
  const idx = new RingIndex([t.ring], 400);
  const theta = Math.floor(hash01(i, 9) * 160) - 80;
  const spacing = 78 + Math.floor(hash01(i, 10) * 24);
  runZone(t.id, t.ring, { theta, spacing, warp: 0.32, gap: 0.16, jitter: 0.06, seed: 200 + i }, (x, y) => idx.inside(x, y));
});

// ───────────────────────────── es-atlas (provincia y municipios) ─────────────────────────────
const atlas = loadEsAtlas(CACHE);
const provinceLines = atlas.province.polygons.flatMap((poly) => poly.map((ring) => ring));
const muniLines = atlas.municipalities.flatMap((m) => m.polygons.flatMap((poly) => poly.map((ring) => ring)));

// ───────────────────────────── Rótulos ─────────────────────────────
const placeLabels = places
  .filter((p) => p.label)
  .map((p) => {
    const at = p.label.at ?? [p.lat, p.lng];
    return { n: p.label.wrap ?? p.name, id: p.id, kind: p.kind, lat: at[0], lon: at[1], r: p.label.rank, z: p.label.minZoom, zx: p.label.maxZoom ?? 99 };
  });
const havePlace = new Set(places.map((p) => p.name.toLowerCase()));
const muniLabels = [];
for (const m of atlas.municipalities) {
  if (havePlace.has(m.name.toLowerCase())) continue;
  let best = null;
  for (const poly of m.polygons) {
    const ring = poly[0];
    const area = ringArea(ring.map(([lon, lat]) => [(lon - -5.99) * KX, (lat - 37.385) * KY])) / 1e6;
    if (!best || area > best.area) best = { ring, area };
  }
  if (!best) continue;
  let sx = 0;
  let sy = 0;
  for (const [lon, lat] of best.ring) {
    sx += lon;
    sy += lat;
  }
  const lon = sx / best.ring.length;
  const lat = sy / best.ring.length;
  const minZoom = best.area >= 300 ? 9 : best.area >= 120 ? 9.8 : best.area >= 50 ? 10.6 : 11.4;
  muniLabels.push({ n: m.name, id: `mu-${m.id}`, kind: 'municipio', lat: +lat.toFixed(5), lon: +lon.toFixed(5), r: 3, z: minZoom, zx: 99 });
}

// Escudos de carretera: anclas cada ~4,5 km a lo largo de cada vía con referencia
const shields = [];
for (const r of roadFeatures) {
  if (!r.ref) continue;
  const len = pathLength(r.pts);
  const n = Math.max(1, Math.round(len / 4500));
  const dense = resample(r.pts, 60);
  for (let k = 0; k < n; k++) {
    const target = ((k + 0.5) / n) * len;
    let acc = 0;
    for (let i = 1; i < dense.length; i++) {
      acc += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
      if (acc >= target) {
        const [lat, lon] = toLL(dense[i][0], dense[i][1]);
        shields.push({ ref: r.ref, lat: +lat.toFixed(5), lon: +lon.toFixed(5) });
        break;
      }
    }
  }
}

// ───────────────────────────── Capas y empaquetado ─────────────────────────────
const lineFeat = (pts) => ({ parts: [llRing(pts)] });
const layers = [
  { id: 'province', kind: 'line', features: provinceLines.map((ring) => ({ parts: [ring] })) },
  { id: 'munis', kind: 'line', features: muniLines.map((ring) => ({ parts: [ring] })) },
  { id: 'agri', kind: 'poly', features: agriRings.map((a) => ({ parts: [llRing(a.ring)] })) },
  { id: 'urban', kind: 'poly', features: urbanRings.map((u) => ({ parts: [llRing(u.ring)] })), props: { k: urbanRings.map((u) => u.kind) } },
  {
    id: 'peach',
    kind: 'poly',
    features: PEACH_ZONES.map((pts) => ({ parts: [pts.map(([lat, lon]) => [lon, lat])] })),
  },
  {
    id: 'green',
    kind: 'poly',
    features: allParks.map((p) => ({ parts: [llRing(p.ring)] })),
    props: { big: allParks.map((p) => p.big) },
  },
  { id: 'river', kind: 'line', features: riverChunks.map((c) => lineFeat(c.pts)), props: { w: riverChunks.map((c) => c.w), b: riverChunks.map((c) => c.branch) } },
  {
    id: 'roads',
    kind: 'line',
    features: roadFeatures.map((r) => lineFeat(r.pts)),
    props: { c: roadFeatures.map((r) => r.cls), ref: roadFeatures.map((r) => r.ref), nm: roadFeatures.map((r) => r.name) },
  },
  ...lodLayers.map((list, k) => ({ id: `st${k}`, kind: 'line', features: list.map((pts) => lineFeat(pts)) })),
];
const { meta, data } = pack(layers);
meta.labels = { places: [...placeLabels, ...muniLabels], shields };
meta.riverName = 'Río Guadalquivir';
meta.attribution = '© IGN (límites) · Mapa ilustrativo';
meta.layers.forEach((l) => delete l.points);

fs.mkdirSync(path.dirname(OUT_JS), { recursive: true });
const b64 = data.toString('base64');
const js = `// GENERADO por tools/preview/map/build-basemap.mjs — NO editar a mano. Mapa base ILUSTRATIVO de Sevilla (vista previa web).\n// Datos: dibujo a mano (tools/preview/map/data), límites de es-atlas (© Instituto Geográfico Nacional, CC BY 4.0). Ver docs/MAPS.md.\nexport const BASEMAP_META = ${JSON.stringify(meta)};\nexport const BASEMAP_DATA = '${b64}';\n`;
fs.writeFileSync(OUT_JS, js);

fs.mkdirSync(path.dirname(OUT_GRAPH), { recursive: true });
fs.writeFileSync(OUT_GRAPH, JSON.stringify(roadFeatures.map((r) => ({ id: r.id, cls: r.cls, name: r.name, ref: r.ref, pts: r.pts.map(([x, y]) => [Math.round(x), Math.round(y)]) }))));

console.log(`sevilla-basemap.js: ${(js.length / 1048576).toFixed(2)} MB (datos ${(data.length / 1024).toFixed(0)} KB, ${meta.totalPoints} puntos)`);
console.log('capas:', meta.layers.map((l) => `${l.id}=${l.n}`).join(' '));
console.log('callejero por zona (lod0/lod1/lod2):');
for (const row of statsByZone) console.log('  ', row.join('  '));
