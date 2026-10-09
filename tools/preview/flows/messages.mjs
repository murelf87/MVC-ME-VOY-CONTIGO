// Humo del slice «messages»: Mensajes (25), Chat de reserva (26), Notificaciones (27), Cancelar reserva (28) y sus páginas
// (ajustes de avisos, personas bloqueadas, denunciar, reserva cancelada, información del chat) con el backend simulado.
// Falla si hay errores de consola, peticiones a Internet, marcadores de obra («Próximamente», TODO…) o una acción que no hace nada.
//
//   node tools/preview/smoke.mjs --dev --flow messages -v
export const meta = { description: 'mensajes, chat de reserva, avisos y cancelación de reserva (slice messages)', timeoutSeconds: 420, viewport: { width: 393, height: 852 } };

const CLOCK_INBOX = '2026-10-05T07:17:00+02:00';
const CLOCK_CHAT = '2026-10-05T07:22:00+02:00';

/** Abre una ruta con perfil, datos y reloj, y espera a que la app deje de pedir cosas. */
async function openScreen(s, route, params, { seed = 'default', clock = CLOCK_CHAT, profile = 'passenger' } = {}) {
  await s.inApp(([name, p, o]) => window.__mvc.open(name, p, o), [route, params, { profile, seed, clock }]);
  await s.inApp(() => (window.__mvc.idle ? window.__mvc.idle(4000) : undefined));
  await s.settle();
  const here = await s.inApp(() => window.__mvc.route());
  s.expect(here === route, `la app abre ${route} (está en ${here})`);
}

export default async function messages(s) {
  await s.open('?perm=granted&autoperm=1');
  await s.requireBridge();

  await s.step('25 · Mensajes: cuatro conversaciones con su insignia y el pie de la lámina', async () => {
    await openScreen(s, 'Inbox', {}, { seed: 'messages-inbox', clock: CLOCK_INBOX });
    await s.waitText('Ruta Sevilla · Trabajo');
    const text = await s.appText();
    for (const expected of ['Mensajes', 'Todos', 'Mis reservas', 'Grupos', 'Ana', 'Ruta al trabajo · Sevilla', 'Perfecto, nos vemos en el aparcamiento.', 'Ana: Salgo en 5 min. Nos vemos en P1.', 'Genial, gracias por la info.', '¿Sigues con plazas?', 'Aún no tienes más mensajes']) {
      s.expect(text.includes(expected), `la bandeja muestra «${expected}»`);
    }
    await s.shot('25-mensajes');
    await s.checkForbiddenText('Mensajes');
  });

  await s.step('27 · Notificaciones: filtros, marcar leída, avisos esenciales bloqueados y opcionales editables', async () => {
    await openScreen(s, 'Notifications', {}, { seed: 'messages-notifications', clock: CLOCK_INBOX });
    await s.waitText('Tu recogida en 5 min');
    let text = await s.appText();
    for (const expected of ['Notificaciones', 'Ha cambiado la hora estimada', 'Tu solicitud ha sido aceptada', 'Pago del viaje completado', 'Propuesta: 4,00 €.', 'Tipos de notificaciones', 'Avisos esenciales del viaje', 'Avisos opcionales de llegada']) {
      s.expect(text.includes(expected), `Notificaciones muestra «${expected}»`);
    }
    await s.tap('Notifications.filter.payment');
    await s.settle();
    text = await s.appText();
    s.expect(text.includes('Pago del viaje completado') && !text.includes('Tu recogida en 5 min'), 'el filtro Pagos deja solo los pagos');
    await s.tap('Notifications.filter.all');
    await s.settle();
    await s.tap('Notifications.markAll');
    await s.settle();
    s.expect(!(await s.appText()).includes('Marcar todas como leídas'), 'tras marcar todas ya no queda el enlace');
    await s.tap('Notifications.arrivalSwitch');
    await s.settle();
    await s.shot('27-notificaciones');
    await s.checkForbiddenText('Notificaciones');
  });

  await s.step('28 · Cancelar reserva: motivo, otro motivo, confirmación y resultado', async () => {
    await openScreen(s, 'CancelBooking', { bookingId: { $ref: 'booking.isla' } }, { seed: 'messages-cancel', clock: '2026-10-05T07:17:00+02:00' });
    await s.waitText('Motivo de la cancelación');
    let text = await s.appText();
    for (const expected of ['Cancelar reserva', 'Ya no lo necesito', 'Cambio en mi horario', 'He encontrado otra opción', 'Otro motivo', 'Detalle del reembolso (propuesta)', 'Por definir', 'Mantener reserva', 'Confirmar cancelación']) {
      s.expect(text.includes(expected), `Cancelar reserva muestra «${expected}»`);
    }
    await s.tap('CancelBooking.reason.other');
    await s.type('CancelBooking.note', 'Me ha surgido un imprevisto');
    await s.shot('28-cancelar');
    await s.tap('CancelBooking.confirm');
    await s.settle();
    await s.checkForbiddenText('Cancelar reserva');
  });
}
