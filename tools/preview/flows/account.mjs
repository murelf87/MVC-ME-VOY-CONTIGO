// Humo del slice «account»: consultas de soporte, y (según se añaden) pagos, legal, privacidad y datos.
//   node tools/preview/smoke.mjs --dev --flow account -v
export const meta = { description: 'consultas de soporte y centros de cuenta (slice account)', timeoutSeconds: 420, viewport: { width: 393, height: 852 } };

const CLOCK = '2026-10-05T07:17:00+02:00';

async function openScreen(s, route, params, { seed = 'default', clock = CLOCK, profile = 'passenger' } = {}) {
  await s.inApp(([name, p, o]) => window.__mvc.open(name, p, o), [route, params, { profile, seed, clock }]);
  await s.inApp(() => (window.__mvc.idle ? window.__mvc.idle(4000) : undefined));
  await s.settle();
  const here = await s.inApp(() => window.__mvc.route());
  s.expect(here === route, `la app abre ${route} (está en ${here})`);
}

export default async function account(s) {
  await s.open('?perm=granted&autoperm=1');
  await s.requireBridge();

  await s.step('Mis consultas: lista, filtro y apertura del hilo', async () => {
    await openScreen(s, 'SupportTickets', {}, { seed: 'help-tickets' });
    await s.waitText('Mis consultas');
    let text = await s.appText();
    for (const expected of ['Abierta', 'Respondida', 'Cerrada']) s.expect(text.includes(expected), `la lista muestra «${expected}»`);
    await s.tap('SupportTickets.filter.closed');
    await s.settle();
    text = await s.appText();
    s.expect(!text.includes('Respondida') || text.includes('Cerrada'), 'el filtro Cerradas filtra');
    await s.shot('support-tickets');
    await s.checkForbiddenText('Mis consultas');
  });

  await s.step('Hilo de la consulta: responder y cerrar', async () => {
    await openScreen(s, 'SupportTicketDetail', { ticketId: { $ref: 'help.ticketOpen' } }, { seed: 'help-tickets' });
    await s.waitText('Tu respuesta');
    await s.tap('SupportTicketDetail.send');
    await s.settle();
    s.expect((await s.appText()).includes('Escribe tu respuesta.'), 'respuesta vacía da error');
    await s.type('SupportTicketDetail.reply', 'Gracias, ya lo he revisado.');
    await s.tap('SupportTicketDetail.send');
    await s.settle();
    s.expect((await s.appText()).includes('Gracias, ya lo he revisado.'), 'la respuesta aparece en el hilo');
    await s.tap('SupportTicketDetail.close');
    await s.settle();
    await s.waitText('¿Cerrar esta consulta?');
    await s.shot('support-detail');
  });

  await s.step('Nueva consulta: validación del formulario', async () => {
    await openScreen(s, 'SupportNewTicket', {}, { seed: 'help-tickets' });
    await s.waitText('Nueva consulta');
    await s.checkForbiddenText('Nueva consulta');
  });

  await s.step('Historial de pagos: filtro por estado y apertura', async () => {
    await openScreen(s, 'PaymentHistory', {}, { seed: 'money-historial-largo' });
    await s.waitText('Historial');
    await s.tap('PaymentHistory.filter.opt-paid');
    await s.settle();
    await s.shot('payment-history');
    await s.checkForbiddenText('Historial de pagos');
  });

  await s.step('Recibos: lista, filtro, detalle, copiar y versión imprimible', async () => {
    await openScreen(s, 'ReceiptsList', {}, { seed: 'money-historial-largo' });
    await s.waitText('Facturas y justificantes');
    let text = await s.appText();
    s.expect(text.includes('no son facturas') || text.includes('No son facturas'), 'se dice que no son facturas');
    await s.tap('ReceiptsList.filter.opt-refund');
    await s.settle();
    await s.tap('ReceiptsList.filter.opt-all');
    await s.settle();
    await openScreen(s, 'ReceiptDetail', { receiptId: { $ref: 'money.receiptPayment' } }, { seed: 'money-historial-largo' });
    await s.waitText('Justificante no fiscal');
    await s.shot('receipt-detail');
    await s.tap('ReceiptDetail.openPrintable');
    await s.settle();
    await s.waitText('Versión imprimible');
    await s.shot('receipt-printable');
    await s.tap('ReceiptDetail.printable.close');
    await s.settle();
    await s.checkForbiddenText('Recibo');
  });

  await s.step('Liquidación y cobro: desglose y enlaces', async () => {
    await openScreen(s, 'PayoutDetail', { payoutId: { $ref: 'money.payoutPaid' } }, { seed: 'money-historial-largo' }, );
    await s.waitText('Liquidación');
    await s.shot('payout-detail');
    await openScreen(s, 'EarningDetail', { bookingId: { $ref: 'money.earningPaidOut' } }, { seed: 'money-historial-largo' });
    await s.waitText('Detalle del cobro');
    await s.shot('earning-detail');
    await s.checkForbiddenText('Detalle del cobro');
  });

  await s.step('Devoluciones: seguimiento sin prometer nada', async () => {
    await openScreen(s, 'Refunds', {}, { seed: 'money-historial-largo' });
    await s.waitText('Mis devoluciones');
    await s.shot('refunds');
    await s.checkForbiddenText('Mis devoluciones');
  });
}
