/* ═══════════════ MVC · Me voy contigo — visor (núcleo) ═══════════════
   Este fichero, viewer-system.js, viewer-panel.js y viewer-main.js se concatenan DENTRO de una sola función (build-artifact.mjs):
   comparten ámbito. El visor es el documento exterior; la app real vive en un <iframe srcdoc> y solo hablan por postMessage
   (protocolo {mvc:1, t:'rpc'|'rpc-result'|'event'|'call'|'call-result'|'hello', …}; ver tools/preview/shell/API.md). */
var W = window;
var D = document;
var VERSION = 1;

/* ───────────── Datos incrustados en la compilación ───────────── */
var DATA = (function () {
  try { return JSON.parse(D.getElementById('mvc-data').textContent); } catch (e) { return { designs: [], scenarios: {}, thumbs: {}, build: {}, assets: {} }; }
})();
var ASSETS = DATA.assets || {};
var Q = (function () { try { return new URLSearchParams(W.location.search); } catch (e) { return new URLSearchParams(''); } })();

/* ───────────── Utilidades ───────────── */
function h(tag, props) {
  var el = D.createElement(tag);
  if (props) {
    for (var k in props) {
      if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
      var v = props[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
  return el;
}
function append(el, c) {
  if (c === null || c === undefined || c === false) return;
  if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
  el.appendChild(typeof c === 'object' ? c : D.createTextNode(String(c)));
}
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
/** Solo para constantes propias (iconos SVG del visor); nunca con texto de la app ni de la persona. */
function svgEl(markup) {
  var t = D.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}
function $(sel, root) { return (root || D).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || D).querySelectorAll(sel)); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function clone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; } }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function uid(prefix) { return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
function errMsg(e) { return e && e.message ? e.message : String(e); }

var bus = (function () {
  var map = {};
  return {
    on: function (n, fn) { (map[n] = map[n] || []).push(fn); return function () { map[n] = (map[n] || []).filter(function (f) { return f !== fn; }); }; },
    emit: function (n, d) { (map[n] || []).slice().forEach(function (f) { try { f(d); } catch (e) { if (W.console) console.error(e); } }); }
  };
})();

/* ───────────── Almacenamiento del visor (prefijo «mvcv.»; la app guarda lo suyo en el mismo origen) ───────────── */
var LS = (function () {
  try { var s = W.localStorage; s.setItem('mvcv.__probe', '1'); s.removeItem('mvcv.__probe'); return s; } catch (e) { return null; }
})();
var memStore = {};
var store = {
  get: function (k, d) {
    try { var v = LS ? LS.getItem('mvcv.' + k) : memStore[k]; return v === null || v === undefined ? d : JSON.parse(v); } catch (e) { return d; }
  },
  set: function (k, v) {
    try { var s = JSON.stringify(v); if (LS) LS.setItem('mvcv.' + k, s); else memStore[k] = s; } catch (e) { /* sin almacenamiento */ }
  },
  remove: function (k) { try { if (LS) LS.removeItem('mvcv.' + k); else delete memStore[k]; } catch (e) { /* sin almacenamiento */ } }
};
/** Borra lo que guarda la app (todo menos «mvcv.*») para empezar con datos limpios. */
function wipeAppStorage() {
  try {
    if (LS) {
      var drop = [];
      for (var i = 0; i < LS.length; i++) { var k = LS.key(i); if (k && k.indexOf('mvcv.') !== 0) drop.push(k); }
      drop.forEach(function (k) { LS.removeItem(k); });
    }
  } catch (e) { /* sin almacenamiento */ }
  try { W.sessionStorage.clear(); } catch (e) { /* sin sessionStorage */ }
  try {
    if (W.indexedDB && W.indexedDB.databases) {
      W.indexedDB.databases().then(function (dbs) { dbs.forEach(function (db) { if (db.name) W.indexedDB.deleteDatabase(db.name); }); }, function () {});
    }
  } catch (e) { /* sin IndexedDB */ }
}

/* ───────────── Hora de Madrid ───────────── */
var MADRID = 'Europe/Madrid';
function madridParts(ms) {
  var f = new Intl.DateTimeFormat('en-GB', { timeZone: MADRID, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  var o = {};
  f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}
function madridOffsetMin(ms) {
  var p = madridParts(ms);
  var asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}
/** «2026-10-05T07:17» (hora de Madrid) → ISO con zona «2026-10-05T07:17:00+02:00». */
function madridLocalToIso(local) {
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || '');
  if (!m) return null;
  var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0);
  var off = madridOffsetMin(guess);
  off = madridOffsetMin(guess - off * 60000);
  var sign = off >= 0 ? '+' : '-';
  var a = Math.abs(off);
  return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':00' + sign + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
}
function isoToMadridLocal(iso) {
  var t = Date.parse(iso);
  if (isNaN(t)) return '';
  var p = madridParts(t);
  return p.y + '-' + pad2(p.mo) + '-' + pad2(p.d) + 'T' + pad2(p.h) + ':' + pad2(p.mi);
}
function madridHHmm(ms) { var p = madridParts(ms); return pad2(p.h) + ':' + pad2(p.mi); }
function fmtDateTime(ms) {
  try { return new Intl.DateTimeFormat('es-ES', { timeZone: MADRID, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)); } catch (e) { return new Date(ms).toISOString(); }
}

/* ───────────── Dispositivos y lugares simulados ───────────── */
var DEVICES = {
  iphone15: { id: 'iphone15', label: 'iPhone 15', platform: 'ios', kind: 'island', width: 393, height: 852, safeTop: 59, safeBottom: 34, cornerRadius: 55, bz: 12, bzt: 12, bzb: 12 },
  promax: { id: 'promax', label: 'iPhone 15 Pro Max', platform: 'ios', kind: 'island', width: 430, height: 932, safeTop: 59, safeBottom: 34, cornerRadius: 55, bz: 12, bzt: 12, bzb: 12 },
  se: { id: 'se', label: 'iPhone SE', platform: 'ios', kind: 'classic', width: 375, height: 667, safeTop: 20, safeBottom: 0, cornerRadius: 4, bz: 18, bzt: 78, bzb: 86 },
  pixel8: { id: 'pixel8', label: 'Pixel 8 (Android)', platform: 'android', kind: 'hole', width: 412, height: 915, safeTop: 32, safeBottom: 24, cornerRadius: 36, bz: 10, bzt: 10, bzb: 10 },
  small: { id: 'small', label: 'Móvil pequeño 320 px', platform: 'ios', kind: 'classic', width: 320, height: 568, safeTop: 20, safeBottom: 0, cornerRadius: 4, bz: 18, bzt: 78, bzb: 86 }
};
var DEVICE_ORDER = ['iphone15', 'promax', 'se', 'pixel8', 'small'];
var PLACES = [
  { id: 'plazanueva', label: 'Plaza Nueva (Sevilla)', latitude: 37.3886, longitude: -5.9953 },
  { id: 'santajusta', label: 'Estación de Santa Justa (Sevilla)', latitude: 37.3922, longitude: -5.9756 },
  { id: 'olavide', label: 'Universidad Pablo de Olavide', latitude: 37.3553, longitude: -5.9366 },
  { id: 'aeropuerto', label: 'Aeropuerto de Sevilla', latitude: 37.418, longitude: -5.8931 },
  { id: 'doshermanas', label: 'Dos Hermanas', latitude: 37.2829, longitude: -5.9209 },
  { id: 'alcala', label: 'Alcalá de Guadaíra', latitude: 37.338, longitude: -5.842 },
  { id: 'aljarafe', label: 'Mairena del Aljarafe', latitude: 37.345, longitude: -6.064 },
  { id: 'carmona', label: 'Carmona', latitude: 37.471, longitude: -5.643 },
  { id: 'utrera', label: 'Utrera', latitude: 37.184, longitude: -5.78 },
  { id: 'ecija', label: 'Écija', latitude: 37.542, longitude: -5.082 },
  { id: 'osuna', label: 'Osuna', latitude: 37.238, longitude: -5.101 }
];
function placeById(id) { for (var i = 0; i < PLACES.length; i++) if (PLACES[i].id === id) return PLACES[i]; return PLACES[0]; }

var PERM_KINDS = ['location', 'locationAlways', 'notifications', 'camera', 'microphone', 'photos', 'contacts', 'bluetooth'];
var PERM_LABEL = {
  location: 'Ubicación (al usar la app)', locationAlways: 'Ubicación (siempre)', notifications: 'Notificaciones', camera: 'Cámara',
  microphone: 'Micrófono', photos: 'Fotos', contacts: 'Contactos', bluetooth: 'Bluetooth'
};
var PERM_STATUS_LABEL = { undetermined: 'Sin preguntar', granted: 'Concedido', denied: 'Denegado', blocked: 'Bloqueado' };
var PROFILES = [
  { id: 'new', name: 'Persona nueva', desc: 'Sin sesión: la app empieza en Bienvenida.' },
  { id: 'passenger', name: 'Pasajero · Miguel Torres', desc: 'Con sesión iniciada, viajes y reservas de ejemplo.' },
  { id: 'driver', name: 'Conductor · Ana García López', desc: 'Con sesión, vehículo (Seat Arona) y viajes publicados.' },
  { id: 'admin', name: 'Administración', desc: 'Personal: panel de administración visible en Ajustes.' }
];
function profileName(id) { for (var i = 0; i < PROFILES.length; i++) if (PROFILES[i].id === id) return PROFILES[i].name; return id; }

/* ───────────── Estado ───────────── */
function qv(name) { var v = Q.get(name); return v === null || v === '' ? null : v; }
function oneOf(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }

var state = {
  chrome: qv('chrome') !== '0',
  device: oneOf(qv('device') || store.get('device', 'iphone15'), DEVICE_ORDER, 'iphone15'),
  profile: oneOf(qv('profile') || store.get('profile', 'new'), ['new', 'passenger', 'driver', 'admin'], 'new'),
  seed: qv('seed') || store.get('seed', null),
  clock: qv('clock') || store.get('clock', null),
  auto: qv('auto') === '1',
  autoperm: qv('autoperm') === '1' || qv('auto') === '1',
  theme: oneOf(qv('theme') || store.get('theme', 'auto'), ['auto', 'light', 'dark'], 'auto'),
  panelOpen: qv('panel') === '0' ? false : store.get('panelOpen', true),
  drawerOpen: false,
  sections: store.get('sections', { here: true, profile: false, goto: false, sim: false, notes: false, how: false }),
  sim: {
    network: oneOf(qv('network') || store.get('sim.network', 'wifi'), ['wifi', 'cellular', 'none'], 'wifi'),
    gps: oneOf(qv('gps') || store.get('sim.gps', 'good'), ['good', 'weak', 'off'], 'good'),
    place: placeById(qv('place') || store.get('sim.place', 'plazanueva')),
    clock: null,
    statusTime: qv('status') || store.get('sim.statusTime', null) || '09:41',
    screenReader: qv('screenreader') === '1'
  },
  perms: {},
  permOnce: {},
  denies: {},
  sms: [],
  notes: store.get('notes', []),
  screen: { route: null, params: null },
  bridge: { present: null, routes: [], error: null },
  sb: { light: false, homeLight: false, hidden: false },
  blocked: [],
  errors: [],
  ready: false,
  booting: true,
  bootError: null,
  bleed: false,
  viewW: W.innerWidth,
  viewH: W.innerHeight,
  bootCount: 0
};
state.sim.clock = state.clock;
if (qv('section') && Object.prototype.hasOwnProperty.call(state.sections, qv('section'))) {
  Object.keys(state.sections).forEach(function (k) { state.sections[k] = k === qv('section'); });
}
(function initPerms() {
  var stored = store.get('perms', {});
  var urlMode = qv('perm');
  PERM_KINDS.forEach(function (k) {
    var v = stored[k];
    if (urlMode === 'granted' || urlMode === 'denied' || urlMode === 'blocked') v = urlMode;
    else if (urlMode === 'ask') v = 'undetermined';
    state.perms[k] = v === 'granted' || v === 'denied' || v === 'blocked' ? v : 'undetermined';
  });
})();
function persistPerms() { store.set('perms', state.perms); }
if (state.theme !== 'auto') D.documentElement.setAttribute('data-theme', state.theme);

function device() { return DEVICES[state.device] || DEVICES.iphone15; }
function osOf() { return device().platform; }
function envInsets() {
  var probe = h('div', { style: 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)' });
  D.body.appendChild(probe);
  var cs = W.getComputedStyle(probe);
  var out = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
  probe.remove();
  return out;
}
/** El `PreviewDevice` que ve la app (ver mobile/src/platform/previewBridge.ts). */
function deviceForApp() {
  var d = device();
  var out = {
    id: d.id, label: d.label, platform: d.platform, width: d.width, height: d.height,
    safeTop: d.safeTop, safeBottom: d.safeBottom, safeLeft: 0, safeRight: 0, cornerRadius: d.cornerRadius, chrome: state.chrome && !state.bleed
  };
  if (!state.chrome) { out.width = state.viewW; out.height = state.viewH; }
  if (state.bleed) {
    var env = envInsets();
    out.width = state.viewW; out.height = state.viewH;
    out.safeTop = env.top; out.safeBottom = env.bottom; out.safeLeft = env.left; out.safeRight = env.right; out.cornerRadius = 0;
    var ua = (W.navigator && navigator.userAgent) || '';
    out.platform = /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : d.platform;
  }
  return out;
}
function statusTimeText() {
  if (state.sim.statusTime && /^\d{1,2}:\d{2}$/.test(state.sim.statusTime) && !state.statusFollowsClock) return state.sim.statusTime;
  return state.sim.statusTime || '09:41';
}
/** El `PreviewSim` que ve la app. */
function simForApp() {
  return { network: state.sim.network, gps: state.sim.gps, place: clone(state.sim.place), clock: state.clock, statusTime: statusTimeText(), screenReader: !!state.sim.screenReader };
}
/** Hora «de hoy» según el reloj simulado (ms). */
function nowMs() {
  if (!state.clock) return Date.now();
  var t = Date.parse(state.clock);
  return isNaN(t) ? Date.now() : t + (Date.now() - (state.clockSetAt || Date.now()));
}

/* ───────────── Carga de la app (iframe srcdoc) ───────────── */
var host = { frame: null, nextCall: 1, calls: {}, innerHtml: null, loading: null, mounted: 0 };

function decodePayload() {
  if (host.innerHtml) return Promise.resolve(host.innerHtml);
  if (host.loading) return host.loading;
  host.loading = new Promise(function (resolve, reject) {
    var el = D.getElementById('mvc-payload');
    var b64 = el ? (el.textContent || '').replace(/\s+/g, '') : '';
    if (!b64) { reject(new Error('El visor no lleva la app dentro (carga vacía): vuelve a generar la vista previa.')); return; }
    if (typeof W.DecompressionStream === 'undefined') { reject(new Error('Este navegador no puede descomprimir la app (necesita Chrome 80+, Safari 16.4+ o Firefox 113+).')); return; }
    var bin = W.atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var stream = new Blob([bytes]).stream().pipeThrough(new W.DecompressionStream('gzip'));
    new Response(stream).text().then(function (t) { host.innerHtml = t; resolve(t); }, reject);
  });
  return host.loading;
}

/** Lo que lee inner.js ANTES que el bundle (window.__MVC_PREVIEW_BOOT__). */
function bootObject() {
  return {
    profile: state.profile,
    seed: state.seed || undefined,
    clock: state.clock || null,
    device: deviceForApp(),
    sim: simForApp(),
    permissions: clone(state.perms),
    chrome: state.chrome && !state.bleed,
    auto: !!state.autoperm,
    freezeClock: false
  };
}
function bootScript() {
  var json = JSON.stringify(bootObject()).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return '<script>window.__MVC_PREVIEW_BOOT__=' + json + ';window.MVC_PREVIEW_PROFILE=' + JSON.stringify(state.profile) + ';<\/script>';
}

/** (Re)monta la app en el iframe. `opts.profile` cambia de perfil; `opts.wipe` borra los datos de la app. */
function mountApp(opts) {
  opts = opts || {};
  if (opts.profile) state.profile = opts.profile;
  if (opts.wipe) wipeAppStorage();
  /* «Solo esta vez» caduca al reiniciar la app, como en el móvil */
  PERM_KINDS.forEach(function (k) { if (state.permOnce[k] && state.perms[k] === 'granted') { state.perms[k] = 'undetermined'; delete state.permOnce[k]; } });
  persistPerms();
  state.ready = false;
  state.booting = true;
  state.bootError = null;
  state.errors = [];
  state.blocked = [];
  state.screen = { route: null, params: null };
  state.bridge = { present: null, routes: [], error: null };
  state.bootCount++;
  var token = state.bootCount;
  bus.emit('boot', state);
  updateBootOverlay();
  var screen = $('.v-screen');
  return decodePayload().then(function (html) {
    if (token !== state.bootCount) return;
    var inner = html.replace('<!--MVC_BOOT-->', function () { return bootScript(); });
    var f = h('iframe', { class: 'v-app', id: 'v-app', title: 'MVC · Me voy contigo (la app)' });
    if (host.frame && host.frame.parentNode) host.frame.parentNode.removeChild(host.frame);
    host.frame = f;
    host.mounted = Date.now();
    screen.insertBefore(f, screen.firstChild);
    f.srcdoc = inner;
    armBootTimeout(token);
  }, function (e) {
    state.booting = false;
    state.bootError = errMsg(e);
    updateBootOverlay();
  });
}
function armBootTimeout(token) {
  setTimeout(function () {
    if (token !== state.bootCount || state.ready) return;
    state.bootError = state.errors.length ? state.errors.join('\n') : 'La app no ha terminado de arrancar en 30 s.';
    state.booting = false;
    updateBootOverlay();
  }, 30000);
}
function updateBootOverlay() {
  var el = $('.v-boot');
  if (!el) return;
  var visible = state.booting || !!state.bootError;
  el.setAttribute('data-hide', visible ? '0' : '1');
  clear(el);
  if (!visible) return;
  if (ASSETS.wordLogo) el.appendChild(h('img', { src: ASSETS.wordLogo, alt: 'MVC · Me voy contigo' }));
  if (state.bootError) {
    el.appendChild(h('div', { class: 'v-boot-msg', text: 'La app no ha podido arrancar.' }));
    el.appendChild(h('div', { class: 'v-boot-err', text: state.bootError }));
    el.appendChild(h('button', { class: 'v-btn primary', type: 'button', text: 'Reintentar', onclick: function () { mountApp(); } }));
  } else {
    el.appendChild(h('div', { class: 'v-spin', role: 'progressbar', 'aria-label': 'Cargando' }));
    el.appendChild(h('div', { class: 'v-boot-msg', text: 'Preparando la app…' }));
  }
}

/* ───────────── Mensajería con la app ───────────── */
function postToApp(msg) {
  if (!host.frame || !host.frame.contentWindow) return false;
  msg.mvc = 1;
  try { host.frame.contentWindow.postMessage(msg, '*'); return true; } catch (e) { return false; }
}
function sendEvent(name, detail) { return postToApp({ t: 'event', n: name, d: detail }); }
/** Llama a un método de `window.__mvc` dentro de la app. */
function callApp(method, args, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var id = host.nextCall++;
    var ms = timeoutMs || 20000;
    var timer = setTimeout(function () { delete host.calls[id]; reject(new Error('La app no ha respondido a __mvc.' + method + '() en ' + Math.round(ms / 1000) + ' s')); }, ms);
    host.calls[id] = { resolve: function (v) { clearTimeout(timer); resolve(v); }, reject: function (e) { clearTimeout(timer); reject(e); } };
    if (!postToApp({ t: 'call', id: id, m: method, a: args || [] })) { clearTimeout(timer); delete host.calls[id]; reject(new Error('La app todavía no está cargada')); }
  });
}

var RPC = {}; /* métodos que la app pide al visor (los rellena viewer-system.js) */
function replyRpc(id, ok, payload) {
  var msg = { t: 'rpc-result', id: id, ok: ok };
  if (ok) msg.v = payload; else msg.e = payload;
  postToApp(msg);
}
function handleRpc(d) {
  var fn = RPC[d.m];
  if (typeof fn !== 'function') { replyRpc(d.id, false, 'El visor no implementa «' + d.m + '»'); return; }
  Promise.resolve().then(function () { return fn.apply(null, d.a || []); }).then(
    function (v) { replyRpc(d.id, true, v === undefined ? null : v); },
    function (e) { replyRpc(d.id, false, errMsg(e)); }
  );
}

function onAppEvent(name, d) {
  d = d || {};
  if (name === 'screen') {
    state.screen = { route: d.route, params: d.params === undefined ? null : d.params };
    bus.emit('screen', state.screen);
  } else if (name === 'ready') {
    state.ready = true;
    state.booting = false;
    state.bootError = null;
    updateBootOverlay();
    refreshBridge().then(function () { bus.emit('ready', state); });
  } else if (name === 'statusbar') {
    state.sb = { light: !!d.light, homeLight: !!d.homeLight, hidden: !!d.hidden };
    applyStatusBarStyle();
  } else if (name === 'blocked') {
    if (state.blocked.length < 50) state.blocked.push(d);
    bus.emit('blocked', state.blocked);
  } else if (name === 'error') {
    if (state.errors.length < 12) state.errors.push(String(d.message || 'error'));
    if (state.booting && !state.ready) { /* se mostrará si la app no llega a arrancar */ }
    bus.emit('error', state.errors);
  }
}

W.addEventListener('message', function (ev) {
  if (!host.frame || ev.source !== host.frame.contentWindow) return;
  var d = ev.data;
  if (!d || d.mvc !== 1) return;
  if (d.t === 'rpc') handleRpc(d);
  else if (d.t === 'event') onAppEvent(d.n, d.d);
  else if (d.t === 'call-result') {
    var c = host.calls[d.id];
    if (!c) return;
    delete host.calls[d.id];
    if (d.ok) c.resolve(d.v); else c.reject(new Error(d.e || 'Error en la app'));
  }
});

/** Lee el puente de pruebas de la app (`window.__mvc`). Si no existe, el panel lo dice con claridad. */
function refreshBridge() {
  return callApp('routes', [], 8000).then(function (routes) {
    state.bridge = { present: true, routes: Array.isArray(routes) ? routes : [], error: null };
    bus.emit('bridge', state.bridge);
  }, function (e) {
    state.bridge = { present: false, routes: [], error: errMsg(e) };
    bus.emit('bridge', state.bridge);
  });
}

/* ───────────── Simulación: se la cuenta a la app ───────────── */
function pushSim() { sendEvent('sim', simForApp()); updateStatusBar(); }
function setSim(patch) {
  Object.keys(patch || {}).forEach(function (k) { state.sim[k] = patch[k]; });
  if (patch && patch.network !== undefined) store.set('sim.network', state.sim.network);
  if (patch && patch.gps !== undefined) store.set('sim.gps', state.sim.gps);
  if (patch && patch.place !== undefined) store.set('sim.place', state.sim.place.id);
  if (patch && patch.statusTime !== undefined) store.set('sim.statusTime', state.sim.statusTime);
  pushSim();
  bus.emit('sim', state.sim);
}
function setClock(iso) {
  state.clock = iso || null;
  state.sim.clock = state.clock;
  state.clockSetAt = Date.now();
  store.set('clock', state.clock);
  sendEvent('clock', { iso: state.clock, freeze: false });
  if (state.clock) { state.sim.statusTime = madridHHmm(Date.parse(state.clock)); state.statusFollowsClock = true; }
  else { state.sim.statusTime = '09:41'; state.statusFollowsClock = false; }
  pushSim();
  bus.emit('sim', state.sim);
}
function setDevice(id) {
  if (!DEVICES[id]) return;
  state.device = id;
  store.set('device', id);
  layout();
  sendEvent('device', deviceForApp());
  updateStatusBar();
  bus.emit('device', device());
}
function setProfile(id, opts) {
  opts = opts || {};
  if (['new', 'passenger', 'driver', 'admin'].indexOf(id) < 0) return Promise.reject(new Error('Perfil desconocido: ' + id));
  state.profile = id;
  store.set('profile', id);
  bus.emit('profile', id);
  return mountApp({ profile: id, wipe: opts.wipe !== false });
}

/* ───────────── Maquetación del móvil ───────────── */
var els = {};
function buildChrome() {
  var stage = $('#v-stage');
  els.sb = h('div', { class: 'v-sb', 'aria-hidden': 'true' },
    h('div', { class: 'sb-left' }),
    h('div', { class: 'sb-time' }),
    h('div', { class: 'sb-right' })
  );
  els.island = h('div', { class: 'v-island', 'aria-hidden': 'true' });
  els.hole = h('div', { class: 'v-hole', 'aria-hidden': 'true' });
  els.home = h('div', { class: 'v-home', 'aria-hidden': 'true' });
  els.boot = h('div', { class: 'v-boot', role: 'status', 'aria-live': 'polite' });
  els.sys = h('div', { class: 'v-sys', 'aria-live': 'polite' });
  els.screen = h('div', { class: 'v-screen' }, els.boot, els.sb, els.island, els.hole, els.home, els.sys);
  els.phone = h('div', { class: 'v-phone' }, h('div', { class: 'v-forehead' }), els.screen, h('div', { class: 'v-chin' }));
  els.box = h('div', { class: 'v-phone-box' }, els.phone);
  stage.appendChild(els.box);
}

function layout() {
  var root = $('#v-root');
  state.viewW = W.innerWidth;
  state.viewH = W.innerHeight;
  var wasBleed = state.bleed;
  state.bleed = state.chrome && state.viewW < 760;
  root.setAttribute('data-chrome', state.chrome ? '1' : '0');
  root.setAttribute('data-bleed', state.bleed ? '1' : '0');
  root.setAttribute('data-panel', (state.bleed ? state.drawerOpen : state.panelOpen) ? 'open' : 'closed');
  var d = device();
  var full = !state.chrome || state.bleed;
  var w = full ? state.viewW : d.width;
  var hh = full ? state.viewH : d.height;
  var bz = full ? 0 : d.bz, bzt = full ? 0 : d.bzt, bzb = full ? 0 : d.bzb;
  var outerW = w + bz * 2;
  var outerH = hh + bzt + bzb;
  var panelW = state.chrome && !state.bleed && state.panelOpen ? 340 : 0;
  var availW = state.viewW - panelW - (full ? 0 : 32);
  var availH = state.viewH - (full ? 0 : 32);
  var scale = full ? 1 : Math.min(1, availW / outerW, availH / outerH);
  if (!(scale > 0)) scale = 0.3;
  els.phone.setAttribute('data-kind', full ? 'full' : d.kind);
  els.phone.setAttribute('data-os', d.platform);
  var st = els.phone.style;
  st.setProperty('--w', w + 'px');
  st.setProperty('--h', hh + 'px');
  st.setProperty('--r', (full ? 0 : d.cornerRadius) + 'px');
  st.setProperty('--bz', bz + 'px');
  st.setProperty('--bzt', bzt + 'px');
  st.setProperty('--bzb', bzb + 'px');
  st.transform = 'scale(' + scale + ')';
  els.box.style.width = Math.round(outerW * scale) + 'px';
  els.box.style.height = Math.round(outerH * scale) + 'px';
  els.sys.style.setProperty('--st', (full ? deviceForApp().safeTop : d.safeTop) + 'px');
  els.sys.style.setProperty('--sbm', (full ? deviceForApp().safeBottom : d.safeBottom) + 'px');
  els.sys.setAttribute('data-os', d.platform);
  state.scale = scale;
  if (wasBleed !== state.bleed && host.frame) sendEvent('device', deviceForApp());
  else if (!state.chrome && host.frame) sendEvent('device', deviceForApp());
  bus.emit('layout', { scale: scale, bleed: state.bleed });
}

/* ───────────── Barra de estado dibujada por el visor ───────────── */
var SB_ICONS = {
  signal: '<svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>',
  wifi: '<svg width="17" height="12" viewBox="0 0 17 12" aria-hidden="true"><path d="M8.5 2.3c2.3 0 4.4.9 6 2.4l1-1.1A10.4 10.4 0 0 0 8.5.8C5.7.8 3.2 1.9 1.4 3.6l1 1.1a8.8 8.8 0 0 1 6.1-2.4z"/><path d="M8.5 5.6c1.4 0 2.6.5 3.6 1.4l1-1.1A7.2 7.2 0 0 0 8.5 4C6.8 4 5.2 4.6 3.9 5.9l1 1.1c.9-.9 2.2-1.4 3.6-1.4z"/><path d="M8.5 8.8c.6 0 1.2.2 1.6.6L8.5 11l-1.6-1.6c.4-.4 1-.6 1.6-.6z"/></svg>',
  plane: '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>',
  battery: '<svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true"><rect x="0.5" y="0.5" width="22" height="12" rx="3.8" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="19" height="9" rx="2.6"/><path d="M24 4.5v4c.8-.3 1.5-1.1 1.5-2s-.7-1.7-1.5-2z" opacity=".5"/></svg>'
};
function updateStatusBar() {
  if (!els.sb) return;
  var t = $('.sb-time', els.sb), r = $('.sb-right', els.sb), l = $('.sb-left', els.sb);
  t.textContent = statusTimeText();
  clear(r);
  clear(l);
  var net = state.sim.network;
  var cls = els.phone.getAttribute('data-kind');
  if (net === 'none') {
    r.appendChild(svgEl(SB_ICONS.plane));
    if (cls === 'classic') l.appendChild(h('span', { class: 'sb-note', text: 'Sin servicio' }));
  } else {
    r.appendChild(svgEl(SB_ICONS.signal));
    if (net === 'wifi') r.appendChild(svgEl(SB_ICONS.wifi));
    else r.appendChild(h('span', { class: 'sb-note', text: '5G' }));
    if (cls === 'classic') l.appendChild(h('span', { class: 'sb-note', text: 'Movistar' }));
  }
  r.appendChild(svgEl(SB_ICONS.battery));
  applyStatusBarStyle();
}
function applyStatusBarStyle() {
  if (!els.sb) return;
  els.sb.setAttribute('data-light', state.sb.light ? '1' : '0');
  els.sb.setAttribute('data-hidden', state.sb.hidden ? '1' : '0');
  els.home.setAttribute('data-light', state.sb.homeLight ? '1' : '0');
}
setInterval(function () {
  if (state.statusFollowsClock && state.clock) { var t = madridHHmm(nowMs()); if (t !== state.sim.statusTime) { state.sim.statusTime = t; updateStatusBar(); } }
}, 15000);

/* ───────────── Aviso del visor (fuera del móvil) ───────────── */
var toastTimer = null;
function vtoast(text, ms) {
  var old = $('.v-toast');
  if (old) old.remove();
  var el = h('div', { class: 'v-toast', role: 'status', text: text });
  D.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.remove(); }, ms || 3200);
}
function copyText(text) {
  return new Promise(function (resolve, reject) {
    var done = function () { resolve(true); };
    var fallback = function () {
      try {
        var ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0;opacity:0', 'aria-hidden': 'true' });
        ta.value = text;
        D.body.appendChild(ta);
        ta.select();
        var ok = D.execCommand && D.execCommand('copy');
        ta.remove();
        ok ? done() : reject(new Error('El navegador no permite copiar'));
      } catch (e) { reject(e); }
    };
    try {
      if (W.navigator && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    } catch (e) { fallback(); }
  });
}
