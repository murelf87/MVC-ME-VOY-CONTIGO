// Recorre TODAS las rutas del catálogo de la app (window.__mvc.routes()) con el perfil que les corresponde y comprueba que
// cada una abre sin errores de consola, sin salir a Internet y sin marcadores de obra. Es el medidor de avance del
// frontend: una ruta que sigue siendo la pantalla provisional («Pantalla sin implementar») cuenta como pendiente y el
// flujo falla hasta que su slice la escriba.
//
//   node tools/preview/smoke.mjs --flow routes                       todas las rutas
//   node tools/preview/smoke.mjs --flow routes --slice search,live   solo esos slices
//   node tools/preview/smoke.mjs --flow routes --route TripDetail    solo esas rutas
//   node tools/preview/smoke.mjs --flow routes --shots               además, una captura del móvil por ruta
//
// Informe por ruta: dist-preview/smoke/routes/routes.json  ·  estados: ok · pendiente · redirigida · error
import fs from 'node:fs';
import path from 'node:path';
import { findForbidden } from '../lib/flow.mjs';

export const meta = { description: 'abre cada ruta del catálogo con su perfil: sin errores, sin pantallas provisionales', timeoutSeconds: 600 };

/** Perfil de prueba con el que se abre cada slice. Una ruta sin sesión (auth) se abre como persona nueva. */
const PROFILE_BY_SLICE = { auth: 'new', search: 'passenger', live: 'passenger', messages: 'passenger', profile: 'passenger', account: 'passenger', driver: 'driver', admin: 'admin' };

export default async function routes(s) {
  await s.open('?perm=granted&autoperm=1');
  await s.requireBridge();

  const catalog = await s.inApp(() => window.__mvc.routes());
  const onlySlices = s.args.slice || [];
  const onlyRoutes = s.args.route || [];
  const todo = catalog.filter((r) => r.slice !== 'dev' && (!onlySlices.length || onlySlices.includes(r.slice)) && (!onlyRoutes.length || onlyRoutes.includes(r.name)));
  s.note(`catálogo: ${catalog.length} rutas · se recorren ${todo.length}${onlySlices.length ? ` (slices: ${onlySlices.join(', ')})` : ''}`);

  const results = [];
  const bySlice = {};

  await s.step(`abrir ${todo.length} rutas`, async () => {
    for (const r of todo) {
      const profile = PROFILE_BY_SLICE[r.slice] || 'passenger';
      const rec = { route: r.name, slice: r.slice, screen: r.screen || null, profile, status: 'ok', ms: 0 };
      const violationsBefore = s.violations.length;
      const t0 = Date.now();
      try {
        await s.inApp(([name, params, opts]) => window.__mvc.open(name, params || {}, opts), [r.name, r.params || {}, { profile }]);
        if (!(await s.hasBridge())) await s.refreshApp(true);
        await s.inApp(() => (window.__mvc.idle ? window.__mvc.idle(3000) : undefined));
        await s.settle();
        const here = await s.inApp(() => window.__mvc.route());
        const pending = await s.pendingRoutes();
        const text = await s.appText();
        const forbidden = findForbidden(text);
        if (pending.length) {
          rec.status = 'pendiente';
          rec.detail = 'sigue siendo la pantalla provisional (PendingScreen)';
        } else if (here !== r.name) {
          rec.status = 'redirigida';
          rec.detail = `abre ${here} en lugar de ${r.name}`;
        } else if (forbidden) {
          rec.status = 'error';
          rec.detail = `texto prohibido «${forbidden.word}»`;
        }
        if (s.args.shots) {
          const shot = path.join(s.outDir, `${r.name}.png`);
          await s.page.locator('.v-screen').screenshot({ path: shot });
        }
      } catch (e) {
        rec.status = 'error';
        rec.detail = String(e && e.message ? e.message : e).split('\n')[0].slice(0, 300);
        await s.resetSystem();
        try {
          await s.refreshApp(true);
        } catch {
          // el visor reiniciará la app en la ruta siguiente
        }
      }
      rec.ms = Date.now() - t0;
      const newViolations = s.violations.slice(violationsBefore).filter((v) => !/^ruta sin implementar|^texto prohibido/.test(v));
      if (newViolations.length && rec.status !== 'error') {
        rec.status = 'error';
        rec.detail = newViolations[0].slice(0, 300);
      }
      results.push(rec);
      (bySlice[r.slice] ||= { ok: 0, pendiente: 0, redirigida: 0, error: 0 })[rec.status]++;
    }
  });

  const count = (st) => results.filter((r) => r.status === st).length;
  fs.writeFileSync(path.join(s.outDir, 'routes.json'), JSON.stringify({ at: new Date().toISOString(), total: results.length, ok: count('ok'), pendiente: count('pendiente'), redirigida: count('redirigida'), error: count('error'), bySlice, routes: results }, null, 2) + '\n');
  s.note(`resultado: ${count('ok')} ok · ${count('pendiente')} pendientes · ${count('redirigida')} redirigidas · ${count('error')} con error (de ${results.length})`);
  for (const [slice, c] of Object.entries(bySlice)) s.note(`  ${slice}: ${c.ok} ok · ${c.pendiente} pendientes · ${c.redirigida} redirigidas · ${c.error} error`);

  await s.step('todas las rutas abren su pantalla real, sin errores', async () => {
    const bad = results.filter((r) => r.status !== 'ok');
    if (bad.length) {
      const shown = bad.slice(0, 8).map((r) => `${r.route} (${r.status}${r.status === 'error' || r.status === 'redirigida' ? `: ${r.detail}` : ''})`).join('; ');
      throw new Error(`${bad.length} de ${results.length} rutas no están listas: ${shown}${bad.length > 8 ? '…' : ''}. Detalle: dist-preview/smoke/routes/routes.json`);
    }
  });
}
