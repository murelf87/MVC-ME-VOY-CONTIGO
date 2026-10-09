// Los sustitutos web de Expo (mobile/web-stubs/*) ejecutados DE VERDAD, sin la app, contra el shell real (shell/inner.js):
// cada módulo contesta con la forma que la app espera de Expo (permisos { status, granted, canAskAgain }, posiciones, avisos,
// assets de la galería…) y obedece al «móvil simulado» (permisos, GPS, red). La app suele llamarlos a través de
// mobile/src/platform/*; aquí se llama a los módulos tal cual para que un fallo señale al sustituto y no a una pantalla.
//
// El arnés (tools/preview/lib/stubs-harness.mjs) empaqueta los sustitutos con esbuild —leyendo la misma tabla WEB_STUBS que
// metro.config.js— y escribe dist-preview/stubs-harness.html. Sin esbuild el flujo se salta con el motivo.
//
//   node tools/preview/smoke.mjs --flow stubs -v
import { buildStubsHarness } from '../lib/stubs-harness.mjs';

export const meta = { description: 'sustitutos web de Expo (mobile/web-stubs) ejecutados contra el shell real: permisos, GPS, avisos, cámara, galería, red…', timeoutSeconds: 240 };

export default async function stubs(s) {
  let harness = null;
  await s.step('empaquetar el arnés con esbuild', async () => {
    harness = await buildStubsHarness();
    if (harness.skipped) s.skip(harness.skipped);
    s.note(`arnés: ${harness.modules} módulos con sustituto · ${(harness.bytes / 1024).toFixed(0)} KB (dist-preview/stubs-harness.html)`);
  });
  if (!harness || harness.skipped) return;

  const load = async (query = '') => {
    await s.openLocal(harness.file, query);
    await s.page.waitForFunction(() => !!(window.__stubs && window.__react && window.__MVC_PREVIEW_SHELL__), null, { timeout: 15000 });
  };
  const run = (fn, arg) => s.page.evaluate(fn, arg);
  const noBlocked = async (what) => {
    const n = await run(() => window.__MVC_PREVIEW_SHELL__.blocked.length);
    s.expect(n === 0, `${what}: ninguna petición cortada por salir a Internet (${n})`);
  };

  // ───────────────────────────── expo-location ─────────────────────────────
  await s.step('expo-location: permisos, posición, última posición, seguimiento y geocodificación', async () => {
    await load('?perm=ask');
    const r = await run(async () => {
      const L = window.__stubs.Location;
      const out = {};
      out.before = await L.getForegroundPermissionsAsync();
      out.asked = await L.requestForegroundPermissionsAsync();
      out.after = await L.getForegroundPermissionsAsync();
      out.services = await L.hasServicesEnabledAsync();
      out.pos = await L.getCurrentPositionAsync({ accuracy: L.Accuracy.High });
      const last = await L.getLastKnownPositionAsync({ maxAge: 120000 });
      out.lastAgeMs = last ? Date.now() - last.timestamp : null;
      const watched = [];
      const sub = await L.watchPositionAsync({ accuracy: L.Accuracy.High, timeInterval: 2000 }, (p) => watched.push(p.coords.latitude));
      await new Promise((res) => setTimeout(res, 900));
      out.watchedFirst = watched.length;
      sub.remove();
      await new Promise((res) => setTimeout(res, 2300));
      out.watchedAfterRemove = watched.length;
      out.geo = await L.reverseGeocodeAsync({ latitude: out.pos.coords.latitude, longitude: out.pos.coords.longitude });
      out.madrid = await L.reverseGeocodeAsync({ latitude: 40.4168, longitude: -3.7038 });
      out.geocoded = await L.geocodeAsync('Dos Hermanas, Sevilla');
      out.bg = await L.requestBackgroundPermissionsAsync();
      try {
        await L.startLocationUpdatesAsync('seguimiento', {});
        out.bgStart = 'sin error';
      } catch (e) {
        out.bgStart = e.code;
      }
      return out;
    });
    s.expect(r.before.status === 'undetermined' && r.before.granted === false && r.before.canAskAgain === true, `sin pedir aún: undetermined (${JSON.stringify(r.before)})`);
    s.expect(r.asked.status === 'granted' && r.asked.granted === true && r.after.status === 'granted', `al pedirlo queda concedido (${JSON.stringify(r.asked)})`);
    s.expect(r.asked.ios && r.asked.ios.scope === 'whenInUse', 'iOS: ios.scope = whenInUse');
    s.expect(r.services === true, 'servicios de ubicación activos con GPS bueno');
    const c = r.pos.coords;
    s.expect(Math.abs(c.latitude - 37.3886) < 0.002 && Math.abs(c.longitude + 5.9953) < 0.002, `la posición cae en Plaza Nueva, Sevilla (${c.latitude}, ${c.longitude})`);
    s.expect(c.accuracy <= 30 && typeof r.pos.timestamp === 'number' && r.pos.mocked === false, `precisión ≤ 30 m y marca de tiempo (${c.accuracy} m)`);
    s.expect(r.lastAgeMs >= 55000 && r.lastAgeMs <= 70000, `última posición conocida de hace ~60 s (${r.lastAgeMs} ms)`);
    s.expect(r.watchedFirst >= 1 && r.watchedAfterRemove === r.watchedFirst, `watchPositionAsync emite y remove() lo detiene (${r.watchedFirst} → ${r.watchedAfterRemove})`);
    s.expect(r.geo.length === 1 && r.geo[0].city === 'Sevilla' && r.geo[0].isoCountryCode === 'ES', `geocodificación inversa: Sevilla (${JSON.stringify(r.geo[0] && r.geo[0].city)})`);
    s.expect(Array.isArray(r.madrid) && r.madrid.length === 0, 'fuera de la provincia no inventa un municipio');
    s.expect(r.geocoded.length === 1 && Math.abs(r.geocoded[0].latitude - 37.2828) < 0.01, 'geocodificación directa de «Dos Hermanas»');
    s.expect(r.bg.status === 'granted', 'permiso en segundo plano concedido (en modo suelto)');
    s.expect(r.bgStart === 'E_TASKMANAGER_NOT_AVAILABLE', `el seguimiento en segundo plano falla de forma explícita (${r.bgStart})`);
    await noBlocked('expo-location');
  });

  await s.step('expo-location: GPS apagado y GPS débil', async () => {
    await load('?perm=granted&gps=off');
    const off = await run(async () => {
      const L = window.__stubs.Location;
      await L.requestForegroundPermissionsAsync();
      const out = { services: await L.hasServicesEnabledAsync(), provider: await L.getProviderStatusAsync(), last: await L.getLastKnownPositionAsync() };
      try {
        await L.getCurrentPositionAsync({});
        out.current = 'devolvió posición';
      } catch (e) {
        out.current = e.code;
      }
      return out;
    });
    s.expect(off.services === false && off.provider.locationServicesEnabled === false, 'gps=off: servicios desactivados');
    s.expect(off.last === null && off.current === 'E_LOCATION_SERVICES_DISABLED', `gps=off: sin última posición y getCurrentPositionAsync falla con E_LOCATION_SERVICES_DISABLED (${off.current})`);
    await load('?perm=granted&gps=weak');
    const weak = await run(async () => {
      const L = window.__stubs.Location;
      await L.requestForegroundPermissionsAsync();
      const t0 = performance.now();
      const p = await L.getCurrentPositionAsync({ accuracy: L.Accuracy.High });
      return { accuracy: p.coords.accuracy, ms: Math.round(performance.now() - t0) };
    });
    s.expect(weak.accuracy >= 140 && weak.ms >= 1200, `gps=weak: precisión ≥ 140 m y tarda más (${weak.accuracy} m, ${weak.ms} ms)`);
  });

  // ───────────────────────────── permisos denegados / bloqueados ─────────────────────────────
  await s.step('permisos denegados y bloqueados: forma de Expo y errores con código', async () => {
    const probe = () =>
      run(async () => {
        const { Location: L, Notifications: N, ImagePicker: IP, Camera: C } = window.__stubs;
        const out = {};
        out.loc = await L.requestForegroundPermissionsAsync();
        try {
          await L.getCurrentPositionAsync({});
          out.locCall = 'devolvió posición';
        } catch (e) {
          out.locCall = e.code;
        }
        try {
          await L.watchPositionAsync({}, () => {});
          out.locWatch = 'siguió';
        } catch (e) {
          out.locWatch = e.code;
        }
        out.notif = await N.requestPermissionsAsync();
        out.cam = await C.Camera.requestCameraPermissionsAsync();
        out.mic = await C.requestMicrophonePermissionsAsync();
        try {
          await IP.launchCameraAsync({});
          out.launch = 'abrió la cámara';
        } catch (e) {
          out.launch = e.code;
        }
        out.again = await L.getForegroundPermissionsAsync();
        return out;
      });
    await load('?perm=denied');
    const d = await probe();
    s.expect(d.loc.status === 'denied' && d.loc.granted === false && d.loc.canAskAgain === true, `denegado, se puede volver a preguntar (${JSON.stringify(d.loc)})`);
    s.expect(d.locCall === 'E_LOCATION_UNAUTHORIZED' && d.locWatch === 'E_LOCATION_UNAUTHORIZED', `sin permiso, la posición falla con E_LOCATION_UNAUTHORIZED (${d.locCall}, ${d.locWatch})`);
    s.expect(d.notif.status === 'denied' && d.cam.status === 'denied' && d.mic.status === 'denied', 'avisos, cámara y micrófono: denied');
    s.expect(d.launch === 'ERR_MISSING_CAMERA_PERMISSION', `launchCameraAsync sin permiso: ERR_MISSING_CAMERA_PERMISSION (${d.launch})`);
    s.expect(d.again.status === 'denied', 'el estado se recuerda');
    await load('?perm=blocked');
    const b = await probe();
    s.expect(b.loc.status === 'denied' && b.loc.granted === false && b.loc.canAskAgain === false, `bloqueado: denied con canAskAgain = false (${JSON.stringify(b.loc)})`);
    s.expect(b.cam.canAskAgain === false && b.notif.canAskAgain === false, 'cámara y avisos bloqueados: canAskAgain = false');
  });

  // ───────────────────────────── expo-notifications ─────────────────────────────
  await s.step('expo-notifications: permiso, aviso local rotulado «Simulación», escuchas y pulsación', async () => {
    await load('?perm=ask');
    const r = await run(async () => {
      const N = window.__stubs.Notifications;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const toast = () => (document.getElementById('mvc-preview-toast') || {}).textContent || null;
      const out = {};
      out.before = await N.getPermissionsAsync();
      out.asked = await N.requestPermissionsAsync();
      N.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
      const received = [];
      const subReceived = N.addNotificationReceivedListener((n) => received.push(n.request.content.title));
      const taps = [];
      const subTap = N.addNotificationResponseReceivedListener((resp) => taps.push({ id: resp.notification.request.identifier, data: resp.notification.request.content.data, action: resp.actionIdentifier }));
      out.id = await N.scheduleNotificationAsync({ content: { title: 'Tu viaje sale en 30 minutos', body: 'Sevilla Este → Pablo de Olavide', data: { tripId: 't1' } }, trigger: null });
      out.toast = toast();
      out.presented = (await N.getPresentedNotificationsAsync()).map((n) => n.request.identifier);
      window.dispatchEvent(new CustomEvent('mvc:preview-notification-response', { detail: { id: out.id, data: { tripId: 't1' } } }));
      await sleep(30);
      out.taps = taps;
      out.last = await N.getLastNotificationResponseAsync();
      out.lastId = out.last ? out.last.notification.request.identifier : null;
      N.clearLastNotificationResponse();
      out.lastAfterClear = await N.getLastNotificationResponseAsync();
      await N.scheduleNotificationAsync({ content: { title: 'Aviso programado' }, trigger: { seconds: 1 } });
      out.scheduledListed = (await N.getAllScheduledNotificationsAsync()).length;
      await sleep(1400);
      out.toast2 = toast();
      out.scheduledAfter = (await N.getAllScheduledNotificationsAsync()).length;
      const cancelled = await N.scheduleNotificationAsync({ content: { title: 'No debe salir' }, trigger: { seconds: 1 } });
      await N.cancelScheduledNotificationAsync(cancelled);
      await sleep(1300);
      out.toast3 = toast();
      out.received = received;
      try {
        await N.getExpoPushTokenAsync({ projectId: 'x' });
        out.push = 'devolvió un token';
      } catch (e) {
        out.push = e.code;
      }
      out.channel = await N.setNotificationChannelAsync('default', { name: 'Avisos de MVC', importance: N.AndroidImportance.DEFAULT });
      subReceived.remove();
      subTap.remove();
      return out;
    });
    s.expect(r.before.status === 'undetermined' && r.before.canAskAgain === true, `permiso sin pedir: undetermined (${JSON.stringify(r.before.status)})`);
    s.expect(r.asked.status === 'granted' && r.asked.granted === true && r.asked.ios.status === 2, 'permiso concedido (ios.status = AUTHORIZED)');
    s.expect(typeof r.id === 'string' && r.id.startsWith('pv-notif-'), `scheduleNotificationAsync devuelve el identificador (${r.id})`);
    s.expect(/Simulación/.test(r.toast || '') && /Tu viaje sale en 30 minutos/.test(r.toast || ''), `el aviso sale rotulado como simulación (${r.toast})`);
    s.expect(r.presented.includes(r.id), 'queda en getPresentedNotificationsAsync');
    s.expect(r.taps.length === 1 && r.taps[0].id === r.id && r.taps[0].data.tripId === 't1' && r.taps[0].action === 'expo.modules.notifications.actions.DEFAULT', `al pulsar, el listener recibe id, data y acción por defecto (${JSON.stringify(r.taps)})`);
    s.expect(r.lastId === r.id && r.lastAfterClear === null, 'getLastNotificationResponseAsync y clearLastNotificationResponse');
    s.expect(r.scheduledListed === 1 && r.scheduledAfter === 0 && /Aviso programado/.test(r.toast2 || ''), `el aviso con trigger { seconds: 1 } sale al cabo de 1 s (${r.toast2})`);
    s.expect(!/No debe salir/.test(r.toast3 || ''), 'un aviso cancelado no sale');
    s.expect(r.received.length === 2, `addNotificationReceivedListener recibe los dos avisos presentados (${JSON.stringify(r.received)})`);
    s.expect(r.push === 'ERR_NOTIFICATIONS_PUSH_UNAVAILABLE', `el push remoto falla de forma explícita (${r.push})`);
    s.expect(r.channel && r.channel.id === 'default' && r.channel.importance === 3, 'canal de Android recordado');
    await noBlocked('expo-notifications');
    await load('?perm=denied');
    const none = await run(async () => {
      const N = window.__stubs.Notifications;
      const asked = await N.requestPermissionsAsync();
      await N.scheduleNotificationAsync({ content: { title: 'Sin permiso' }, trigger: null });
      return { status: asked.status, toast: document.getElementById('mvc-preview-toast') ? 'sí' : 'no' };
    });
    s.expect(none.status === 'denied' && none.toast === 'no', `sin permiso no se muestra ningún aviso (${JSON.stringify(none)})`);
  });

  // ───────────────────────────── cámara, galería, archivos ─────────────────────────────
  await s.step('expo-image-picker, expo-camera y expo-document-picker', async () => {
    await load('?perm=ask');
    const r = await run(async () => {
      const { ImagePicker: IP, Camera: C, DocumentPicker: DP } = window.__stubs;
      const brief = (res) => ({ canceled: res.canceled, n: res.assets ? res.assets.length : null, a: res.assets ? { uriHead: res.assets[0].uri.slice(0, 23), mimeType: res.assets[0].mimeType, type: res.assets[0].type, width: res.assets[0].width, height: res.assets[0].height, fileName: res.assets[0].fileName, fileSize: res.assets[0].fileSize } : null });
      const out = {};
      out.libPerm = await IP.getMediaLibraryPermissionsAsync();
      out.lib = brief(await IP.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false }));
      out.camPermBefore = await IP.getCameraPermissionsAsync();
      out.cam = brief(await IP.launchCameraAsync({ mediaTypes: ['images'], cameraType: IP.CameraType.front }));
      out.camPermAfter = await IP.getCameraPermissionsAsync();
      out.cameraApi = await C.Camera.getCameraPermissionsAsync();
      out.mic = await C.requestMicrophonePermissionsAsync();
      const doc = await DP.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      out.doc = { canceled: doc.canceled, assets: doc.assets };
      out.cameraType = IP.CameraType.front;
      return out;
    });
    s.expect(r.libPerm.status === 'undetermined' && r.libPerm.accessPrivileges === 'none', 'permiso de fotos sin pedir');
    for (const [name, v] of [['galería', r.lib], ['cámara', r.cam]]) {
      s.expect(v.canceled === false && v.n === 1 && v.a.uriHead === 'data:image/jpeg;base64,' && v.a.mimeType === 'image/jpeg' && v.a.type === 'image', `${name}: un asset de imagen de ejemplo (${JSON.stringify(v.a && v.a.mimeType)})`);
      s.expect(v.a.width === 960 && v.a.height === 1280 && v.a.fileName === 'foto-de-ejemplo.jpg' && v.a.fileSize > 1000, `${name}: ancho, alto, nombre y tamaño (${JSON.stringify(v.a)})`);
    }
    s.expect(r.camPermBefore.status === 'undetermined' && r.camPermAfter.status === 'granted' && r.cameraApi.status === 'granted', 'abrir la cámara pide el permiso y lo recuerda (también en Camera.getCameraPermissionsAsync)');
    s.expect(r.mic.status === 'granted', 'micrófono concedido');
    s.expect(r.doc.canceled === true && r.doc.assets === null, 'en modo suelto no hay selector de archivos: cancelado, sin assets');
    s.expect(r.cameraType === 'front', 'CameraType.front');
    await noBlocked('cámara y galería');
  });

  // ───────────────────────────── componentes y hooks de React ─────────────────────────────
  await s.step('CameraView, StatusBar y useForegroundPermissions se montan y obedecen', async () => {
    await load('?perm=ask');
    const r = await run(async () => {
      const { React, flushSync, createRoot } = window.__react;
      const { Camera: C, Location: L, StatusBarModule: SB } = window.__stubs;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const out = {};
      const mount = (element) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        flushSync(() => root.render(element));
        return { host, root, done: () => { root.unmount(); host.remove(); } };
      };
      // CameraView simulada
      const ref = React.createRef();
      let ready = 0;
      const cam = mount(React.createElement(C.CameraView, { ref, style: { width: 300, height: 400 }, facing: 'front', onCameraReady: () => { ready++; } }));
      await sleep(60);
      out.cameraText = cam.host.textContent;
      out.cameraTestId = !!cam.host.querySelector('[data-testid="CameraView.simulated"]');
      out.cameraReady = ready;
      const photo = await ref.current.takePictureAsync({ quality: 0.8 });
      out.photo = { uriHead: photo.uri.slice(0, 23), width: photo.width, height: photo.height, format: photo.format };
      try {
        await ref.current.recordAsync();
        out.video = 'grabó';
      } catch (e) {
        out.video = e.code;
      }
      cam.done();
      // StatusBar
      const shell = window.__MVC_PREVIEW_SHELL__;
      const bar = mount(React.createElement(SB.StatusBar, { style: 'light' }));
      await sleep(20);
      out.sbLight = shell.statusBar();
      SB.setStatusBarStyle('dark');
      out.sbDark = shell.statusBar();
      SB.setStatusBarHidden(true);
      out.sbHidden = shell.statusBar();
      bar.done();
      out.sbAfter = shell.statusBar();
      // Hook de permisos
      let api = null;
      function Probe() {
        const [p, request] = L.useForegroundPermissions();
        api = { request };
        return React.createElement('span', null, p ? p.status : 'null');
      }
      const probe = mount(React.createElement(Probe));
      await sleep(20);
      out.hookBefore = probe.host.textContent;
      await api.request();
      await sleep(40);
      out.hookAfter = probe.host.textContent;
      probe.done();
      return out;
    });
    s.expect(/Cámara simulada/.test(r.cameraText) && r.cameraTestId && r.cameraReady === 1, `CameraView se declara simulada y avisa de que está lista (${r.cameraText})`);
    s.expect(r.photo.uriHead === 'data:image/jpeg;base64,' && r.photo.width === 960 && r.photo.height === 1280 && r.photo.format === 'jpg', `takePictureAsync devuelve la foto de ejemplo (${JSON.stringify(r.photo)})`);
    s.expect(r.video === 'ERR_CAMERA_VIDEO_UNAVAILABLE', `recordAsync falla de forma explícita (${r.video})`);
    s.expect(r.sbLight.style === 'light' && r.sbLight.hidden === false && r.sbDark.style === 'dark' && r.sbHidden.hidden === true && r.sbAfter.style === 'auto' && r.sbAfter.hidden === false, `StatusBar manda al shell estilo y visibilidad (${JSON.stringify([r.sbLight, r.sbDark, r.sbHidden, r.sbAfter])})`);
    s.expect(r.hookBefore === 'undetermined' && r.hookAfter === 'granted', `useForegroundPermissions se actualiza al pedir el permiso (${r.hookBefore} → ${r.hookAfter})`);
  });

  // ───────────────────────────── almacenamiento, portapapeles, enlaces, compartir ─────────────────────────────
  await s.step('expo-secure-store, expo-clipboard, expo-linking, expo-web-browser y expo-sharing', async () => {
    await load('?perm=ask');
    const r = await run(async () => {
      const { SecureStore: SS, Clipboard: CB, Linking: LK, WebBrowser: WB, Sharing: SH } = window.__stubs;
      const out = {};
      out.available = await SS.isAvailableAsync();
      out.empty = await SS.getItemAsync('sesion');
      await SS.setItemAsync('sesion', 'token-de-ejemplo', { keychainAccessible: SS.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
      out.stored = await SS.getItemAsync('sesion');
      out.rawKey = localStorage.getItem('mvc.secure.sesion');
      await SS.deleteItemAsync('sesion');
      out.deleted = await SS.getItemAsync('sesion');
      out.copied = await CB.setStringAsync('https://mvc.example/v/abc');
      out.pasted = await CB.getStringAsync();
      out.hasUrl = await CB.hasUrlAsync();
      out.url = LK.createURL('trips/42', { queryParams: { from: 'sevilla-este' } });
      out.parsed = LK.parse(out.url);
      out.canHttps = await LK.canOpenURL('https://www.sevilla.org');
      out.canOther = await LK.canOpenURL('foo:bar');
      out.initial = await LK.getInitialURL();
      const sub = LK.addEventListener('url', () => {});
      out.subRemove = typeof sub.remove === 'function';
      sub.remove();
      out.open = await LK.openURL('https://www.sevilla.org/ayuda');
      out.browser = await WB.openBrowserAsync('https://www.sevilla.org/ayuda');
      out.shareAvailable = await SH.isAvailableAsync();
      await SH.shareAsync('file:///tmp/billete.pdf', { dialogTitle: 'Compartir billete' });
      out.sharedResolved = true;
      return out;
    });
    s.expect(r.available === true && r.empty === null && r.stored === 'token-de-ejemplo' && r.rawKey === 'token-de-ejemplo' && r.deleted === null, `SecureStore: leer, escribir y borrar (${JSON.stringify([r.empty, r.stored, r.deleted])})`);
    s.expect(r.copied === true && r.pasted === 'https://mvc.example/v/abc' && r.hasUrl === true, `Clipboard: copiar y pegar (${r.pasted})`);
    s.expect(r.url === 'mvc://trips/42?from=sevilla-este' && r.parsed.scheme === 'mvc' && r.parsed.path === 'trips/42' && r.parsed.queryParams.from === 'sevilla-este', `Linking.createURL / parse (${r.url})`);
    s.expect(r.canHttps === true && r.canOther === false && r.initial === null && r.subRemove === true, 'Linking: canOpenURL, getInitialURL = null, addEventListener devuelve { remove }');
    s.expect(r.open === true && r.browser.type === 'cancel', `openURL resuelve y openBrowserAsync respeta que la persona no confirme (${JSON.stringify(r.browser)})`);
    s.expect(r.shareAvailable === true && r.sharedResolved === true, 'Sharing: shareAsync resuelve al cerrar la hoja');
    await noBlocked('almacenamiento, enlaces y compartir');
  });

  // ───────────────────────────── red ─────────────────────────────
  await s.step('@react-native-community/netinfo: con Wi-Fi, con datos móviles y sin Internet', async () => {
    const snap = () =>
      run(async () => {
        const { NetInfo, } = window.__stubs;
        const { React, flushSync, createRoot } = window.__react;
        const out = {};
        out.fetched = await NetInfo.fetch();
        const first = await new Promise((res) => {
          const off = NetInfo.addEventListener((st) => {
            off();
            res(st);
          });
        });
        out.listener = first.type;
        function Probe() {
          const st = NetInfo.useNetInfo();
          return React.createElement('span', null, st.type + ':' + st.isConnected);
        }
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        flushSync(() => root.render(React.createElement(Probe)));
        out.hook = host.textContent;
        root.unmount();
        out.onLine = navigator.onLine;
        return out;
      });
    await load('?network=wifi');
    const w = await snap();
    s.expect(w.fetched.type === 'wifi' && w.fetched.isConnected === true && w.fetched.isInternetReachable === true && w.listener === 'wifi' && w.hook === 'wifi:true' && w.onLine === true, `Wi-Fi (${JSON.stringify(w)})`);
    await load('?network=cellular');
    const c = await snap();
    s.expect(c.fetched.type === 'cellular' && c.fetched.details.isConnectionExpensive === true && c.listener === 'cellular' && c.hook === 'cellular:true', `datos móviles (${JSON.stringify(c.fetched.type)})`);
    await load('?network=none');
    const n = await snap();
    s.expect(n.fetched.type === 'none' && n.fetched.isConnected === false && n.fetched.isInternetReachable === false && n.listener === 'none' && n.hook === 'none:false' && n.onLine === false, `sin Internet (${JSON.stringify(n)})`);
  });

  // ───────────────────────────── el resto ─────────────────────────────
  await s.step('expo-localization, expo-keep-awake, expo-system-ui y expo-haptics', async () => {
    await load('?perm=ask');
    const r = await run(async () => {
      const { Localization: LO, KeepAwake: KA, SystemUI: SU, Haptics: HP } = window.__stubs;
      const out = {};
      out.locale = LO.getLocales()[0];
      out.calendar = LO.getCalendars()[0];
      const states = [];
      const sub = KA.addListener('seguimiento', (e) => states.push(e.state));
      await KA.activateKeepAwakeAsync('seguimiento');
      await KA.deactivateKeepAwake('seguimiento');
      await KA.deactivateKeepAwake('seguimiento');
      sub.remove();
      out.released = states;
      await SU.setBackgroundColorAsync('#FF0000');
      out.bg = await SU.getBackgroundColorAsync();
      out.docBg = document.documentElement.style.backgroundColor;
      await SU.setBackgroundColorAsync(null);
      out.bgAfter = await SU.getBackgroundColorAsync();
      out.haptics = [await HP.impactAsync(HP.ImpactFeedbackStyle.Light), await HP.notificationAsync(HP.NotificationFeedbackType.Success), await HP.selectionAsync()].map((v) => (v === undefined ? 'undefined' : 'valor'));
      out.hapticStyles = [HP.ImpactFeedbackStyle.Light, HP.NotificationFeedbackType.Success];
      return out;
    });
    s.expect(r.locale.languageTag === 'es-ES' && r.locale.regionCode === 'ES' && r.locale.currencyCode === 'EUR' && r.locale.decimalSeparator === ',' && r.calendar.timeZone === 'Europe/Madrid' && r.calendar.uses24hourClock === true, `es-ES, euro y Europe/Madrid (${r.locale.languageTag}, ${r.calendar.timeZone})`);
    s.expect(r.released.length === 1 && r.released[0] === 'release', `KeepAwake avisa una sola vez al liberar (${JSON.stringify(r.released)})`);
    s.expect(r.bg === '#FF0000' && /255, 0, 0|rgb\(255, 0, 0\)/i.test(r.docBg) && r.bgAfter === null, `SystemUI cambia el fondo del documento (${r.docBg})`);
    s.expect(r.haptics.every((v) => v === 'undefined') && r.hapticStyles[0] === 'light' && r.hapticStyles[1] === 'success', 'Haptics no hace nada y conserva las constantes');
  });
}
