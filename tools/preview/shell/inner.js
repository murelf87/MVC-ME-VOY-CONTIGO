/*
 * MVC · Me voy contigo — «inner»: se ejecuta DENTRO del documento de la app, ANTES que su bundle (solo en la vista previa web;
 * no forma parte de la app de producción). Convierte el navegador en un «móvil de pruebas» honesto:
 *
 *  - Publica globalThis.__MVC_PREVIEW_SHELL__ con el contrato de mobile/src/platform/previewBridge.ts (versión 1) y las
 *    extensiones que usan los sustitutos de mobile/web-stubs (ver tools/preview/shell/API.md).
 *  - Habla con el visor (documento padre) solo por postMessage. Sin visor (HTML suelto o servidor de desarrollo) funciona en
 *    «modo suelto»: los permisos se resuelven según ?perm= y las fotos/pagos usan resultados de muestra etiquetados.
 *  - Nube apagada: fetch/XHR/WebSocket/beacon a cualquier origen que no sea data:/blob: se cortan y quedan anotados en
 *    shell.blocked (el visor además impone una CSP sin hosts externos).
 *  - Historial en memoria (la URL del iframe es about:srcdoc), almacenamiento con reserva en memoria, reloj simulado, «solo claro»,
 *    márgenes seguros del dispositivo para react-native-safe-area-context, enlaces/ventanas externas → confirmación del visor.
 */
(function () {
  'use strict';
  var W = window;
  var D = document;
  if (W.__MVC_INNER__) return;
  W.__MVC_INNER__ = true;

  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var noop = function () {};
  var log = function (msg) { try { if (W.console && console.info) console.info('[MVC · vista previa] ' + msg); } catch (e) { /* sin consola */ } };

  /* ───────────── Arranque: lo que decide el visor (o la URL en modo suelto) ───────────── */
  var DEVICES = {
    iphone15: { id: 'iphone15', label: 'iPhone 15', platform: 'ios', width: 393, height: 852, safeTop: 59, safeBottom: 34, cornerRadius: 55, chrome: true },
    promax: { id: 'promax', label: 'iPhone 15 Pro Max', platform: 'ios', width: 430, height: 932, safeTop: 59, safeBottom: 34, cornerRadius: 55, chrome: true },
    se: { id: 'se', label: 'iPhone SE', platform: 'ios', width: 375, height: 667, safeTop: 20, safeBottom: 0, cornerRadius: 4, chrome: true },
    pixel8: { id: 'pixel8', label: 'Pixel 8 (Android)', platform: 'android', width: 412, height: 915, safeTop: 32, safeBottom: 24, cornerRadius: 36, chrome: true },
    small: { id: 'small', label: 'Móvil pequeño 320 px', platform: 'ios', width: 320, height: 568, safeTop: 20, safeBottom: 0, cornerRadius: 4, chrome: true }
  };
  var PLACES = {
    plazanueva: { id: 'plazanueva', label: 'Plaza Nueva (Sevilla)', latitude: 37.3886, longitude: -5.9953 }
  };
  function bootFromUrl() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { q = { get: function () { return null; } }; }
    var g = function (k, d) { var v = q.get(k); return v === null || v === '' ? d : v; };
    var dev = DEVICES[g('device', 'iphone15')] || DEVICES.iphone15;
    return {
      standalone: true,
      profile: g('profile', 'passenger'),
      seed: g('seed', null),
      clock: g('clock', null),
      perm: g('perm', 'granted'),
      auto: g('auto', '1') !== '0',
      device: Object.assign({ safeLeft: 0, safeRight: 0 }, dev),
      sim: { network: 'wifi', gps: 'good', place: PLACES.plazanueva, clock: g('clock', null), statusTime: '09:41', screenReader: false },
      permissions: {},
      chrome: false
    };
  }
  var boot = W.__MVC_PREVIEW_BOOT__ || bootFromUrl();
  var inFrame = false;
  try { inFrame = !!W.parent && W.parent !== W && !boot.standalone; } catch (e) { inFrame = true; }

  /* ───────────── Mensajería con el visor ───────────── */
  var seq = 0;
  var pending = {};
  var calls = {}; /* llamadas del visor a la app (open, goBack…) */
  function post(msg) {
    if (!inFrame) return;
    msg.mvc = 1;
    try { W.parent.postMessage(msg, '*'); } catch (e) { /* visor ausente */ }
  }
  function emit(name, detail) { post({ t: 'event', n: name, d: detail }); }
  function rpc(method, args, fallback) {
    if (!inFrame) {
      try { return Promise.resolve(fallback ? fallback.apply(null, args || []) : undefined); } catch (e) { return Promise.reject(e); }
    }
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      post({ t: 'rpc', id: id, m: method, a: args || [] });
    });
  }

  /* ───────────── Almacenamiento: si el navegador lo bloquea, memoria durante la sesión ───────────── */
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try {
      var s = W[name];
      var probe = '__mvc_probe__';
      s.setItem(probe, '1');
      s.removeItem(probe);
      return;
    } catch (e) { /* bloqueado → memoria */ }
    var data = {};
    var mem = {
      get length() { return Object.keys(data).length; },
      key: function (i) { var ks = Object.keys(data); return i >= 0 && i < ks.length ? ks[i] : null; },
      getItem: function (k) { k = String(k); return has(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[String(k)]; },
      clear: function () { data = {}; }
    };
    try { Object.defineProperty(W, name, { configurable: true, enumerable: true, get: function () { return mem; } }); } catch (e) { /* no se puede sustituir */ }
  });

  /* ───────────── Historial en memoria: la URL de un iframe srcdoc es about:srcdoc ───────────── */
  (function virtualHistory() {
    var H = W.history;
    if (!H) return;
    var entries = [{ state: null }];
    var index = 0;
    try { entries[0].state = H.state; } catch (e) { /* sin estado inicial */ }
    var copy = function (v) {
      try { return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
    };
    try {
      Object.defineProperty(H, 'state', { configurable: true, get: function () { return entries[index].state; } });
      Object.defineProperty(H, 'length', { configurable: true, get: function () { return entries.length; } });
    } catch (e) { return; }
    H.pushState = function (state) {
      entries = entries.slice(0, index + 1);
      entries.push({ state: copy(state) });
      index = entries.length - 1;
    };
    H.replaceState = function (state) { entries[index] = { state: copy(state) }; };
    H.go = function (delta) {
      var n = Math.trunc(Number(delta) || 0);
      if (n === 0) return;
      var target = index + n;
      if (target < 0 || target >= entries.length) return;
      index = target;
      setTimeout(function () {
        var ev;
        try { ev = new PopStateEvent('popstate', { state: entries[index].state }); } catch (e) { ev = new Event('popstate'); }
        W.dispatchEvent(ev);
      }, 0);
    };
    H.back = function () { H.go(-1); };
    H.forward = function () { H.go(1); };
  })();

  /* ───────────── «Solo claro»: la app no tiene modo oscuro; el visor sí sigue al sistema ───────────── */
  (function lightOnly() {
    try {
      var m = D.createElement('meta');
      m.name = 'color-scheme';
      m.content = 'light only';
      (D.head || D.documentElement).appendChild(m);
      D.documentElement.style.colorScheme = 'light';
    } catch (e) { /* sin meta */ }
    try {
      var real = W.matchMedia && W.matchMedia.bind(W);
      if (real) {
        W.matchMedia = function (q) {
          var mql = real(q);
          if (!/prefers-color-scheme\s*:\s*dark/i.test(String(q))) return mql;
          return {
            matches: false, media: mql.media, onchange: null,
            addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: function () { return false; }
          };
        };
      }
    } catch (e) { /* sin matchMedia */ }
  })();

  /* ───────────── Título fijo ───────────── */
  (function lockTitle() {
    try {
      var desc = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
      if (!desc || !desc.get || !desc.set) return;
      desc.set.call(D, 'MVC · Me voy contigo');
      Object.defineProperty(D, 'title', { configurable: true, get: function () { return desc.get.call(D); }, set: noop });
    } catch (e) { /* título por defecto */ }
  })();

  /* ───────────── Reloj simulado ───────────── */
  var RealDate = W.Date;
  var clock = { offset: 0, frozen: null, iso: null };
  (function installClock() {
    function now() { return clock.frozen !== null ? clock.frozen : RealDate.now() + clock.offset; }
    function FakeDate(a, b, c, d, e, f, g) {
      if (!(this instanceof FakeDate)) return new RealDate(now()).toString();
      switch (arguments.length) {
        case 0: return new RealDate(now());
        case 1: return new RealDate(a);
        case 2: return new RealDate(a, b);
        case 3: return new RealDate(a, b, c);
        case 4: return new RealDate(a, b, c, d);
        case 5: return new RealDate(a, b, c, d, e);
        case 6: return new RealDate(a, b, c, d, e, f);
        default: return new RealDate(a, b, c, d, e, f, g);
      }
    }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = now;
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;
    try { Object.defineProperty(RealDate.prototype, 'constructor', { value: FakeDate, writable: true, configurable: true }); } catch (e) { /* sin constructor */ }
    W.Date = FakeDate;
  })();
  /** iso = fecha ISO con zona (p. ej. 2026-10-05T07:17:00+02:00) o null para volver a la hora real. */
  function setClock(iso, opts) {
    if (iso === null || iso === undefined || iso === '') {
      clock.offset = 0;
      clock.frozen = null;
      clock.iso = null;
      return;
    }
    var t = RealDate.parse(String(iso));
    if (isNaN(t)) { log('setClock: fecha inválida ' + iso); return; }
    clock.iso = String(iso);
    if (opts && opts.freeze) { clock.frozen = t; return; }
    clock.frozen = null;
    clock.offset = t - RealDate.now();
  }
  if (boot.clock) setClock(boot.clock, { freeze: !!boot.freezeClock });

  /* ───────────── Estado: dispositivo, simulación y permisos ───────────── */
  var device = Object.assign({ safeLeft: 0, safeRight: 0 }, boot.device || DEVICES.iphone15);
  var sim = Object.assign({ network: 'wifi', gps: 'good', place: PLACES.plazanueva, clock: null, statusTime: '09:41', screenReader: false }, boot.sim || {});
  var permissions = Object.assign({}, boot.permissions || {});
  var permMode = boot.perm || 'ask';

  var shell = (W.__MVC_PREVIEW_SHELL__ = W.__MVC_PREVIEW_SHELL__ || {});
  boot.permissions = permissions;
  boot.device = device;
  boot.sim = sim;
  boot.clock = boot.clock || null;
  boot.chrome = boot.chrome !== false && !!inFrame;
  var blocked = [];
  var offlineListeners = [];

  function fire(name, detail) {
    try { W.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) { /* sin evento */ }
  }
  function connType() { return sim.network === 'none' ? 'none' : sim.network === 'cellular' ? 'cellular' : 'wifi'; }

  /* navigator.connection / onLine reflejan «Sin Internet»: NetInfo y la app lo leen. */
  var conn = (function () { try { return new EventTarget(); } catch (e) { return D.createDocumentFragment(); } })();
  try {
    Object.defineProperty(conn, 'type', { get: connType });
    Object.defineProperty(conn, 'effectiveType', { get: function () { return '4g'; } });
    Object.defineProperty(conn, 'downlink', { get: function () { return sim.network === 'none' ? 0 : sim.network === 'cellular' ? 8 : 40; } });
    Object.defineProperty(conn, 'rtt', { get: function () { return sim.network === 'cellular' ? 90 : 30; } });
    Object.defineProperty(conn, 'saveData', { get: function () { return false; } });
    Object.defineProperty(navigator, 'connection', { configurable: true, get: function () { return conn; } });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: function () { return sim.network !== 'none'; } });
  } catch (e) { /* el navegador no deja sustituirlos */ }

  function applySim(next) {
    var prev = sim;
    sim = Object.assign({}, sim, next || {}); // shell.sim es un getter que lee esta variable
    if (prev.network !== sim.network) {
      try { conn.dispatchEvent(new Event('change')); } catch (e) { /* sin evento */ }
      try { W.dispatchEvent(new Event(sim.network === 'none' ? 'offline' : 'online')); } catch (e) { /* sin evento */ }
      offlineListeners.slice().forEach(function (l) { try { l(sim.network === 'none'); } catch (e) { /* oyente defectuoso */ } });
    }
    fire('mvc:preview-sim', sim);
  }

  /* ───────────── Contrato de mobile/src/platform/previewBridge.ts (versión 1) ───────────── */
  function permissionStatus(kind) {
    var v = permissions[kind];
    return v === 'granted' || v === 'denied' || v === 'blocked' ? v : 'undetermined';
  }
  function setPermissionCache(kind, status) {
    if (permissions[kind] === status) return;
    permissions[kind] = status;
    fire('mvc:preview-permission', { kind: kind, status: status });
  }
  var pendingPerm = {};
  function requestPermission(kind) {
    var cur = permissionStatus(kind);
    if (pendingPerm[kind]) return pendingPerm[kind];
    var p;
    if (inFrame) {
      p = rpc('requestPermission', [kind]);
    } else {
      /* Modo suelto: sin diálogos. ?perm=granted|denied|blocked decide; «ask» se trata como concedido. */
      if (cur === 'granted' || cur === 'blocked') p = Promise.resolve(cur);
      else p = Promise.resolve(permMode === 'denied' ? 'denied' : permMode === 'blocked' ? 'blocked' : 'granted');
    }
    pendingPerm[kind] = p.then(function (status) {
      delete pendingPerm[kind];
      setPermissionCache(kind, status);
      return status;
    }, function (e) {
      delete pendingPerm[kind];
      throw e;
    });
    return pendingPerm[kind];
  }

  /* Fotos de muestra generadas aquí mismo (modo suelto): siempre etiquetadas, nunca parecen una foto real. */
  function sampleImage(label, portrait) {
    var c = D.createElement('canvas');
    c.width = 960;
    c.height = 1280;
    var g = c.getContext('2d');
    var grad = g.createLinearGradient(0, 0, 0, 1280);
    grad.addColorStop(0, '#9DBBE8');
    grad.addColorStop(0.58, '#DCE6F7');
    grad.addColorStop(0.59, '#A9B4A0');
    grad.addColorStop(1, '#7D8A70');
    g.fillStyle = grad;
    g.fillRect(0, 0, 960, 1280);
    if (portrait) {
      g.fillStyle = 'rgba(40,52,84,0.55)';
      g.beginPath(); g.arc(480, 500, 160, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(480, 1020, 300, 260, 0, Math.PI, 0); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.82)';
    g.fillRect(0, 1080, 960, 200);
    g.fillStyle = '#0B2357';
    g.textAlign = 'center';
    g.font = '700 60px system-ui, sans-serif';
    g.fillText('FOTO DE EJEMPLO', 480, 1160);
    g.font = '500 32px system-ui, sans-serif';
    g.fillText(label || 'Vista previa de MVC · no es una foto real', 480, 1220);
    var uri = c.toDataURL('image/jpeg', 0.82);
    return { uri: uri, name: 'foto-de-ejemplo.jpg', mimeType: 'image/jpeg', size: Math.round((uri.length - 23) * 0.75), width: 960, height: 1280, example: true };
  }
  function sampleFallback(opts) { return sampleImage(opts && opts.label, opts && opts.facing === 'user'); }

  /* Modo suelto: un aviso flotante etiquetado como simulación (SMS, notificaciones) */
  function standaloneToast(text, ms) {
    try {
      var old = D.getElementById('mvc-preview-toast');
      if (old) old.remove();
      var box = D.createElement('div');
      box.id = 'mvc-preview-toast';
      box.setAttribute('role', 'status');
      box.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:92vw;background:#0B2357;color:#fff;font:600 14px/1.35 system-ui,sans-serif;padding:10px 14px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.35);text-align:center';
      box.textContent = text;
      (D.body || D.documentElement).appendChild(box);
      setTimeout(function () { box.remove(); }, ms || 30000);
    } catch (e) { /* sin DOM utilizable */ }
  }

  shell.version = 1;
  shell.boot = boot;
  shell.permissionStatus = permissionStatus;
  shell.requestPermission = requestPermission;
  shell.setPermission = function (kind, status) {
    setPermissionCache(kind, status);
    rpc('setPermission', [kind, status]).catch(noop);
  };
  shell.openSettings = function () { return rpc('openSettings', [], noop).then(noop); };
  shell.cameraCapture = function (opts) { return rpc('cameraCapture', [opts || {}], sampleFallback); };
  shell.pickImages = function (opts) { return rpc('pickImages', [opts || {}], function () { return [sampleImage()]; }); };
  shell.pickDocument = function (opts) { return rpc('pickDocuments', [opts || {}], function () { return []; }); };
  shell.share = function (req) { return rpc('share', [req || {}], function () { return 'dismissed'; }); };
  shell.openExternal = function (url) {
    return rpc('openExternal', [String(url)], function (u) { log('openExternal ' + u); return false; }).then(function (ok) { return !!ok; });
  };
  shell.payWithWallet = function (req) {
    return rpc('payWithWallet', [req || {}], function () { return { status: 'authorized', reference: 'SIM-' + Math.random().toString(36).slice(2, 8).toUpperCase() }; });
  };
  shell.biometricPrompt = function (opts) { return rpc('biometricPrompt', [opts || {}], function () { return 'success'; }); };
  shell.alert = function (opts) {
    return rpc('alert', [opts || {}], function (o) {
      var b = (o && o.buttons) || [];
      for (var i = 0; i < b.length; i++) if (b[i].style !== 'cancel') return b[i].id;
      return b.length ? b[0].id : 'ok';
    });
  };
  shell.saveFile = function (opts) {
    return rpc('saveFile', [opts || {}], function (o) {
      try {
        var a = D.createElement('a');
        var blob = o && o.data instanceof Blob ? o.data : new Blob([String((o && o.data) || '')], { type: 'text/plain' });
        a.href = URL.createObjectURL(blob);
        a.download = ((o && o.baseName) || 'mvc') + '.txt';
        D.body.appendChild(a);
        a.click();
        a.remove();
        return 'saved';
      } catch (e) { return 'failed'; }
    });
  };
  shell.deliverSms = function (sms) {
    sms = sms || {};
    rpc('deliverSms', [sms], function (m) {
      standaloneToast('Simulación · SMS' + (m.to ? ' a ' + m.to : '') + ': ' + (m.code ? 'tu código de MVC es ' + m.code : m.body || ''), 60000);
    }).catch(noop);
  };
  shell.notify = function (n) {
    n = n || {};
    rpc('notify', [n], function (m) { standaloneToast('Simulación · ' + (m.title || '') + (m.body ? ' — ' + m.body : ''), 8000); }).catch(noop);
  };
  shell.setClock = function (iso) { setClock(iso); };
  shell.reportScreen = reportScreen;
  shell.blocked = blocked;
  shell.isOffline = function () { return sim.network === 'none'; };
  Object.defineProperty(shell, 'device', { configurable: true, enumerable: true, get: function () { return device; } });
  Object.defineProperty(shell, 'sim', { configurable: true, enumerable: true, get: function () { return sim; } });
  shell.profile = boot.profile;

  /* Extensiones (no están en el contrato tipado; las usan mobile/web-stubs y las pruebas; ver API.md) */
  shell.platform = device.platform;
  shell.permissions = permissions;
  shell.pickDocuments = shell.pickDocument;
  shell.copyToClipboard = function (text) {
    return rpc('copyToClipboard', [String(text)], function (t) {
      return navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t).catch(noop) : undefined;
    }).then(noop);
  };
  shell.setStatusBar = function (s) {
    s = s || {};
    sb.style = s.style === 'light' || s.style === 'dark' || s.style === 'inverted' ? s.style : 'auto';
    sb.hidden = !!s.hidden;
    refreshStatusBar();
  };
  shell.statusBar = function () { return { style: sb.style, hidden: sb.hidden }; };

  /* ───────────── Nube apagada: nada sale del navegador ───────────── */
  /* Servidor de desarrollo (compare.mjs --dev, smoke.mjs --dev): su origen se permite (bundle, recursos, HMR por WebSocket). */
  var DEV_ORIGIN = (function () { try { return typeof W.__MVC_DEV_ORIGIN__ === 'string' ? W.__MVC_DEV_ORIGIN__.replace(/\/$/, '') : null; } catch (e) { return null; } })();
  function isDev(u) {
    if (!DEV_ORIGIN) return false;
    var s = String(u).replace(/^ws(s?):/i, 'http$1:');
    return s === DEV_ORIGIN || s.indexOf(DEV_ORIGIN + '/') === 0 || s.indexOf(DEV_ORIGIN + '?') === 0;
  }
  function isRemote(u) { return !/^(data|blob|about|javascript):/i.test(String(u)) && !isDev(u); }
  function noteBlocked(kind, u) {
    if (blocked.length < 50) blocked.push({ kind: kind, url: String(u).slice(0, 300) });
    emit('blocked', { kind: kind, url: String(u).slice(0, 300) });
    log(kind + ' bloqueada (nube apagada): ' + String(u).slice(0, 160));
  }
  (function guardNetwork() {
    var realFetch = W.fetch;
    if (typeof realFetch === 'function') {
      W.fetch = function (input, init) {
        var raw = typeof input === 'string' ? input : input && input.href ? input.href : input && input.url ? input.url : String(input);
        var url = null;
        try { url = new URL(raw, 'https://preview.invalid/'); } catch (e) { /* relativa u opaca */ }
        if (/^(data|blob):/i.test(String(raw))) return realFetch.apply(this, arguments);
        if (url && !isRemote(url.href)) return realFetch.apply(this, arguments);
        var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        noteBlocked('petición ' + method, raw);
        return Promise.reject(new TypeError('Failed to fetch'));
      };
    }
    try {
      var XO = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
      if (XO) {
        var realOpen = XO.open;
        XO.open = function (method, url) {
          if (isRemote(url)) {
            noteBlocked('XHR ' + method, url);
            throw new DOMException('Petición bloqueada: la vista previa no sale del navegador', 'NetworkError');
          }
          return realOpen.apply(this, arguments);
        };
      }
    } catch (e) { /* sin XHR */ }
    try {
      if (W.WebSocket) {
        var RealWS = W.WebSocket;
        var GuardedWS = function (u, protocols) {
          if (isDev(u)) return protocols === undefined ? new RealWS(u) : new RealWS(u, protocols);
          noteBlocked('WebSocket', u);
          throw new DOMException('WebSocket bloqueado en la vista previa', 'SecurityError');
        };
        GuardedWS.prototype = RealWS.prototype;
        GuardedWS.CONNECTING = RealWS.CONNECTING; GuardedWS.OPEN = RealWS.OPEN; GuardedWS.CLOSING = RealWS.CLOSING; GuardedWS.CLOSED = RealWS.CLOSED;
        W.WebSocket = GuardedWS;
      }
      if (W.EventSource) W.EventSource = function (u) { noteBlocked('EventSource', u); throw new DOMException('EventSource bloqueado en la vista previa', 'SecurityError'); };
      if (navigator.sendBeacon) navigator.sendBeacon = function (u) { noteBlocked('beacon', u); return false; };
    } catch (e) { /* sin esas APIs */ }
  })();

  /* ───────────── Enlaces y ventanas externas: el móvil mostraría «abrir con…», aquí lo pregunta el visor ───────────── */
  W.open = function (url) {
    if (url) shell.openExternal(url);
    return null;
  };
  D.addEventListener('click', function (ev) {
    var t = ev.target;
    var a = t && t.closest ? t.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href)) return;
    ev.preventDefault();
    ev.stopPropagation();
    shell.openExternal(a.href || href);
  }, true);

  /* ───────────── Márgenes seguros del dispositivo para react-native-safe-area-context (web) ─────────────
     La implementación web mide un elemento oculto con padding: env(safe-area-inset-*) vía getComputedStyle. En un navegador de
     escritorio env() vale 0: aquí devuelve los márgenes del móvil simulado. Con el móvil real a pantalla completa (realInsets) no se toca. */
  /* Diagnóstico: cuántas veces ha leído la librería los márgenes y el último valor de «top» (lo usa el flujo «system»). */
  var safeStats = { reads: 0, lastTop: null };
  shell.safeAreas = safeStats;
  (function safeAreas() {
    if (device.realInsets) return;
    var realGCS = W.getComputedStyle;
    var SIDES = { paddingTop: 'safeTop', paddingBottom: 'safeBottom', paddingLeft: 'safeLeft', paddingRight: 'safeRight' };
    W.getComputedStyle = function (el, pseudo) {
      var cs = realGCS.call(W, el, pseudo);
      try {
        var st = el && el.style;
        if (st && /(env|constant)\(\s*safe-area-inset-/.test(String(st.paddingTop) + String(st.paddingBottom) + String(st.paddingLeft) + String(st.paddingRight))) {
          return new Proxy(cs, {
            get: function (target, key) {
              if (typeof key === 'string' && has(SIDES, key)) {
                var px = device[SIDES[key]] || 0;
                if (key === 'paddingTop') { safeStats.reads++; safeStats.lastTop = px; }
                return px + 'px';
              }
              var v = target[key];
              return typeof v === 'function' ? v.bind(target) : v;
            }
          });
        }
      } catch (e) { /* valores reales */ }
      return cs;
    };
  })();
  /** Hace que react-native-safe-area-context vuelva a medir (cambio de dispositivo).
      La librería escucha el nombre de evento que detecta el navegador (en Chromium «webkitTransitionEnd», no «transitionend»),
      y los eventos DOM distinguen mayúsculas: se envían todos los nombres que ella puede haber elegido. */
  var TRANSITION_END_NAMES = ['transitionend', 'webkitTransitionEnd', 'transitionEnd', 'msTransitionEnd', 'oTransitionEnd'];
  function remeasureSafeAreas() {
    try {
      var kids = D.body ? D.body.children : [];
      for (var i = 0; i < kids.length; i++) {
        var n = kids[i];
        if (!(n.style && n.style.position === 'fixed' && /(env|constant)\(/.test(n.style.paddingTop || ''))) continue;
        for (var k = 0; k < TRANSITION_END_NAMES.length; k++) n.dispatchEvent(new Event(TRANSITION_END_NAMES[k]));
      }
    } catch (e) { /* sin elementos de medida */ }
  }

  /* ───────────── Barra de estado: ¿oscuro lo que hay detrás? ───────────── */
  var sb = { style: 'auto', hidden: false };
  function parseColor(str) {
    var m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)/.exec(str || '');
    if (!m) return null;
    var a = m[4] == null ? 1 : parseFloat(m[4]) / (m[5] ? 100 : 1);
    return [+m[1], +m[2], +m[3], a];
  }
  function layerColor(el) {
    var cs = getComputedStyle(el);
    var c = parseColor(cs.backgroundColor);
    if (c && c[3] > 0.02) return c;
    var img = cs.backgroundImage;
    if (img && img !== 'none' && img.indexOf('gradient') >= 0) {
      var stops = (img.match(/rgba?\([^)]*\)/g) || []).map(parseColor).filter(Boolean);
      if (stops.length) {
        var sum = [0, 0, 0, 0];
        stops.forEach(function (s) { sum[0] += s[0]; sum[1] += s[1]; sum[2] += s[2]; sum[3] += s[3]; });
        return sum.map(function (v) { return v / stops.length; });
      }
    }
    return null;
  }
  function luminance(c) {
    var lin = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  }
  function backdropIsDark(y) {
    if (!D.elementsFromPoint) return false;
    var w = D.documentElement.clientWidth || device.width;
    var votes = 0;
    var total = 0;
    [0.16, 0.84].forEach(function (fx) {
      var els = D.elementsFromPoint(w * fx, y);
      var layers = [];
      for (var i = 0; i < els.length; i++) {
        var c = layerColor(els[i]);
        if (!c) continue;
        layers.push(c);
        if (c[3] >= 0.98) break;
      }
      var col = [255, 255, 255];
      for (var j = layers.length - 1; j >= 0; j--) {
        var a = Math.min(1, layers[j][3]);
        col = [0, 1, 2].map(function (k) { return layers[j][k] * a + col[k] * (1 - a); });
      }
      total++;
      if (luminance(col) < 0.18) votes++;
    });
    return total > 0 && votes * 2 >= total;
  }
  var lastSb = '';
  function refreshStatusBar() {
    if (D.hidden) return;
    var top = backdropIsDark(Math.max(4, Math.min(device.safeTop || 20, 60) * 0.5));
    var light;
    if (sb.style === 'light') light = true;
    else if (sb.style === 'dark') light = false;
    else if (sb.style === 'inverted') light = !top;
    else light = top;
    var bottom = backdropIsDark(Math.max(4, (D.documentElement.clientHeight || device.height) - Math.max(4, (device.safeBottom || 8) * 0.5)));
    var key = [light, bottom, sb.hidden].join('|');
    if (key === lastSb) return;
    lastSb = key;
    emit('statusbar', { light: light, homeLight: bottom, hidden: sb.hidden, style: sb.style });
  }

  /* ───────────── Pantalla actual (para «Estás en») y arranque de la app ───────────── */
  var lastRoute = '';
  function readBridge() {
    var m = W.__mvc;
    if (!m) return null;
    var pick = function (v) { try { return typeof v === 'function' ? v() : v; } catch (e) { return undefined; } };
    return { route: pick(m.route), params: pick(m.params) };
  }
  function reportScreen(route, params) {
    var key = String(route) + '|' + JSON.stringify(params || null);
    if (key === lastRoute) return;
    lastRoute = key;
    emit('screen', { route: route, params: params === undefined ? null : params });
  }
  var readyReported = false;
  var startedAt = Date.now();
  function tick() {
    var b = readBridge();
    if (b && b.route) reportScreen(b.route, b.params);
    if (!readyReported) {
      var m = W.__mvc;
      var ok = false;
      try { ok = !!(m && (typeof m.ready === 'function' ? m.ready() : m.ready)); } catch (e) { ok = false; }
      var root = D.getElementById('root');
      var painted = !!(root && root.childElementCount > 0 && root.getBoundingClientRect().height > 0);
      /* Sin puente __mvc (la app aún no lo instala): se da por arrancada cuando ya pinta algo. */
      if (ok || (!m && painted && Date.now() - startedAt > 2500)) {
        readyReported = true;
        emit('ready', { bridge: !!m, bootMs: Date.now() - startedAt });
      }
    }
    refreshStatusBar();
  }
  setInterval(tick, 300);

  /* ───────────── Errores que impiden arrancar (el visor los muestra si la app no llega a pintar) ───────────── */
  var errors = [];
  function reportError(message, source) {
    if (errors.length < 8) errors.push(String(message).slice(0, 400));
    emit('error', { message: String(message).slice(0, 400), source: source || '', count: errors.length });
  }
  W.addEventListener('error', function (e) { reportError(e && e.message ? e.message : 'error', e && e.filename); });
  W.addEventListener('unhandledrejection', function (e) { reportError(e && e.reason && e.reason.message ? e.reason.message : String(e && e.reason), 'promesa'); });
  shell.errors = errors;

  /* ───────────── Mensajes del visor ───────────── */
  W.addEventListener('message', function (ev) {
    if (!inFrame || ev.source !== W.parent) return;
    var d = ev.data;
    if (!d || d.mvc !== 1) return;
    if (d.t === 'rpc-result') {
      var p = pending[d.id];
      if (!p) return;
      delete pending[d.id];
      if (d.ok) p.resolve(d.v);
      else p.reject(new Error(d.e || 'Error del visor'));
    } else if (d.t === 'event') {
      var data = d.d || {};
      if (d.n === 'sim') applySim(data);
      else if (d.n === 'permission') setPermissionCache(data.kind, data.status);
      else if (d.n === 'device') {
        device = Object.assign({}, device, data);
        shell.platform = device.platform;
        remeasureSafeAreas();
        fire('mvc:preview-device', device);
        try { W.dispatchEvent(new Event('resize')); } catch (e) { /* sin evento */ }
      } else if (d.n === 'clock') setClock(data.iso, { freeze: !!data.freeze });
      else if (d.n === 'notification-response') fire('mvc:preview-notification-response', data);
      else if (d.n === 'foreground') {
        /* Ir a Ajustes y volver: AppState pasa a «background» y a «active». */
        shell.__foreground = !!data.foreground;
        try { D.dispatchEvent(new Event('visibilitychange')); } catch (e) { /* sin evento */ }
        if (data.foreground) { try { W.dispatchEvent(new Event('focus')); } catch (e) { /* sin evento */ } }
      }
    } else if (d.t === 'call') {
      var m = W.__mvc;
      var fn = m && m[d.m];
      if (typeof fn !== 'function') {
        post({ t: 'call-result', id: d.id, ok: false, e: 'La app no expone __mvc.' + d.m + '() (src/preview/install.ts)' });
        return;
      }
      Promise.resolve()
        .then(function () { return fn.apply(m, d.a || []); })
        .then(
          function (v) { post({ t: 'call-result', id: d.id, ok: true, v: safeClone(v) }); },
          function (e) { post({ t: 'call-result', id: d.id, ok: false, e: String(e && e.message ? e.message : e) }); }
        );
    }
  });
  function safeClone(v) {
    try { return JSON.parse(JSON.stringify(v === undefined ? null : v)); } catch (e) { return null; }
  }
  /* Visibilidad simulada (Ajustes): lo que lee AppState en web. */
  (function () {
    try {
      var vs = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
      var hd = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
      if (!vs || !vs.get || !hd || !hd.get) return;
      Object.defineProperty(D, 'visibilityState', { configurable: true, get: function () { return shell.__foreground === false ? 'hidden' : vs.get.call(D); } });
      Object.defineProperty(D, 'hidden', { configurable: true, get: function () { return shell.__foreground === false ? true : hd.get.call(D); } });
    } catch (e) { /* AppState no cambia */ }
  })();

  shell.__inner = { version: 1, standalone: !inFrame, boot: boot };
  emit('hello', { version: 1, standalone: false });
})();
