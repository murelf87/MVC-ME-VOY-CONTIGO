// Generador determinista de callejero local ILUSTRATIVO: una retícula deformada (rejilla con nodos desplazados, ruido de
// baja frecuencia, tramos que faltan y calles ligeramente curvas) recortada a una zona permitida. No reproduce calles reales.
import { hash01, makeNoise, simplify } from './geo.mjs';

/**
 * @param opts.ring      anillo [[x,y]…] (m) de la zona
 * @param opts.allowed   (x, y) => boolean: dentro de lo urbanizable (no agua, no parque, no zonas ya cubiertas)
 * @param opts.theta     orientación de la rejilla (grados)
 * @param opts.spacing   distancia entre calles (m)
 * @param opts.warp      deformación (fracción del espaciado)
 * @param opts.gap       probabilidad de que falte un tramo (0..1)
 * @param opts.seed      semilla
 * @returns { lod: [Polyline[], Polyline[], Polyline[]] } polilíneas [[x,y]…] en metros
 */
export function generateStreets({ ring, allowed, theta, spacing: s, warp = 0.3, gap = 0.15, seed = 1, jitter = 0.16 }) {
  const th = (theta * Math.PI) / 180;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const toUV = (x, y) => [x * c + y * sn, -x * sn + y * c];
  const fromUV = (u, v) => [u * c - v * sn, u * sn + v * c];

  let umin = Infinity;
  let umax = -Infinity;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const [x, y] of ring) {
    const [u, v] = toUV(x, y);
    if (u < umin) umin = u;
    if (u > umax) umax = u;
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }
  const i0 = Math.floor(umin / s) - 1;
  const i1 = Math.ceil(umax / s) + 1;
  const j0 = Math.floor(vmin / s) - 1;
  const j1 = Math.ceil(vmax / s) + 1;

  const n1 = makeNoise(seed * 7 + 1);
  const n2 = makeNoise(seed * 7 + 2);
  const nc = makeNoise(seed * 7 + 3);
  const L = s * 4.5;
  const cache = new Map();
  const node = (i, j) => {
    const key = i * 100003 + j;
    let p = cache.get(key);
    if (!p) {
      const u = (i + (hash01(i, j, seed, 11) - 0.5) * 2 * jitter) * s;
      const v = (j + (hash01(i, j, seed, 12) - 0.5) * 2 * jitter) * s;
      let [x, y] = fromUV(u, v);
      x += warp * s * n1(x / L, y / L);
      y += warp * s * n2(x / L + 19, y / L + 7);
      p = [x, y];
      cache.set(key, p);
    }
    return p;
  };

  const lodOf = (k) => (k % 4 === 0 ? 0 : k % 2 === 0 ? 1 : 2);
  const gapFor = (lod) => gap * (lod === 0 ? 0.35 : lod === 1 ? 0.7 : 1);
  const out = [[], [], []];

  const segmentSamples = (a, b, bend) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nSeg = Math.max(2, Math.round(len / 38));
    const nx = -(b[1] - a[1]) / (len || 1);
    const ny = (b[0] - a[0]) / (len || 1);
    const pts = [];
    for (let k = 0; k <= nSeg; k++) {
      const t = k / nSeg;
      const off = Math.sin(Math.PI * t) * bend * len;
      pts.push([a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + ny * off]);
    }
    return pts;
  };

  const flush = (lod, run) => {
    if (run.length >= 2) out[lod].push(simplify(run, 1.2));
  };

  // familia A: calles de índice i que recorren j; familia B: calles de índice j que recorren i
  for (const fam of [0, 1]) {
    const aMin = fam === 0 ? i0 : j0;
    const aMax = fam === 0 ? i1 : j1;
    const bMin = fam === 0 ? j0 : i0;
    const bMax = fam === 0 ? j1 : i1;
    for (let a = aMin; a <= aMax; a++) {
      const lod = lodOf(a);
      const g = gapFor(lod);
      let run = [];
      for (let b = bMin; b < bMax; b++) {
        const p = fam === 0 ? node(a, b) : node(b, a);
        const q = fam === 0 ? node(a, b + 1) : node(b + 1, a);
        const present = hash01(a, b, seed, 21 + fam) >= g;
        if (!present) {
          flush(lod, run);
          run = [];
          continue;
        }
        const bend = (nc(p[0] / 90 + fam * 5.3, p[1] / 90) * 0.5) * 0.14;
        const samples = segmentSamples(p, q, bend);
        for (let k = 0; k < samples.length; k++) {
          const sp = samples[k];
          if (allowed(sp[0], sp[1])) {
            if (run.length === 0 || k > 0) run.push(sp);
          } else {
            flush(lod, run);
            run = [];
          }
        }
      }
      flush(lod, run);
    }
  }
  return { lod: out };
}
