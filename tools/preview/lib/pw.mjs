// Ayudas de Playwright compartidas por tools/design/compare.mjs, tools/preview/smoke.mjs y los flujos de cada slice.
//
// Playwright: se busca (en este orden) en PW_MODULE, tools/preview/node_modules, <repo>/node_modules, mobile/node_modules y
// en la instalación global (/opt/node22/lib/node_modules/playwright). No hace falta instalar nada si existe la global.
// Chromium: CHROME_PATH o /opt/pw-browsers/chromium.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TOOLS_PREVIEW = path.resolve(HERE, '..');
export const ROOT = path.resolve(HERE, '../../..');
export const DIST = path.join(ROOT, 'dist-preview');
export const ARTIFACT = path.join(DIST, 'mvc-preview.html');
export const ARTIFACT_URL = pathToFileURL(ARTIFACT).href;

const CANDIDATES = [
  process.env.PW_MODULE,
  path.join(TOOLS_PREVIEW, 'node_modules', 'playwright-core'),
  path.join(TOOLS_PREVIEW, 'node_modules', 'playwright'),
  path.join(ROOT, 'node_modules', 'playwright-core'),
  path.join(ROOT, 'node_modules', 'playwright'),
  path.join(ROOT, 'mobile', 'node_modules', 'playwright-core'),
  '/opt/node22/lib/node_modules/playwright',
  '/opt/node22/lib/node_modules/playwright-core',
].filter(Boolean);

export function loadPlaywright() {
  for (const dir of CANDIDATES) {
    try {
      if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
      const req = createRequire(path.join(dir, 'package.json'));
      return req(dir);
    } catch {
      // siguiente candidato
    }
  }
  throw new Error(`No se encuentra Playwright. Prueba: PW_MODULE=/ruta/a/playwright o instala playwright-core en tools/preview. Buscado en:\n  ${CANDIDATES.join('\n  ')}`);
}

export function chromePath() {
  const p = process.env.CHROME_PATH ?? ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((c) => fs.existsSync(c));
  return p; // undefined → Playwright usa su propio navegador descargado
}

export async function launchChromium(extra = {}) {
  const { chromium } = loadPlaywright();
  return chromium.launch({
    executablePath: chromePath(),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars'],
    ...extra,
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Devuelve el marco (Frame) de la app: el que tiene `window.__mvc` (puente de pruebas de la app) o, con
 * `requireBridge: false`, el que tiene `window.__MVC_PREVIEW_SHELL__` (lo instala inner.js aunque la app aún no tenga puente).
 * Modo suelto: es el propio documento. Con visor: el iframe. Espera hasta `timeout` ms.
 */
export async function findAppFrame(page, { timeout = 60000, requireBridge = true } = {}) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeout) {
    const frames = [...page.frames()].sort((a, b) => (a === page.mainFrame() ? 1 : 0) - (b === page.mainFrame() ? 1 : 0)); // primero los hijos
    for (const f of frames) {
      try {
        const info = await f.evaluate(() => ({ has: !!(window.__mvc && typeof window.__mvc.open === 'function'), shell: !!window.__MVC_PREVIEW_SHELL__, url: location.href.slice(0, 60) }));
        last = JSON.stringify(info);
        if (info.has) return f;
        if (!requireBridge && info.shell) return f;
      } catch {
        // el marco aún no tiene contexto
      }
    }
    await sleep(250);
  }
  throw new Error(
    requireBridge
      ? `La app no ha expuesto window.__mvc en ${Math.round(timeout / 1000)} s (último estado: ${last || 'sin marcos'}). ¿Está montada la vista previa (EXPO_PUBLIC_PREVIEW=1) y existe src/preview/install.ts?`
      : `No aparece el documento de la app (window.__MVC_PREVIEW_SHELL__) en ${Math.round(timeout / 1000)} s (último estado: ${last || 'sin marcos'}).`,
  );
}

/** Espera a que `__mvc.ready()` sea true. */
export async function waitAppReady(frame, { timeout = 60000 } = {}) {
  await frame.waitForFunction(() => !!(window.__mvc && window.__mvc.ready && window.__mvc.ready()), null, { timeout });
}

/**
 * «Red inactiva + fuentes + imágenes + DOM quieto»: espera a que la pantalla deje de cambiar.
 *  - __mvc.idle() (peticiones del backend en el navegador en vuelo), si existe.
 *  - document.fonts.ready y todas las <img> completas.
 *  - ventana sin mutaciones de DOM (se ignoran los cambios de `style`: las animaciones en bucle no bloquean).
 */
export async function settleApp(frame, { quietMs = 350, minMs = 450, timeoutMs = 12000, idleMs = 8000 } = {}) {
  await frame.evaluate(async (t) => {
    const m = window.__mvc;
    if (m && typeof m.idle === 'function') {
      try {
        await m.idle(t);
      } catch (e) {
        // sin idle fiable: se sigue con la espera por DOM
      }
    }
  }, idleMs);
  return frame.evaluate(
    ({ quietMs, minMs, timeoutMs }) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        let last = t0;
        const mo = new MutationObserver((list) => {
          for (const m of list) {
            if (m.type === 'attributes' && m.attributeName === 'style') continue;
            last = performance.now();
            return;
          }
        });
        mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        const pendingImages = () => [...document.images].some((i) => !i.complete);
        const tick = async () => {
          const now = performance.now();
          try {
            await document.fonts.ready;
          } catch (e) {
            // sin API de fuentes
          }
          if (pendingImages()) last = performance.now();
          const timedOut = now - t0 > timeoutMs;
          if ((now - last >= quietMs && now - t0 >= minMs) || timedOut) {
            mo.disconnect();
            requestAnimationFrame(() => requestAnimationFrame(() => resolve({ waitedMs: Math.round(performance.now() - t0), timedOut })));
            return;
          }
          setTimeout(tick, 60);
        };
        tick();
      }),
    { quietMs, minMs, timeoutMs },
  );
}

/** Parámetros de URL del visor (ver tools/preview/shell/API.md §6). */
export function viewerUrl(base, params = {}) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  return u.href;
}

/**
 * Vigila la red: cualquier petición que no sea del propio HTML (data:, blob:, about: y el documento de entrada se
 * ignoran) es una violación de la hermeticidad. `entries` = URL de los HTML de entrada permitidos (sin consulta).
 */
export function watchNetwork(page, { allow = () => false, allowWebSocket = () => false, entries = [], onViolation }) {
  const strip = (u) => String(u).split('#')[0].split('?')[0];
  // Documentos de entrada permitidos: el visor, la app suelta y los que pase quien llama (p. ej. --url de smoke.mjs).
  const entry = new Set([...entries, ARTIFACT_URL, pathToFileURL(path.join(DIST, 'mvc-app.html')).href].map(strip));
  const requests = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/^(data|blob|about):/i.test(u)) return;
    requests.push(`${r.method()} ${u.slice(0, 160)}`);
    const base = strip(u);
    if (entry.has(base) || base === strip(page.url())) return;
    if (allow(u)) return;
    onViolation(`petición fuera del HTML: ${r.method()} ${u.slice(0, 200)}`);
  });
  page.on('websocket', (ws) => {
    if (!allowWebSocket(ws.url())) onViolation(`websocket: ${ws.url()}`);
  });
  return { requests };
}

/**
 * Si la última compilación de la vista previa FALLÓ (el árbol de la app no compilaba), el HTML que haya en dist-preview es
 * antiguo y probarlo daría una falsa tranquilidad. Devuelve el informe de fallo o `null`.
 */
export function lastBuildFailure() {
  try {
    const rep = JSON.parse(fs.readFileSync(path.join(DIST, 'build-report.json'), 'utf8'));
    return rep && rep.exportFailed ? rep : null;
  } catch {
    return null;
  }
}
