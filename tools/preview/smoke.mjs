#!/usr/bin/env node
// Humo y flujos de la vista previa: abre dist-preview/mvc-preview.html en Chromium sin cabeza y ejecuta los flujos de
// tools/preview/flows/*.mjs. Falla si, durante cualquier flujo:
//   · hay un error de consola o una excepción no controlada;
//   · se hace una petición a cualquier origen que no sea el propio HTML (hermeticidad: data:/blob:/about: no cuentan);
//   · la app muestra texto como PendingScreen, TODO, Próximamente o lorem;
//   · la app intenta salir a Internet (shell.blocked no vacío).
//
//   npm --prefix mobile run preview:artifact                     construir antes
//   node tools/preview/smoke.mjs                                 todos los flujos
//   node tools/preview/smoke.mjs --flow boot,system              solo esos
//   node tools/preview/smoke.mjs --list                          lista los flujos
//   node tools/preview/smoke.mjs --url file:///…/mvc-app.html    la app suelta en vez del visor
//   node tools/preview/smoke.mjs --dev --flow search            contra el servidor de desarrollo (sin exportar; ver tools/preview/dev-server.sh)
//   node tools/preview/smoke.mjs --allow-console "ERR_INVALID_URL"   tolerar un error de consola concreto (regex; repetible)
//
// Opciones: --out <dir> (capturas e informe; por defecto dist-preview/smoke) · --viewport 1400x900 · --timeout <s por flujo> ·
//           --action-timeout <s por acción de Playwright, 10> · -v/--verbose (cada paso según termina) ·
//           --slice a,b · --route Nombre,Otra · --shots (los flujos que lo admiten, como «routes», acotan o fotografían) ·
//           --json (informe por la salida estándar) · --no-lock · --stale-ok (probar un HTML antiguo si la última compilación falló) ·
//           --headed no existe (siempre sin cabeza)
// Código de salida: 0 todo bien (los pasos saltados no fallan) · 1 algún flujo falla · 2 uso o prerrequisitos.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ensureHeavyLock } from './lib/heavy.mjs';
import { ARTIFACT, ARTIFACT_URL, DIST, TOOLS_PREVIEW, lastBuildFailure, launchChromium } from './lib/pw.mjs';
import { Session } from './lib/flow.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const optAll = (n) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]] : []));

const FLOWS_DIR = path.join(TOOLS_PREVIEW, 'flows');
const flowFiles = () => (fs.existsSync(FLOWS_DIR) ? fs.readdirSync(FLOWS_DIR).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort() : []);

async function loadFlow(file) {
  const mod = await import(pathToFileURL(path.join(FLOWS_DIR, file)).href);
  if (typeof mod.default !== 'function') throw new Error(`${file}: debe exportar por defecto una función async (s) => {…}`);
  return { name: path.basename(file, '.mjs'), meta: mod.meta ?? {}, run: mod.default };
}

if (flag('--list')) {
  for (const f of flowFiles()) {
    const { name, meta } = await loadFlow(f);
    console.log(`${name.padEnd(14)} ${meta.description ?? ''}`);
  }
  process.exit(0);
}

// --dev: contra el servidor de desarrollo único (tools/preview/dev-server.sh), sin exportar: la app va suelta (sin visor) con el puente inyectado.
const dev = flag('--dev');
const devOrigin = dev ? new URL(process.env.MVC_DEV_URL ?? 'http://localhost:8081').origin : null;
const url = dev ? `${devOrigin}/` : opt('--url', ARTIFACT_URL);
if (url === ARTIFACT_URL && !fs.existsSync(ARTIFACT)) {
  console.error(`✖ No existe ${path.relative(process.cwd(), ARTIFACT)}. Constrúyelo primero:  npm --prefix mobile run preview:artifact`);
  process.exit(2);
}
const failedBuild = url === ARTIFACT_URL && !flag('--stale-ok') ? lastBuildFailure() : null;
if (failedBuild) {
  console.error('✖ La última compilación de la vista previa FALLÓ (el árbol de la app no compilaba), así que el HTML que hay es antiguo.');
  for (const b of failedBuild.broken ?? []) console.error(`   · ${b}`);
  console.error('  Arregla lo anterior y vuelve a compilar (npm --prefix mobile run preview:artifact), o usa --stale-ok para probar el HTML antiguo a sabiendas.');
  process.exit(2);
}
if (dev && !process.env.MVC_HEAVY_LOCK_FILE) {
  // Dos «carriles» de Chromium para el servidor de desarrollo: no se espera detrás de las pruebas de integración del backend.
  const lanes = ['/tmp/mvc-ui-1.lock', '/tmp/mvc-ui-2.lock'];
  const free = lanes.find((f) => spawnSync('flock', ['-n', f, 'true'], { stdio: 'ignore' }).status === 0);
  process.env.MVC_HEAVY_LOCK_FILE = free ?? lanes[Math.floor(Math.random() * lanes.length)];
}
ensureHeavyLock('humo de la vista previa');

const outRoot = path.resolve(opt('--out', path.join(DIST, 'smoke')));
const viewportArg = /^(\d+)x(\d+)$/.exec(opt('--viewport', '1400x900'));
const viewport = viewportArg ? { width: +viewportArg[1], height: +viewportArg[2] } : { width: 1400, height: 900 };
const timeoutMs = Math.max(10, Number(opt('--timeout', '150'))) * 1000;
const actionTimeout = Math.max(1, Number(opt('--action-timeout', '10'))) * 1000;
const allowConsole = optAll('--allow-console');
const list = (n) => (opt(n, '') || '').split(',').map((x) => x.trim()).filter(Boolean);
const flowArgs = { slice: list('--slice'), route: list('--route'), shots: flag('--shots') };
const wanted = (opt('--flow', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

const files = flowFiles().filter((f) => !wanted.length || wanted.includes(path.basename(f, '.mjs')));
if (!files.length) {
  console.error(`✖ Ningún flujo coincide${wanted.length ? ` con «${wanted.join(', ')}»` : ''}. Flujos: ${flowFiles().map((f) => path.basename(f, '.mjs')).join(', ') || '(ninguno)'}`);
  process.exit(2);
}

fs.mkdirSync(outRoot, { recursive: true });
const browser = await launchChromium();
let currentSession = null;
process.on('unhandledRejection', (e) => {
  const msg = String(e && e.message ? e.message : e).split('\n')[0];
  if (/has been closed/i.test(msg)) return; // promesa de un flujo ya abandonado (tiempo agotado o fallo anterior)
  if (currentSession) currentSession.violations.push(`promesa rechazada sin capturar: ${msg.slice(0, 300)}`);
  else console.error(`promesa rechazada sin capturar: ${msg}`);
});
const results = [];
let failed = 0;
const t0 = Date.now();
for (const file of files) {
  const flow = await loadFlow(file);
  const onStep = flag('--verbose') || flag('-v') ? (st) => console.log(`    ${st.ok ? (st.skipped ? '–' : '·') : '✖'} ${st.name} (${(st.ms / 1000).toFixed(1)} s)${st.ok ? '' : ` → ${st.error}`}`) : null;
  const s = new Session(browser, { name: flow.name, url, dev: devOrigin, viewport: flow.meta.viewport ?? viewport, outDir: path.join(outRoot, flow.name), allowConsole: [...allowConsole, ...(flow.meta.allowConsole ?? [])], colorScheme: flow.meta.colorScheme ?? 'light', actionTimeout, onStep, args: flowArgs });
  const ft = Date.now();
  currentSession = s;
  let crashed = null;
  try {
    await s.start();
    const running = flow.run(s);
    running.catch(() => {}); // si el tiempo se agota, lo que el flujo falle después ya no importa
    let timer;
    const limit = Math.max(timeoutMs, (flow.meta.timeoutSeconds ?? 0) * 1000);
    await Promise.race([
      running,
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(`El flujo no ha terminado en ${Math.round(limit / 1000)} s`)), limit);
      }),
    ]).finally(() => clearTimeout(timer));
  } catch (e) {
    crashed = String(e && e.message ? e.message : e).split('\n')[0];
    try {
      await s.shot('crash');
    } catch {
      // sin captura
    }
  }
  s.aborted = true;
  const r = s.result();
  if (crashed) {
    r.ok = false;
    r.steps.push({ name: '(flujo)', ok: false, ms: 0, error: crashed });
  }
  r.ms = Date.now() - ft;
  results.push(r);
  if (!r.ok) failed++;
  await s.close();
  if (!flag('--json')) {
    const mark = r.ok ? '✔' : '✖';
    console.log(`${mark} ${flow.name} · ${r.steps.length} pasos · ${(r.ms / 1000).toFixed(1)} s · ${r.requests.length} petición(es) de red (solo el HTML)${flow.meta.description ? ` · ${flow.meta.description}` : ''}`);
    for (const st of r.steps) {
      if (!st.ok) console.log(`    ✖ ${st.name}: ${st.error}`);
      else if (st.skipped) console.log(`    – ${st.name} (saltado: ${st.skipped})`);
    }
    for (const v of r.violations) console.log(`    ! ${v}`);
    for (const n of r.notes) console.log(`    · ${n}`);
  }
}
await browser.close();

const report = { at: new Date().toISOString(), url, seconds: Math.round((Date.now() - t0) / 1000), flows: results, failed };
fs.writeFileSync(path.join(outRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
if (flag('--json')) console.log(JSON.stringify(report, null, 2));
else console.log(`\n${failed ? '✖' : '✔'} ${results.length - failed}/${results.length} flujos correctos en ${report.seconds} s · informe: ${path.relative(process.cwd(), path.join(outRoot, 'report.json'))}`);
process.exit(failed ? 1 : 0);
