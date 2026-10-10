// Humo del slice «admin»: resumen, usuarios y revisión, reservas y devoluciones (paquete admin-review).
//   node tools/preview/smoke.mjs --dev --flow admin -v
export const meta = { description: 'panel de administración: resumen, revisión de usuarios y devoluciones (slice admin)', timeoutSeconds: 420, viewport: { width: 393, height: 852 } };

const CLOCK = '2026-10-05T09:41:00+02:00';

async function openScreen(s, route, params = {}, { seed = 'default', clock = CLOCK, profile = 'admin' } = {}) {
  await s.inApp(([name, p, o]) => window.__mvc.open(name, p, o), [route, params, { profile, seed, clock }]);
  await s.inApp(() => (window.__mvc.idle ? window.__mvc.idle(4000) : undefined));
  await s.settle();
  const here = await s.inApp(() => window.__mvc.route());
  s.expect(here === route, `la app abre ${route} (está en ${here})`);
}

export default async function admin(s) {
  await s.open('?perm=granted&autoperm=1');
  await s.requireBridge();

  await s.step('Resumen: indicadores reales y mapa de actividad', async () => {
    await openScreen(s, 'AdminSummary');
    await s.waitText('Resumen de administración');
    await s.waitText('Viajes activos');
    const text = await s.appText();
    for (const expected of ['42', '18', 'Incidencias', 'Datos ilustrativos', 'Actividad de vehículos']) s.expect(text.includes(expected), `el resumen muestra «${expected}»`);
    const info = await s.inApp(() => ({
      markers: document.querySelectorAll('[data-pv-marker]').length,
      mapView: document.querySelectorAll('[data-testid="MapView.web"]').length,
      canvas: Array.from(document.querySelectorAll('canvas')).map((c) => `${c.width}x${c.height}`),
    }));
    s.expect(info.markers > 0, `el mapa pinta marcadores (${JSON.stringify(info)})`);
    await s.shot('admin-summary');
    await s.checkForbiddenText('Resumen de administración');
  });
}
