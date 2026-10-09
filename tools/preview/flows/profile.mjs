// Humo del slice «profile»: Favoritos y rutina (31) y Planes (32) con el backend simulado.
//   node tools/preview/smoke.mjs --dev --flow profile -v
export const meta = { description: 'favoritos, rutina y planes (slice profile)', timeoutSeconds: 300, viewport: { width: 393, height: 852 } };

const CLOCK = '2026-10-05T07:17:00+02:00';

async function openScreen(s, route, params, { seed = 'default', clock = CLOCK, profile = 'passenger' } = {}) {
  await s.inApp(([name, p, o]) => window.__mvc.open(name, p, o), [route, params, { profile, seed, clock }]);
  await s.inApp(() => (window.__mvc.idle ? window.__mvc.idle(4000) : undefined));
  await s.settle();
  const here = await s.inApp(() => window.__mvc.route());
  s.expect(here === route, `la app abre ${route} (está en ${here})`);
}

export default async function profile(s) {
  await s.open('?perm=granted&autoperm=1');
  await s.requireBridge();

  await s.step('31 · Favoritos y rutina: lugares, filas de rutina y tarjetas', async () => {
    await openScreen(s, 'FavoritesRoutine', {}, { seed: 'profile-routine', profile: 'driver' });
    await s.waitText('Rutina');
    const text = await s.appText();
    s.expect(/Casa|Trabajo/.test(text), 'se ven los lugares guardados');
    await s.shot('31-favoritos-rutina');
    await s.checkForbiddenText('Favoritos y rutina');
  });

  await s.step('31 · Pausar la semana abre confirmación', async () => {
    await s.tap('FavoritesRoutine.suspend');
    await s.settle();
    await s.waitText('¿Suspender la próxima semana?');
    await s.shot('31-pausar');
  });

  await s.step('32 · Planes: sin compra y con aviso honesto', async () => {
    await openScreen(s, 'Plans', {});
    await s.waitText('Planes MVC');
    const text = await s.appText();
    s.expect(!/Comprar|Suscribirme|Contratar ahora/i.test(text), 'no hay botón de compra');
    await s.shot('32-planes');
    await s.checkForbiddenText('Planes');
  });
}
