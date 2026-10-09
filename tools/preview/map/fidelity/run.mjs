#!/usr/bin/env node
// Prueba de fidelidad del mapa: renderiza MvcMap (la implementación real, con el sustituto web de react-native-maps) a TAMAÑO DE
// LÁMINA para las 9 pantallas aprobadas con mapa, las coloca junto al recorte de la lámina y mide diferencias.
//
//   node tools/preview/map/fidelity/run.mjs                 (todo; ≈ 1 min; usa el bloqueo global de tareas pesadas)
//   node tools/preview/map/fidelity/run.mjs --scenes=09,22  (solo esas escenas)
//   node tools/preview/map/fidelity/run.mjs --no-build      (reutiliza design/out/map/harness)
//   node tools/preview/map/fidelity/run.mjs --no-free       (sin la escalera de zooms libres)
//   node tools/preview/map/fidelity/run.mjs --check         (sale con código 1 si alguna medida supera los umbrales documentados;
//                                                             las manchas de la lámina sin pareja se listan como «informativas», no fallan)
//
// Salidas (design/out/map/, ignorado por git):
//   scenes/<id>.png      el mapa de MvcMap a 2×, mismo tamaño que el recorte de la lámina
//   sbs/<id>.png         lámina | MvcMap, lado a lado
//   free/<zoom>.png      el mapa base a distintos zooms; free/ladder.png los junta
//   report.json, report.md   paleta (agua/verde/melocotón/naranja/blanco/gris), color medio y tamaño de los marcadores azules
//
// Qué se compara y qué NO: se coloca cada marcador y cada trazo en la POSICIÓN DE PANTALLA que tiene en la lámina, de modo que
// se comparan estilo, grosores, tipografía y tamaños con la misma composición. La geografía de fondo NO coincide (las láminas las
// dibujó un generador de imágenes y no son métricas): la paleta se compara por proporciones de color, no por posición.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureHeavyLock } from '../../lib/heavy.mjs';
import { launchChromium } from '../../lib/pw.mjs';
import { buildHarness, HARNESS_HTML } from './build.mjs';

ensureHeavyLock('fidelidad del mapa');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const DESIGN = path.join(ROOT, 'design');
const OUT = process.env.MVC_MAP_FIDELITY_OUT ?? path.join(DESIGN, 'out', 'map');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const BOXES = JSON.parse(fs.readFileSync(path.join(HERE, 'map-boxes.json'), 'utf8'));
delete BOXES._nota;
const wanted = opt('scenes')?.split(',').map((s) => s.trim()) ?? Object.keys(BOXES);
const FREE = [
  ['z09', 'lat=37.39&lng=-5.98&z=9.4'],
  ['z11', 'lat=37.39&lng=-5.98&z=11'],
  ['z12', 'lat=37.39&lng=-5.98&z=12'],
  ['z13', 'lat=37.385&lng=-5.995&z=13'],
  ['z14', 'lat=37.385&lng=-5.995&z=14'],
  ['z15', 'lat=37.385&lng=-5.995&z=15'],
  ['z16.5', 'lat=37.386&lng=-5.993&z=16.5'],
  ['z17.2', 'lat=37.3745&lng=-6.0075&z=17.2'],
];

// Umbrales de --check (pp = puntos porcentuales de superficie; pt = puntos lógicos). Documentados en docs/MAPS.md.
const LIMITS = { palettePP: 16, markerPt: 8, meanRGB: 14 };

// ───────────────────────────── Análisis (se ejecuta dentro de la página) ─────────────────────────────
async function analysePage({ designB64, box, mineB64, caption }) {
  const load = (b64) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('imagen no decodificable'));
      img.src = `data:image/png;base64,${b64}`;
    });
  const [dImg, mImg] = await Promise.all([load(designB64), load(mineB64)]);
  const W = box.w;
  const H = box.h;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c;
  };
  const dC = mk();
  const mC = mk();
  const dX = dC.getContext('2d', { willReadFrequently: true });
  const mX = mC.getContext('2d', { willReadFrequently: true });
  dX.drawImage(dImg, box.x, box.y, W, H, 0, 0, W, H);
  mX.fillStyle = '#fff';
  mX.fillRect(0, 0, W, H);
  mX.drawImage(mImg, 0, 0, Math.min(W, mImg.width), Math.min(H, mImg.height), 0, 0, Math.min(W, mImg.width), Math.min(H, mImg.height));

  const measure = (ctx) => {
    const { data } = ctx.getImageData(0, 0, W, H);
    const n = W * H;
    const counts = { agua: 0, azulMarca: 0, verde: 0, melocoton: 0, naranja: 0, blanco: 0, gris: 0 };
    const deep = new Uint8Array(n);
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let i = 0; i < n; i++) {
      const R = data[i * 4];
      const G = data[i * 4 + 1];
      const B = data[i * 4 + 2];
      sr += R;
      sg += G;
      sb += B;
      const r = R / 255;
      const g = G / 255;
      const b = B / 255;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const d = mx - mn;
      const sat = mx > 0 ? d / mx : 0;
      let h = 0;
      if (d > 1e-6) {
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
      }
      const water = h > 190 && h < 235 && sat > 0.14;
      const blueDeep = h > 190 && h < 260 && sat > 0.7 && mx > 0.5;
      const green = h > 70 && h < 170 && sat > 0.07 && !water;
      const orange = h > 20 && h < 48 && sat > 0.24 && mx > 0.85;
      const peach = h >= 15 && h <= 55 && sat > 0.045 && sat <= 0.24 && mx > 0.85;
      const white = mx > 0.965 && sat < 0.035;
      const gray = sat <= 0.045 && !white;
      if (water && !blueDeep) counts.agua++;
      if (blueDeep) {
        counts.azulMarca++;
        deep[i] = 1;
      }
      if (green && !blueDeep) counts.verde++;
      if (orange) counts.naranja++;
      if (peach && !orange) counts.melocoton++;
      if (white) counts.blanco++;
      if (gray) counts.gris++;
    }
    const frac = {};
    for (const k of Object.keys(counts)) frac[k] = counts[k] / n;

    // Componentes conexas del «azul de marca» (pins, anillos, clústeres, coches y trazos de ruta).
    const label = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n);
    const blobs = [];
    for (let s = 0; s < n; s++) {
      if (!deep[s] || label[s] !== -1) continue;
      let sp = 0;
      stack[sp++] = s;
      label[s] = blobs.length;
      let area = 0;
      let boundary = 0;
      let x0 = W;
      let y0 = H;
      let x1 = 0;
      let y1 = 0;
      let sx = 0;
      let sy = 0;
      while (sp) {
        const p = stack[--sp];
        const x = p % W;
        const y = (p - x) / W;
        area++;
        sx += x;
        sy += y;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        let edge = false;
        const around = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
        for (const q of around) {
          if (q < 0 || !deep[q]) {
            edge = true;
            continue;
          }
          if (label[q] === -1) {
            label[q] = blobs.length;
            stack[sp++] = q;
          }
        }
        if (edge) boundary++;
      }
      blobs.push({ area, w: x1 - x0 + 1, h: y1 - y0 + 1, cx: sx / area, cy: sy / area, boundary });
    }
    const pins = blobs.filter((b) => b.area >= 450 && Math.max(b.w, b.h) <= 110 && Math.max(b.w, b.h) / Math.min(b.w, b.h) <= 3).sort((a, b) => b.area - a.area);
    const strokes = blobs.filter((b) => b.area >= 800 && Math.max(b.w, b.h) > 140).sort((a, b) => b.area - a.area);
    return {
      frac,
      meanRGB: [sr / n, sg / n, sb / n],
      pins: pins.slice(0, 12).map((b) => ({ cx: b.cx, cy: b.cy, w: b.w, h: b.h, area: b.area })),
      // grosor de un trazo ≈ 2·área / perímetro (aprox.; incluye marcadores pegados al trazo)
      strokeThicknessPx: strokes.length ? (2 * strokes[0].area) / Math.max(1, strokes[0].boundary) : null,
    };
  };

  const design = measure(dX);
  const mine = measure(mX);

  // Compuesto lado a lado con rótulos.
  const CAP = 30;
  const GAP = 14;
  const out = document.createElement('canvas');
  out.width = W * 2 + GAP;
  out.height = H + CAP;
  const o = out.getContext('2d');
  o.fillStyle = '#fff';
  o.fillRect(0, 0, out.width, out.height);
  o.fillStyle = '#222';
  o.font = '600 15px sans-serif';
  o.textBaseline = 'middle';
  o.fillText(caption[0], 8, CAP / 2);
  o.fillText(caption[1], W + GAP + 8, CAP / 2);
  o.drawImage(dC, 0, CAP);
  o.drawImage(mC, W + GAP, CAP);
  return { design, mine, png: out.toDataURL('image/png') };
}

async function ladderPage({ images, cols, cellW, cellH }) {
  const load = (b64) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('imagen no decodificable'));
      img.src = `data:image/png;base64,${b64}`;
    });
  const imgs = await Promise.all(images.map((i) => load(i.b64)));
  const rows = Math.ceil(imgs.length / cols);
  const PAD = 10;
  const CAP = 24;
  const c = document.createElement('canvas');
  c.width = cols * (cellW + PAD) + PAD;
  c.height = rows * (cellH + CAP + PAD) + PAD;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.font = '600 14px sans-serif';
  x.textBaseline = 'middle';
  imgs.forEach((img, i) => {
    const cx = PAD + (i % cols) * (cellW + PAD);
    const cy = PAD + Math.floor(i / cols) * (cellH + CAP + PAD);
    x.fillStyle = '#222';
    x.fillText(images[i].label, cx, cy + CAP / 2);
    x.drawImage(img, 0, 0, img.width, img.height, cx, cy + CAP, cellW, cellH);
  });
  return c.toDataURL('image/png');
}

// ───────────────────────────── Ejecución ─────────────────────────────
const PCT = (v) => `${(v * 100).toFixed(1)}%`;
const CLASSES = [
  ['agua', 'agua'],
  ['verde', 'verde'],
  ['melocoton', 'melocotón'],
  ['naranja', 'naranja'],
  ['blanco', 'blanco'],
  ['gris', 'gris'],
  ['azulMarca', 'azul marca'],
];
const dataUrlToBuffer = (u) => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64');

if (!flag('no-build')) {
  await buildHarness();
  console.log('› banco de pruebas compilado');
} else if (!fs.existsSync(HARNESS_HTML)) {
  console.error('! Falta design/out/map/harness (quita --no-build).');
  process.exit(1);
}
for (const d of ['scenes', 'sbs', 'free']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
const problems = [];

async function shoot(query, label) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${label}: pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${label}: console.error ${m.text()}`);
  });
  await page.goto(`${pathToFileURL(HARNESS_HTML).href}?${query}`);
  await page.waitForSelector('[data-testid="scene"]', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900); // primer dibujo + marcadores (tracksViewChanges)
  const el = await page.$('[data-testid="scene"]');
  const buf = await el.screenshot();
  await page.close();
  return buf;
}

const work = await ctx.newPage();
await work.goto('about:blank');
const report = { generatedBy: 'tools/preview/map/fidelity/run.mjs', dpr: 2, scenes: {}, limits: LIMITS, problems };

for (const id of wanted) {
  const box = BOXES[id];
  if (!box) {
    problems.push(`escena desconocida: ${id}`);
    continue;
  }
  const mine = await shoot(`scene=${id}`, `escena ${id}`);
  fs.writeFileSync(path.join(OUT, 'scenes', `${id}.png`), mine);
  const designFile = path.join(DESIGN, box.screen);
  if (!fs.existsSync(designFile)) {
    problems.push(`${id}: falta ${box.screen}`);
    continue;
  }
  const res = await work.evaluate(analysePage, {
    designB64: fs.readFileSync(designFile).toString('base64'),
    box: { x: box.x, y: box.y, w: box.w, h: box.h },
    mineB64: mine.toString('base64'),
    caption: [`lámina ${id} · ${box['pantalla']}`, 'MvcMap (web) · mismo tamaño'],
  });
  fs.writeFileSync(path.join(OUT, 'sbs', `${id}.png`), dataUrlToBuffer(res.png));

  // Emparejar marcadores: cada «blob» de la lámina con el más cercano (≤ 40 px a 2×) del mapa.
  const pairs = [];
  const used = new Set();
  for (const d of res.design.pins) {
    let best = -1;
    let bd = 40;
    res.mine.pins.forEach((m, i) => {
      const dist = Math.hypot(m.cx - d.cx, m.cy - d.cy);
      if (!used.has(i) && dist < bd) {
        bd = dist;
        best = i;
      }
    });
    if (best >= 0) {
      used.add(best);
      const m = res.mine.pins[best];
      pairs.push({ at: [Math.round(d.cx / 2), Math.round(d.cy / 2)], designPt: [d.w / 2, d.h / 2], minePt: [m.w / 2, m.h / 2], dWpt: (m.w - d.w) / 2, dHpt: (m.h - d.h) / 2 });
    } else {
      pairs.push({ at: [Math.round(d.cx / 2), Math.round(d.cy / 2)], designPt: [d.w / 2, d.h / 2], minePt: null });
    }
  }
  const deltas = {};
  for (const [k] of CLASSES) deltas[k] = (res.mine.frac[k] - res.design.frac[k]) * 100;
  const meanDelta = Math.max(...res.design.meanRGB.map((v, i) => Math.abs(v - res.mine.meanRGB[i])));
  report.scenes[id] = {
    pantalla: box['pantalla'],
    sizePt: [box.w / 2, box.h / 2],
    design: { frac: res.design.frac, meanRGB: res.design.meanRGB, strokePt: res.design.strokeThicknessPx === null ? null : res.design.strokeThicknessPx / 2 },
    mine: { frac: res.mine.frac, meanRGB: res.mine.meanRGB, strokePt: res.mine.strokeThicknessPx === null ? null : res.mine.strokeThicknessPx / 2 },
    deltaPP: deltas,
    meanRGBMaxDelta: meanDelta,
    markers: pairs,
  };
  console.log(`✓ ${id}  Δ(pp) ${CLASSES.map(([k, n]) => `${n} ${deltas[k] >= 0 ? '+' : ''}${deltas[k].toFixed(1)}`).join(' · ')}`);
}

// Escalera de zooms libres (sin comparar con láminas: solo para revisar el mapa base).
if (!flag('no-free')) {
  const shots = [];
  for (const [name, q] of FREE) {
    const buf = await shoot(`free=1&w=393&h=600&${q}`, `libre ${name}`);
    fs.writeFileSync(path.join(OUT, 'free', `${name}.png`), buf);
    shots.push({ b64: buf.toString('base64'), label: name.replace('z', 'zoom ') });
  }
  const url = await work.evaluate(ladderPage, { images: shots, cols: 4, cellW: 393, cellH: 600 });
  fs.writeFileSync(path.join(OUT, 'free', 'ladder.png'), dataUrlToBuffer(url));
  console.log(`✓ escalera de zooms (${FREE.length}) → free/ladder.png`);
}
await browser.close();

// ───────────────────────────── Informe ─────────────────────────────
const lines = [];
lines.push('# Fidelidad del mapa — informe automático', '');
lines.push(`Generado por \`tools/preview/map/fidelity/run.mjs\` (DPR 2). Las columnas «lámina» y «mapa» son proporciones de superficie de cada clase de color en el recorte; Δ en puntos porcentuales (mapa − lámina).`, '');
lines.push('| escena | ' + CLASSES.map(([, n]) => `${n} (lámina → mapa, Δ)`).join(' | ') + ' | color medio (lámina → mapa) |');
lines.push('|---|' + CLASSES.map(() => '---').join('|') + '|---|');
const failures = [];
const notes = [];
for (const [id, s] of Object.entries(report.scenes)) {
  const cells = CLASSES.map(([k]) => `${PCT(s.design.frac[k])} → ${PCT(s.mine.frac[k])}, ${s.deltaPP[k] >= 0 ? '+' : ''}${s.deltaPP[k].toFixed(1)}`);
  const rgb = (v) => v.map((x) => Math.round(x)).join(',');
  lines.push(`| ${id} | ${cells.join(' | ')} | ${rgb(s.design.meanRGB)} → ${rgb(s.mine.meanRGB)} |`);
  for (const [k, n] of CLASSES) {
    if (['naranja', 'azulMarca'].includes(k)) continue; // fracciones diminutas: no se acotan
    if (Math.abs(s.deltaPP[k]) > LIMITS.palettePP) failures.push(`${id}: ${n} difiere ${s.deltaPP[k].toFixed(1)} pp (límite ${LIMITS.palettePP})`);
  }
  if (s.meanRGBMaxDelta > LIMITS.meanRGB) failures.push(`${id}: color medio difiere ${s.meanRGBMaxDelta.toFixed(1)} (límite ${LIMITS.meanRGB})`);
  for (const m of s.markers) {
    if (!m.minePt) notes.push(`${id}: mancha azul de la lámina en (${m.at.join(',')}) pt, ${m.designPt.join(' × ')} pt, sin pareja en el mapa (informativo: puede ser un rótulo/escudo/trazo que la geografía propia no reproduce)`);
    else if (Math.abs(m.dWpt) > LIMITS.markerPt || Math.abs(m.dHpt) > LIMITS.markerPt) failures.push(`${id}: marcador en (${m.at.join(',')}) difiere ${m.dWpt.toFixed(1)} × ${m.dHpt.toFixed(1)} pt (límite ${LIMITS.markerPt})`);
  }
}
lines.push('', '## Marcadores azules (ancho × alto en pt; lámina → mapa)', '');
lines.push('Cada «mancha» de azul de marca (pin, anillo, clúster, coche) de la lámina emparejada con la más cercana del mapa. Si una mancha incluye el borde blanco o una cola del trazo, las dos se miden igual, pero la comparación es aproximada.', '');
lines.push('| escena | posición (pt) | lámina | mapa | Δ ancho | Δ alto |', '|---|---|---|---|---|---|');
for (const [id, s] of Object.entries(report.scenes)) {
  for (const m of s.markers) {
    const f = (v) => v.map((x) => x.toFixed(1)).join(' × ');
    lines.push(`| ${id} | ${m.at.join(', ')} | ${f(m.designPt)} | ${m.minePt ? f(m.minePt) : '—'} | ${m.minePt ? m.dWpt.toFixed(1) : '—'} | ${m.minePt ? m.dHpt.toFixed(1) : '—'} |`);
  }
}
lines.push('', '## Grosor estimado del trazo (pt; 2·área/perímetro del mayor trazo azul)', '', '| escena | lámina | mapa |', '|---|---|---|');
for (const [id, s] of Object.entries(report.scenes)) lines.push(`| ${id} | ${s.design.strokePt === null ? '—' : s.design.strokePt.toFixed(1)} | ${s.mine.strokePt === null ? '—' : s.mine.strokePt.toFixed(1)} |`);
lines.push('', failures.length ? `## Fuera de umbral (${failures.length})\n\n${failures.map((f) => `- ${f}`).join('\n')}` : '## Todas las medidas dentro de los umbrales', '');
if (notes.length) lines.push(`## Manchas de la lámina sin pareja (${notes.length}, informativo)`, '', ...notes.map((n) => `- ${n}`), '');
lines.push(`Umbrales de \`--check\`: paleta ±${LIMITS.palettePP} pp por clase (agua, verde, melocotón, blanco, gris), color medio ±${LIMITS.meanRGB} niveles RGB, marcadores ±${LIMITS.markerPt} pt.`, '');
if (problems.length) lines.push('## Problemas durante la ejecución', '', ...problems.map((p) => `- ${p}`), '');
report.failures = failures;
report.notes = notes;
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n'));
console.log(`informe → ${path.relative(ROOT, path.join(OUT, 'report.md'))}`);
if (failures.length) console.log(`${failures.length} medida(s) fuera de umbral:\n  - ${failures.join('\n  - ')}`);
if (notes.length) console.log(`${notes.length} mancha(s) de la lámina sin pareja en el mapa (informativo):\n  - ${notes.join('\n  - ')}`);
if (problems.length) {
  console.error(`✗ ${problems.length} problema(s) de ejecución:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
if (flag('check') && failures.length) process.exit(1);
