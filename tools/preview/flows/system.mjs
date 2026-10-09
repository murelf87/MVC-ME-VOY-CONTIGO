// Capa del «sistema» del móvil simulado: lo que el navegador no puede dar de verdad y el visor SIMULA con etiqueta
// «Simulación» (permisos, Ajustes, cámara, galería, archivos, compartir, abrir enlaces, Apple Pay / Google Pay, biometría,
// avisos, SMS, red, GPS, reloj, dispositivo). Se prueba por la misma vía que usa la app: __MVC_PREVIEW_SHELL__.
export const meta = { description: 'permisos, cámara, galería, compartir, enlaces, pagos simulados, biometría, avisos, SMS, red, reloj' };

const sh = (s, fn, arg) => s.app.evaluate(fn, arg);
/** Los eventos del visor llegan a la app por postMessage (asíncronos): se espera a que se cumpla, no se lee a ciegas. */
const until = async (s, fn, arg, what) => {
  try {
    await s.app.waitForFunction(fn, arg, { timeout: 4000 });
  } catch {
    throw new Error(`Se esperaba (en 4 s): ${what}`);
  }
};

export default async function system(s) {
  await s.open('?perm=ask&profile=new');
  const page = s.page;
  const ios = page.locator('.v-ios-alert');
  const and = page.locator('.v-and-perm');

  await s.step('iOS · permiso de ubicación: diálogo con «Simulación» y concesión', async () => {
    const p = sh(s, () => window.__MVC_PREVIEW_SHELL__.requestPermission('location'));
    await ios.waitFor({ timeout: 5000 });
    const text = await ios.textContent();
    s.expect(/ubicación/i.test(text), 'el diálogo habla de la ubicación');
    s.expect(/Simulación/i.test(text), 'el diálogo está etiquetado como simulación');
    await s.shot('permiso-ios');
    await ios.getByRole('button', { name: 'Permitir al usar la app' }).click();
    s.expect((await p) === 'granted', 'requestPermission devuelve granted');
    s.expect((await sh(s, () => window.__MVC_PREVIEW_SHELL__.permissionStatus('location'))) === 'granted', 'permissionStatus = granted');
    const again = await Promise.race([sh(s, () => window.__MVC_PREVIEW_SHELL__.requestPermission('location')), new Promise((r) => setTimeout(() => r('colgado'), 2000))]);
    s.expect(again === 'granted', 'pedirlo otra vez no vuelve a preguntar');
  });

  await s.step('iOS · «No permitir» deja el permiso bloqueado y no se vuelve a preguntar', async () => {
    const p = sh(s, () => window.__MVC_PREVIEW_SHELL__.requestPermission('camera'));
    await ios.waitFor({ timeout: 5000 });
    await ios.getByRole('button', { name: 'No permitir' }).click();
    s.expect((await p) === 'blocked', 'requestPermission devuelve blocked');
    const again = await Promise.race([sh(s, () => window.__MVC_PREVIEW_SHELL__.requestPermission('camera')), new Promise((r) => setTimeout(() => r('colgado'), 2000))]);
    s.expect(again === 'blocked', 'sin diálogo: sigue bloqueado');
  });

  await s.step('Ajustes simulados: activar el permiso y volver a la app', async () => {
    const events = await sh(s, () => { window.__perm = []; window.addEventListener('mvc:preview-permission', (e) => window.__perm.push(e.detail)); window.__fg = []; document.addEventListener('visibilitychange', () => window.__fg.push(document.visibilityState)); return true; });
    s.expect(events, 'oyentes instalados');
    const p = sh(s, () => window.__MVC_PREVIEW_SHELL__.openSettings());
    await page.locator('.v-set').waitFor({ timeout: 5000 });
    await s.shot('ajustes');
    await page.locator('.v-set .tg[aria-label="Cámara"]').click();
    await until(s, () => window.__MVC_PREVIEW_SHELL__.permissionStatus('camera') === 'granted', null, 'el interruptor de Ajustes concede el permiso (la app lo lee como granted)');
    await page.getByRole('button', { name: 'Volver a MVC' }).click();
    await p;
    await until(s, () => window.__perm.some((e) => e.kind === 'camera' && e.status === 'granted'), null, 'la app recibe mvc:preview-permission (camera → granted)');
    await until(s, () => window.__fg.includes('hidden') && window.__fg[window.__fg.length - 1] === 'visible', null, 'la app pasa a segundo plano y vuelve a primer plano');
  });

  await s.step('Android · dos denegaciones bloquean el permiso', async () => {
    await page.evaluate(() => window.__mvcViewer.setDevice('pixel8'));
    await until(s, () => window.__MVC_PREVIEW_SHELL__.device.platform === 'android', null, 'la app ve platform = android');
    const first = sh(s, () => window.__MVC_PREVIEW_SHELL__.requestPermission('notifications'));
    await and.waitFor({ timeout: 5000 });
    await s.shot('permiso-android');
    await and.getByRole('button', { name: 'No permitir' }).click();
    s.expect((await first) === 'denied', 'primera denegación = denied (se puede volver a preguntar)');
    const second = sh(s, () => window.__MVC_PREVIEW_SHELL__.requestPermission('notifications'));
    await and.waitFor({ timeout: 5000 });
    await and.getByRole('button', { name: 'No permitir' }).click();
    s.expect((await second) === 'blocked', 'segunda denegación = blocked');
    await page.evaluate(() => window.__mvcViewer.setDevice('iphone15'));
    await until(s, () => window.__MVC_PREVIEW_SHELL__.device.platform === 'ios', null, 'la app vuelve a ver platform = ios');
  });

  await s.step('cámara simulada: foto de ejemplo etiquetada y cancelar', async () => {
    const p = sh(s, () => window.__MVC_PREVIEW_SHELL__.cameraCapture({ facing: 'user', label: 'Selfie de prueba' }));
    await page.locator('.v-cam').waitFor({ timeout: 5000 });
    s.expect(/Simulación de cámara/.test(await page.locator('.v-cam').textContent()), 'la cámara se declara simulada');
    await s.shot('camara');
    await page.locator('.v-cam .shutter').click();
    const f = await p;
    s.expect(f && f.example === true && /^data:image\/jpeg;base64,/.test(f.uri) && f.width > 0 && f.name && f.mimeType === 'image/jpeg', 'devuelve un archivo de ejemplo (example: true)');
    const q = sh(s, () => window.__MVC_PREVIEW_SHELL__.cameraCapture({}));
    await page.locator('.v-cam').waitFor({ timeout: 5000 });
    await page.locator('.v-cam .xb').click();
    s.expect((await q) === null, 'cancelar devuelve null');
  });

  await s.step('galería y archivos simulados', async () => {
    const p = sh(s, () => window.__MVC_PREVIEW_SHELL__.pickImages({ multiple: false }));
    await page.locator('.v-gal').waitFor({ timeout: 5000 });
    await s.shot('galeria');
    await page.locator('.v-gal button').nth(1).click();
    await page.getByRole('button', { name: /^Añadir/ }).click();
    const files = await p;
    s.expect(files.length === 1 && files[0].example === true && /^data:image\/jpeg/.test(files[0].uri), 'devuelve una imagen de ejemplo');
    const c = sh(s, () => window.__MVC_PREVIEW_SHELL__.pickImages({}));
    await page.locator('.v-gal').waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Cancelar' }).click();
    s.expect((await c).length === 0, 'cancelar devuelve []');
    const d = sh(s, () => window.__MVC_PREVIEW_SHELL__.pickDocument({ accept: ['application/pdf'] }));
    await page.locator('.v-docs').waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Elegir', exact: true }).click();
    const docs = await d;
    s.expect(docs.length === 1 && docs[0].mimeType === 'application/pdf' && /^data:application\/pdf;base64,/.test(docs[0].uri), 'devuelve un PDF de ejemplo');
  });

  await s.step('compartir y abrir enlaces piden confirmación y no salen del navegador', async () => {
    const p = sh(s, () => window.__MVC_PREVIEW_SHELL__.share({ title: 'Mi viaje', message: 'Voy a Sevilla Este', url: 'https://mvc.example/v/abc' }));
    await page.locator('.v-sheet').waitFor({ timeout: 5000 });
    await s.shot('compartir');
    await page.locator('.v-target').first().click();
    s.expect((await p) === 'shared', 'elegir un destino devuelve shared');
    const q = sh(s, () => window.__MVC_PREVIEW_SHELL__.share({ message: 'x' }));
    await page.locator('.v-sheet').waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Cancelar' }).click();
    s.expect((await q) === 'dismissed', 'cancelar devuelve dismissed');
    const o = sh(s, () => window.__MVC_PREVIEW_SHELL__.openExternal('https://www.sevilla.org/ayuda'));
    await ios.waitFor({ timeout: 5000 });
    s.expect(/sevilla\.org/.test(await ios.textContent()), 'el diálogo enseña la dirección');
    await s.shot('enlace-externo');
    await ios.getByRole('button', { name: 'Cancelar' }).click();
    s.expect((await o) === false, 'cancelar devuelve false');
    const url0 = await s.app.evaluate(() => location.href);
    await s.app.evaluate(() => { const a = document.createElement('a'); a.id = 'xlink'; a.href = 'https://example.org/legal'; a.textContent = 'enlace'; a.style.cssText = 'position:fixed;left:12px;top:300px;z-index:99999;background:#fff;padding:8px'; document.body.appendChild(a); });
    await s.app.locator('#xlink').click();
    await ios.waitFor({ timeout: 5000 });
    s.expect(/example\.org/.test(await ios.textContent()), 'un <a href> externo también pide confirmación');
    await ios.getByRole('button', { name: 'Cancelar' }).click();
    s.expect((await s.app.evaluate(() => location.href)) === url0, 'la app no ha navegado a ninguna parte');
    await s.app.evaluate(() => document.getElementById('xlink').remove());
  });

  await s.step('Apple Pay simulado: «no se cobra nada» y devuelve una referencia simulada', async () => {
    const p = sh(s, () => window.__MVC_PREVIEW_SHELL__.payWithWallet({ merchant: 'MVC · Me voy contigo', label: 'Reserva Sevilla Este → Olavide', amountLabel: '4,00 €', lines: [{ label: 'Plaza', amountLabel: '4,00 €' }] }));
    const sheet = page.locator('.v-sheet');
    await sheet.waitFor({ timeout: 5000 });
    const text = await sheet.textContent();
    s.expect(text.includes('Simulación de Apple Pay — no se cobra nada'), 'el aviso «Simulación de Apple Pay — no se cobra nada» está en la hoja');
    await s.shot('apple-pay');
    await sheet.getByRole('button', { name: /Pagar con Face ID/ }).click();
    const r = await p;
    s.expect(r.status === 'authorized' && /^SIM-APAY-/.test(r.reference), `autorizado con referencia simulada (${JSON.stringify(r)})`);
    const q = sh(s, () => window.__MVC_PREVIEW_SHELL__.payWithWallet({ merchant: 'MVC', label: 'x', amountLabel: '1,00 €' }));
    await sheet.waitFor({ timeout: 5000 });
    await sheet.getByRole('button', { name: 'Cancelar' }).click();
    s.expect((await q).status === 'cancelled', 'cancelar devuelve cancelled');
    const f = sh(s, () => window.__MVC_PREVIEW_SHELL__.payWithWallet({ merchant: 'MVC', label: 'x', amountLabel: '1,00 €' }));
    await sheet.waitFor({ timeout: 5000 });
    await sheet.getByRole('button', { name: 'Simular fallo' }).click();
    s.expect((await f).status === 'failed', 'el fallo simulado devuelve failed');
  });

  await s.step('Google Pay simulado en Android', async () => {
    await page.evaluate(() => window.__mvcViewer.setDevice('pixel8'));
    await until(s, () => window.__MVC_PREVIEW_SHELL__.device.platform === 'android', null, 'la app ve platform = android');
    const p = sh(s, () => window.__MVC_PREVIEW_SHELL__.payWithWallet({ merchant: 'MVC', label: 'Reserva', amountLabel: '4,00 €' }));
    const sheet = page.locator('.v-sheet');
    await sheet.waitFor({ timeout: 5000 });
    s.expect((await sheet.textContent()).includes('Simulación de Google Pay — no se cobra nada'), 'el aviso de Google Pay está en la hoja');
    await sheet.getByRole('button', { name: 'Pagar', exact: true }).click();
    s.expect((await p).status === 'authorized', 'autorizado');
    await page.evaluate(() => window.__mvcViewer.setDevice('iphone15'));
  });

  await s.step('biometría simulada y alertas del sistema', async () => {
    const b = sh(s, () => window.__MVC_PREVIEW_SHELL__.biometricPrompt({ reason: 'Confirma tu reserva' }));
    const sheet = page.locator('.v-sheet');
    await sheet.waitFor({ timeout: 5000 });
    s.expect(/Simulación de biometría/.test(await sheet.textContent()), 'la biometría se declara simulada');
    await sheet.getByRole('button', { name: 'Simular fallo' }).click();
    s.expect((await b) === 'fail', 'fallo simulado = fail');
    const a = sh(s, () => window.__MVC_PREVIEW_SHELL__.alert({ title: '¿Eliminar la reserva?', message: 'No se puede deshacer.', buttons: [{ id: 'cancel', label: 'Cancelar', style: 'cancel' }, { id: 'del', label: 'Eliminar', style: 'destructive' }] }));
    await ios.waitFor({ timeout: 5000 });
    await ios.getByRole('button', { name: 'Eliminar' }).click();
    s.expect((await a) === 'del', 'el botón pulsado devuelve su id');
    const e = sh(s, () => window.__MVC_PREVIEW_SHELL__.alert({ title: 'Aviso', buttons: [{ id: 'cancel', label: 'Cancelar', style: 'cancel' }, { id: 'ok', label: 'Seguir' }] }));
    await ios.waitFor({ timeout: 5000 });
    await page.keyboard.press('Escape');
    s.expect((await e) === 'cancel', 'Escape equivale al botón de cancelar');
  });

  await s.step('notificaciones: el aviso llega a la app al pulsarlo', async () => {
    await sh(s, () => { window.__np = null; window.addEventListener('mvc:preview-notification-response', (e) => { window.__np = e.detail; }); window.__MVC_PREVIEW_SHELL__.notify({ title: 'Tu viaje sale en 30 minutos', body: 'Sevilla Este → Pablo de Olavide', data: { tripId: 't1' }, id: 'n1' }); });
    const banner = page.locator('.v-banner');
    await banner.waitFor({ timeout: 5000 });
    await s.shot('notificacion');
    await banner.click();
    await until(s, () => window.__np && window.__np.id === 'n1' && window.__np.data && window.__np.data.tripId === 't1', null, 'la app recibe mvc:preview-notification-response con id y data');
  });

  await s.step('SMS: aviso, bandeja del visor y app Mensajes con el código', async () => {
    await sh(s, () => window.__MVC_PREVIEW_SHELL__.deliverSms({ to: '+34 600 000 000', from: 'MVC', body: 'Tu código de MVC es 482913. Caduca en 10 minutos. No lo compartas con nadie.', code: '482913' }));
    const banner = page.locator('.v-banner');
    await banner.waitFor({ timeout: 5000 });
    s.expect((await page.evaluate(() => window.__mvcViewer.sms())).length === 1, 'el visor guarda el SMS');
    await banner.click();
    const msgs = page.locator('.v-msgs');
    await msgs.waitFor({ timeout: 5000 });
    s.expect((await msgs.locator('.v-bubble b').textContent()) === '482913', 'Mensajes resalta el código');
    await s.shot('sms');
    await msgs.getByRole('button', { name: '‹ Volver' }).click();
  });

  await s.step('sin Internet: la app lo sabe y no sale nada', async () => {
    s.allowBlocked = true; // este paso PRUEBA el corte
    const ev = await sh(s, () => { window.__net = []; window.addEventListener('offline', () => window.__net.push('offline')); window.addEventListener('online', () => window.__net.push('online')); window.addEventListener('mvc:preview-sim', (e) => window.__net.push('sim:' + e.detail.network)); return true; });
    s.expect(ev, 'oyentes instalados');
    await page.evaluate(() => window.__mvcViewer.setSim({ network: 'none' }));
    await until(s, () => window.__MVC_PREVIEW_SHELL__.isOffline(), null, 'la app pasa a sin Internet (isOffline())');
    const r = await sh(s, async () => {
      const out = { isOffline: window.__MVC_PREVIEW_SHELL__.isOffline(), onLine: navigator.onLine, simNet: window.__MVC_PREVIEW_SHELL__.sim.network };
      try { await fetch('https://example.com/prueba'); out.fetch = 'respondió'; } catch (e) { out.fetch = e.name; }
      out.blocked = window.__MVC_PREVIEW_SHELL__.blocked.length;
      return out;
    });
    s.expect(r.isOffline && r.onLine === false && r.simNet === 'none', `isOffline()/navigator.onLine/sim.network coinciden (${JSON.stringify(r)})`);
    s.expect(r.fetch === 'TypeError' && r.blocked >= 1, `fetch a un origen externo se rechaza y queda anotado (${r.fetch}, blocked=${r.blocked})`);
    await page.evaluate(() => window.__mvcViewer.setSim({ network: 'wifi' }));
    await until(s, () => window.__net.includes('offline') && window.__net.includes('online'), null, 'la app recibe los eventos offline y online del navegador');
  });

  await s.step('reloj simulado y GPS', async () => {
    await page.evaluate(() => window.__mvcViewer.setClock('2026-10-05T07:17:00+02:00'));
    await until(s, () => new Date().toISOString().startsWith('2026-10-05T05:17'), null, 'Date.now() de la app sigue el reloj simulado (05:17 UTC)');
    s.expect((await page.locator('.sb-time').textContent()).trim() === '07:17', 'la barra de estado marca 07:17');
    await page.evaluate(() => window.__mvcViewer.setClock(null));
    const hostNow = await page.evaluate(() => Date.now());
    await until(s, (t) => Math.abs(Date.now() - t) < 15000, hostNow, 'sin reloj simulado, Date.now() de la app vuelve a la hora real');
    await page.evaluate(() => window.__mvcViewer.setSim({ gps: 'off' }));
    await until(s, () => window.__MVC_PREVIEW_SHELL__.sim.gps === 'off', null, 'sim.gps = off llega a la app');
    await page.evaluate(() => window.__mvcViewer.setSim({ gps: 'good' }));
  });

  await s.step('cambio de móvil: tamaño y márgenes seguros (la app vuelve a medirlos)', async () => {
    // react-native-safe-area-context (web) solo mide al montar y en transitionend: el visor tiene que provocar la nueva lectura.
    // shell.safeAreas.reads cuenta las lecturas de la librería; lastTop es el «top» que recibió en la última.
    const reads = () => sh(s, () => window.__MVC_PREVIEW_SHELL__.safeAreas.reads);
    const switchTo = async (id, w, h, top, what) => {
      const before = await reads();
      await page.evaluate((d) => window.__mvcViewer.setDevice(d), id);
      await until(s, ([d, ww, hh]) => window.__MVC_PREVIEW_SHELL__.device.id === d && innerWidth === ww && innerHeight === hh, [id, w, h], `el iframe pasa a ${w}×${h} (${what})`);
      await until(s, ([n, t]) => window.__MVC_PREVIEW_SHELL__.safeAreas.reads > n && window.__MVC_PREVIEW_SHELL__.safeAreas.lastTop === t, [before, top], `la librería de márgenes seguros vuelve a medir y recibe top = ${top} (${what})`);
      const d = await sh(s, () => ({ w: innerWidth, h: innerHeight, top: window.__MVC_PREVIEW_SHELL__.device.safeTop }));
      s.expect(d.top === top, `${w}×${h} con safeTop ${top} (${JSON.stringify(d)})`);
    };
    await switchTo('promax', 430, 932, 59, 'iPhone 15 Pro Max');
    await switchTo('se', 375, 667, 20, 'iPhone SE');
    await s.shot('iphone-se');
    await switchTo('pixel8', 412, 915, 32, 'Pixel 8');
    await switchTo('iphone15', 393, 852, 59, 'iPhone 15');
  });

  await s.step('la app es solo clara; el visor sigue el modo del sistema', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const dark = await sh(s, () => matchMedia('(prefers-color-scheme: dark)').matches);
    s.expect(dark === false, 'la app ve prefers-color-scheme: light aunque el sistema sea oscuro');
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    s.expect(bg === '#070b18', `el visor pasa a oscuro (--bg = ${bg})`);
    await s.shot('visor-oscuro');
    await page.emulateMedia({ colorScheme: 'light' });
    const bg2 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    s.expect(bg2 === '#e9edf5', `y vuelve a claro (--bg = ${bg2})`);
  });

  await s.step('historial en memoria y almacenamiento dentro de la app', async () => {
    const r = await sh(s, async () => {
      localStorage.setItem('t', '1');
      const ls = localStorage.getItem('t');
      localStorage.removeItem('t');
      history.pushState({ a: 1 }, '', '#x');
      history.pushState({ a: 2 }, '', '#y');
      const mid = history.state && history.state.a;
      const got = await new Promise((res) => { window.addEventListener('popstate', (e) => res(e.state && e.state.a), { once: true }); history.back(); });
      return { ls, mid, got };
    });
    s.expect(r.ls === '1' && r.mid === 2 && r.got === 1, `localStorage e history funcionan en about:srcdoc (${JSON.stringify(r)})`);
  });

  await s.step('guardar archivo', async () => {
    const p = sh(s, () => window.__MVC_PREVIEW_SHELL__.saveFile({ baseName: 'prueba', data: 'hola' }));
    const sheet = page.locator('.v-sheet');
    await sheet.waitFor({ timeout: 5000 });
    await sheet.getByRole('button', { name: 'Guardar', exact: true }).click();
    s.expect((await p) === 'saved', 'saveFile devuelve saved');
  });

  // Este flujo prueba el visor (la capa del sistema), no una pantalla de la app: el texto de la pantalla de fondo no se juzga aquí.
  await s.step('sin diálogos colgados', async () => {
    s.expect((await page.evaluate(() => window.__mvcViewer.pendingDialogs())) === 0, 'no queda ningún diálogo abierto');
  });
}
