#!/usr/bin/env node
// Comparador pantalla a pantalla: RENDER de la app (vista previa web) frente al DISEÑO aprobado.
//
//   node tools/design/compare.mjs --list
//   node tools/design/compare.mjs --screen 11                 # 11 (y todas sus variantes si las tiene: 13 → 13a y 13b)
//   node tools/design/compare.mjs --screen 13 --variant b
//   node tools/design/compare.mjs --all
//   node tools/design/compare.mjs --route TripResults --params '{"from":"sevilla"}' --profile passenger --screen 11   # a mano
//   node tools/design/compare.mjs --geometry [--screen N]     # solo mide el recuadro de pantalla de cada diseño (sin renderizar)
//
// Salida (design/out/compare/):  <NN><v>.png = [diseño | render | superposición 50 % | mapa de diferencias]
//                                <NN><v>.json = métricas, <NN><v>.render@2x.png, <NN><v>.design@2x.png, summary.{json,md} (varias pantallas)
// Documentación completa: tools/design/README.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureHeavyLock } from '../preview/lib/heavy.mjs';
import { spawnSync } from 'node:child_process';
import { ARTIFACT, ARTIFACT_URL, findAppFrame, lastBuildFailure, launchChromium, settleApp, sleep, viewerUrl, waitAppReady, watchNetwork } from '../preview/lib/pw.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DESIGN = path.join(ROOT, 'design');
const VIEW_W = 393;
const VIEW_H_DEFAULT = 852;

// ───────────────────────────── CLI ─────────────────────────────
const VALUE_FLAGS = new Set([
  'screen', 'variant', 'url', 'out', 'route', 'params', 'profile', 'seed', 'clock', 'perm', 'device', 'height', 'inner',
  'fail-under-ssim', 'timeout', 'settle-ms', 'min-wait', 'scenarios', 'wait-for', 'design',
]);
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      o._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const key = (eq > 0 ? a.slice(2, eq) : a.slice(2)).trim();
    if (eq > 0) o[key] = a.slice(eq + 1);
    else if (VALUE_FLAGS.has(key)) o[key] = argv[++i];
    else o[key] = true;
  }
  return o;
}

const HELP = `Comparador diseño ↔ app (vista previa)

  node tools/design/compare.mjs --list                          lista las pantallas del diseño y si tienen escenario
  node tools/design/compare.mjs --screen 11 [--variant b]       compara una pantalla (13 → 13a y 13b; 13b → solo esa)
  node tools/design/compare.mjs --all                           compara todas las que tengan escenario (un solo navegador)
  node tools/design/compare.mjs --geometry [--screen N]         mide el recuadro de pantalla del diseño (sin renderizar)
  node tools/design/compare.mjs --export-design [--screen N|--all]   escribe design/out/screens-pt/<id>.png: SOLO la pantalla del diseño (sin bisel) a 393 pt @2x
  node tools/design/compare.mjs --route Name [--params '{…}'] [--profile passenger] [--screen 11]   ruta a mano

Opciones:
  --dev                  atajo para el servidor de desarrollo único (Metro, recarga en caliente): --url http://localhost:8081 (o $MVC_DEV_URL)
                         --inject-shell, y avisa de los errores del bundle (fichero y mensaje). Arráncalo con tools/preview/dev-server.sh start
  --url <url>            por defecto dist-preview/mvc-preview.html (file://). Admite un servidor de desarrollo con --inject-shell
  --profile new|passenger|driver|admin   --seed <s>   --clock <ISO>   --perm ask|granted|denied|blocked (def. granted)   --device iphone15|…
  --height <pt>          altura del viewport (si no, la del diseño: el recuadro de pantalla del recorte medido)
  --inner x,y,w,h        recuadro de pantalla del diseño en píxeles de la LÁMINA original (si la medida automática falla; ver --geometry)
  --scenarios <dir>      def. design/scenarios        --out <dir>  def. design/out/compare
  --wait-for <texto|css> espera a que aparezca ese texto/selector antes de capturar
  --fresh                recarga la página para cada pantalla (aislamiento total; por defecto se reutiliza)
  --fail-under-ssim <n>  sale con código 2 si alguna pantalla queda por debajo
  --timeout <ms> (def. 60000)   --settle-ms <ms> (def. 12000)   --min-wait <ms> (def. 450)
  --no-lock              no pedir /tmp/mvc-heavy.lock (solo si ya lo tienes)   --json   salida JSON por pantalla   --quiet
  --stale-ok             comparar aunque la última compilación haya fallado (el HTML es antiguo; por defecto se rechaza)
`;

// ───────────────────────────── Diseño y escenarios ─────────────────────────────
function loadManifest() {
  const p = path.join(DESIGN, 'manifest.json');
  if (!fs.existsSync(p)) throw new Error(`Falta ${rel(p)}. Regenera el material de diseño con tools/design/slice_boards.py.`);
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  return m.screens ?? [];
}
const rel = (p) => path.relative(ROOT, p) || '.';

function selectScreens(all, args) {
  const want = args.screen !== undefined && args.screen !== true ? String(args.screen).toLowerCase() : null;
  let list = all;
  if (want) {
    const exact = all.filter((s) => s.screen.toLowerCase() === want);
    const byNumber = all.filter((s) => String(s.number) === String(Number(want)) || s.screen.slice(0, 2) === want.padStart(2, '0'));
    list = exact.length ? exact : byNumber;
    if (!list.length) throw new Error(`No existe la pantalla «${args.screen}» en design/manifest.json. Usa --list.`);
  }
  if (args.variant) list = list.filter((s) => s.variant === String(args.variant).toLowerCase());
  return list;
}

function scenarioPath(dir, shot) {
  for (const name of [`${shot.screen}.json`, `${String(shot.number).padStart(2, '0')}${shot.variant}.json`, `${String(shot.number).padStart(2, '0')}.json`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function readScenario(p) {
  try {
    const sc = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!sc || typeof sc !== 'object' || typeof sc.route !== 'string') throw new Error('falta «route» (string)');
    return sc;
  } catch (e) {
    throw new Error(`Escenario inválido ${rel(p)}: ${e.message}`);
  }
}

// ───────────────────────────── Código que corre DENTRO de Chromium (página auxiliar) ─────────────────────────────
// Todo el tratamiento de imagen se hace con canvas en una página auxiliar: así el script no necesita ninguna dependencia npm.
/* eslint-disable */
function helperMain() {
  async function decode(b64) {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return { canvas: c, w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
  }
  const median = (a) => {
    const s = a.slice().sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };

  // ── Geometría. Se mide sobre la LÁMINA ORIGINAL (design/boards), no sobre el recorte: el recorte de slice_boards.py corta a veces
  // por dentro de la pantalla (arriba o abajo) y entonces el borde real ya no se ve. En la lámina el teléfono entero está rodeado de
  // fondo claro y el manifest da su caja exterior (`bezelBox`): desde cada lado de esa caja se avanza hacia dentro, se cruza el bisel
  // negro y se mide su grosor.
  function scanBezel(get, len, maxBand) {
    let dark = -1;
    for (let i = 0; i < len - 3; i++) {
      if (get(i) < 70 && get(i + 1) < 70 && get(i + 2) < 70) {
        dark = i;
        break;
      }
    }
    if (dark < 0) return null;
    for (let i = dark + 3; i < len - 4 && i - dark <= maxBand; i++) {
      // ≥ 4 px claros seguidos: ignora el filo plateado de 1-2 px del bisel
      if (get(i) >= 110 && get(i + 1) >= 110 && get(i + 2) >= 110 && get(i + 3) >= 110) return i;
    }
    return null;
  }
  function lumaAtFn(d, w) {
    return (x, y) => {
      const i = (y * w + x) * 4;
      return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    };
  }
  const boards = new Map();
  async function board(id, b64) {
    if (!boards.has(id)) {
      if (!b64) throw new Error('lámina no cargada: ' + id);
      boards.set(id, await decode(b64));
      while (boards.size > 3) boards.delete(boards.keys().next().value); // memoria acotada
    }
    return boards.get(id);
  }
  /** Grosor del bisel en cada lado y posición de la isla dinámica, relativos a la caja exterior del teléfono. null = no medible. */
  function detectBox(img, box) {
    const [bx, by, bw, bh] = box;
    const L = lumaAtFn(img.data, img.w);
    const rows = [];
    for (let y = Math.floor(by + bh * 0.3); y < by + bh * 0.7; y += 3) rows.push(y);
    const ls = [];
    const rs = [];
    for (const y of rows) {
      const l = scanBezel((i) => L(bx + i, y), Math.floor(bw * 0.2), Math.ceil(bw * 0.07));
      if (l !== null) ls.push(l);
      const r = scanBezel((i) => L(bx + bw - 1 - i, y), Math.floor(bw * 0.2), Math.ceil(bw * 0.07));
      if (r !== null) rs.push(r);
    }
    // arriba/abajo: columnas entre la hora y la isla (26-33 %) y entre la isla y los iconos (67-73 %)
    const cols = [];
    for (let x = Math.floor(bx + bw * 0.26); x <= bx + bw * 0.33; x += 2) cols.push(x);
    for (let x = Math.floor(bx + bw * 0.67); x <= bx + bw * 0.73; x += 2) cols.push(x);
    const ts = [];
    const bs = [];
    for (const x of cols) {
      const t = scanBezel((i) => L(x, by + i), Math.floor(bh * 0.12), Math.ceil(bh * 0.03));
      if (t !== null) ts.push(t);
      const b = scanBezel((i) => L(x, by + bh - 1 - i), Math.floor(bh * 0.12), Math.ceil(bh * 0.03));
      if (b !== null) bs.push(b);
    }
    const pick = (arr, total) => (arr.length >= total * 0.4 ? median(arr) : null);
    // isla dinámica: primer tramo negro (luma < 28) de 20-40 px en el centro, precedido de un píxel claro
    let island = null;
    {
      const c = [];
      for (let y = by; y < by + Math.floor(bh * 0.14); y++) {
        const v = [];
        for (let x = Math.floor(bx + bw * 0.47); x <= bx + bw * 0.53; x++) v.push(L(x, y));
        c.push(median(v));
      }
      let a = -1;
      for (let y = 0; y <= c.length; y++) {
        const dark = y < c.length && c[y] < 28;
        if (dark && a < 0) a = y;
        if (!dark && a >= 0) {
          const len = y - a;
          if (len >= 20 && len <= 40 && a > 0 && c[a - 1] > 100) {
            island = a;
            break;
          }
          a = -1;
        }
      }
    }
    return { left: pick(ls, rows.length), right: pick(rs, rows.length), top: pick(ts, cols.length), bottom: pick(bs, cols.length), island };
  }

  // ── Reducción por promedio de área (determinista, sin depender del suavizado de canvas)
  function areaResize(src, sw, sh, dw, dh) {
    const out = new Float32Array(dw * dh * 3);
    const tmp = new Float32Array(sh * dw * 3);
    const kx = sw / dw;
    for (let x = 0; x < dw; x++) {
      const a = x * kx;
      const b = (x + 1) * kx;
      const i0 = Math.floor(a);
      const i1 = Math.min(sw - 1, Math.ceil(b) - 1);
      for (let y = 0; y < sh; y++) {
        let r = 0;
        let g = 0;
        let bl = 0;
        let wsum = 0;
        for (let i = i0; i <= i1; i++) {
          const wgt = Math.min(b, i + 1) - Math.max(a, i);
          if (wgt <= 0) continue;
          const o = (y * sw + i) * 4;
          r += src[o] * wgt;
          g += src[o + 1] * wgt;
          bl += src[o + 2] * wgt;
          wsum += wgt;
        }
        const t = (y * dw + x) * 3;
        tmp[t] = r / wsum;
        tmp[t + 1] = g / wsum;
        tmp[t + 2] = bl / wsum;
      }
    }
    const ky = sh / dh;
    for (let y = 0; y < dh; y++) {
      const a = y * ky;
      const b = (y + 1) * ky;
      const j0 = Math.floor(a);
      const j1 = Math.min(sh - 1, Math.ceil(b) - 1);
      for (let x = 0; x < dw; x++) {
        let r = 0;
        let g = 0;
        let bl = 0;
        let wsum = 0;
        for (let j = j0; j <= j1; j++) {
          const wgt = Math.min(b, j + 1) - Math.max(a, j);
          if (wgt <= 0) continue;
          const t = (j * dw + x) * 3;
          r += tmp[t] * wgt;
          g += tmp[t + 1] * wgt;
          bl += tmp[t + 2] * wgt;
          wsum += wgt;
        }
        const o = (y * dw + x) * 3;
        out[o] = r / wsum;
        out[o + 1] = g / wsum;
        out[o + 2] = bl / wsum;
      }
    }
    return out;
  }

  // ── SSIM sobre luminancia, ventana uniforme 7×7 (imágenes integrales)
  function ssimMap(a, b, w, h, win) {
    const r = (win - 1) >> 1;
    const W1 = w + 1;
    const mk = () => new Float64Array(W1 * (h + 1));
    const Ia = mk();
    const Ib = mk();
    const Iaa = mk();
    const Ibb = mk();
    const Iab = mk();
    for (let y = 0; y < h; y++) {
      let ra = 0;
      let rb = 0;
      let raa = 0;
      let rbb = 0;
      let rab = 0;
      for (let x = 0; x < w; x++) {
        const va = a[y * w + x];
        const vb = b[y * w + x];
        ra += va;
        rb += vb;
        raa += va * va;
        rbb += vb * vb;
        rab += va * vb;
        const o = (y + 1) * W1 + (x + 1);
        const u = y * W1 + (x + 1);
        Ia[o] = Ia[u] + ra;
        Ib[o] = Ib[u] + rb;
        Iaa[o] = Iaa[u] + raa;
        Ibb[o] = Ibb[u] + rbb;
        Iab[o] = Iab[u] + rab;
      }
    }
    const C1 = (0.01 * 255) ** 2;
    const C2 = (0.03 * 255) ** 2;
    const out = new Float32Array(w * h);
    const sum = (I, xa, ya, xb, yb) => I[yb * W1 + xb] - I[ya * W1 + xb] - I[yb * W1 + xa] + I[ya * W1 + xa];
    for (let y = 0; y < h; y++) {
      const ya = Math.max(0, y - r);
      const yb = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const xa = Math.max(0, x - r);
        const xb = Math.min(w, x + r + 1);
        const n = (xb - xa) * (yb - ya);
        const ma = sum(Ia, xa, ya, xb, yb) / n;
        const mb = sum(Ib, xa, ya, xb, yb) / n;
        const va = sum(Iaa, xa, ya, xb, yb) / n - ma * ma;
        const vb = sum(Ibb, xa, ya, xb, yb) / n - mb * mb;
        const cv = sum(Iab, xa, ya, xb, yb) / n - ma * mb;
        out[y * w + x] = ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      }
    }
    return out;
  }

  function heat(d) {
    // d: diferencia media absoluta 0..255 → [r,g,b,alpha]
    const t = Math.min(1, d / 64);
    if (t < 0.02) return [0, 0, 0, 0];
    const stops = [
      [0.0, [40, 70, 200]],
      [0.2, [30, 120, 255]],
      [0.5, [255, 215, 0]],
      [1.0, [255, 30, 30]],
    ];
    let c = stops[stops.length - 1][1];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1];
        const [t1, c1] = stops[i];
        const k = (t - t0) / (t1 - t0);
        c = [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
        break;
      }
    }
    return [c[0], c[1], c[2], Math.min(1, 0.3 + 0.7 * t)];
  }

  async function geometry({ boardId, boardB64, boxes }) {
    const img = await board(boardId, boardB64);
    return boxes.map((b) => detectBox(img, b));
  }

  /** Solo la pantalla del diseño (sin bisel), a 393 pt de ancho @2x: referencia métrica correcta para medir en pt. */
  async function exportDesign({ boardId, boardB64, geom, viewW, viewH }) {
    const D = await board(boardId, boardB64);
    const c = document.createElement('canvas');
    c.width = viewW * 2;
    c.height = viewH * 2;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(D.canvas, geom.x, geom.y, geom.w, geom.h, 0, 0, c.width, c.height);
    return c.toDataURL('image/png').split(',')[1];
  }

  async function compare({ boardId, boardB64, renderB64, geom, viewW, viewH, opts, labels }) {
    const D = await board(boardId, boardB64);
    const R = await decode(renderB64);
    const rw = Math.round(geom.w);
    const rh = Math.round(geom.h);
    const s = geom.pxPerPt; // px de recorte por pt
    const n = rw * rh;

    // diseño (recuadro de pantalla) y render reducido al mismo tamaño
    const dr = new Float32Array(n * 3);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const o = ((geom.y + y) * D.w + (geom.x + x)) * 4;
        const t = (y * rw + x) * 3;
        dr[t] = D.data[o];
        dr[t + 1] = D.data[o + 1];
        dr[t + 2] = D.data[o + 2];
      }
    }
    const rr = areaResize(R.data, R.w, R.h, rw, rh);
    const yd = new Float32Array(n);
    const yr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      yd[i] = 0.2126 * dr[i * 3] + 0.7152 * dr[i * 3 + 1] + 0.0722 * dr[i * 3 + 2];
      yr[i] = 0.2126 * rr[i * 3] + 0.7152 * rr[i * 3 + 1] + 0.0722 * rr[i * 3 + 2];
    }

    // ── máscara (1 = se ignora): esquinas redondeadas del bisel, barra de estado, indicador de inicio
    const mask = new Uint8Array(n);
    const dilatePx = 2;
    const cornerBox = Math.round(rw * 0.3);
    const seeds = [[0, 0], [rw - 1, 0], [0, rh - 1], [rw - 1, rh - 1]];
    let cornerPx = 0;
    for (const [sx, sy] of seeds) {
      if (yd[sy * rw + sx] >= 80) continue; // la esquina ya es pantalla (el recorte empieza dentro): nada que enmascarar
      const stack = [sy * rw + sx];
      const seen = new Uint8Array(n);
      seen[stack[0]] = 1;
      while (stack.length) {
        const p = stack.pop();
        mask[p] = 1;
        cornerPx++;
        const x = p % rw;
        const y = (p / rw) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue;
          if (Math.abs(nx - sx) > cornerBox || Math.abs(ny - sy) > cornerBox) continue;
          const q = ny * rw + nx;
          if (seen[q] || yd[q] >= 80) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    const statusRows = Math.min(rh, Math.round(opts.statusBandPt * s));
    for (let y = 0; y < statusRows; y++) mask.fill(1, y * rw, (y + 1) * rw);
    if (opts.homeIndicator) {
      const hx0 = Math.round(((viewW - 150) / 2) * s);
      const hx1 = Math.round(((viewW + 150) / 2) * s);
      const hy0 = Math.max(0, rh - Math.round(18 * s));
      const hy1 = Math.max(0, rh - Math.round(2 * s));
      for (let y = hy0; y < hy1; y++) mask.fill(1, y * rw + hx0, y * rw + hx1);
    }
    // dilatación (cuadrada, 2 px)
    {
      const src = mask.slice();
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          if (src[y * rw + x]) continue;
          let hit = false;
          for (let dy = -dilatePx; dy <= dilatePx && !hit; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= rh) continue;
            for (let dx = -dilatePx; dx <= dilatePx; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= rw) continue;
              if (src[yy * rw + xx]) {
                hit = true;
                break;
              }
            }
          }
          if (hit) mask[y * rw + x] = 1;
        }
      }
    }
    let maskedPx = 0;
    for (let i = 0; i < n; i++) if (mask[i]) maskedPx++;
    const valid = n - maskedPx;

    // ── MAD (RGB) y SSIM (luminancia)
    const absd = new Float32Array(n);
    let sumAbs = 0;
    for (let i = 0; i < n; i++) {
      const d = (Math.abs(dr[i * 3] - rr[i * 3]) + Math.abs(dr[i * 3 + 1] - rr[i * 3 + 1]) + Math.abs(dr[i * 3 + 2] - rr[i * 3 + 2])) / 3;
      absd[i] = d;
      if (!mask[i]) sumAbs += d;
    }
    const ssim = ssimMap(yd, yr, rw, rh, 7);
    let sumSsim = 0;
    for (let i = 0; i < n; i++) if (!mask[i]) sumSsim += ssim[i];
    const mad = valid ? sumAbs / valid : 0;
    const meanSsim = valid ? sumSsim / valid : 0;

    // ── franjas (cabecera / cuerpo / base) en pt
    const bandDefs = [
      { name: 'cabecera', from: opts.statusBandPt, to: Math.min(150, viewH) },
      { name: 'cuerpo', from: Math.min(150, viewH), to: Math.max(150, viewH - 110) },
      { name: 'base', from: Math.max(150, viewH - 110), to: viewH },
    ];
    const bands = bandDefs.map((b) => {
      const ya = Math.max(0, Math.round(b.from * s));
      const yb = Math.min(rh, Math.round(b.to * s));
      let cnt = 0;
      let sd = 0;
      let ss = 0;
      for (let y = ya; y < yb; y++)
        for (let x = 0; x < rw; x++) {
          const i = y * rw + x;
          if (mask[i]) continue;
          cnt++;
          sd += absd[i];
          ss += ssim[i];
        }
      return { band: b.name, fromPt: Math.round(b.from), toPt: Math.round(b.to), mad: cnt ? +(sd / cnt).toFixed(2) : null, ssim: cnt ? +(ss / cnt).toFixed(4) : null };
    });

    // ── puntos calientes: celdas de 24 pt
    const cellPx = Math.max(6, Math.round(opts.cellPt * s));
    const cells = [];
    for (let cy = 0; cy < rh; cy += cellPx) {
      for (let cx = 0; cx < rw; cx += cellPx) {
        const x1 = Math.min(rw, cx + cellPx);
        const y1 = Math.min(rh, cy + cellPx);
        let cnt = 0;
        let sd = 0;
        for (let y = cy; y < y1; y++)
          for (let x = cx; x < x1; x++) {
            const i = y * rw + x;
            if (mask[i]) continue;
            cnt++;
            sd += absd[i];
          }
        if (cnt >= 0.5 * (x1 - cx) * (y1 - cy)) cells.push({ cx, cy, x1, y1, mad: sd / cnt });
      }
    }
    cells.sort((a, b) => b.mad - a.mad);
    const hot = cells.slice(0, 8).map((c, i) => ({
      n: i + 1,
      xPt: Math.round(c.cx / s),
      yPt: Math.round(c.cy / s),
      wPt: Math.round((c.x1 - c.cx) / s),
      hPt: Math.round((c.y1 - c.cy) / s),
      mad: +c.mad.toFixed(1),
    }));

    // ── desplazamiento global (±opts.shiftPx px del recorte): ¿el render está todo desplazado respecto al diseño?
    const sr = opts.shiftPx;
    const stepS = 2;
    const madAt = (dx, dy) => {
      let cnt = 0;
      let sd = 0;
      for (let y = sr; y < rh - sr; y += stepS) {
        for (let x = sr; x < rw - sr; x += stepS) {
          const i = y * rw + x;
          if (mask[i]) continue;
          const j = (y - dy) * rw + (x - dx);
          if (mask[j]) continue;
          cnt++;
          sd += Math.abs(yd[i] - yr[j]);
        }
      }
      return cnt ? sd / cnt : 255;
    };
    const base = madAt(0, 0);
    let best = { dx: 0, dy: 0, v: base };
    for (let dy = -sr; dy <= sr; dy++)
      for (let dx = -sr; dx <= sr; dx++) {
        const v = madAt(dx, dy);
        if (v < best.v) best = { dx, dy, v };
      }
    const shift = {
      // positivo = hay que mover el contenido del render hacia la derecha / abajo para igualar el diseño
      dxPt: +(best.dx / s).toFixed(1),
      dyPt: +(best.dy / s).toFixed(1),
      lumaMadAtZero: +base.toFixed(2),
      lumaMadBest: +best.v.toFixed(2),
      improvementPct: base > 0 ? +(((base - best.v) / base) * 100).toFixed(1) : 0,
      significant: (best.dx !== 0 || best.dy !== 0) && base > 0 && (base - best.v) / base > 0.08,
    };

    // ── composite [diseño | render | superposición | diferencias]
    const PW = viewW;
    const PH = viewH;
    const GAP = 14;
    const M = 14;
    const HEAD = 34;
    const FOOT = 74;
    const cw = M * 2 + PW * 4 + GAP * 3;
    const ch = HEAD + PH + FOOT;
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const g = cv.getContext('2d');
    g.fillStyle = '#16181d';
    g.fillRect(0, 0, cw, ch);

    const designCanvas = D.canvas;
    const renderCanvas = R.canvas;
    const drawDesign = (x, y, w, h, alpha) => {
      g.save();
      g.globalAlpha = alpha;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(designCanvas, geom.x, geom.y, rw, rh, x, y, w, h);
      g.restore();
    };
    const drawRender = (x, y, w, h, alpha) => {
      g.save();
      g.globalAlpha = alpha;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(renderCanvas, 0, 0, R.w, R.h, x, y, w, h);
      g.restore();
    };
    const px = (i) => M + i * (PW + GAP);
    const py = HEAD;
    // 1 diseño
    g.fillStyle = '#fff';
    g.fillRect(px(0), py, PW, PH);
    drawDesign(px(0), py, PW, PH, 1);
    // 2 render
    g.fillStyle = '#fff';
    g.fillRect(px(1), py, PW, PH);
    drawRender(px(1), py, PW, PH, 1);
    // 3 superposición 50 %
    g.fillStyle = '#fff';
    g.fillRect(px(2), py, PW, PH);
    drawDesign(px(2), py, PW, PH, 1);
    drawRender(px(2), py, PW, PH, 0.5);
    // 4 diferencias (mapa de calor sobre el diseño atenuado)
    {
      const hm = document.createElement('canvas');
      hm.width = rw;
      hm.height = rh;
      const hg = hm.getContext('2d');
      const im = hg.createImageData(rw, rh);
      for (let i = 0; i < n; i++) {
        const grey = 120 + 0.5 * yd[i]; // el diseño atenuado se intuye bajo el calor
        let r0 = grey;
        let g0 = grey;
        let b0 = grey;
        if (mask[i]) {
          r0 = 58;
          g0 = 62;
          b0 = 72;
        } else {
          const [hr, hg2, hb, ha] = heat(absd[i]);
          r0 = r0 * (1 - ha) + hr * ha;
          g0 = g0 * (1 - ha) + hg2 * ha;
          b0 = b0 * (1 - ha) + hb * ha;
        }
        im.data[i * 4] = r0;
        im.data[i * 4 + 1] = g0;
        im.data[i * 4 + 2] = b0;
        im.data[i * 4 + 3] = 255;
      }
      hg.putImageData(im, 0, 0);
      g.save();
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'medium';
      g.drawImage(hm, 0, 0, rw, rh, px(3), py, PW, PH);
      g.restore();
      // recuadros numerados de los puntos calientes
      g.save();
      g.lineWidth = 1.5;
      g.font = '700 11px sans-serif';
      g.textBaseline = 'top';
      for (const h of hot.slice(0, 5)) {
        g.strokeStyle = '#ffffff';
        g.strokeRect(px(3) + h.xPt + 0.5, py + h.yPt + 0.5, h.wPt - 1, h.hPt - 1);
        g.fillStyle = '#000000';
        g.fillRect(px(3) + h.xPt, py + h.yPt, 12, 13);
        g.fillStyle = '#ffffff';
        g.fillText(String(h.n), px(3) + h.xPt + 3, py + h.yPt + 1);
      }
      g.restore();
    }
    // marcos finos
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 1;
    for (let i = 0; i < 4; i++) g.strokeRect(px(i) - 0.5, py - 0.5, PW + 1, PH + 1);
    // títulos
    g.fillStyle = '#ffffff';
    g.font = '700 13px sans-serif';
    g.textBaseline = 'middle';
    const titles = ['DISEÑO', 'RENDER', 'SUPERPOSICIÓN 50 %', 'DIFERENCIA'];
    for (let i = 0; i < 4; i++) g.fillText(titles[i], px(i), HEAD / 2 + 1);
    g.textAlign = 'right';
    g.fillStyle = '#9fb0cf';
    g.font = '12px sans-serif';
    g.fillText(labels.title, cw - M, HEAD / 2 + 1);
    g.textAlign = 'left';
    // pie con métricas
    g.fillStyle = '#e8edf7';
    g.font = '600 13px monospace';
    g.textBaseline = 'top';
    const fy = py + PH + 10;
    g.fillText(`SSIM ${meanSsim.toFixed(3)}   MAD ${mad.toFixed(1)}/255 (${((mad / 255) * 100).toFixed(1)} %)   enmascarado ${((maskedPx / n) * 100).toFixed(1)} %   viewport ${viewW}×${viewH} pt @2x`, M, fy);
    g.fillStyle = '#b9c4dc';
    g.font = '12px monospace';
    g.fillText(bands.map((b) => `${b.band} ${b.ssim === null ? '—' : b.ssim.toFixed(3)}`).join('   ') + `   ·   desplazamiento global: ${shift.significant ? `mover render ${shift.dxPt >= 0 ? '+' : ''}${shift.dxPt}, ${shift.dyPt >= 0 ? '+' : ''}${shift.dyPt} pt (MAD ${shift.lumaMadAtZero}→${shift.lumaMadBest})` : 'ninguno relevante'}`, M, fy + 20);
    g.fillStyle = '#9fb0cf';
    g.fillText(labels.footer, M, fy + 40);

    // @2x del diseño (mismo encuadre que el render)
    const d2 = document.createElement('canvas');
    d2.width = viewW * 2;
    d2.height = viewH * 2;
    const d2g = d2.getContext('2d');
    d2g.fillStyle = '#fff';
    d2g.fillRect(0, 0, d2.width, d2.height);
    d2g.imageSmoothingEnabled = true;
    d2g.imageSmoothingQuality = 'high';
    d2g.drawImage(designCanvas, geom.x, geom.y, rw, rh, 0, 0, d2.width, d2.height);

    return {
      metrics: {
        madRgb: +mad.toFixed(2),
        madPct: +((mad / 255) * 100).toFixed(2),
        ssim: +meanSsim.toFixed(4),
        validPx: valid,
        totalPx: n,
        maskedPct: +((maskedPx / n) * 100).toFixed(2),
        cornerMaskPx: cornerPx,
        bands,
        hotspots: hot,
        shift,
      },
      compositeB64: cv.toDataURL('image/png').split(',')[1],
      design2xB64: d2.toDataURL('image/png').split(',')[1],
    };
  }

  window.__cmp = { geometry, compare, exportDesign };
}
/* eslint-enable */

// ───────────────────────────── Ejecución ─────────────────────────────
function describeParams(p) {
  if (p === undefined || p === null) return undefined;
  if (typeof p === 'object') return p;
  try {
    return JSON.parse(String(p));
  } catch {
    throw new Error(`--params no es JSON válido: ${String(p).slice(0, 120)}`);
  }
}

function targetFor(shot, args, scenarioDir) {
  const spFile = shot ? scenarioPath(scenarioDir, shot) : null;
  const sc = spFile ? readScenario(spFile) : null;
  const hasAdhoc = typeof args.route === 'string';
  if (!sc && !hasAdhoc) return { shot, scenarioFile: null, skip: shot ? `sin escenario (design/scenarios/${shot.screen}.json)` : 'sin ruta' };
  const t = {
    shot,
    scenarioFile: spFile,
    route: hasAdhoc ? args.route : sc.route,
    params: args.params !== undefined ? describeParams(args.params) : sc?.params ?? {},
    profile: args.profile ?? sc?.profile ?? 'passenger',
    seed: args.seed ?? sc?.seed,
    clock: args.clock ?? sc?.clock,
    perm: args.perm ?? sc?.perm ?? 'granted',
    device: args.device ?? sc?.device ?? 'iphone15',
    height: args.height ? Number(args.height) : sc?.height,
    waitFor: args['wait-for'] ?? sc?.waitFor,
    note: sc?.note,
  };
  return t;
}

function parseInner(s) {
  if (!s) return undefined;
  const v = String(s).split(',').map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isFinite(n))) throw new Error('--inner espera x,y,w,h (px de la lámina), p. ej. --inner 786,238,330,714');
  return { x: v[0], y: v[1], w: v[2], h: v[3] };
}

function fmt(n, d = 3) {
  return n === null || n === undefined ? '—' : Number(n).toFixed(d);
}

const median = (arr) => {
  const a = arr.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  return a.length ? a[(a.length - 1) >> 1] : null;
};

const ISLAND_TOP_PT = 11; // la isla dinámica del iPhone 15 empieza 11 pt por debajo del borde superior de la pantalla
// Grosor típico del bisel (px de lámina): solo se usa si en una lámina no se puede medir ningún lado.
const BEZEL_FALLBACK = { left: 15, right: 15, top: 13, bottom: 13 };

function boardFile(shot) {
  return path.join(DESIGN, 'boards', `${shot.board}.png`);
}

/** Mediana tras descartar los valores que se apartan más de `tol` de la mediana inicial. */
function robustMedian(values, tol = 3) {
  const v = values.filter((x) => Number.isFinite(x));
  const m0 = median(v);
  if (m0 === null) return null;
  const kept = v.filter((x) => Math.abs(x - m0) <= tol);
  return median(kept);
}

/**
 * Recuadro de PANTALLA de un diseño, en píxeles de la lámina original (design/boards/<lámina>.png).
 * El recorte de slice_boards.py incluye el bisel y a veces corta por dentro de la pantalla; en la lámina el teléfono entero está
 * rodeado de fondo claro. Desde cada lado de su caja exterior (`bezelBox` del manifest) se avanza hacia dentro, se cruza el bisel
 * negro y se localiza el primer píxel de pantalla. Las cuatro pantallas de una lámina son el mismo teléfono y están alineadas
 * en vertical: tamaño y borde superior/inferior son la mediana de las cuatro (robusto frente a cabeceras oscuras y a cajas
 * desplazadas); la posición horizontal es el centro medido de cada teléfono. Escala uniforme por ANCHURA: 393 pt = anchura medida;
 * la altura en pt sale de esa misma escala, de modo que lo comparado es proporcional.
 */
async function measureDesign(helper, manifest, shot, memo, forced) {
  const file = boardFile(shot);
  if (!shot.bezelBox) throw new Error('design/manifest.json no trae «bezelBox». Regenera el material con tools/design/slice_boards.py.');
  if (!fs.existsSync(file)) throw new Error(`Falta ${rel(file)} (lámina original; regenera con tools/design/slice_boards.py <carpeta-con-las-láminas>)`);
  if (!memo.has(shot.board)) {
    const sibs = manifest.filter((m) => m.board === shot.board && m.bezelBox);
    const det = await helper.evaluate((a) => window.__cmp.geometry(a), {
      boardId: shot.board,
      boardB64: fs.readFileSync(file).toString('base64'),
      boxes: sibs.map((m) => m.bezelBox),
    });
    const notes = [];
    const phones = sibs.map((m, i) => {
      const [bx, by, bw, bh] = m.bezelBox;
      const d = det[i];
      return {
        id: m.screen,
        xl: d.left === null ? null : bx + d.left,
        xr: d.right === null ? null : bx + bw - d.right,
        yt: d.top === null ? null : by + d.top,
        yb: d.bottom === null ? null : by + bh - d.bottom,
        island: d.island === null ? null : by + d.island,
        box: m.bezelBox,
      };
    });
    const widths = phones.map((p) => (p.xl !== null && p.xr !== null ? p.xr - p.xl : null));
    let W = robustMedian(widths);
    let top = robustMedian(phones.map((p) => p.yt));
    let bottom = robustMedian(phones.map((p) => p.yb));
    const boxTop = median(phones.map((p) => p.box[1]));
    const boxBottom = median(phones.map((p) => p.box[1] + p.box[3]));
    const boxW = median(phones.map((p) => p.box[2]));
    if (W === null) {
      W = Math.round(boxW - BEZEL_FALLBACK.left - BEZEL_FALLBACK.right);
      notes.push(`anchura de pantalla no medible en la lámina ${shot.board}; se estima ${W} px a partir de la caja del teléfono`);
    }
    if (top === null) {
      top = boxTop + BEZEL_FALLBACK.top;
      notes.push(`borde superior no medible en la lámina ${shot.board}; se estima con ${BEZEL_FALLBACK.top} px de bisel`);
    }
    if (bottom === null) {
      bottom = boxBottom - BEZEL_FALLBACK.bottom;
      notes.push(`borde inferior no medible en la lámina ${shot.board}; se estima con ${BEZEL_FALLBACK.bottom} px de bisel`);
    }
    // contraste con la isla dinámica (debe quedar ISLAND_TOP_PT bajo el borde superior)
    const islands = phones.map((p) => p.island).filter((v) => v !== null);
    if (islands.length) {
      const expect = median(islands) - ISLAND_TOP_PT * (W / VIEW_W);
      if (Math.abs(expect - top) > 3) notes.push(`el borde superior medido (${top}) difiere de lo que indica la isla dinámica (${expect.toFixed(1)}) en más de 3 px`);
    }
    memo.set(shot.board, { phones, W, top, bottom, notes });
  }
  const b = memo.get(shot.board);
  const notes = [...b.notes];
  const me = b.phones.find((p) => p.id === shot.screen);
  let x;
  let y;
  let w;
  let h;
  if (forced) {
    ({ x, y, w, h } = forced);
    notes.push('recuadro forzado con --inner (px de lámina)');
  } else {
    w = Math.round(b.W);
    y = Math.round(b.top);
    h = Math.round(b.bottom - b.top);
    if (me.xl !== null && me.xr !== null && Math.abs(me.xr - me.xl - b.W) <= 3) x = Math.round((me.xl + me.xr) / 2 - b.W / 2);
    else if (me.xl !== null) x = me.xl;
    else if (me.xr !== null) x = Math.round(me.xr - b.W);
    else x = Math.round(me.box[0] + (me.box[2] - b.W) / 2);
    if (!(me.xl !== null && me.xr !== null && Math.abs(me.xr - me.xl - b.W) <= 3)) notes.push(`${shot.screen}: posición horizontal estimada (bordes laterales poco claros)`);
  }
  const pxPerPt = w / VIEW_W;
  const heightPt = h / pxPerPt;
  if (!forced && (heightPt < 700 || heightPt > 1000)) notes.push(`altura medida atípica (${Math.round(heightPt)} pt); revisa con --geometry o fuerza --inner x,y,w,h`);
  return { x, y, w, h, boardFile: file, pxPerPt, heightPt: Math.round(heightPt), notes, phone: me };
}

/**
 * Con --dev: pide el bundle web al servidor de desarrollo (Metro). Si no compila, Metro responde 500 con el fichero y el motivo;
 * se devuelven tal cual para que se vea QUÉ fichero rompe el bundle (puede ser de otro equipo: espera unos segundos y repite).
 * Devuelve `null` si el bundle compila.
 */
async function devBundleProblem(origin, timeoutMs) {
  const bundle = `${origin}/index.ts.bundle?platform=web&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable`;
  try {
    const res = await fetch(bundle, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      await res.arrayBuffer(); // consume el cuerpo
      return null;
    }
    const text = await res.text();
    let detail = text.slice(0, 1200);
    try {
      const j = JSON.parse(text);
      const errs = Array.isArray(j.errors) && j.errors.length > 0 ? j.errors.map((e) => `${e.filename ?? ''}${e.lineNumber ? `:${e.lineNumber}` : ''} ${e.description ?? e.message ?? ''}`.trim()) : [];
      detail = [j.type, j.message, ...errs].filter(Boolean).join('\n  ').slice(0, 1600);
    } catch {
      // el cuerpo no era JSON: se enseña el texto
    }
    return `El bundle de desarrollo NO compila (HTTP ${res.status}). Metro dice:\n  ${detail}\nSi el fichero no es tuyo, avisa a su equipo o espera unos segundos y repite; no lo arregles tú.`;
  } catch (e) {
    return `No se pudo pedir el bundle a ${origin} (${e && e.message ? e.message : e}). ¿Está arrancado el servidor? tools/preview/dev-server.sh start`;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.dev) {
    args.url ??= process.env.MVC_DEV_URL ?? 'http://localhost:8081';
    args['inject-shell'] = true;
  }
  if (args.help || args.h) {
    process.stdout.write(HELP);
    return 0;
  }
  const manifest = loadManifest();
  const scenarioDir = path.resolve(ROOT, args.scenarios ?? 'design/scenarios');
  const outDir = path.resolve(ROOT, args.out ?? 'design/out/compare');

  if (args.list) {
    const rows = manifest.map((s) => {
      const sp = scenarioPath(scenarioDir, s);
      let route = '';
      if (sp) {
        try {
          route = readScenario(sp).route;
        } catch (e) {
          route = `¡inválido! ${e.message}`;
        }
      }
      return `${s.screen.padEnd(4)} lámina ${s.board.padEnd(4)} recorte ${String(s.rawSize[0]).padStart(3)}×${String(s.rawSize[1]).padEnd(3)}  ${sp ? `escenario ${route}` : 'sin escenario'}`;
    });
    process.stdout.write(rows.join('\n') + `\n\n${manifest.length} diseños · ${rows.filter((r) => !r.includes('sin escenario')).length} con escenario en ${rel(scenarioDir)}\n`);
    return 0;
  }

  // ¿qué pantallas?
  let shots;
  if (args.all) shots = selectScreens(manifest, { variant: args.variant });
  else if (args.screen !== undefined) shots = selectScreens(manifest, args);
  else if (typeof args.route === 'string') shots = [null]; // a mano y sin diseño: solo captura
  else {
    process.stderr.write('Indica --screen N, --all, --list o --route Nombre. (--help para ver el uso)\n');
    return 1;
  }

  if (args.dev && !process.env.MVC_HEAVY_LOCK_FILE) {
    // Con el servidor de desarrollo no hay export de Metro que serializar: bastan dos Chromium a la vez (dos «carriles»), y no se
    // espera detrás de las pruebas de integración del backend (que tienen el bloqueo global durante minutos).
    const lanes = ['/tmp/mvc-ui-1.lock', '/tmp/mvc-ui-2.lock'];
    const free = lanes.find((f) => spawnSync('flock', ['-n', f, 'true'], { stdio: 'ignore' }).status === 0);
    process.env.MVC_HEAVY_LOCK_FILE = free ?? lanes[Math.floor(Math.random() * lanes.length)];
  }
  ensureHeavyLock(args.geometry || args['export-design'] ? 'medir diseños' : 'comparar con el diseño');

  const timeout = Number(args.timeout ?? 60000);
  const forcedInner = parseInner(args.inner);
  const exportDesign = Boolean(args['export-design']);
  const geometryOnly = Boolean(args.geometry) || exportDesign;
  const url = args.url ?? ARTIFACT_URL;
  const isFile = url.startsWith('file:');
  const devOrigin = args.dev ? new URL(url).origin : null;
  if (args.dev && !geometryOnly) {
    const problem = await devBundleProblem(devOrigin, Math.max(timeout, 180000));
    if (problem) {
      process.stderr.write(`${problem}\n`);
      return 1;
    }
  }
  if (!geometryOnly && isFile && !fs.existsSync(ARTIFACT) && url === ARTIFACT_URL) {
    process.stderr.write(`No existe ${rel(ARTIFACT)}. Constrúyelo primero:\n  npm --prefix mobile run preview:artifact\nO apunta a otra build con --url.\n`);
    return 1;
  }

  const failedBuild = !geometryOnly && url === ARTIFACT_URL && !args['stale-ok'] ? lastBuildFailure() : null;
  if (failedBuild) {
    process.stderr.write('La última compilación de la vista previa FALLÓ (el árbol de la app no compilaba): el HTML que hay es antiguo.\n');
    for (const b of failedBuild.broken ?? []) process.stderr.write(`  · ${b}\n`);
    process.stderr.write('Arréglalo y vuelve a compilar (npm --prefix mobile run preview:artifact), o usa --stale-ok para comparar con el HTML antiguo.\n');
    return 1;
  }

  const t0 = Date.now();
  const browser = await launchChromium();
  const results = [];
  let exit = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: VIEW_W, height: VIEW_H_DEFAULT },
      deviceScaleFactor: 2,
      locale: 'es-ES',
      timezoneId: 'Europe/Madrid',
      colorScheme: 'light',
      acceptDownloads: false,
    });
    context.setDefaultTimeout(timeout);
    const helper = await context.newPage();
    await helper.setContent('<!doctype html><meta charset="utf-8"><body></body>');
    await helper.evaluate(`(${helperMain.toString()})()`);

    const geomMemo = new Map();
    let page = null;
    let frame = null;
    let pageLog = null;
    const openPage = async (target) => {
      if (page) await page.close().catch(() => {});
      page = await context.newPage();
      pageLog = { consoleErrors: [], externalRequests: [], pageErrors: [] };
      page.on('console', (m) => {
        if (m.type() === 'error') pageLog.consoleErrors.push(m.text().slice(0, 400));
      });
      page.on('pageerror', (e) => pageLog.pageErrors.push(String(e && e.message ? e.message : e).slice(0, 400)));
      watchNetwork(page, {
        allow: (u) => devOrigin !== null && u.startsWith(devOrigin),
        allowWebSocket: (u) => devOrigin !== null && u.replace(/^ws/, 'http').startsWith(devOrigin),
        onViolation: (m) => pageLog.externalRequests.push(m),
      });
      const u = viewerUrl(url, { chrome: '0', profile: target.profile, device: target.device, perm: target.perm, seed: target.seed, clock: target.clock });
      await page.goto(u, { waitUntil: 'load', timeout });
      if (args['inject-shell']) {
        const shellJs = path.join(ROOT, 'tools/preview/shell/inner.js');
        if (fs.existsSync(shellJs)) await page.addScriptTag({ path: shellJs });
      }
      frame = await findAppFrame(page, { timeout });
      await waitAppReady(frame, { timeout });
    };

    for (const shot of shots) {
      const id = shot ? shot.screen : `adhoc-${String(args.route).replace(/[^\w-]+/g, '_')}`;
      const res = { id, ok: false, warnings: [] };
      results.push(res);
      const tStart = Date.now();
      try {
        const target = targetFor(shot, args, scenarioDir);
        if (target.skip && !geometryOnly) {
          res.skipped = target.skip;
          if (!args.quiet) console.log(`– ${id.padEnd(4)} ${target.skip}`);
          res.ok = true;
          continue;
        }
        res.route = target.route;
        res.profile = target.profile;

        // 1) geometría del diseño
        let geom = null;
        let designFile = null;
        if (shot) {
          geom = await measureDesign(helper, manifest, shot, geomMemo, forcedInner);
          designFile = geom.boardFile;
          res.design = { board: rel(designFile), bezelBox: shot.bezelBox, inner: { x: geom.x, y: geom.y, w: geom.w, h: geom.h }, pxPerPt: +geom.pxPerPt.toFixed(4), heightPt: geom.heightPt, manifestHeightPt: shot.designHeightPt, notes: geom.notes };
          for (const n of geom.notes) res.warnings.push(`diseño: ${n}`);
        }
        if (geometryOnly) {
          res.ok = true;
          console.log(`${id.padEnd(4)} lámina ${shot.board.padEnd(3)} pantalla x=${geom.x} y=${geom.y} ${geom.w}×${geom.h}px = 393×${geom.heightPt} pt (${geom.pxPerPt.toFixed(3)} px/pt)  manifest ${shot.designHeightPt}${geom.notes.length ? '  · ' + geom.notes.join('; ') : ''}`);
          if (exportDesign) {
            const b64 = await helper.evaluate((a) => window.__cmp.exportDesign(a), { boardId: shot.board, boardB64: fs.readFileSync(designFile).toString('base64'), geom, viewW: VIEW_W, viewH: geom.heightPt });
            const dir = path.join(path.dirname(outDir), 'screens-pt');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `${id}.png`), Buffer.from(b64, 'base64'));
          }
          continue;
        }
        const viewH = Math.round(target.height ?? geom?.heightPt ?? VIEW_H_DEFAULT);
        res.viewport = { width: VIEW_W, height: viewH, deviceScaleFactor: 2 };

        // 2) página de la app (se reutiliza entre pantallas salvo --fresh o error previo)
        if (!page || args.fresh) await openPage(target);
        await page.setViewportSize({ width: VIEW_W, height: viewH });
        await sleep(150);
        pageLog.consoleErrors.length = 0;
        pageLog.pageErrors.length = 0;

        // 3) saltar a la pantalla
        const tOpen = Date.now();
        const openErr = await frame.evaluate(
          async ({ route, params, opts, clock }) => {
            try {
              const sh = window.__MVC_PREVIEW_SHELL__;
              if (clock && sh && typeof sh.setClock === 'function') sh.setClock(clock);
              await window.__mvc.open(route, params, opts);
              return null;
            } catch (e) {
              const routes = window.__mvc && typeof window.__mvc.routes === 'function' ? window.__mvc.routes() : null;
              return { message: String(e && e.message ? e.message : e), routes: Array.isArray(routes) ? routes.slice(0, 80) : null };
            }
          },
          { route: target.route, params: target.params, opts: { profile: target.profile, seed: target.seed, clock: target.clock }, clock: target.clock },
        );
        if (openErr) {
          const hint = openErr.routes ? `\n   rutas conocidas: ${openErr.routes.map((r) => (typeof r === 'string' ? r : r.name)).join(', ')}` : '';
          throw new Error(`__mvc.open('${target.route}') falló: ${openErr.message}${hint}`);
        }
        const settled = await settleApp(frame, { quietMs: 350, minMs: Number(args['min-wait'] ?? 450), timeoutMs: Number(args['settle-ms'] ?? 12000) });
        if (target.waitFor) {
          await frame
            .waitForFunction(
              (w) => {
                try {
                  if (document.querySelector(w)) return true;
                } catch (e) {
                  // no es un selector CSS: se busca como texto
                }
                return document.body.innerText.includes(w);
              },
              target.waitFor,
              { timeout: Math.min(timeout, 20000) },
            )
            .catch(() => res.warnings.push(`no apareció «${target.waitFor}» antes de capturar`));
        }
        const openMs = Date.now() - tOpen;

        // 4) captura
        await sleep(100);
        const png = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide', timeout });
        fs.mkdirSync(outDir, { recursive: true });
        const base = path.join(outDir, id);
        fs.writeFileSync(`${base}.render@2x.png`, png);
        res.settle = settled;
        res.timing = { openMs };
        res.consoleErrors = [...pageLog.consoleErrors, ...pageLog.pageErrors];
        res.externalRequests = pageLog.externalRequests.slice();
        if (settled.timedOut) res.warnings.push(`la pantalla no llegó a quedarse quieta en ${args['settle-ms'] ?? 12000} ms (animación continua o carga sin terminar)`);
        if (res.consoleErrors.length) res.warnings.push(`${res.consoleErrors.length} error(es) de consola durante la carga`);
        if (res.externalRequests.length) res.warnings.push(`${res.externalRequests.length} petición(es) fuera del HTML (¡la vista previa debe ser hermética!)`);

        if (!shot) {
          res.ok = true;
          res.files = { render2x: rel(`${base}.render@2x.png`) };
          console.log(`✔ ${id}  captura sin diseño → ${rel(`${base}.render@2x.png`)}  (${VIEW_W}×${viewH} pt @2x)`);
          fs.writeFileSync(`${base}.json`, JSON.stringify(res, null, 2));
          continue;
        }

        // 5) métricas + composite
        const out = await helper.evaluate((a) => window.__cmp.compare(a), {
          boardId: shot.board,
          boardB64: fs.readFileSync(designFile).toString('base64'),
          renderB64: png.toString('base64'),
          geom,
          viewW: VIEW_W,
          viewH,
          opts: { statusBandPt: 54, homeIndicator: true, cellPt: 24, shiftPx: 6 },
          labels: {
            title: `${id} · ${target.route} · ${target.profile}`,
            footer: `${rel(designFile)} (pantalla ${geom.w}×${geom.h}px en x=${geom.x} y=${geom.y} = ${geom.pxPerPt.toFixed(3)} px/pt) · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ignorado: esquinas del bisel, barra de estado (54 pt), indicador de inicio`,
          },
        });
        fs.writeFileSync(`${base}.png`, Buffer.from(out.compositeB64, 'base64'));
        fs.writeFileSync(`${base}.design@2x.png`, Buffer.from(out.design2xB64, 'base64'));
        res.metrics = out.metrics;
        res.files = { composite: rel(`${base}.png`), render2x: rel(`${base}.render@2x.png`), design2x: rel(`${base}.design@2x.png`), json: rel(`${base}.json`) };
        res.url = isFile ? rel(fileURLToPathSafe(url)) : url;
        res.params = target.params;
        res.seed = target.seed;
        res.clock = target.clock;
        res.scenarioFile = target.scenarioFile ? rel(target.scenarioFile) : null;
        res.timing.totalMs = Date.now() - tStart;
        res.generatedAt = new Date().toISOString();
        res.ok = true;
        fs.writeFileSync(`${base}.json`, JSON.stringify(res, null, 2));

        const m = out.metrics;
        if (!args.quiet) {
          const hs = m.hotspots.slice(0, 3).map((h) => `#${h.n} (${h.xPt},${h.yPt}) ${h.mad}`).join('  ');
          console.log(`✔ ${id.padEnd(4)} ${String(target.route).padEnd(22)} SSIM ${fmt(m.ssim)}  MAD ${fmt(m.madPct, 1)} %  ${m.shift.significant ? `Δ(${m.shift.dxPt >= 0 ? '+' : ''}${m.shift.dxPt},${m.shift.dyPt >= 0 ? '+' : ''}${m.shift.dyPt}pt) ` : ''}heat ${hs}  → ${res.files.composite}`);
          for (const w of res.warnings) console.log(`    ! ${w}`);
        }
        if (args.json) console.log(JSON.stringify(res));
        if (args['fail-under-ssim'] !== undefined && m.ssim < Number(args['fail-under-ssim'])) exit = Math.max(exit, 2);
      } catch (e) {
        res.ok = false;
        res.error = String(e && e.message ? e.message : e);
        exit = Math.max(exit, 1);
        console.error(`✘ ${id.padEnd(4)} ${res.error}`);
        // la página puede haber quedado en mal estado: la siguiente pantalla la recarga
        if (page) {
          await page.close().catch(() => {});
          page = null;
        }
      }
    }
    await context.close();
  } finally {
    await browser.close().catch(() => {});
  }

  // resumen de varias pantallas
  const done = results.filter((r) => r.metrics);
  if (!geometryOnly && results.length > 1) {
    fs.mkdirSync(outDir, { recursive: true });
    const summary = {
      generatedAt: new Date().toISOString(),
      url,
      compared: done.length,
      skipped: results.filter((r) => r.skipped).map((r) => ({ id: r.id, reason: r.skipped })),
      failed: results.filter((r) => !r.ok).map((r) => ({ id: r.id, error: r.error })),
      screens: done.map((r) => ({ id: r.id, route: r.route, ssim: r.metrics.ssim, madPct: r.metrics.madPct, shift: r.metrics.shift.significant ? [r.metrics.shift.dxPt, r.metrics.shift.dyPt] : null, warnings: r.warnings.length })),
    };
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    const md = [
      `# Comparación diseño ↔ render (${summary.generatedAt.slice(0, 16).replace('T', ' ')} UTC)`,
      '',
      `${done.length} comparadas · ${summary.skipped.length} sin escenario · ${summary.failed.length} con error`,
      '',
      '| Pantalla | Ruta | SSIM | MAD % | Desplazamiento | Avisos |',
      '|---|---|---|---|---|---|',
      ...summary.screens.sort((a, b) => a.ssim - b.ssim).map((s) => `| ${s.id} | ${s.route} | ${fmt(s.ssim)} | ${fmt(s.madPct, 1)} | ${s.shift ? `${s.shift[0]}, ${s.shift[1]} pt` : '—'} | ${s.warnings || ''} |`),
      '',
      ...(summary.failed.length ? ['## Errores', '', ...summary.failed.map((f) => `- **${f.id}**: ${f.error}`), ''] : []),
      ...(summary.skipped.length ? ['## Sin escenario', '', summary.skipped.map((s) => s.id).join(', '), ''] : []),
    ].join('\n');
    fs.writeFileSync(path.join(outDir, 'summary.md'), md);
    console.log(`\nResumen: ${done.length} comparadas, ${summary.skipped.length} sin escenario, ${summary.failed.length} con error · ${rel(path.join(outDir, 'summary.md'))} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  return exit;
}

function fileURLToPathSafe(u) {
  try {
    return fileURLToPath(u);
  } catch {
    return u;
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`✘ ${e && e.message ? e.message : e}`);
    process.exit(1);
  },
);
