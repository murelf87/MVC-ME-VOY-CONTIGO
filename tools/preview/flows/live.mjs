// Humo del slice «live» (pasajero en directo) con el backend simulado.
//
//   node tools/preview/smoke.mjs --dev --flow live -v
export const meta = { description: 'pasajero en directo: cambio de ruta (aceptar / rechazar) y el resto de pantallas del viaje (slice live)', timeoutSeconds: 400, viewport: { width: 393, height: 852 } };

const CLOCK = '2026-10-05T07:17:00+02:00';

async function openScreen(s, route, params, seed, profile = 'passenger') {
  await s.inApp(([name, p, o]) => window.__mvc.open(name, p, o), [route, params, { profile, seed, clock: CLOCK }]);
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

  await s.step('Mis incidencias · lista con estados reales y detalle con fotos', async () => {
    await openScreen(s, 'IncidentReports', undefined, 'live-incidents');
    await s.waitText('Mis incidencias');
    await s.waitText('Ruta u horario');
    const text = await s.appText();
    s.expect(text.includes('En revisión') && text.includes('Abierta') && text.includes('Resuelta'), 'muestra los tres estados');
    await s.shot('incidencias-lista');
    await s.app.locator('[data-testid^="IncidentReports.item."]').first().click({ timeout: 10000 });
    await s.until(() => window.__mvc.route() === 'IncidentDetail', null, 'se abre el detalle', 8000);
    await s.waitText('Lo que nos contaste');
    await s.shot('incidencias-detalle');
    await s.checkForbiddenText('incidencia');
  });

  await s.step('Mis incidencias · sin incidencias lo dice y ofrece salida', async () => {
    await openScreen(s, 'IncidentReports', undefined, 'live-finished');
    await s.waitText('No has reportado ninguna incidencia');
  });

  await s.step('Detalle de incidencia · una que no existe dice que no existe', async () => {
    await openScreen(s, 'IncidentDetail', { reportId: '00000000-0000-4000-8000-000000000000' }, 'live-incidents');
    await s.until(() => !!document.querySelector('[data-testid="IncidentDetail.notFound"], [data-testid="IncidentDetail.error"]'), null, 'error de carga', 8000);
  });

  await s.step('Compartir viaje · crea el enlace, lo muestra una vez y se puede copiar', async () => {
    await openScreen(s, 'ShareTrip', { bookingId: { $ref: 'live.booking' } }, 'live-in-car');
    await s.waitText('No verá');
    await s.tap('ShareTrip.create');
    await s.waitText('Enlace creado');
    const text = await s.appText();
    s.expect(text.includes('https://mvc.example/t/'), 'muestra el enlace');
    s.expect(text.includes('Solo se muestra ahora'), 'avisa de que solo se muestra una vez');
    await s.tap('ShareTrip.copy');
    await s.waitText('Enlace copiado');
    await s.shot('compartir-creado');
    await s.checkForbiddenText('compartir viaje');
  });

  await s.step('Compartir viaje · con un enlace activo se puede retirar con confirmación', async () => {
    await openScreen(s, 'ShareTrip', { bookingId: { $ref: 'live.booking' } }, 'live-shared');
    await s.waitText('Tienes un enlace activo');
    await s.tap('ShareTrip.revoke');
    await s.waitText('¿Retirar el enlace?');
    await s.tap('ShareTrip.revokeDialog.confirm');
    await s.waitText('Enlace retirado');
    await s.until(() => !document.body.innerText.includes('Tienes un enlace activo'), null, 'el enlace ya no consta como activo', 8000);
  });

  await s.step('Viaje compartido (público) · muestra lo permitido y nada más', async () => {
    await openScreen(s, 'SharedTripView', { token: { $ref: 'live.shareToken' } }, 'live-shared');
    await s.waitText('Viaje compartido');
    await s.waitText('Ruta');
    const text = await s.appText();
    s.expect(text.includes('Matrícula no compartida'), 'no enseña la matrícula si no se incluyó');
    s.expect(!/\+34|6\d{8}/.test(text), 'no enseña ningún teléfono');
    await s.shot('compartido-publico');
    await s.checkForbiddenText('viaje compartido');
  });

  await s.step('Viaje compartido · un enlace que no existe lo dice', async () => {
    await openScreen(s, 'SharedTripView', { token: 'mvc_s_no-existe' }, 'live-shared');
    await s.waitText('Este enlace no existe');
  });

  await s.step('Privacidad en directo · el cambio se guarda en el servidor', async () => {
    await openScreen(s, 'LivePrivacy', undefined, 'live-in-car');
    await s.waitText('Mostrar mi nombre y foto');
    await s.tap('LivePrivacy.profile');
    await s.waitText('Preferencia guardada');
    await s.shot('privacidad-directo');
  });

  await s.step('Valorar viaje · pasajero valora a quien condujo', async () => {
    await openScreen(s, 'RateTrip', { tripId: { $ref: 'live.finishedTrip' }, bookingId: { $ref: 'live.finishedBooking' } }, 'live-finished');
    await s.waitText('Enviar valoración');
    await s.tap('RateTrip.submit');
    await s.waitText('Elige entre 1 y 5 estrellas.');
    await s.tap('RateTrip.stars.5');
    await s.tap('RateTrip.submit');
    await s.waitText('Gracias por valorar');
  });

  await s.step('Valorar viaje · conductor elige a quién valorar', async () => {
    await openScreen(s, 'RateTrip', { tripId: { $ref: 'live.finishedTrip' } }, 'live-finished', 'driver');
    await s.waitText('¿A quién quieres valorar?');
    await s.app.locator('[data-testid^="RateTrip.passenger."]').first().click({ timeout: 10000 });
    await s.waitText('Enviar valoración');
    await s.tap('RateTrip.stars.4');
    await s.tap('RateTrip.submit');
    await s.waitText('Gracias por valorar');
  });
}
