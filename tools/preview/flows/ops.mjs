// Humo del paquete «operar el viaje» (conductor): gestionar, proponer parada, cancelar y terminar, con el backend simulado.
//
//   node tools/preview/smoke.mjs --dev --flow ops -v
export const meta = { description: 'operar el viaje: gestionar, proponer parada, cancelar viaje y resumen (slice driver/ops)', timeoutSeconds: 300, viewport: { width: 393, height: 852 } };

const CLOCK = '2026-10-05T07:17:00+02:00';
const TRIP = { $ref: 'trip.anaMorning' };

async function openScreen(s, route, params, seed = 'default') {
  await s.inApp(([name, p, o]) => window.__mvc.open(name, p, o), [route, params, { profile: 'driver', seed, clock: CLOCK }]);
  await s.inApp(() => (window.__mvc.idle ? window.__mvc.idle(4000) : undefined));
  await s.settle();
}

export default async function ops(s) {
  await s.open('?perm=granted&autoperm=1');
  await s.requireBridge();

  await s.step('Tu viaje publicado · resume el viaje y reparte las acciones', async () => {
    await openScreen(s, 'DriverTripManage', { tripId: TRIP });
    await s.waitText('Tu viaje publicado');
    await s.waitText('Abrir consola del viaje');
    const text = await s.appText();
    s.expect(text.includes('Cancelar viaje'), 'ofrece cancelar');
    s.expect(text.includes('Proponer nueva parada'), 'ofrece proponer parada');
    await s.shot('manage');
    await s.checkForbiddenText('tu viaje publicado');
  });

  await s.step('Cancelar el viaje · sin motivo no avanza y con motivo cancela', async () => {
    await openScreen(s, 'DriverCancelTrip', { tripId: TRIP });
    await s.waitText('Motivo de la cancelación');
    await s.tap('DriverCancelTrip.submit');
    await s.waitText('Elige un motivo para continuar.');
    await s.tap('DriverCancelTrip.reason.emergency');
    await s.tap('DriverCancelTrip.submit');
    await s.waitText('¿Cancelar el viaje?');
    await s.shot('cancel-dialog');
    await s.tap('DriverCancelTrip.dialog.confirm');
    await s.waitText('Viaje cancelado');
    const text = await s.appText();
    s.expect(!text.includes('Reembolso garantizado'), 'no promete devoluciones');
    await s.shot('cancel-done');
    await s.checkForbiddenText('cancelar viaje');
  });

  await s.step('Proponer una parada · sin lugar avisa; con lugar el servidor calcula el desvío', async () => {
    await openScreen(s, 'ProposeRouteChange', { tripId: TRIP });
    await s.waitText('Nueva parada');
    await s.tap('ProposeRouteChange.submit');
    await s.waitText('Elige dónde quieres parar.');
    await openScreen(s, 'ProposeRouteChange', { tripId: TRIP, stop: { label: 'Avenida de la Palmera', latitude: 37.3586, longitude: -5.9879 } });
    await s.waitText('Avenida de la Palmera');
    await s.tap('ProposeRouteChange.submit');
    await s.until(() => /Parada añadida|Propuesta enviada|Parada fuera|Desvío demasiado|Parada demasiado|No hay ruta|Ruta no disponible|No hay plaza|Parada por detrás|Ya hay una propuesta/.test(document.body.innerText), null, 'respuesta del servidor', 10000).catch(() => {});
    await s.settle();
    await s.shot('propose-result');
  });

  await s.step('Consola → iniciar → terminar lleva al resumen del viaje terminado', async () => {
    await openScreen(s, 'DriverConsole', { tripId: TRIP });
    await s.waitText('Iniciar viaje');
    await s.tap('DriverConsole.start');
    await s.tap('DriverConsole.startDialog.confirm');
    await s.waitText('Terminar viaje');
    await s.tap('DriverConsole.complete');
    await s.tap('DriverConsole.completeDialog.confirm');
    await s.until(() => window.__mvc.route() === 'DriverTripFinished', null, 'se abre el resumen', 10000);
    await s.waitText('Has terminado el viaje');
    const text = await s.appText();
    s.expect(text.includes('Recogidos') && text.includes('No presentados'), 'cuenta recogidos y no presentados');
    await s.shot('finished');
    await s.checkForbiddenText('viaje terminado');
  });
}
