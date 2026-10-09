// Humo del paquete «solicitar plaza y pagar» (pantalla 16 y su flujo de pago) con el backend simulado:
// estado bloqueado con el proveedor desactivado, pago de punta a punta con Apple Pay simulado, retirar una solicitud pendiente.
//
//   node tools/preview/smoke.mjs --dev --flow request -v
export const meta = { description: 'estado y pago de una solicitud: bloqueo, pago con hoja simulada y retirar (slice search/request)', timeoutSeconds: 300, viewport: { width: 393, height: 852 } };

const CLOCK = '2026-10-05T07:58:00+02:00';

async function openScreen(s, route, params, seed) {
  await s.inApp(([name, p, o]) => window.__mvc.open(name, p, o), [route, params, { profile: 'passenger', seed, clock: CLOCK }]);
  await s.inApp(() => (window.__mvc.idle ? window.__mvc.idle(4000) : undefined));
  await s.settle();
}

export default async function request(s) {
  await s.open('?perm=granted&autoperm=1');
  await s.requireBridge();
  const here = () => s.inApp(() => window.__mvc.route());

  await s.step('16 · Con el proveedor de pagos desactivado no se cobra: botón bloqueado y motivo real', async () => {
    await openScreen(s, 'RequestStatusPayment', { requestId: { $ref: 'request.miguel' } }, 'req-awaiting-payment');
    await s.waitText('¡Solicitud aceptada!');
    const text = await s.appText();
    s.expect(text.includes('Ejemplo de pago · Importe por definir'), 'resumen de ejemplo con importe por definir');
    s.expect(text.includes('Pagos aún no disponibles') || text.includes('Importe por definir'), 'el bloqueo dice el motivo');
    s.expect(!/Plaza confirmada/.test(text), 'aceptada no es confirmada');
    await s.checkForbiddenText('estado y pago bloqueado');
  });

  await s.step('16 · Pagar con la hoja simulada (autorizada por el visor) → Procesando → «¡Plaza confirmada!» solo cuando el servidor lo confirma', async () => {
    await openScreen(s, 'RequestStatusPayment', { requestId: { $ref: 'request.miguel' } }, 'req-awaiting-payment-live');
    await s.waitText('¡Solicitud aceptada!');
    await s.tap('RequestStatus.pay');
    await s.until(() => ['PaymentProcessing', 'PaymentResult'].includes(window.__mvc.route()), null, 'tras autorizar espera al servidor', 10000);
    await s.until(() => window.__mvc.route() === 'PaymentResult', null, 'el servidor confirma y se abre el resultado', 20000);
    await s.waitText('¡Plaza confirmada!');
    await s.shot('16-resultado-confirmado');
    await s.checkForbiddenText('resultado del pago');
  });

  await s.step('16 · Retirar una solicitud pendiente pide confirmación y no cobra nada', async () => {
    await openScreen(s, 'RequestStatusPayment', { requestId: { $ref: 'request.miguel' } }, 'req-pending');
    await s.waitText('Esperando a');
    await s.tap('RequestStatus.withdraw');
    await s.waitText('¿Retirar tu solicitud?');
    await s.tap('RequestStatus.withdrawDialog.confirm');
    await s.waitText('Has retirado tu solicitud');
    await s.checkForbiddenText('solicitud retirada');
  });

  await s.step('16b · Reserva semanal aceptada: mismo flujo, resumen semanal', async () => {
    await openScreen(s, 'RequestStatusPayment', { requestId: { $ref: 'weekly.miguelRequest' }, reservationId: { $ref: 'weekly.miguel' } }, 'req-weekly-awaiting-payment');
    await s.waitText('Aportación semanal (ejemplo)');
    await s.shot('16b-semanal');
  });
}
