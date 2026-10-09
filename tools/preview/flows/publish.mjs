// Humo del paquete «publicar ruta» (pantallas 18, 19 y «Ruta publicada») con el backend simulado:
// validación del formulario, cálculo de la ruta, parada fuera de provincia (guardar bloqueado) y publicación de punta a punta.
//
//   node tools/preview/smoke.mjs --dev --flow publish -v
export const meta = { description: 'publicar ruta: formulario, paradas y recorrido, fuera de provincia y guardar (slice driver/publish)', timeoutSeconds: 300, viewport: { width: 393, height: 852 } };

const CLOCK = '2026-10-05T07:17:00+02:00';

async function openScreen(s, route, params) {
  await s.inApp(([name, p, o]) => window.__mvc.open(name, p, o), [route, params, { profile: 'driver', seed: 'default', clock: CLOCK }]);
  await s.inApp(() => (window.__mvc.idle ? window.__mvc.idle(4000) : undefined));
  await s.settle();
}

export default async function publish(s) {
  await s.open('?perm=granted&autoperm=1');
  await s.requireBridge();

  await s.step('18 · Con el formulario vacío «Calcular ruta» explica qué falta y no avanza', async () => {
    await openScreen(s, 'PublishRoute', { draftId: 'blank-1' });
    await s.waitText('Publica tu ruta');
    await s.tap('PublishRoute.calculate');
    await s.waitText('Elige el origen de la ruta.');
    const text = await s.appText();
    s.expect(text.includes('Elige el destino de la ruta.'), 'pide también el destino');
    s.expect(text.includes('Elige la hora de salida.'), 'pide la hora de salida');
    s.expect(await s.inApp(() => window.__mvc.route()) === 'PublishRoute', 'sigue en la pantalla 18');
    await s.checkForbiddenText('formulario vacío');
  });

  await s.step('18 → 19 · Con datos válidos el servidor calcula la ruta y dentro de provincia se puede guardar', async () => {
    await openScreen(s, 'PublishRoute', { draftId: 'preview-18' });
    await s.waitText('Palomares del Río');
    await s.tap('PublishRoute.calculate');
    await s.until(() => window.__mvc.route() === 'StopsRoute', null, 'se abre «Paradas y recorrido»', 8000);
    await s.waitText('Toda la ruta está dentro de la provincia de Sevilla.');
    const text = await s.appText();
    s.expect(/\d+,\d km · \d+ min/.test(text), 'resumen de distancia y tiempo del servidor');
    await s.shot('19-dentro-provincia');
    await s.checkForbiddenText('paradas y recorrido');
  });

  await s.step('19 · Una parada fuera de la provincia bloquea «Guardar ruta» y dice por qué', async () => {
    await openScreen(s, 'StopsRoute', { draftId: 'preview-19-outside' });
    await s.waitText('Fuera de provincia');
    const text = await s.appText();
    s.expect(text.includes('Corrige los puntos fuera de la provincia para guardar.'), 'mensaje de bloqueo del servidor');
    s.expect(text.includes('Buscar otra parada'), 'ofrece buscar otra parada');
    await s.shot('19-fuera-provincia');
    await s.checkForbiddenText('parada fuera de provincia');
  });

  await s.step('19 → publicada · Guardar ruta publica y confirma lo que ha creado el servidor', async () => {
    await openScreen(s, 'StopsRoute', { draftId: 'preview-19' });
    await s.waitText('Toda la ruta está dentro de la provincia de Sevilla.');
    await s.tap('StopsRoute.save');
    await s.until(() => window.__mvc.route() === 'RoutePublished', null, 'se abre «Ruta publicada»', 15000);
    await s.waitText('¡Tu ruta está publicada!');
    const text = await s.appText();
    s.expect(text.includes('Palomares del Río'), 'resume el origen');
    await s.shot('ruta-publicada');
    await s.checkForbiddenText('ruta publicada');
  });
}
