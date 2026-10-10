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

  await s.step('Inicio del panel: solo secciones del rol y contadores', async () => {
    await openScreen(s, 'AdminHome');
    await s.waitText('Secciones');
    const text = await s.appText();
    for (const expected of ['Resumen', 'Usuarios y revisión', 'Reservas y devoluciones', 'Liquidaciones', 'Atención al cliente']) s.expect(text.includes(expected), `el inicio muestra «${expected}»`);
    s.expect(/pendientes/.test(text), 'la tarjeta de usuarios muestra el contador de pendientes');
    await s.shot('admin-home');
    await s.checkForbiddenText('Inicio del panel');
  });

  await s.step('Cola de revisión: pestañas y expediente', async () => {
    await openScreen(s, 'AdminUsersReview');
    await s.waitText('Ver expediente');
    await s.tap('AdminUsersReview.tab.opt-approved');
    await s.settle();
    s.expect(!(await s.appText()).includes('Requiere revisión'), 'Aprobados no muestra elementos por revisar');
    await s.tap('AdminUsersReview.tab.opt-pending');
    await s.settle();
    await s.shot('admin-users');
  });

  await s.step('Expediente: ver documentación (aviso, imagen y cierre) y rechazar con motivo', async () => {
    await openScreen(s, 'AdminUserFile', { userId: { $ref: 'adminReview.pendingUser' } });
    await s.waitText('Documentación entregada');
    const view = s.app.locator('[data-testid$=".view"]').first();
    await view.click();
    await s.waitText('Documentación privada');
    await s.tap('AdminUserFile.viewer.notice.confirm');
    await s.waitText(/Caduca en/);
    s.expect((await s.inApp(() => document.querySelectorAll('img').length)) > 0, 'el visor pinta la imagen');
    await s.shot('admin-evidence');
    await s.tap('AdminUserFile.viewer.close');
    await s.settle();
    s.expect((await s.inApp(() => document.querySelectorAll('img[src^="blob:"]').length)) === 0, 'al cerrar no queda ninguna imagen viva');
    const reject = s.app.locator('[data-testid$=".reject"]').first();
    await reject.click();
    await s.tap('AdminUserFile.rejectSheet.confirm');
    await s.settle();
    s.expect((await s.appText()).includes('al menos 3 caracteres'), 'rechazar sin motivo da error de validación');
    await s.type('AdminUserFile.rejectSheet.text', 'La foto del documento no se lee bien.');
    await s.tap('AdminUserFile.rejectSheet.confirm');
    await s.settle();
    await s.waitText('Rechazado');
    await s.shot('admin-dossier');
  });

  await s.step('Devolución: aprobar con importe, bloqueada sin proveedor, y rechazar con nota', async () => {
    await openScreen(s, 'AdminRefundDetail', { refundId: { $ref: 'adminRefund.pending' } });
    await s.waitText('Importes');
    await s.tap('AdminRefundDetail.approve');
    await s.type('AdminRefundDetail.approveSheet.amount', '99');
    await s.tap('AdminRefundDetail.approveSheet.confirm');
    await s.settle();
    s.expect(/No puede superar|Entre/.test(await s.appText()), 'un importe mayor que lo pagado se rechaza en el campo');
    await s.type('AdminRefundDetail.approveSheet.amount', '1,00');
    await s.type('AdminRefundDetail.approveSheet.note', 'Aprobada a mano en la prueba.');
    await s.tap('AdminRefundDetail.approveSheet.confirm');
    await s.settle();
    await s.waitText('Bloqueado');
    s.expect(!(await s.appText()).includes('Devuelta'), 'sin proveedor no consta como devuelta');
    await s.shot('admin-refund');
    await s.checkForbiddenText('Detalle de devolución');
  });

  await s.step('Liquidaciones: sin proveedor el abono se bloquea; con proveedor queda «En proceso», nunca «Abonada» al instante', async () => {
    await openScreen(s, 'AdminPayoutRuns');
    await s.waitText('Pagos aún no disponibles');
    const blocked = await s.inApp(() => Array.from(document.querySelectorAll('[data-testid$=".blocked"]')).length);
    s.expect(blocked > 0, 'con proveedor desactivado, cada abono pendiente dice «Bloqueado»');
    await s.shot('admin-payouts-blocked');
    await openScreen(s, 'AdminPayoutRuns', {}, { seed: 'admin-payouts-ready' });
    await s.waitText('Proveedor de pago activo');
    await s.tap('AdminPayoutRuns.generate');
    await s.type('AdminPayoutRuns.generateSheet.period', 'abril');
    await s.tap('AdminPayoutRuns.generateSheet.confirm');
    await s.settle();
    s.expect((await s.appText()).includes('Escribe el mes'), 'un mes no válido da error en el campo');
    await s.type('AdminPayoutRuns.generateSheet.period', '09/2026');
    await s.tap('AdminPayoutRuns.generateSheet.confirm');
    await s.waitText('Se han creado 2 liquidaciones');
    const execute = s.app.locator('[data-testid$=".execute"]').first();
    await execute.click();
    await s.tap('AdminPayoutRuns.executeDialog.confirm');
    await s.waitText('Esperando la confirmación del proveedor');
    s.expect(!(await s.appText()).includes('Abonada el'), 'pedir el abono no lo da por abonado');
    await s.shot('admin-payouts-processing');
    await s.checkForbiddenText('Liquidaciones');
  });

  await s.step('Documentos legales: ver texto, publicar exige la referencia de revisión legal, nueva versión valida', async () => {
    await openScreen(s, 'AdminLegalDocs', {}, { seed: 'admin-legal-published' });
    await s.waitText('Términos y condiciones');
    s.expect((await s.appText()).includes('Pendiente de revisión legal'), 'los borradores dicen «Pendiente de revisión legal»');
    await s.app.locator('[data-testid$=".toggle"]').first().click();
    await s.settle();
    s.expect((await s.inApp(() => document.querySelectorAll('[data-testid$=".text"]').length)) > 0, 'ver texto muestra las secciones');
    await s.shot('admin-legal');
    await s.app.locator('[data-testid^="AdminLegalDocs.doc."][data-testid$=".publish"]').first().click();
    await s.tap('AdminLegalDocs.publishSheet.confirm');
    await s.settle();
    s.expect((await s.appText()).includes('Indica la referencia de la revisión legal'), 'sin referencia no se publica');
    await s.type('AdminLegalDocs.publishSheet.reference', 'REV-2026-014');
    await s.tap('AdminLegalDocs.publishSheet.confirm');
    await s.waitText('Documento publicado');
    await openScreen(s, 'AdminLegalEditor');
    await s.tap('AdminLegalEditor.save');
    await s.settle();
    s.expect((await s.appText()).includes('El título debe tener'), 'guardar sin título da error de validación');
    await s.type('AdminLegalEditor.title', 'Términos y condiciones');
    await s.type('AdminLegalEditor.section.0.heading', 'Objeto');
    await s.type('AdminLegalEditor.section.0.paragraphs', 'Estas condiciones regulan el uso de MVC.');
    await s.shot('admin-legal-editor');
    await s.tap('AdminLegalEditor.save');
    await s.waitText('Borrador guardado');
    await s.checkForbiddenText('Documentos legales');
  });

  await s.step('Atención al cliente: cola, adjunto privado con aviso, responder, asignar y cerrar', async () => {
    await openScreen(s, 'AdminSupportQueue');
    await s.waitText('Esperando respuesta');
    const cards = await s.inApp(() => document.querySelectorAll('[data-testid^="AdminSupportQueue.ticket."]').length);
    s.expect(cards === 3, `la cola abierta tiene 3 consultas (hay ${cards})`);
    await s.shot('admin-support-queue');
    await s.app.locator('[data-testid^="AdminSupportQueue.ticket."]').first().click();
    await s.waitText('Conversación');
    await s.app.locator('[data-testid*=".attachment."]').first().click();
    await s.waitText('Documentación privada');
    await s.tap('AdminSupportTicket.viewer.notice.confirm');
    await s.waitText(/Caduca en/);
    s.expect((await s.inApp(() => document.querySelectorAll('img').length)) > 0, 'el visor pinta el adjunto');
    await s.shot('admin-support-attachment');
    await s.tap('AdminSupportTicket.viewer.close');
    await s.settle();
    await s.tap('AdminSupportTicket.send');
    await s.settle();
    s.expect((await s.appText()).includes('Escribe una respuesta'), 'responder en blanco da error de validación');
    await s.type('AdminSupportTicket.reply', 'Hola, sentimos lo ocurrido. Estamos revisando tu reserva.');
    await s.tap('AdminSupportTicket.send');
    await s.waitText('Respuesta enviada');
    s.expect((await s.appText()).includes('Respondida'), 'tras responder la consulta figura «Respondida»');
    await s.shot('admin-support-ticket');
    await s.tap('AdminSupportTicket.close');
    await s.tap('AdminSupportTicket.closeDialog.confirm');
    await s.waitText('La consulta está cerrada');
    await s.checkForbiddenText('Atención al cliente');
  });
}
