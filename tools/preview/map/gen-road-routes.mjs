#!/usr/bin/env node
// Genera mobile/src/maps/roadRoutesData.ts: rutas ILUSTRATIVAS entre lugares de SEVILLA_PLACES que SIGUEN las carreteras
// dibujadas en el mapa base (los mismos ejes que se ven en la vista previa web), para semillas, pruebas y la vista previa.
//
//   node tools/preview/map/build-basemap.mjs        (una vez: escribe out/road-graph.json)
//   node tools/preview/map/gen-road-routes.mjs      (≈1 s; determinista)
//
// Método: red viaria = las carreteras dibujadas (ROADS de data/sevilla-geometry.mjs) (cruces y enlaces calculados en lib/roadgraph.mjs) → Dijkstra con coste
// por clase de vía (autovía < avenida < calle) → polilínea simplificada (5 m) → codificada (polyline 1e5, ≈ 1 m). El primer y
// el último tramo (del lugar a la red) son conectores rectos y se cuentan aparte. Distancia y duración son ESTIMACIONES sobre un
// dibujo, no datos de navegación: nunca deben presentarse como el resultado de un servicio de rutas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointSegDist, simplify, toLL, toXY } from './lib/geo.mjs';
import { RoadGraph } from './lib/roadgraph.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const GRAPH_JSON = path.join(HERE, 'out', 'road-graph.json');
const PLACES_JSON = path.join(HERE, 'data', 'places.json');
const OUT_TS = path.join(ROOT, 'mobile', 'src', 'maps', 'roadRoutesData.ts');

if (!fs.existsSync(GRAPH_JSON)) {
  console.error('Falta tools/preview/map/out/road-graph.json: ejecuta antes  node tools/preview/map/build-basemap.mjs');
  process.exit(1);
}
const roads = JSON.parse(fs.readFileSync(GRAPH_JSON, 'utf8'));
const places = JSON.parse(fs.readFileSync(PLACES_JSON, 'utf8')).places;
const placeById = new Map(places.map((p) => [p.id, p]));
const roadById = new Map(roads.map((r) => [r.id, r]));
const graph = new RoadGraph(roads.map((r) => ({ id: r.id, cls: r.cls, pts: r.pts })), { snapM: 160 });

// ───────────────────────────── Rutas pedidas ─────────────────────────────
// id: corto y legible; from/to/via: ids de places.json. Todas son intraprovinciales (Sevilla).
const SPECS = [
  { id: 'montequinto-universidad', from: 'montequinto', to: 'universidad-de-sevilla' },
  { id: 'montequinto-dos-hermanas-universidad', from: 'montequinto', via: ['dos-hermanas'], to: 'universidad-de-sevilla' },
  { id: 'dos-hermanas-universidad', from: 'dos-hermanas', to: 'universidad-de-sevilla' },
  { id: 'mairena-universidad', from: 'mairena-del-aljarafe', to: 'universidad-de-sevilla' },
  { id: 'palomares-mairena-sevilla', from: 'palomares-del-rio', via: ['mairena-del-aljarafe'], to: 'centro-de-sevilla' },
  { id: 'palomares-universidad', from: 'palomares-del-rio', to: 'universidad-de-sevilla' },
  { id: 'luis-montoto-universidad', from: 'calle-luis-montoto', to: 'universidad-de-sevilla' },
  { id: 'torre-sevilla-centro', from: 'torre-sevilla', to: 'centro-de-sevilla' },
  { id: 'isla-magica-centro', from: 'isla-magica', to: 'centro-de-sevilla' },
  { id: 'camas-universidad', from: 'camas', to: 'universidad-de-sevilla' },
  { id: 'camas-centro', from: 'camas', to: 'centro-de-sevilla' },
  { id: 'tomares-universidad', from: 'tomares', to: 'universidad-de-sevilla' },
  { id: 'bormujos-universidad', from: 'bormujos', to: 'universidad-de-sevilla' },
  { id: 'san-juan-centro', from: 'san-juan-de-aznalfarache', to: 'centro-de-sevilla' },
  { id: 'gines-centro', from: 'gines', to: 'centro-de-sevilla' },
  { id: 'castilleja-centro', from: 'castilleja-de-la-cuesta', to: 'centro-de-sevilla' },
  { id: 'gelves-universidad', from: 'gelves', to: 'universidad-de-sevilla' },
  { id: 'coria-universidad', from: 'coria-del-rio', to: 'universidad-de-sevilla' },
  { id: 'alcala-universidad', from: 'alcala-de-guadaira', to: 'universidad-de-sevilla' },
  { id: 'la-rinconada-universidad', from: 'la-rinconada', to: 'universidad-de-sevilla' },
  { id: 'la-algaba-universidad', from: 'la-algaba', to: 'universidad-de-sevilla' },
  { id: 'santiponce-universidad', from: 'santiponce', to: 'universidad-de-sevilla' },
  { id: 'valencina-universidad', from: 'valencina-de-la-concepcion', to: 'universidad-de-sevilla' },
  { id: 'espartinas-universidad', from: 'espartinas', to: 'universidad-de-sevilla' },
  { id: 'almensilla-palomares-universidad', from: 'almensilla', via: ['palomares-del-rio'], to: 'universidad-de-sevilla' },
  { id: 'upo-santa-justa', from: 'universidad-pablo-de-olavide', to: 'estacion-santa-justa' },
  { id: 'upo-universidad', from: 'universidad-pablo-de-olavide', to: 'universidad-de-sevilla' },
  { id: 'sevilla-este-universidad', from: 'sevilla-este', to: 'universidad-de-sevilla' },
  { id: 'pino-montano-universidad', from: 'pino-montano', to: 'universidad-de-sevilla' },
  { id: 'bellavista-universidad', from: 'bellavista', to: 'universidad-de-sevilla' },
  { id: 'santa-justa-universidad', from: 'estacion-santa-justa', to: 'universidad-de-sevilla' },
  { id: 'virgen-del-rocio-santa-justa', from: 'hospital-virgen-del-rocio', to: 'estacion-santa-justa' },
  { id: 'valme-virgen-del-rocio', from: 'hospital-virgen-de-valme', to: 'hospital-virgen-del-rocio' },
  { id: 'utrera-universidad', from: 'utrera', to: 'universidad-de-sevilla' },
  { id: 'carmona-universidad', from: 'carmona', to: 'universidad-de-sevilla' },
  { id: 'mairena-del-alcor-universidad', from: 'mairena-del-alcor', to: 'universidad-de-sevilla' },
  { id: 'los-palacios-universidad', from: 'los-palacios-y-villafranca', to: 'universidad-de-sevilla' },
];

// ───────────────────────────── Red principal y ajuste a la red ─────────────────────────────
const comps = graph.components();
let main = 0;
comps.sizes.forEach((s, i) => {
  if (s > comps.sizes[main]) main = i;
});
const inMain = (id) => comps.seen[id] === main;
console.log(`red viaria: ${graph.nodes.length} nodos, ${comps.sizes.length} componentes (principal ${comps.sizes[main]} nodos; resto ${comps.sizes.filter((_, i) => i !== main).join(', ') || '—'})`);

function snap(x, y) {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    if (!inMain(i)) continue;
    const d = Math.hypot(graph.nodes[i][0] - x, graph.nodes[i][1] - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return { id: best, d: bd };
}

// Velocidades medias por clase (m/s): autovía/ronda 80 km/h, avenida 45, calle 30; conector 25 km/h.
const MPS = [22.2, 12.5, 8.3, 6.9];
const CONNECTOR_MPS = 6.9;

const label = (roadId) => {
  const r = roadById.get(roadId);
  return r ? r.ref || r.name || '' : '';
};

function solve(spec) {
  const stops = [spec.from, ...(spec.via ?? []), spec.to].map((id) => {
    const p = placeById.get(id);
    if (!p) throw new Error(`${spec.id}: lugar desconocido ${id}`);
    const xy = toXY(p.lat, p.lng);
    return { id, xy, snap: snap(xy[0], xy[1]) };
  });
  let nodeIds = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const leg = graph.shortest(stops[i].snap.id, stops[i + 1].snap.id);
    if (!leg) throw new Error(`${spec.id}: sin camino entre ${stops[i].id} y ${stops[i + 1].id}`);
    nodeIds.push(...(nodeIds.length ? leg.ids.slice(1) : leg.ids));
  }
  // Elimina los rebotes u,v,u (se entra a un nodo y se vuelve por el mismo sitio).
  const clean = [];
  for (const id of nodeIds) {
    if (clean.length >= 2 && clean[clean.length - 2] === id) clean.pop();
    else clean.push(id);
  }
  nodeIds = clean;

  let roadM = 0;
  let roadS = 0;
  const seq = [];
  for (let i = 1; i < nodeIds.length; i++) {
    const u = nodeIds[i - 1];
    const v = nodeIds[i];
    const e = graph.adj[u].find((q) => q.to === v);
    if (!e) continue;
    roadM += e.w;
    roadS += e.w / MPS[e.cls];
    const l = label(e.road);
    const last = seq[seq.length - 1];
    if (last && last.label === l) last.m += e.w;
    else seq.push({ label: l, m: e.w });
  }
  const roadsUsed = [];
  for (const s of seq) {
    if (!s.label || s.m < 450) continue;
    if (roadsUsed[roadsUsed.length - 1] !== s.label) roadsUsed.push(s.label);
  }

  const pts = [];
  const first = stops[0];
  const lastStop = stops[stops.length - 1];
  const startConn = first.snap.d;
  const endConn = lastStop.snap.d;
  if (startConn > 25) pts.push(first.xy);
  nodeIds.forEach((id) => pts.push(graph.nodes[id]));
  if (endConn > 25) pts.push(lastStop.xy);
  const body = simplify(pts, 5);
  const connectorM = (startConn > 25 ? startConn : 0) + (endConn > 25 ? endConn : 0);
  const distanceM = Math.round(roadM + connectorM);
  const durationS = Math.round(roadS + connectorM / CONNECTOR_MPS);
  return { spec, stops, nodeIds, body, distanceM, durationS, roadsUsed, startConn, endConn, roadM };
}

// ───────────────────────────── Polyline (Google, 1e5) ─────────────────────────────
function encodeNumber(v) {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let out = '';
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return out + String.fromCharCode(n + 63);
}
function encodePolyline(latLng) {
  let plat = 0;
  let plng = 0;
  let s = '';
  for (const [lat, lng] of latLng) {
    const la = Math.round(lat * 1e5);
    const ln = Math.round(lng * 1e5);
    s += encodeNumber(la - plat) + encodeNumber(ln - plng);
    plat = la;
    plng = ln;
  }
  return s;
}

// ───────────────────────────── Verificación y salida ─────────────────────────────
const results = [];
const failures = [];
for (const spec of SPECS) {
  try {
    results.push(solve(spec));
  } catch (e) {
    failures.push(`${spec.id}: ${e.message}`);
  }
}

// Comprobación: (a) todos los nodos del camino están sobre la red dibujada por construcción; (b) la simplificación (Douglas-Peucker,
// 5 m) no separa la polilínea final de ese camino más de la tolerancia. Se mide la distancia de cada nodo del camino original a la
// polilínea simplificada.
const simplifyDeviation = (r) => {
  let worst = 0;
  for (const id of r.nodeIds) {
    const p = graph.nodes[id];
    let best = Infinity;
    for (let i = 1; i < r.body.length; i++) best = Math.min(best, pointSegDist(p, r.body[i - 1], r.body[i]));
    worst = Math.max(worst, best);
  }
  return worst;
};

console.log('\nruta'.padEnd(40), 'km'.padStart(6), 'min'.padStart(5), 'pts'.padStart(5), 'conect(m)'.padStart(10), 'simpl.(m)'.padStart(10), ' vías');
let worstDev = 0;
for (const r of results) {
  const dev = simplifyDeviation(r);
  worstDev = Math.max(worstDev, dev);
  console.log(
    r.spec.id.padEnd(39),
    (r.distanceM / 1000).toFixed(1).padStart(6),
    String(Math.round(r.durationS / 60)).padStart(5),
    String(r.body.length).padStart(5),
    String(Math.round(r.startConn + r.endConn)).padStart(10),
    dev.toFixed(1).padStart(10),
    ' ',
    r.roadsUsed.join(' → '),
  );
  if (dev > 5.5) failures.push(`${r.spec.id}: la simplificación separa la ruta ${dev.toFixed(1)} m del camino sobre la red`);
  if (r.startConn > 1500 || r.endConn > 1500) failures.push(`${r.spec.id}: conector de ${Math.round(Math.max(r.startConn, r.endConn))} m (el lugar está lejos de la red)`);
}
if (failures.length) {
  console.error(`\n✗ ${failures.length} problema(s):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`\n✓ ${results.length} rutas sobre la red dibujada; separación máxima por simplificación: ${worstDev.toFixed(1)} m (tolerancia 5 m)`);

const q = (s) => JSON.stringify(s);
const rows = results.map((r) => {
  const ll = r.body.map(([x, y]) => toLL(x, y));
  const poly = encodePolyline(ll);
  const name = `${placeById.get(r.spec.from).name} → ${placeById.get(r.spec.to).name}`;
  return `  {
    id: ${q(r.spec.id)},
    name: ${q(name)},
    from: ${q(r.spec.from)},
    to: ${q(r.spec.to)},
    via: [${(r.spec.via ?? []).map(q).join(', ')}],
    roads: [${r.roadsUsed.map(q).join(', ')}],
    distanceM: ${r.distanceM},
    durationS: ${r.durationS},
    polyline: ${q(poly)},
  },`;
});

const ts = `/**
 * GENERADO por tools/preview/map/gen-road-routes.mjs (a partir de las carreteras dibujadas en el mapa base). NO editar a mano.
 * Rutas ILUSTRATIVAS: siguen los ejes del mapa ilustrativo de la vista previa, no una red viaria real. Distancia y duración son
 * estimaciones (autovía 80 km/h, avenida 45 km/h, calle 30 km/h). Úsalas como semilla/pruebas; nunca como resultado de un
 * servicio de rutas. Se leen con \`SEVILLA_ROAD_ROUTES\` (roadRoutes.ts).
 */
import type { SevillaPlaceId } from './places';

export interface RoadRouteRecord {
  readonly id: string;
  readonly name: string;
  readonly from: SevillaPlaceId;
  readonly to: SevillaPlaceId;
  readonly via: readonly SevillaPlaceId[];
  /** Vías principales del recorrido, en orden (referencia o nombre). */
  readonly roads: readonly string[];
  readonly distanceM: number;
  readonly durationS: number;
  /** Polilínea codificada (Google polyline, precisión 1e5). */
  readonly polyline: string;
}

export const SEVILLA_ROAD_ROUTES_DATA = [
${rows.join('\n')}
] as const satisfies readonly RoadRouteRecord[];

export type SevillaRoadRouteId = (typeof SEVILLA_ROAD_ROUTES_DATA)[number]['id'];
`;
fs.writeFileSync(OUT_TS, ts);
console.log(`roadRoutesData.ts: ${results.length} rutas, ${(ts.length / 1024).toFixed(1)} KB → ${path.relative(ROOT, OUT_TS)}`);
