// Panel de pruebas del visor: «Estás en», «Perfil de prueba», «Ir a pantalla», «Simulaciones», «Correcciones» y el modo
// móvil (el visor ocupa toda la ventana y el panel es un cajón). Se prueba con el puente real de la app (window.__mvc).
// Este flujo juzga el VISOR, no las pantallas de la app: no mira si la pantalla de fondo es una pantalla provisional.
export const meta = { description: 'panel del visor: perfiles, «Ir a pantalla», simulaciones, correcciones y modo móvil' };

const section = (s, title) => s.page.locator(`.v-sec[aria-label="${title}"]`);
async function openSection(s, title) {
  const sec = section(s, title);
  if ((await sec.getAttribute('data-open')) !== '1') await sec.locator('.v-sec-h').click();
  await s.page.waitForTimeout(80);
  return sec.locator('.v-sec-b');
}
const whenReady = (s) => s.page.evaluate(() => window.__mvcViewer.whenReady(45000));

export default async function panel(s) {
  await s.open('?perm=granted');
  await s.requireBridge();
  const page = s.page;

  await s.step('«Estás en» dice la pantalla y el puente está conectado', async () => {
    const route = await s.inApp(() => window.__mvc.route());
    s.expect(route, 'window.__mvc.route() devuelve el nombre de la pantalla');
    await s.untilViewer((r) => document.querySelector('.v-where .v-route') && document.querySelector('.v-where .v-route').textContent.trim() === r, route, `«Estás en» muestra ${route}`);
    const chips = await page.locator('.v-sec[aria-label="Estás en"] .v-chip').allTextContents();
    s.expect(chips.some((c) => /Puente de pruebas conectado/.test(c)), `el panel dice «Puente de pruebas conectado» (${JSON.stringify(chips)})`);
    s.note(`primera pantalla con el perfil por defecto: ${route}`);
  });

  await s.step('«Ir a pantalla»: buscar y saltar a otra pantalla', async () => {
    const routes = await s.inApp(() => window.__mvc.routes());
    const target = routes.find((r) => r.name === 'ChooseRole') || routes.find((r) => r.slice !== 'dev' && r.name !== 'Welcome');
    s.expect(target, 'el catálogo de rutas tiene al menos una pantalla además de Welcome');
    const body = await openSection(s, 'Ir a pantalla');
    await body.locator('input[aria-label="Buscar pantalla"]').fill(target.name);
    const entry = body.locator('.v-go:not([disabled])', { hasText: target.name }).first();
    await entry.waitFor({ timeout: 4000 });
    await s.shot('panel-ir-a-pantalla');
    await entry.click();
    await s.until((n) => window.__mvc.route() === n, target.name, `la app abre ${target.name}`, 15000);
    await s.untilViewer((n) => document.querySelector('.v-where .v-route').textContent.trim() === n, target.name, `«Estás en» pasa a ${target.name}`);
    await body.locator('input[aria-label="Buscar pantalla"]').fill('zzz-no-existe');
    s.expect(/Ninguna pantalla coincide/.test(await body.textContent()), 'una búsqueda sin resultados lo dice');
    await body.locator('input[aria-label="Buscar pantalla"]').fill('');
  });

  await s.step('«Ir a pantalla»: buscar por número de lámina enseña miniaturas del diseño', async () => {
    const body = await openSection(s, 'Ir a pantalla');
    await body.locator('input[aria-label="Buscar pantalla"]').fill('11');
    const n = await body.locator('.v-go').count();
    s.expect(n >= 1, `la búsqueda «11» devuelve alguna lámina (devuelve ${n})`);
    const withThumb = await body.locator('.v-go img').count();
    s.note(`láminas con miniatura para «11»: ${withThumb} de ${n}`);
    await body.locator('input[aria-label="Buscar pantalla"]').fill('');
  });

  await s.step('«Atrás» y «Reiniciar la app» del panel', async () => {
    const here = await openSection(s, 'Estás en');
    await here.getByRole('button', { name: 'Atrás' }).click();
    await page.waitForTimeout(300);
    s.expect((await page.locator('.v-toast').count()) === 0 || !/No se puede volver/.test((await page.locator('.v-toast').textContent()) || ''), 'Atrás no da error');
    await here.getByRole('button', { name: 'Reiniciar la app' }).click();
    await whenReady(s);
    s.expect(await s.hasBridge(), 'tras reiniciar, el puente vuelve a estar');
  });

  await s.step('«Perfil de prueba»: cada perfil reinicia la app con ese perfil', async () => {
    for (const [label, id] of [['Pasajero', 'passenger'], ['Conductor', 'driver'], ['Administración', 'admin'], ['Persona nueva', 'new']]) {
      const body = await openSection(s, 'Perfil de prueba');
      await body.locator('.v-radio', { hasText: label }).first().click();
      await whenReady(s);
      s.expect((await s.inViewer(() => window.__mvcViewer.state.profile)) === id, `el visor guarda el perfil ${id}`);
      await s.until(() => !!(window.__mvc && window.__mvc.ready()), null, `la app de ${id} está lista`, 20000);
      const got = await s.inApp(() => (window.__mvc.profile ? window.__mvc.profile() : null));
      if (got !== null) s.expect(got === id, `el backend en memoria arranca como ${id} (${got})`);
      s.note(`${id}: primera pantalla ${await s.inApp(() => window.__mvc.route())}`);
    }
  });

  await s.step('«Perfil de prueba»: semilla y «Borrar datos y empezar de cero»', async () => {
    const body = await openSection(s, 'Perfil de prueba');
    await body.locator('input[aria-label="Semilla de datos"]').fill('demo');
    await body.getByRole('button', { name: 'Aplicar' }).click();
    await whenReady(s);
    s.expect((await s.inViewer(() => window.__mvcViewer.state.seed)) === 'demo', 'la semilla se guarda');
    await body.locator('input[aria-label="Semilla de datos"]').fill('');
    await body.getByRole('button', { name: 'Aplicar' }).click();
    await whenReady(s);
    await body.getByRole('button', { name: 'Borrar datos y empezar de cero' }).click();
    await whenReady(s);
    s.expect((await s.inViewer(() => window.__mvcViewer.state.seed)) === null, 'sin semilla vuelve a la de siempre');
  });

  await s.step('«Simulaciones»: móvil, conexión, GPS y lugar llegan a la app', async () => {
    const body = await openSection(s, 'Simulaciones');
    await s.shot('panel-simulaciones');
    await body.locator('select[aria-label="Móvil simulado"]').selectOption('pixel8');
    await s.until(() => window.__MVC_PREVIEW_SHELL__.device.id === 'pixel8' && innerWidth === 412 && innerHeight === 915, null, 'el móvil pasa a Pixel 8 (412×915)');
    await body.locator('select[aria-label="Móvil simulado"]').selectOption('iphone15');
    await s.until(() => window.__MVC_PREVIEW_SHELL__.device.id === 'iphone15', null, 'vuelve al iPhone 15');
    await body.locator('[role="group"][aria-label="Conexión"] button', { hasText: 'Sin Internet' }).click();
    await s.until(() => window.__MVC_PREVIEW_SHELL__.isOffline() && navigator.onLine === false, null, 'la app queda sin Internet');
    s.expect(/Sin Internet/.test((await page.locator('.v-sec[aria-label="Estás en"] .v-chip.warn').allTextContents()).join(' ')), '«Estás en» muestra la marca «Sin Internet»');
    await body.locator('[role="group"][aria-label="Conexión"] button', { hasText: 'Wi-Fi' }).click();
    await s.until(() => !window.__MVC_PREVIEW_SHELL__.isOffline(), null, 'vuelve la conexión');
    await body.locator('[role="group"][aria-label="GPS"] button', { hasText: 'Apagado' }).click();
    await s.until(() => window.__MVC_PREVIEW_SHELL__.sim.gps === 'off', null, 'el GPS pasa a apagado');
    await body.locator('[role="group"][aria-label="GPS"] button', { hasText: 'Bueno' }).click();
    const options = await body.locator('select[aria-label="Lugar"] option').evaluateAll((os) => os.map((o) => o.value));
    s.expect(options.length >= 5, `hay lugares de la provincia de Sevilla (${options.length})`);
    await body.locator('select[aria-label="Lugar"]').selectOption(options[options.length - 1]);
    await s.until((id) => window.__MVC_PREVIEW_SHELL__.sim.place.id === id, options[options.length - 1], 'el lugar llega a la app');
    await body.locator('select[aria-label="Lugar"]').selectOption(options[0]);
  });

  await s.step('«Simulaciones»: permisos del sistema', async () => {
    const body = await openSection(s, 'Simulaciones');
    await body.locator('select[aria-label="Cámara"]').selectOption('denied');
    await s.until(() => window.__MVC_PREVIEW_SHELL__.permissionStatus('camera') === 'denied', null, 'la cámara pasa a denegada');
    await body.locator('select[aria-label="Cámara"]').selectOption('undetermined');
    await s.until(() => window.__MVC_PREVIEW_SHELL__.permissionStatus('camera') === 'undetermined', null, 'la cámara vuelve a «sin preguntar»');
    await body.getByRole('button', { name: 'Restablecer permisos' }).click();
    await s.until(() => ['location', 'notifications', 'camera', 'photos'].every((k) => window.__MVC_PREVIEW_SHELL__.permissionStatus(k) === 'undetermined'), null, 'todos los permisos vuelven a «sin preguntar»');
  });

  await s.step('«Simulaciones»: reloj, hora de la barra de estado y lector de pantalla', async () => {
    const body = await openSection(s, 'Simulaciones');
    await body.locator('input[aria-label^="Fecha y hora simuladas"]').fill('2026-10-05T07:17');
    await body.getByRole('button', { name: 'Aplicar', exact: true }).click();
    await s.until(() => new Date().toISOString().startsWith('2026-10-05T05:17'), null, 'la app cree que son las 07:17 del lunes 5 de octubre (Madrid)');
    s.expect((await page.locator('.sb-time').textContent()).trim() === '07:17', 'la barra de estado sigue al reloj (07:17)');
    await body.getByRole('button', { name: 'Hora real' }).click();
    const hostNow = await page.evaluate(() => Date.now());
    await s.until((t) => Math.abs(Date.now() - t) < 15000, hostNow, 'vuelve la hora real');
    const st = body.locator('input[aria-label="Hora de la barra de estado"]');
    await st.fill('08:15');
    await st.dispatchEvent('change');
    await s.untilViewer(() => document.querySelector('.sb-time').textContent.trim() === '08:15', null, 'la barra de estado marca 08:15');
    await body.locator('button[role="switch"][aria-label="Lector de pantalla"]').click();
    await s.until(() => window.__MVC_PREVIEW_SHELL__.sim.screenReader === true, null, 'la app sabe que hay lector de pantalla');
    await body.locator('button[role="switch"][aria-label="Lector de pantalla"]').click();
  });

  await s.step('«Simulaciones»: SMS de prueba, Mensajes y notificaciones', async () => {
    const body = await openSection(s, 'Simulaciones');
    await body.getByRole('button', { name: 'SMS de prueba' }).click();
    await page.locator('.v-banner').first().waitFor({ timeout: 4000 });
    s.expect((await s.inViewer(() => window.__mvcViewer.sms().length)) >= 1, 'el SMS queda en la bandeja del visor');
    await body.getByRole('button', { name: 'Abrir Mensajes en el móvil' }).click();
    await page.locator('.v-msgs').waitFor({ timeout: 4000 });
    await s.shot('panel-mensajes');
    await page.locator('.v-msgs').getByRole('button', { name: '‹ Volver' }).click();
    await body.getByRole('button', { name: 'Notificación de prueba' }).click();
    await page.locator('.v-banner').first().waitFor({ timeout: 4000 });
    await s.inViewer(() => window.__mvcViewer.resetDialogs());
  });

  await s.step('«Simulaciones»: tema del visor (la app sigue siendo clara)', async () => {
    const body = await openSection(s, 'Simulaciones');
    await body.locator('[role="group"][aria-label="Tema del visor"] button', { hasText: 'Oscuro' }).click();
    s.expect((await s.inViewer(() => document.documentElement.getAttribute('data-theme'))) === 'dark', 'el visor pasa a oscuro');
    s.expect((await s.inViewer(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())) === '#070b18', 'el fondo del visor es oscuro');
    s.expect((await s.inApp(() => matchMedia('(prefers-color-scheme: dark)').matches)) === false, 'la app sigue en claro');
    await s.shot('panel-visor-oscuro');
    await body.locator('[role="group"][aria-label="Tema del visor"] button', { hasText: 'Sistema' }).click();
    s.expect((await s.inViewer(() => document.documentElement.getAttribute('data-theme'))) === null, 'vuelve a seguir al sistema');
  });

  await s.step('«Correcciones»: anotar, listar, ver el texto, descargar y borrar', async () => {
    await s.inViewer(() => window.__mvcViewer.state.notes.splice(0));
    const body = await openSection(s, 'Correcciones');
    await body.getByRole('button', { name: 'Añadir' }).click();
    s.expect(/Escribe qué hay que corregir/.test((await page.locator('.v-toast').textContent()) || ''), 'una nota vacía se rechaza con un aviso');
    await body.locator('textarea[aria-label="Qué hay que corregir"]').fill('El botón principal queda pegado al borde inferior.');
    await body.locator('select[aria-label="Tipo de corrección"]').selectOption('Diseño');
    await body.getByRole('button', { name: 'Añadir' }).click();
    await s.untilViewer(() => window.__mvcViewer.state.notes.length === 1, null, 'la nota se guarda');
    const note = await s.inViewer(() => window.__mvcViewer.notes()[0]);
    s.expect(note.route && note.profile && note.device, `la nota lleva pantalla, perfil y móvil (${JSON.stringify({ route: note.route, profile: note.profile, device: note.device })})`);
    s.expect((await section(s, 'Correcciones').locator('.v-badge').textContent()).trim() === '1', 'la cabecera de la sección muestra 1');
    await section(s, 'Correcciones').locator('.v-sec-b').getByRole('button', { name: 'Ver texto' }).click();
    const modal = page.locator('.v-modal');
    await modal.waitFor({ timeout: 4000 });
    const md = await modal.locator('textarea').inputValue();
    s.expect(md.startsWith('# Correcciones · MVC vista previa') && md.includes('El botón principal queda pegado') && md.includes('Pantalla:'), 'el texto exportado es Markdown con la pantalla');
    await modal.getByRole('button', { name: 'Cerrar' }).click();
    const dl = page.waitForEvent('download', { timeout: 8000 });
    await section(s, 'Correcciones').locator('.v-sec-b').getByRole('button', { name: 'Descargar .md' }).click();
    await page.locator('.v-sheet').waitFor({ timeout: 4000 });
    await page.locator('.v-sheet').getByRole('button', { name: 'Guardar', exact: true }).click();
    const download = await dl;
    s.expect(/^correcciones-mvc.*\.md$/.test(download.suggestedFilename()), `la descarga se llama correcciones-mvc….md (${download.suggestedFilename()})`);
    await section(s, 'Correcciones').locator('.v-sec-b').getByRole('button', { name: 'Borrar todas' }).click();
    await s.untilViewer(() => window.__mvcViewer.state.notes.length === 0, null, 'se borran las notas');
  });

  await s.step('ocultar y volver a mostrar el panel', async () => {
    await page.getByRole('button', { name: 'Ocultar el panel' }).click();
    await s.untilViewer(() => document.querySelector('#v-root').getAttribute('data-panel') === 'closed', null, 'el panel se oculta');
    const handle = page.getByRole('button', { name: 'Abrir el panel de pruebas' });
    await handle.click();
    await s.untilViewer(() => document.querySelector('#v-root').getAttribute('data-panel') === 'open', null, 'el panel vuelve a mostrarse');
  });

  await s.step('ventana de móvil: la app ocupa toda la ventana y el panel es un cajón', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await s.untilViewer(() => document.querySelector('#v-root').getAttribute('data-bleed') === '1', null, 'el visor pasa al modo móvil (bleed)');
    await s.until(() => innerWidth === 390 && innerHeight === 844, null, 'el iframe de la app ocupa 390×844');
    s.expect(!(await page.locator('.v-island').isVisible()), 'sin marco: no se dibuja la isla');
    await page.getByRole('button', { name: 'Abrir el panel de pruebas' }).click();
    await s.untilViewer(() => document.querySelector('#v-root').getAttribute('data-panel') === 'open', null, 'el cajón se abre');
    await s.shot('movil-cajon');
    await page.getByRole('button', { name: 'Ocultar el panel' }).click();
    await s.untilViewer(() => document.querySelector('#v-root').getAttribute('data-panel') === 'closed', null, 'el cajón se cierra');
    await page.setViewportSize({ width: 1400, height: 900 });
    await s.untilViewer(() => document.querySelector('#v-root').getAttribute('data-bleed') === '0', null, 'vuelve el marco del móvil');
  });

  await s.step('sin salidas a Internet', async () => {
    await s.checkBlocked('el panel');
  });
}
