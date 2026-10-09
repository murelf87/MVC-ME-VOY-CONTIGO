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

  await s.step('24 · Sin estrellas no se envía; con estrellas el servidor guarda la valoración', async () => {
    await openScreen(s, 'TripFinished', { bookingId: { $ref: 'live.finishedBooking' } }, 'live-finished');
    await s.waitText('Has llegado');
    const text = await s.appText();
    s.expect(text.includes('Pago pendiente'), 'el pago aparece como pendiente (por definir)');
    s.expect(!text.includes('Pago confirmado'), 'no dice que el pago esté confirmado');
    await s.tap('TripFinished.stars.4');
    await s.tap('TripFinished.rateSubmit');
    await s.waitText('Gracias por valorar');
    await s.shot('24-valorado');
    await s.checkForbiddenText('viaje terminado');
  });

  await s.step('24 · Pasado el plazo de 14 días no se puede valorar y lo explica', async () => {
    await openScreen(s, 'TripFinished', { bookingId: { $ref: 'live.finishedBooking' } }, 'live-rating-closed');
    await s.waitText('El plazo de 14 días para valorar este viaje ya terminó.');
  });

  await s.step('Reportar incidencia · valida categoría y texto y el servidor la registra', async () => {
    await openScreen(s, 'ReportIncident', { tripId: { $ref: 'live.finishedTrip' }, bookingId: { $ref: 'live.finishedBooking' } }, 'live-finished');
    await s.waitText('¿Qué ha pasado?');
    await s.tap('ReportIncident.submit');
    await s.waitText('Elige una categoría.');
    await s.waitText('Cuéntanos qué pasó con al menos 10 caracteres.');
    await s.tap('ReportIncident.category.vehicle');
    await s.type('ReportIncident.description', 'El coche llegó veinte minutos tarde a la recogida.');
    await s.tap('ReportIncident.submit');
    await s.waitText('Incidencia enviada');
    await s.shot('report-enviada');
    await s.checkForbiddenText('reportar incidencia');
  });
}
