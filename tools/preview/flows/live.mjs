// Humo del slice «live» (pasajero en directo) con el backend simulado.
//
//   node tools/preview/smoke.mjs --dev --flow live -v
export const meta = { description: 'pasajero en directo: cambio de ruta (aceptar / rechazar) y el resto de pantallas del viaje (slice live)', timeoutSeconds: 400, viewport: { width: 393, height: 852 } };

const CLOCK = '2026-10-05T07:17:00+02:00';

async function openScreen(s, route, params, seed) {
  await s.inApp(([name, p, o]) => window.__mvc.open(name, p, o), [route, params, { profile: 'passenger', seed, clock: CLOCK }]);
  await s.inApp(() => (window.__mvc.idle ? window.__mvc.idle(4000) : undefined));
  await s.settle();
}

export default async function live(s) {
  await s.open('?perm=granted&autoperm=1');
  await s.requireBridge();

  await s.step('21 → 22 · El aviso del cambio de ruta lleva a la propuesta', async () => {
    await openScreen(s, 'WaitingForCar', { bookingId: { $ref: 'live.booking' } }, 'live-route-change');
    await s.waitText('Ana propone una nueva parada');
    await s.tap('WaitingForCar.routeChange');
    await s.until(() => window.__mvc.route() === 'RouteChange', null, 'se abre «Cambio de ruta»', 8000);
    await s.waitText('Rechazar');
    const text = await s.appText();
    s.expect(text.includes('Sin recargo por esta parada'), 'dice que no hay recargo');
    s.expect(text.includes('El cambio de ruta se aplicará solo si lo aceptas.'), 'explica que solo se aplica si aceptas');
    await s.shot('22-pendiente');
    await s.checkForbiddenText('cambio de ruta');
  });

  await s.step('22 · Aceptar envía la respuesta al servidor y la deja constada', async () => {
    await openScreen(s, 'RouteChange', { proposalId: { $ref: 'live.routeChange' } }, 'live-route-change');
    await s.waitText('Aceptar');
    await s.tap('RouteChange.accept');
    await s.waitText('Has aceptado el cambio');
    await s.shot('22-aceptado');
  });

  await s.step('22 · Rechazar pide confirmación y el viaje sigue como estaba', async () => {
    await openScreen(s, 'RouteChange', { proposalId: { $ref: 'live.routeChange' } }, 'live-route-change');
    await s.waitText('Rechazar');
    await s.tap('RouteChange.reject');
    await s.waitText('¿Rechazar el cambio de ruta?');
    await s.tap('RouteChange.rejectDialog.confirm');
    await s.until(() => /se ha rechazado|Has rechazado/.test(document.body.innerText), null, 'queda rechazada', 8000);
    await s.shot('22-rechazado');
  });

  await s.step('22 · Una propuesta que no existe dice que no existe', async () => {
    await openScreen(s, 'RouteChange', { proposalId: '00000000-0000-4000-8000-000000000000' }, 'live-route-change');
    await s.waitText('Propuesta no encontrada');
  });
}
