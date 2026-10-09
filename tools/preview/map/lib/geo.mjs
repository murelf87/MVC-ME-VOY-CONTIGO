// Utilidades geométricas del generador del mapa base ilustrativo de Sevilla (solo Node; sin dependencias).
// Proyección local equirrectangular alrededor de ORIGIN (válida a ±60 km): x = metros al este, y = metros al norte.

export const ORIGIN = { lat: 37.385, lon: -5.99 };
export const KY = 111200;
export const KX = KY * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** [lat, lon] → [x, y] en metros. */
export const toXY = (lat, lon) => [(lon - ORIGIN.lon) * KX, (lat - ORIGIN.lat) * KY];
/** [x, y] → [lat, lon]. */
export const toLL = (x, y) => [ORIGIN.lat + y / KY, ORIGIN.lon + x / KX];

/** Generador pseudoaleatorio determinista (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash entero de varios números → [0, 1). */
export function hash01(...nums) {
  let h = 2166136261;
  for (const n of nums) {
    h ^= Math.floor(n * 1000) | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Ruido de valor 2D suave en [-1, 1]. */
export function makeNoise(seed) {
  const val = (ix, iy) => hash01(ix, iy, seed) * 2 - 1;
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = val(ix, iy);
    const b = val(ix + 1, iy);
    const c = val(ix, iy + 1);
    const d = val(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Longitud de una polilínea [[x,y]…]. */
export function pathLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** Spline Catmull-Rom centrípeta por los puntos dados; `perSeg` muestras por tramo. */
export function catmullRom(pts, perSeg = 8) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1];
    const p1 = P[i];
    const p2 = P[i + 1];
    const p3 = P[i + 2];
    const t0 = 0;
    const t1 = t0 + Math.sqrt(dist(p0, p1) || 1e-6);
    const t2 = t1 + Math.sqrt(dist(p1, p2) || 1e-6);
    const t3 = t2 + Math.sqrt(dist(p2, p3) || 1e-6);
    for (let k = 1; k <= perSeg; k++) {
      const t = t1 + ((t2 - t1) * k) / perSeg;
      const A1 = lerp2(p0, p1, (t1 - t) / (t1 - t0), (t - t0) / (t1 - t0));
      const A2 = lerp2(p1, p2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
      const A3 = lerp2(p2, p3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2));
      const B1 = lerp2(A1, A2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0));
      const B2 = lerp2(A2, A3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1));
      out.push(lerp2(B1, B2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1)));
    }
  }
  return out;
}
const lerp2 = (a, b, wa, wb) => [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb];

/** Remuestrea una polilínea cada `step` metros (conserva extremos). */
export function resample(pts, step) {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = dist(a, b);
    if (d === 0) continue;
    let pos = step - carry;
    while (pos <= d) {
      const t = pos / d;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      pos += step;
    }
    carry = (carry + d) % step;
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.2) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

/** Douglas-Peucker (tolerancia en metros). */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let md = 0;
    let mi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegDist(pts[i], pts[s], pts[e]);
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > tol && mi > 0) {
      keep[mi] = 1;
      stack.push([s, mi], [mi, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function pointSegDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Punto dentro de un polígono (anillo [[x,y]…], par-impar). */
export function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function ringBBox(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** Superficie (m²) de un anillo. */
export function ringArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(s / 2);
}

/** Índice espacial de anillos: `inside(x, y)` en O(1) medio. */
export class RingIndex {
  constructor(rings, cell = 400) {
    this.cell = cell;
    this.rings = rings.map((ring) => ({ ring, bbox: ringBBox(ring) }));
    this.grid = new Map();
    this.rings.forEach((r, id) => {
      const [x0, y0, x1, y1] = r.bbox;
      for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
        for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) {
          const k = cx * 100003 + cy;
          let a = this.grid.get(k);
          if (!a) this.grid.set(k, (a = []));
          a.push(id);
        }
      }
    });
  }

  inside(x, y) {
    const ids = this.grid.get(Math.floor(x / this.cell) * 100003 + Math.floor(y / this.cell));
    if (!ids) return false;
    for (const id of ids) {
      const r = this.rings[id];
      if (x < r.bbox[0] || x > r.bbox[2] || y < r.bbox[1] || y > r.bbox[3]) continue;
      if (inRing(x, y, r.ring)) return true;
    }
    return false;
  }
}

/** Índice de polilíneas: distancia mínima a cualquier tramo (con tope). */
export class LineIndex {
  constructor(lines, cell = 300) {
    this.cell = cell;
    this.segs = [];
    this.grid = new Map();
    for (const l of lines) {
      const half = (l.halfWidth ?? 0) + (l.margin ?? 0);
      for (let i = 1; i < l.pts.length; i++) {
        const id = this.segs.length;
        this.segs.push({ a: l.pts[i - 1], b: l.pts[i], half });
        const x0 = Math.min(l.pts[i - 1][0], l.pts[i][0]) - half;
        const x1 = Math.max(l.pts[i - 1][0], l.pts[i][0]) + half;
        const y0 = Math.min(l.pts[i - 1][1], l.pts[i][1]) - half;
        const y1 = Math.max(l.pts[i - 1][1], l.pts[i][1]) + half;
        for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
          for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) {
            const k = cx * 100003 + cy;
            let a = this.grid.get(k);
            if (!a) this.grid.set(k, (a = []));
            a.push(id);
          }
        }
      }
    }
  }

  /** ¿El punto está a menos de `half` (propio de cada línea) de alguna? */
  near(x, y) {
    const ids = this.grid.get(Math.floor(x / this.cell) * 100003 + Math.floor(y / this.cell));
    if (!ids) return false;
    for (const id of ids) {
      const s = this.segs[id];
      if (pointSegDist([x, y], s.a, s.b) <= s.half) return true;
    }
    return false;
  }
}

/** Blob orgánico (anillo) alrededor de un centro [x,y] con semiejes rx, ry (m), rotación (grados) y ondulación (0..1). */
export function blob(cx, cy, rx, ry, rotDeg = 0, wobble = 0.18, seed = 1, n = 40) {
  const noise = makeNoise(seed);
  const rot = (rotDeg * Math.PI) / 180;
  const ring = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const w = 1 + wobble * (noise(Math.cos(t) * 1.6 + 7.3, Math.sin(t) * 1.6 + 2.1) * 0.8 + noise(Math.cos(t) * 3.7, Math.sin(t) * 3.7) * 0.4);
    const px = Math.cos(t) * rx * w;
    const py = Math.sin(t) * ry * w;
    ring.push([cx + px * Math.cos(rot) - py * Math.sin(rot), cy + px * Math.sin(rot) + py * Math.cos(rot)]);
  }
  return ring;
}

/** Deforma un anillo con ruido (para contornos urbanos orgánicos). Mantiene el número de vértices (tras remuestrear). */
export function wobbleRing(ring, amplitudeM, scaleM, seed, step = 150) {
  const closed = [...ring, ring[0]];
  const pts = resample(closed, step);
  pts.pop();
  const nx = makeNoise(seed);
  const ny = makeNoise(seed + 101);
  return pts.map(([x, y]) => [x + amplitudeM * nx(x / scaleM, y / scaleM), y + amplitudeM * ny(x / scaleM + 31, y / scaleM + 17)]);
}

/** Intersección de dos segmentos; devuelve [x, y, t, u] o null. */
export function segIntersect(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * r[0], a[1] + t * r[1], t, u];
}
