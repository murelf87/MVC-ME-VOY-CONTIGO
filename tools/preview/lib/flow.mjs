// Sesión de prueba sobre la vista previa: una página de Chromium con vigilancia de errores, red y texto prohibido.
// La usan tools/preview/smoke.mjs y los flujos de cada slice (tools/preview/flows/*.mjs). Documentación: tools/preview/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ARTIFACT_URL, DIST, TOOLS_PREVIEW, findAppFrame, settleApp, sleep, watchNetwork } from './pw.mjs';

/**
 * Texto que NUNCA debe verse en la app (ningún marcador de obra, ninguna promesa vacía).
 * El patrón del encargo es /PendingScreen|TODO|Próximamente|lorem/i; con la «i», «todo» (palabra normalísima en español:
 * «Todo listo», «todos los viajes») daría falsos positivos en cualquier pantalla, así que TODO se busca aparte, como
 * marcador de obra (TODO:, TODO(…)), y distinguiendo mayúsculas. Además se añade el texto visible real de la pantalla
 * provisional del andamiaje («Pantalla sin implementar») y se mira el DOM (data-testid="<Ruta>.pending").
 */
export const FORBIDDEN_TEXT = /PendingScreen|Pantalla sin implementar|Pr[oó]ximamente|\blorem\b|coming soon|\bFIXME\b/i;
export const FORBIDDEN_TODO = /\bTODO\s*[:(\[]/;
export function findForbidden(text) {
  const m = FORBIDDEN_TEXT.exec(text) || FORBIDDEN_TODO.exec(text);
  return m ? { word: m[0], index: m.index } : null;
}

export class SkipSignal extends Error {
  constructor(reason) {
    super(reason);
    this.skip = true;
  }
}

export class Session {
  constructor(browser, { name, url = ARTIFACT_URL, viewport = { width: 1400, height: 900 }, outDir, allowConsole = [], colorScheme = 'light', contextOptions = {}, actionTimeout = 10000, onStep = null, args = {}, dev = null }) {
    this.browser = browser;
    this.name = name;
    this.url = url;
    this.viewport = viewport;
    this.outDir = outDir;
    this.allowConsole = allowConsole.map((r) => (r instanceof RegExp ? r : new RegExp(r, 'i')));
    this.colorScheme = colorScheme;
    this.contextOptions = contextOptions;
    this.args = args; // opciones de la línea de órdenes para los flujos: { slice: string[], route: string[], shots: boolean }
    this.dev = dev; // origen del servidor de desarrollo (p. ej. http://localhost:8081) o null: la app va suelta, con el visor inyectado (como `compare.mjs --dev`)
    this.actionTimeout = actionTimeout; // tiempo máximo de cada acción de Playwright (clic, espera de elemento)
    this.onStep = onStep;
    this.aborted = false; // lo activa smoke.mjs si el flujo agota su tiempo: los pasos pendientes dejan de ejecutarse
    this.violations = []; // fallos globales (consola, red, texto prohibido)
    this.consoleErrors = [];
    this.steps = [];
    this.notes = [];
    this.shots = [];
    this._frame = null;
    this.allowBlocked = false; // un flujo que PRUEBA el corte de red lo activa para no contarlo como fallo
    this.extraEntries = new Set(); // otros HTML locales permitidos como documento de entrada (openLocal)
  }

  async start() {
    this.context = await this.browser.newContext({ viewport: this.viewport, deviceScaleFactor: 1, locale: 'es-ES', timezoneId: 'Europe/Madrid', colorScheme: this.colorScheme, ...this.contextOptions });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.actionTimeout);
    this.page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (this.allowConsole.some((r) => r.test(text))) return;
      this.consoleErrors.push(text.slice(0, 400));
      this.violations.push(`error de consola: ${text.slice(0, 300)}`);
    });
    this.page.on('pageerror', (e) => {
      const text = String(e && e.message ? e.message : e);
      if (this.allowConsole.some((r) => r.test(text))) return;
      this.violations.push(`excepción no controlada: ${text.slice(0, 300)}`);
    });
    this.network = watchNetwork(this.page, {
      entries: [this.url],
      allow: (u) => this.extraEntries.has(String(u).split('#')[0].split('?')[0]) || (this.dev !== null && String(u).startsWith(this.dev)),
      allowWebSocket: (u) => this.dev !== null && String(u).replace(/^ws/, 'http').startsWith(this.dev),
      onViolation: (v) => this.violations.push(v),
    });
    fs.rmSync(this.outDir, { recursive: true, force: true }); // sin capturas viejas de ejecuciones anteriores
    fs.mkdirSync(this.outDir, { recursive: true });
    return this;
  }

  /** Abre el visor (o la app suelta si `url` es mvc-app.html) con una cadena de consulta y espera a que la app arranque. */
  async open(query = '', { requireBridge = false, timeout = 60000 } = {}) {
    const u = new URL(this.url);
    if (this.dev !== null) u.searchParams.set('chrome', '0');
    for (const [k, v] of new URLSearchParams(query)) u.searchParams.set(k, v);
    if (this.dev !== null && !this._innerInjected) {
      // Servidor de desarrollo: no hay visor, así que se inyecta el puente del visor dentro de la app (igual que compare.mjs --dev).
      // Como guion de INICIO (antes del bundle), igual que en el artefacto exportado (inner.js va en <head>): así el guardián de
      // red de inner.js queda DEBAJO del fetch del backend simulado. Inyectado después de cargar, el guardián tapaba el API
      // simulado y toda petición de la app fallaba («Failed to fetch»): las pantallas se comparaban sin datos.
      const shellJs = path.join(TOOLS_PREVIEW, 'shell', 'inner.js');
      await this.page.addInitScript(`window.__MVC_DEV_ORIGIN__ = ${JSON.stringify(String(this.dev).replace(/\/$/, ''))};`);
      if (fs.existsSync(shellJs)) await this.page.addInitScript({ path: shellJs });
      this._innerInjected = true;
    }
    await this.page.goto(u.href);
    this._frame = await findAppFrame(this.page, { timeout, requireBridge });
    await this.waitReady(timeout);
    return this._frame;
  }

  /** Abre un HTML local que no es el visor (p. ej. el arnés de los sustitutos web) y lo da por válido como documento de entrada. */
  async openLocal(file, query = '') {
    const u = new URL(pathToFileURL(file).href);
    this.extraEntries.add(u.href.split('#')[0].split('?')[0]);
    for (const [k, v] of new URLSearchParams(query)) u.searchParams.set(k, v);
    await this.page.goto(u.href);
    return u.href;
  }

  async waitReady(timeout = 60000) {
    const isViewer = await this.page.evaluate(() => !!window.__mvcViewer);
    if (isViewer) await this.page.evaluate((t) => window.__mvcViewer.whenReady(t), timeout);
    else await this.app.waitForFunction(() => !!document.querySelector('#root') && document.querySelector('#root').childElementCount > 0, null, { timeout });
    await settleApp(this.app, { timeoutMs: 8000 });
  }

  /** Marco de la app (se vuelve a buscar si el visor lo ha recreado, p. ej. tras cambiar de perfil). */
  get app() {
    if (this._frame && !this._frame.isDetached()) return this._frame;
    const f = this.page.frames().find((fr) => fr !== this.page.mainFrame());
    this._frame = f || this.page.mainFrame();
    return this._frame;
  }
  async refreshApp(requireBridge = false) {
    this._frame = await findAppFrame(this.page, { timeout: 30000, requireBridge });
    return this._frame;
  }

  async hasBridge() {
    try {
      return await this.app.evaluate(() => !!(window.__mvc && typeof window.__mvc.open === 'function'));
    } catch {
      return false;
    }
  }
  /** Cierra los diálogos del sistema simulado que hayan quedado abiertos (no hace nada si no hay visor). */
  async resetSystem() {
    try {
      await this.page.evaluate(() => (window.__mvcViewer && window.__mvcViewer.resetDialogs ? window.__mvcViewer.resetDialogs() : 0));
    } catch {
      // la página ya no existe
    }
  }
  skip(reason) {
    throw new SkipSignal(reason);
  }
  async requireBridge() {
    if (!(await this.hasBridge())) this.skip('la app aún no expone window.__mvc (src/preview/install.ts): este flujo necesita saltar de pantalla');
  }

  expect(cond, msg) {
    if (!cond) throw new Error(`Se esperaba: ${msg}`);
  }
  note(msg) {
    this.notes.push(msg);
  }

  async step(name, fn) {
    if (this.aborted) return false;
    const t0 = Date.now();
    const rec = { name, ok: true, ms: 0 };
    this.steps.push(rec);
    try {
      await fn();
    } catch (e) {
      if (e && e.skip) {
        rec.skipped = e.message;
        rec.ok = true;
      } else {
        rec.ok = false;
        rec.error = String(e && e.message ? e.message : e).split('\n')[0].slice(0, 400);
        try {
          await this.shot(`fallo-${this.steps.length}`);
        } catch {
          // sin captura
        }
        await this.resetSystem(); // que un fallo no deje abierto un diálogo y arrastre a los pasos siguientes
      }
    }
    rec.ms = Date.now() - t0;
    if (this.onStep) this.onStep(rec);
    return rec.ok;
  }

  /** Captura la página entera del visor. `delay` (ms, 350) deja terminar las animaciones de entrada de los diálogos. */
  async shot(name, { delay = 350, ...opts } = {}) {
    const file = path.join(this.outDir, `${name.replace(/[^\w.-]+/g, '_')}.png`);
    if (delay > 0 && !this.aborted) await this.page.waitForTimeout(delay);
    await this.page.screenshot({ path: file, ...opts });
    this.shots.push(path.relative(DIST, file));
    return file;
  }

  /** Texto visible de la app. */
  async appText() {
    return this.app.evaluate(() => document.body.innerText || '');
  }
  /** Falla si la app muestra un marcador de obra (PendingScreen, TODO:, Próximamente, lorem…) o es una ruta sin implementar. */
  async checkForbiddenText(where = 'pantalla') {
    const text = await this.appText();
    const m = findForbidden(text);
    let ok = true;
    if (m) {
      const at = Math.max(0, m.index - 30);
      this.violations.push(`texto prohibido «${m.word}» en ${where}: …${text.slice(at, at + 90).replace(/\s+/g, ' ')}…`);
      ok = false;
    }
    const pending = await this.pendingRoutes();
    if (pending.length) {
      this.violations.push(`ruta sin implementar (PendingScreen) en ${where}: ${pending.join(', ')}`);
      ok = false;
    }
    return ok;
  }
  /** Rutas del andamiaje que se están mostrando ahora (data-testid="<Ruta>.pending"). */
  async pendingRoutes() {
    try {
      return await this.app.evaluate(() => Array.from(document.querySelectorAll('[data-testid$=".pending"]')).map((e) => e.getAttribute('data-testid').replace(/\.pending$/, '')));
    } catch {
      return [];
    }
  }
  /** Peticiones cortadas por inner.js (la app intentó salir a Internet). */
  async checkBlocked(where = 'pantalla') {
    if (this.allowBlocked) return;
    const blocked = await this.page.evaluate(() => (window.__mvcViewer ? window.__mvcViewer.blocked() : []));
    if (blocked.length) this.violations.push(`la app intentó salir a Internet en ${where}: ${blocked.slice(0, 3).map((b) => `${b.kind} ${b.url}`).join('; ')}`);
  }

  async waitText(textOrRe, timeout = 15000) {
    const re = textOrRe instanceof RegExp ? textOrRe : new RegExp(String(textOrRe).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    await this.app.waitForFunction((src) => new RegExp(src.s, src.f).test(document.body.innerText || ''), { s: re.source, f: re.flags }, { timeout });
  }
  /** Evalúa en el documento de la app. */
  inApp(fn, arg) {
    return this.app.evaluate(fn, arg);
  }
  /** Evalúa en el visor (documento exterior). */
  inViewer(fn, arg) {
    return this.page.evaluate(fn, arg);
  }
  /** Los eventos del visor llegan a la app por postMessage (asíncronos): se espera a que se cumpla, no se lee a ciegas. */
  async until(fn, arg, what, timeout = 4000) {
    try {
      await this.app.waitForFunction(fn, arg, { timeout });
    } catch {
      throw new Error(`Se esperaba (en ${Math.round(timeout / 1000)} s): ${what}`);
    }
  }
  /** Igual que `until`, pero la condición se evalúa en el visor. */
  async untilViewer(fn, arg, what, timeout = 4000) {
    try {
      await this.page.waitForFunction(fn, arg, { timeout });
    } catch {
      throw new Error(`Se esperaba (en ${Math.round(timeout / 1000)} s): ${what}`);
    }
  }
  tid(id) {
    return this.app.locator(`[data-testid="${id}"]`);
  }
  async tap(id, opts = {}) {
    await this.tid(id).first().click({ timeout: 10000, ...opts });
  }
  async type(id, value) {
    await this.tid(id).first().fill(value, { timeout: 10000 });
  }
  async settle() {
    await settleApp(this.app, { timeoutMs: 8000 });
  }

  async close() {
    try {
      await this.context.close();
    } catch {
      // ya cerrado
    }
  }

  result() {
    const failedSteps = this.steps.filter((s) => !s.ok);
    return {
      name: this.name,
      ok: failedSteps.length === 0 && this.violations.length === 0,
      steps: this.steps,
      violations: [...new Set(this.violations)],
      consoleErrors: this.consoleErrors,
      requests: this.network ? this.network.requests : [],
      notes: this.notes,
      shots: this.shots,
    };
  }
}

export { sleep };
