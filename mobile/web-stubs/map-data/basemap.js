// Decodificador del mapa base ILUSTRATIVO de Sevilla (vista previa web). Los datos empaquetados están en sevilla-basemap.js
// (generado por tools/preview/map/build-basemap.mjs). Aquí se convierten a coordenadas Web Mercator normalizadas (0..1) una sola
// vez y por capa (decodificación perezosa), con la caja de cada rasgo precalculada para recortar al dibujar.
import { BASEMAP_DATA, BASEMAP_META } from './sevilla-basemap';

const PI = Math.PI;
export const mercX = (lon) => (lon + 180) / 360;
export function mercY(lat) {
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * PI);
}
export const lonOf = (x) => x * 360 - 180;
export const latOf = (y) => (Math.atan(Math.sinh(PI * (1 - 2 * y))) * 180) / PI;

let bytes = null;
function bytesOf() {
  if (!bytes) {
    const bin = atob(BASEMAP_DATA);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

const layerCache = new Map();

/** Invierte el anillo (pares x, y) si su área con signo es negativa → todos los anillos quedan con el mismo sentido. */
function orient(arr) {
  const n = arr.length / 2;
  let area = 0;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    area += arr[k * 2] * arr[j * 2 + 1] - arr[j * 2] * arr[k * 2 + 1];
  }
  if (area >= 0) return;
  for (let a = 0, b = n - 1; a < b; a++, b--) {
    const tx = arr[a * 2];
    const ty = arr[a * 2 + 1];
    arr[a * 2] = arr[b * 2];
    arr[a * 2 + 1] = arr[b * 2 + 1];
    arr[b * 2] = tx;
    arr[b * 2 + 1] = ty;
  }
}

/** Capa decodificada: { kind, features: [{ parts: Float64Array[], bbox: [x0, y0, x1, y1], i }], props } o null. */
export function getLayer(id) {
  if (layerCache.has(id)) return layerCache.get(id);
  const meta = BASEMAP_META.layers.find((l) => l.id === id);
  if (!meta) {
    layerCache.set(id, null);
    return null;
  }
  const { q, x0, y0 } = BASEMAP_META;
  const buf = bytesOf();
  let pos = meta.from;
  const readVarint = () => {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = buf[pos++];
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return result;
  };
  const unzig = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);
  let x = 0;
  let y = 0;
  const features = [];
  for (let i = 0; i < meta.n; i++) {
    const nParts = readVarint();
    const parts = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let p = 0; p < nParts; p++) {
      const n = readVarint();
      const arr = new Float64Array(n * 2);
      for (let k = 0; k < n; k++) {
        x += unzig(readVarint());
        y += unzig(readVarint());
        const mx = mercX(x0 + x / q);
        const my = mercY(y0 + y / q);
        arr[k * 2] = mx;
        arr[k * 2 + 1] = my;
        if (mx < minX) minX = mx;
        if (mx > maxX) maxX = mx;
        if (my < minY) minY = my;
        if (my > maxY) maxY = my;
      }
      // Todos los anillos de relleno con el mismo sentido: así las superposiciones se UNEN con la regla «nonzero»
      // (con «evenodd» dos manchas solapadas se anulan y salen rayas).
      if (meta.kind === 'poly') orient(arr);
      parts.push(arr);
    }
    features.push({ parts, bbox: [minX, minY, maxX, maxY], i });
  }
  const layer = { kind: meta.kind, features, props: meta.props || {} };
  layerCache.set(id, layer);
  return layer;
}

let labels = null;
/** Rótulos (en Mercator normalizado): { places: [{ name, id, kind, p: [x, y], rank, minZoom, maxZoom }], shields: [{ ref, p }] }. */
export function getLabels() {
  if (labels) return labels;
  const src = BASEMAP_META.labels;
  labels = {
    places: src.places.map((r) => ({ name: r.n, id: r.id, kind: r.kind, p: [mercX(r.lon), mercY(r.lat)], rank: r.r, minZoom: r.z, maxZoom: r.zx })),
    shields: src.shields.map((s) => ({ ref: s.ref, p: [mercX(s.lon), mercY(s.lat)] })),
  };
  return labels;
}

let rivers = null;
/** Cauce continuo por rama (para rotular «Río Guadalquivir» a lo largo del río): [{ branch, parts: Float64Array }]. */
export function getRiverPaths() {
  if (rivers) return rivers;
  const layer = getLayer('river');
  const byBranch = new Map();
  if (layer) {
    for (const f of layer.features) {
      const b = layer.props.b[f.i];
      const arr = f.parts[0];
      let list = byBranch.get(b);
      if (!list) byBranch.set(b, (list = []));
      for (let k = list.length ? 1 : 0; k < arr.length / 2; k++) list.push(arr[k * 2], arr[k * 2 + 1]);
    }
  }
  rivers = [...byBranch.entries()].sort((a, b) => a[0] - b[0]).map(([branch, pts]) => ({ branch, pts: Float64Array.from(pts) }));
  return rivers;
}

export const BASEMAP_INFO = { name: BASEMAP_META.riverName, attribution: BASEMAP_META.attribution };
