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
}
