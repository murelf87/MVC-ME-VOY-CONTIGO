/* ═══════════════ Capa del «sistema» del móvil simulado ═══════════════
   Todo lo que un navegador no puede dar de verdad y el sistema operativo dibujaría por encima de la app: diálogos de permisos,
   Ajustes, cámara, galería, archivos, compartir, abrir enlaces, Apple Pay / Google Pay, biometría, avisos y SMS.
   Cada pieza lleva la etiqueta «Simulación». Los métodos de RPC los llama la app (inner.js) por postMessage. */

/* ───────────── Cola de ventanas modales: solo una a la vez ───────────── */
var modalQueue = [];
var modalCurrent = null;
function modal(build) {
  return new Promise(function (resolve) {
    modalQueue.push({ build: build, resolve: resolve });
    pumpModals();
  });
}
function pumpModals() {
  if (modalCurrent || !modalQueue.length) return;
  var item = modalQueue.shift();
  var nodes = [];
  var finished = false;
  var ctx = {
    escape: null,
    add: function (el) { els.sys.appendChild(el); nodes.push(el); return el; },
    done: function (value) {
      if (finished) return;
      finished = true;
      nodes.forEach(function (n) { n.remove(); });
      modalCurrent = null;
      item.resolve(value);
      setTimeout(pumpModals, 0);
    }
  };
  modalCurrent = ctx;
  try {
    item.build(ctx);
    var oldToast = $('.v-stoast', els.sys);
    if (oldToast) oldToast.remove(); /* un aviso breve de un paso anterior no debe tapar el diálogo nuevo */
    var top = nodes.length ? nodes[nodes.length - 1] : null;
    if (top) {
      var target = top.matches && top.matches('[role="dialog"], [role="alertdialog"]') ? top : top.querySelector('[role="dialog"], [role="alertdialog"]') || top;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      try { target.focus({ preventScroll: true }); } catch (e) { /* sin foco */ }
    }
  } catch (e) {
    if (W.console) console.error(e);
    ctx.done(undefined);
  }
}
D.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape' && modalCurrent && modalCurrent.escape) { ev.preventDefault(); modalCurrent.escape(); }
});
function pendingDialogs() { return (modalCurrent ? 1 : 0) + modalQueue.length; }
/** Cierra todo lo que el sistema simulado tenga abierto (para limpiar entre pruebas). Devuelve cuántas ventanas había. */
function resetDialogs() {
  var n = pendingDialogs() + (els.msgs ? 1 : 0);
  modalQueue.splice(0).forEach(function (q) { q.resolve(undefined); });
  if (modalCurrent) { if (modalCurrent.escape) modalCurrent.escape(); else modalCurrent.done(undefined); }
  if (els.msgsClose) els.msgsClose();
  return n;
}

function scrim(ctx, onTap) {
  return ctx.add(h('div', { class: 'v-sys-scrim', onclick: onTap || null }));
}
function simTag(text) { return h('div', { class: 'v-sim-tag', text: text || 'Simulación del sistema: no es un aviso real.' }); }
function stoast(text, ms) {
  var old = $('.v-stoast', els.sys);
  if (old) old.remove();
  var el = h('div', { class: 'v-stoast', role: 'status', text: text });
  els.sys.appendChild(el);
  setTimeout(function () { el.remove(); }, ms || 2600);
}

/* ───────────── Permisos ───────────── */
var PERM_ICON = {
  location: 'M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z',
  notifications: 'M12 22a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 22zm6.5-6.5v-5c0-3.1-1.6-5.6-4.5-6.3V3.5a2 2 0 0 0-4 0v.7C7.1 4.9 5.5 7.4 5.5 10.5v5L3.5 17.5V19h17v-1.5l-2-2z',
  camera: 'M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 15.5A4.5 4.5 0 1 1 12 9.5a4.5 4.5 0 0 1 0 9zm0-2a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  microphone: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z',
  photos: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z',
  contacts: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm8 2.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5zM17 17v-1.5c0-1.7-3.3-2.5-5-2.5s-5 .8-5 2.5V17h10z',
  bluetooth: 'M17.7 7.7 12 2h-1v7.6L6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l4.6-4.6V22h1l5.7-5.7L13.4 12l4.3-4.3zM13 5.8l1.9 1.9L13 9.6V5.8zm1.9 10.5L13 18.2v-3.8l1.9 1.9z'
};
PERM_ICON.locationAlways = PERM_ICON.location;
/* Textos de los diálogos: iOS usa la «cadena de uso» de la app; Android, la pregunta estándar del sistema. */
var PERM_TEXT = {
  location: {
    ios: ['¿Permitir que “MVC” use tu ubicación?', 'MVC usa tu ubicación para mostrarte en el mapa, encontrar viajes cercanos y, durante un viaje, compartirla con tu conductor o tus pasajeros.', [['Permitir una vez', 'once'], ['Permitir al usar la app', 'allow', 1], ['No permitir', 'deny']]],
    android: ['¿Permitir que MVC acceda a la ubicación de este dispositivo?', [['Mientras la app está en uso', 'allow'], ['Solo esta vez', 'once'], ['No permitir', 'deny']]]
  },
  locationAlways: {
    ios: ['¿Permitir que “MVC” use tu ubicación también cuando no la estés usando?', 'MVC comparte tu posición con el grupo del viaje aunque cierres la app mientras el viaje está en marcha.', [['Cambiar a “Permitir siempre”', 'allow', 1], ['Mantener “Al usar la app”', 'deny']]],
    android: ['¿Permitir que MVC acceda a la ubicación en segundo plano?', [['Permitir siempre', 'allow'], ['No permitir', 'deny']]]
  },
  notifications: {
    ios: ['“MVC” quiere enviarte notificaciones', 'Las notificaciones pueden incluir alertas, sonidos e iconos. Se pueden configurar en Ajustes.', [['No permitir', 'deny'], ['Permitir', 'allow', 1]]],
    android: ['¿Permitir que MVC te envíe notificaciones?', [['Permitir', 'allow'], ['No permitir', 'deny']]]
  },
  camera: {
    ios: ['“MVC” quiere acceder a la cámara', 'MVC usa la cámara para tu foto de perfil y para la comprobación privada de identidad.', [['No permitir', 'deny'], ['OK', 'allow', 1]]],
    android: ['¿Permitir que MVC haga fotos y grabe vídeos?', [['Mientras la app está en uso', 'allow'], ['Solo esta vez', 'once'], ['No permitir', 'deny']]]
  },
  microphone: {
    ios: ['“MVC” quiere acceder al micrófono', 'MVC usa el micrófono para enviar notas de voz en el chat de la reserva.', [['No permitir', 'deny'], ['OK', 'allow', 1]]],
    android: ['¿Permitir que MVC grabe audio?', [['Mientras la app está en uso', 'allow'], ['Solo esta vez', 'once'], ['No permitir', 'deny']]]
  },
  photos: {
    ios: ['“MVC” quiere acceder a tus fotos', 'MVC usa tus fotos para que elijas tu foto de perfil y adjuntes documentos.', [['Seleccionar fotos…', 'once'], ['Permitir acceso a todas las fotos', 'allow'], ['No permitir', 'deny']]],
    android: ['¿Permitir que MVC acceda a fotos y vídeos de este dispositivo?', [['Permitir', 'allow'], ['No permitir', 'deny']]]
  },
  contacts: {
    ios: ['“MVC” quiere acceder a tus contactos', 'MVC usa tus contactos para que invites a personas que conoces a compartir viaje.', [['No permitir', 'deny'], ['OK', 'allow', 1]]],
    android: ['¿Permitir que MVC acceda a tus contactos?', [['Permitir', 'allow'], ['No permitir', 'deny']]]
  },
  bluetooth: {
    ios: ['“MVC” quiere usar Bluetooth', 'MVC usa Bluetooth para conectar con dispositivos cercanos.', [['No permitir', 'deny'], ['OK', 'allow', 1]]],
    android: ['¿Permitir que MVC encuentre dispositivos cercanos y se conecte a ellos?', [['Permitir', 'allow'], ['No permitir', 'deny']]]
  }
};

function setPerm(kind, status, quiet) {
  if (PERM_KINDS.indexOf(kind) < 0) return;
  if (state.perms[kind] === status) return;
  state.perms[kind] = status;
  persistPerms();
  if (!quiet) sendEvent('permission', { kind: kind, status: status });
  bus.emit('perm', state.perms);
}

function askPermission(kind) {
  return modal(function (ctx) {
    var android = osOf() === 'android';
    var spec = PERM_TEXT[kind] || PERM_TEXT.location;
    if (!android) {
      var s = spec.ios;
      scrim(ctx);
      var btns = s[2].map(function (b) {
        return h('button', { type: 'button', class: b[2] ? 'strong' : '', text: b[0], onclick: function () { ctx.done(b[1]); } });
      });
      ctx.add(h('div', { class: 'v-ios-alert', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': s[0] },
        h('div', { class: 'body' }, h('div', { class: 'title', text: s[0] }), h('div', { class: 'msg', text: s[1] })),
        h('div', { class: 'btns' + (btns.length === 2 ? ' row' : '') }, btns),
        simTag()
      ));
    } else {
      var a = spec.android;
      scrim(ctx);
      ctx.add(h('div', { class: 'v-and-perm', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': a[0] },
        h('div', { class: 'ico' }, svgEl('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + PERM_ICON[kind] + '"/></svg>')),
        h('div', { class: 'title', text: a[0] }),
        h('div', { class: 'btns' }, a[1].map(function (b, i) {
          return h('button', { type: 'button', class: i === 0 ? 'first' : '', text: b[0], onclick: function () { ctx.done(b[1]); } });
        })),
        simTag()
      ));
    }
  });
}

RPC.requestPermission = function (kind) {
  if (PERM_KINDS.indexOf(kind) < 0) return Promise.reject(new Error('Permiso desconocido: ' + kind));
  var cur = state.perms[kind];
  if (cur === 'granted' || cur === 'blocked') return Promise.resolve(cur);
  var ios = osOf() === 'ios';
  if (cur === 'denied' && ios) { setPerm(kind, 'blocked'); return Promise.resolve('blocked'); }
  var grant = function (once) {
    setPerm(kind, 'granted');
    if (once) state.permOnce[kind] = true;
    if (kind === 'locationAlways' && state.perms.location !== 'granted') setPerm('location', 'granted');
    return 'granted';
  };
  var deny = function () {
    if (ios) { setPerm(kind, 'blocked'); return 'blocked'; }
    state.denies[kind] = (state.denies[kind] || 0) + 1;
    var st = state.denies[kind] >= 2 ? 'blocked' : 'denied';
    setPerm(kind, st);
    return st;
  };
  if (state.autoperm) return Promise.resolve(grant(false));
  return askPermission(kind).then(function (r) {
    if (r === 'allow') return grant(false);
    if (r === 'once') return grant(true);
    return deny();
  });
};
RPC.setPermission = function (kind, status) {
  if (['undetermined', 'granted', 'denied', 'blocked'].indexOf(status) < 0) return Promise.reject(new Error('Estado de permiso desconocido: ' + status));
  setPerm(kind, status, false);
  return null;
};

/* Ajustes › MVC simulado: se abre desde «Abrir Ajustes» cuando un permiso está bloqueado; al volver, la app pasa a primer plano. */
RPC.openSettings = function () {
  return modal(function (ctx) {
    var android = osOf() === 'android';
    sendEvent('foreground', { foreground: false });
    var body = h('div', { class: 'body' });
    var rows = {};
    function render() {
      clear(body);
      body.appendChild(h('div', { class: 'app' },
        ASSETS.appIcon ? h('img', { src: ASSETS.appIcon, alt: '' }) : null,
        h('div', null, h('b', { text: 'MVC · Me voy contigo' }), h('div', { class: 'v-tiny', text: 'Permisos de la app' }))
      ));
      body.appendChild(h('h4', { text: 'Permitir que MVC acceda a:' }));
      var grp = h('div', { class: 'grp' });
      var toggles = [['photos', 'Fotos'], ['camera', 'Cámara'], ['microphone', 'Micrófono'], ['contacts', 'Contactos'], ['notifications', 'Notificaciones'], ['bluetooth', 'Bluetooth']];
      var locState = state.perms.locationAlways === 'granted' ? 'always' : state.perms.location === 'granted' ? 'use' : state.perms.location === 'undetermined' ? 'ask' : 'never';
      var sel = h('select', { 'aria-label': 'Ubicación', onchange: function () {
        var v = sel.value;
        if (v === 'never') { setPerm('location', 'blocked'); setPerm('locationAlways', 'blocked'); }
        else if (v === 'ask') { setPerm('location', 'undetermined'); setPerm('locationAlways', 'undetermined'); }
        else if (v === 'use') { setPerm('location', 'granted'); if (state.perms.locationAlways === 'granted') setPerm('locationAlways', 'undetermined'); }
        else { setPerm('location', 'granted'); setPerm('locationAlways', 'granted'); }
        render();
      } },
        h('option', { value: 'never', text: 'Nunca' }), h('option', { value: 'ask', text: 'Preguntar la próxima vez' }),
        h('option', { value: 'use', text: android ? 'Solo mientras se usa la app' : 'Al usar la app' }), h('option', { value: 'always', text: 'Siempre' })
      );
      sel.value = locState;
      grp.appendChild(h('div', { class: 'it' }, h('span', { text: 'Ubicación' }), sel));
      toggles.forEach(function (t) {
        var on = state.perms[t[0]] === 'granted';
        var tg = h('button', { type: 'button', class: 'tg', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': t[1], onclick: function () {
          setPerm(t[0], on ? 'blocked' : 'granted');
          render();
        } });
        rows[t[0]] = tg;
        grp.appendChild(h('div', { class: 'it' }, h('span', { text: t[1] }), tg));
      });
      body.appendChild(grp);
      body.appendChild(h('div', { class: 'hint', text: 'Al volver, MVC se entera del cambio, como en un móvil real. Esta pantalla es una simulación de Ajustes del sistema.' }));
    }
    render();
    var back = function () { sendEvent('foreground', { foreground: true }); ctx.done(undefined); };
    ctx.escape = back;
    ctx.add(h('div', { class: 'v-full v-set', 'data-sb': 'dark', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ajustes simulados' },
      h('header', null, h('button', { type: 'button', text: '‹ MVC', 'aria-label': 'Volver a MVC', onclick: back }), h('b', { text: android ? 'Información de la app' : 'Ajustes' }), h('span', { style: 'width:52px' })),
      body
    ));
  }).then(function () { return null; });
};

/* ───────────── Imágenes de ejemplo (siempre etiquetadas: nunca parecen una foto real) ───────────── */
var SAMPLE_PALETTES = [
  ['#9DBBE8', '#DCE6F7', '#A9B4A0', '#7D8A70'],
  ['#F2C58B', '#FBE8CC', '#8FA7A0', '#5F7A74'],
  ['#8CC9C0', '#D6F0EC', '#B7A58C', '#8A7A62'],
  ['#B6A5E0', '#E6DFF6', '#9AA7B8', '#6D7B8E'],
  ['#F0A6A0', '#FAD9D5', '#A7B49A', '#78886B'],
  ['#9BC1F0', '#CFE3FA', '#C2B69A', '#948868']
];
function drawSample(canvas, opts) {
  var w = canvas.width, hh = canvas.height, g = canvas.getContext('2d');
  var p = SAMPLE_PALETTES[(opts.index || 0) % SAMPLE_PALETTES.length];
  var grad = g.createLinearGradient(0, 0, 0, hh);
  grad.addColorStop(0, p[0]); grad.addColorStop(0.58, p[1]); grad.addColorStop(0.59, p[2]); grad.addColorStop(1, p[3]);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, hh);
  if (opts.portrait) {
    /* silueta genérica (cabeza y hombros), sin rasgos: no representa a nadie */
    g.fillStyle = 'rgba(40,52,84,0.55)';
    g.beginPath(); g.arc(w / 2, hh * 0.40, w * 0.17, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(w / 2, hh * 0.80, w * 0.32, hh * 0.22, 0, Math.PI, 0); g.fill();
  } else {
    g.fillStyle = 'rgba(40,52,84,0.35)';
    g.beginPath(); g.moveTo(0, hh * 0.59); g.lineTo(w * 0.28, hh * 0.45); g.lineTo(w * 0.52, hh * 0.59); g.closePath(); g.fill();
    g.fillStyle = 'rgba(40,52,84,0.22)';
    g.beginPath(); g.moveTo(w * 0.35, hh * 0.59); g.lineTo(w * 0.72, hh * 0.40); g.lineTo(w, hh * 0.59); g.closePath(); g.fill();
    g.fillStyle = 'rgba(70,74,90,0.55)';
    g.beginPath(); g.moveTo(w * 0.40, hh * 0.59); g.lineTo(w * 0.60, hh * 0.59); g.lineTo(w * 0.98, hh); g.lineTo(w * 0.02, hh); g.closePath(); g.fill();
  }
  if (opts.noBar) return;
  var barH = Math.max(18, Math.round(hh * 0.17));
  g.fillStyle = 'rgba(255,255,255,0.82)';
  g.fillRect(0, hh - barH, w, barH);
  g.fillStyle = '#0B2357';
  g.textAlign = 'center';
  g.font = '700 ' + Math.round(barH * 0.36) + 'px system-ui, sans-serif';
  g.fillText('FOTO DE EJEMPLO', w / 2, hh - barH * 0.5);
  g.font = '500 ' + Math.round(barH * 0.21) + 'px system-ui, sans-serif';
  g.fillText(opts.label || 'Vista previa de MVC · no es una foto real', w / 2, hh - barH * 0.16);
}
function sampleFile(opts) {
  opts = opts || {};
  var c = D.createElement('canvas');
  c.width = opts.w || 960;
  c.height = opts.h || 1280;
  drawSample(c, { index: opts.index || 0, portrait: !!opts.portrait, label: opts.label });
  var uri = c.toDataURL('image/jpeg', 0.82);
  return { uri: uri, name: opts.name || 'foto-de-ejemplo-' + ((opts.index || 0) + 1) + '.jpg', mimeType: 'image/jpeg', size: Math.round((uri.length - 23) * 0.75), width: c.width, height: c.height, example: true };
}
function samplePdf(title) {
  var safe = String(title || 'Documento de ejemplo').replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '');
  var content = 'BT /F1 22 Tf 60 760 Td (' + safe + ') Tj ET\nBT /F1 12 Tf 60 730 Td (Documento de ejemplo de la vista previa de MVC.) Tj ET\nBT /F1 12 Tf 60 712 Td (No es un documento real ni contiene datos de nadie.) Tj ET';
  var objs = [null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  var out = '%PDF-1.4\n';
  var offs = [];
  for (var i = 1; i <= 5; i++) { offs[i] = out.length; out += i + ' 0 obj\n' + objs[i] + '\nendobj\n'; }
  var xref = out.length;
  out += 'xref\n0 6\n0000000000 65535 f \n';
  for (var j = 1; j <= 5; j++) out += ('0000000000' + offs[j]).slice(-10) + ' 00000 n \n';
  out += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return { uri: 'data:application/pdf;base64,' + W.btoa(out), name: safe.toLowerCase().replace(/\s+/g, '-') + '.pdf', mimeType: 'application/pdf', size: out.length, example: true };
}
function readRealFile(file) {
  return new Promise(function (resolve, reject) {
    if (file.size > 8 * 1024 * 1024) { reject(new Error('El archivo pesa más de 8 MB: elige uno más pequeño.')); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var rec = { uri: String(fr.result), name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, example: false };
      if (/^image\//.test(rec.mimeType)) {
        var im = new Image();
        im.onload = function () { rec.width = im.naturalWidth; rec.height = im.naturalHeight; resolve(rec); };
        im.onerror = function () { resolve(rec); };
        im.src = rec.uri;
      } else resolve(rec);
    };
    fr.onerror = function () { reject(new Error('No se ha podido leer el archivo')); };
    fr.readAsDataURL(file);
  });
}

/* ───────────── Cámara (simulada: no se usa la cámara real) ───────────── */
RPC.cameraCapture = function (opts) {
  opts = opts || {};
  var facing = opts.facing === 'user' ? 'user' : 'environment';
  if (opts.instant || state.auto) return Promise.resolve(sampleFile({ portrait: facing === 'user', label: opts.label, index: facing === 'user' ? 3 : 0 }));
  return modal(function (ctx) {
    var cur = facing;
    var canvas = h('canvas', { width: 360, height: 640, 'aria-hidden': 'true' });
    var cap = h('div', { class: 'cap', text: opts.label || '' });
    var tick = 0;
    var raf = null;
    function paint() {
      drawSample(canvas, { index: cur === 'user' ? 3 : 0, portrait: cur === 'user', noBar: true }); /* la foto hecha sí lleva «FOTO DE EJEMPLO» */
      var g = canvas.getContext('2d');
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 2;
      var m = 36, len = 28;
      [[m, m, 1, 1], [canvas.width - m, m, -1, 1], [m, canvas.height * 0.78, 1, -1], [canvas.width - m, canvas.height * 0.78, -1, -1]].forEach(function (c) {
        g.beginPath(); g.moveTo(c[0], c[1] + c[3] * len); g.lineTo(c[0], c[1]); g.lineTo(c[0] + c[2] * len, c[1]); g.stroke();
      });
      tick++;
    }
    paint();
    var close = function (v) { if (raf) clearInterval(raf); ctx.done(v); };
    ctx.escape = function () { close(null); };
    var view = ctx.add(h('div', { class: 'v-full v-cam', 'data-sb': 'light', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cámara simulada' },
      canvas,
      h('div', { class: 'top' },
        h('button', { type: 'button', class: 'xb', 'aria-label': 'Cancelar', text: '✕', onclick: function () { close(null); } }),
        h('span', { class: 'chip', text: 'Simulación de cámara · no se usa la cámara real' }),
        h('span', { style: 'width:38px' })
      ),
      cap,
      h('div', { class: 'bottom' },
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'shutter', 'aria-label': 'Hacer foto', onclick: function () {
          view.appendChild(h('div', { class: 'v-flash' }));
          var file = sampleFile({ portrait: cur === 'user', label: opts.label, index: cur === 'user' ? 3 : 0 });
          setTimeout(function () { close(file); }, 220);
        } }),
        h('button', { type: 'button', class: 'flip', 'aria-label': 'Cambiar de cámara', text: '⟳', onclick: function () { cur = cur === 'user' ? 'environment' : 'user'; paint(); } })
      )
    ));
  });
};

/* ───────────── Hojas inferiores (galería, archivos, compartir…) ───────────── */
function bottomSheet(ctx, title, content, foot, opts) {
  opts = opts || {};
  var dismiss = function () { ctx.done(opts.dismissValue); };
  scrim(ctx, opts.modalOnly ? null : dismiss);
  ctx.escape = dismiss;
  return ctx.add(h('div', { class: 'v-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'grab' }),
    h('header', null, h('b', { text: title }), opts.noClose ? null : h('button', { type: 'button', class: 'v-xbtn', 'aria-label': 'Cerrar', text: '✕', onclick: dismiss })),
    opts.sim === false ? null : h('div', { class: 'v-simbar', text: opts.sim || 'Simulación del sistema: no se usa tu galería ni tus archivos reales.' }),
    h('div', { class: 'content' }, content),
    foot ? h('div', { class: 'foot' }, foot) : null
  ));
}
function realFileButton(accept, onFile) {
  var input = h('input', { type: 'file', accept: accept, style: 'display:none', 'aria-hidden': 'true', tabindex: '-1' });
  input.addEventListener('change', function () {
    var f = input.files && input.files[0];
    if (f) onFile(f);
    input.value = '';
  });
  var btn = h('button', { type: 'button', class: 'v-sbtn', style: 'margin-top:10px;width:100%;flex:none', text: 'Elegir un archivo de mi ordenador…', onclick: function () { input.click(); } });
  return h('div', null, input, btn);
}

RPC.pickImages = function (opts) {
  opts = opts || {};
  var multiple = !!opts.multiple;
  var limit = Math.max(1, opts.limit || (multiple ? 6 : 1));
  if (state.auto) return Promise.resolve([sampleFile({ index: 0 })]);
  return modal(function (ctx) {
    var picked = [];
    var addBtn = h('button', { type: 'button', class: 'v-sbtn primary', text: 'Añadir', disabled: true });
    var grid = h('div', { class: 'v-gal' });
    function refresh() {
      addBtn.textContent = picked.length ? 'Añadir (' + picked.length + ')' : 'Añadir';
      addBtn.disabled = !picked.length;
      Array.prototype.forEach.call(grid.children, function (b, i) { b.setAttribute('aria-pressed', picked.indexOf(i) >= 0 ? 'true' : 'false'); });
    }
    for (var i = 0; i < 6; i++) {
      (function (idx) {
        var c = D.createElement('canvas');
        c.width = 180; c.height = 180;
        drawSample(c, { index: idx, portrait: idx % 3 === 1, label: 'Ejemplo ' + (idx + 1) });
        grid.appendChild(h('button', { type: 'button', 'aria-label': 'Foto de ejemplo ' + (idx + 1), 'aria-pressed': 'false', onclick: function () {
          var at = picked.indexOf(idx);
          if (at >= 0) picked.splice(at, 1);
          else { if (!multiple) picked = []; if (picked.length < limit) picked.push(idx); }
          refresh();
        } }, h('img', { src: c.toDataURL('image/jpeg', 0.7), alt: '' })));
      })(i);
    }
    addBtn.addEventListener('click', function () {
      ctx.done(picked.map(function (idx) { return sampleFile({ index: idx, portrait: idx % 3 === 1, name: 'foto-de-ejemplo-' + (idx + 1) + '.jpg' }); }));
    });
    bottomSheet(ctx, 'Fototeca', [
      grid,
      realFileButton('image/*', function (f) {
        readRealFile(f).then(function (rec) { ctx.done([rec]); }, function (e) { stoast(errMsg(e)); });
      })
    ], [h('button', { type: 'button', class: 'v-sbtn', text: 'Cancelar', onclick: function () { ctx.done([]); } }), addBtn], { dismissValue: [] });
  });
};

RPC.pickDocuments = function (opts) {
  opts = opts || {};
  var samples = [
    { name: 'Documento de ejemplo.pdf', kind: 'PDF', make: function () { return samplePdf('Documento de ejemplo'); } },
    { name: 'Justificante de ejemplo.pdf', kind: 'PDF', make: function () { return samplePdf('Justificante de ejemplo'); } },
    { name: 'Foto de ejemplo.jpg', kind: 'JPG', make: function () { return sampleFile({ index: 1, name: 'foto-de-ejemplo.jpg' }); } }
  ];
  if (state.auto) return Promise.resolve([samples[0].make()]);
  return modal(function (ctx) {
    var sel = 0;
    var list = h('div', { class: 'v-docs' }, samples.map(function (s, i) {
      return h('button', { type: 'button', 'aria-pressed': i === 0 ? 'true' : 'false', onclick: function () {
        sel = i;
        Array.prototype.forEach.call(list.children, function (b, j) { b.setAttribute('aria-pressed', j === i ? 'true' : 'false'); });
      } }, h('span', { class: 'di', text: s.kind }), h('span', null, s.name, h('small', { text: 'Archivo de ejemplo' })));
    }));
    var accept = (opts.accept && opts.accept.length ? opts.accept.join(',') : '*/*');
    bottomSheet(ctx, 'Archivos', [
      list,
      realFileButton(accept, function (f) { readRealFile(f).then(function (rec) { ctx.done([rec]); }, function (e) { stoast(errMsg(e)); }); })
    ], [h('button', { type: 'button', class: 'v-sbtn', text: 'Cancelar', onclick: function () { ctx.done([]); } }), h('button', { type: 'button', class: 'v-sbtn primary', text: 'Elegir', onclick: function () { ctx.done([samples[sel].make()]); } })], { dismissValue: [] });
  });
};

/* ───────────── Compartir, abrir enlaces, copiar, guardar ───────────── */
RPC.share = function (req) {
  req = req || {};
  if (state.auto) return Promise.resolve('shared');
  return modal(function (ctx) {
    var text = [req.message, req.url].filter(Boolean).join('\n');
    var targets = [
      ['Mensajes', '#34c759', '✉', 'Mensajes'],
      ['Correo', '#1a82fb', '@', 'Correo'],
      ['Notas', '#f5c518', '✎', 'Notas'],
      ['Copiar', '#8e8e93', '⧉', null]
    ];
    var row = h('div', { class: 'v-targets' }, targets.map(function (t) {
      return h('button', { type: 'button', class: 'v-target', onclick: function () {
        if (!t[3]) {
          copyText(text).then(function () { stoast('Copiado al portapapeles'); }, function () { stoast('El navegador no permite copiar'); });
          ctx.done('shared');
          return;
        }
        stoast('Simulación: se compartiría con ' + t[3]);
        ctx.done('shared');
      } }, h('i', { text: t[2], style: 'background:' + t[1] }), t[0]);
    }));
    bottomSheet(ctx, 'Compartir', [
      h('div', { class: 'v-prev' },
        h('div', { class: 'ic' }, ASSETS.appIcon ? h('img', { src: ASSETS.appIcon, alt: '' }) : null),
        h('div', { class: 'tx' }, h('b', { text: req.title || 'MVC · Me voy contigo' }), h('span', { text: req.message || req.url || '' }), req.message && req.url ? h('span', { text: req.url }) : null)
      ),
      row
    ], [h('button', { type: 'button', class: 'v-sbtn', text: 'Cancelar', onclick: function () { ctx.done('dismissed'); } })], { dismissValue: 'dismissed', sim: 'Simulación de la hoja de compartir: no se envía nada.' });
  });
};

function describeUrl(url) {
  var u = String(url);
  var scheme = (/^([a-z][a-z0-9+.-]*):/i.exec(u) || [])[1] || '';
  scheme = scheme.toLowerCase();
  if (scheme === 'tel') return 'Se abriría la app Teléfono para llamar a ' + u.replace(/^tel:/i, '') + '.';
  if (scheme === 'sms') return 'Se abriría la app Mensajes.';
  if (scheme === 'mailto') return 'Se abriría la app Correo.';
  if (scheme === 'geo' || /^(maps|comgooglemaps|waze):/i.test(u)) return 'Se abriría la app de mapas.';
  if (scheme === 'http' || scheme === 'https') { var host = ''; try { host = new URL(u).host; } catch (e) { host = u; } return 'Se abriría el navegador en ' + host + '.'; }
  return 'Se abriría la app asociada a este enlace.';
}
RPC.openExternal = function (url) {
  url = String(url || '');
  if (state.auto) { stoast('Simulación: ' + describeUrl(url)); return Promise.resolve(true); }
  return modal(function (ctx) {
    scrim(ctx, function () { ctx.done(false); });
    ctx.escape = function () { ctx.done(false); };
    var android = osOf() === 'android';
    var shown = url.length > 160 ? url.slice(0, 157) + '…' : url;
    var body = [
      h('div', { class: 'title', text: '¿Abrir enlace externo?' }),
      h('div', { class: 'msg', text: shown, style: 'font-family:ui-monospace,Menlo,monospace;font-size:12px;word-break:break-all;margin:6px 0' }),
      h('div', { class: 'msg', text: describeUrl(url) + ' En la vista previa no sale nada del navegador.' })
    ];
    var finish = function (ok) { if (ok) stoast('Simulación: ' + describeUrl(url)); ctx.done(!!ok); };
    if (!android) {
      ctx.add(h('div', { class: 'v-ios-alert', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': '¿Abrir enlace externo?' },
        h('div', { class: 'body' }, body),
        h('div', { class: 'btns row' }, h('button', { type: 'button', text: 'Cancelar', onclick: function () { finish(false); } }), h('button', { type: 'button', class: 'strong', text: 'Abrir', onclick: function () { finish(true); } })),
        simTag('Simulación: no se abre nada de verdad.')
      ));
    } else {
      ctx.add(h('div', { class: 'v-and-alert', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': '¿Abrir enlace externo?' },
        h('div', { class: 'title', text: '¿Abrir enlace externo?' }), h('div', { class: 'msg', text: shown, style: 'font-family:ui-monospace,monospace;font-size:12px;word-break:break-all' }),
        h('div', { class: 'msg', text: describeUrl(url) + ' En la vista previa no sale nada del navegador (simulación).' }),
        h('div', { class: 'btns' }, h('button', { type: 'button', text: 'Cancelar', onclick: function () { finish(false); } }), h('button', { type: 'button', text: 'Abrir', onclick: function () { finish(true); } }))
      ));
    }
  });
};
RPC.copyToClipboard = function (text) {
  return copyText(String(text)).then(function () { stoast('Copiado'); return null; }, function () { stoast('El navegador no permite copiar'); return null; });
};
RPC.saveFile = function (opts) {
  opts = opts || {};
  var name = (opts.baseName || 'mvc') + (opts.ext ? '.' + opts.ext : (typeof opts.data === 'string' && /^\s*[{[]/.test(opts.data) ? '.json' : '.txt'));
  var doSave = function () {
    try {
      var blob = opts.data instanceof Blob ? opts.data : new Blob([String(opts.data || '')], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = h('a', { href: url, download: name, style: 'display:none' });
      D.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return 'saved';
    } catch (e) { return 'failed'; }
  };
  if (state.auto) return Promise.resolve(doSave());
  return modal(function (ctx) {
    bottomSheet(ctx, 'Guardar archivo', [h('div', { class: 'v-prev' }, h('div', { class: 'tx' }, h('b', { text: name }), h('span', { text: 'Se descargará en este navegador.' })))],
      [h('button', { type: 'button', class: 'v-sbtn', text: 'Cancelar', onclick: function () { ctx.done('declined'); } }), h('button', { type: 'button', class: 'v-sbtn primary', text: 'Guardar', onclick: function () { ctx.done(doSave()); } })],
      { dismissValue: 'declined', sim: 'Simulación de «Guardar en Archivos»: se descarga en tu navegador.' });
  });
};

/* ───────────── Apple Pay / Google Pay (SIMULACIÓN: no se cobra nada) ───────────── */
RPC.payWithWallet = function (req) {
  req = req || {};
  var android = osOf() === 'android';
  var brand = android ? 'Google Pay' : 'Apple Pay';
  var ref = function () { return 'SIM-' + (android ? 'GPAY' : 'APAY') + '-' + Math.random().toString(36).slice(2, 8).toUpperCase(); };
  if (state.auto) return Promise.resolve({ status: 'authorized', reference: ref() });
  return modal(function (ctx) {
    var area = h('div');
    var foot = h('div', { class: 'foot wrap' });
    var dismiss = function () { ctx.done({ status: 'cancelled' }); };
    scrim(ctx, null);
    ctx.escape = dismiss;
    function review() {
      clear(area); clear(foot);
      area.appendChild(h('div', null,
        h('div', { class: 'v-rowl' }, h('span', { text: 'Tarjeta' }), h('b', { text: 'Visa •••• 4242 (de ejemplo)' })),
        h('div', { class: 'v-rowl' }, h('span', { text: 'Comercio' }), h('b', { text: req.merchant || 'MVC · Me voy contigo' })),
        h('div', { class: 'v-rowl' }, h('span', { text: 'Concepto' }), h('b', { text: req.label || 'Pago' })),
        (req.lines || []).map(function (l) { return h('div', { class: 'v-rowl' }, h('span', { text: l.label }), h('b', { text: l.amountLabel })); }),
        h('div', { class: 'v-total', text: req.amountLabel || '' })
      ));
      if (!android) area.appendChild(h('div', { class: 'v-faceid' }, svgEl('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 10v1M15 10v1M12 10v3h-1M9.5 16c1.5 1.3 3.5 1.3 5 0"/></svg>')));
      foot.appendChild(h('button', { type: 'button', class: 'v-sbtn', text: 'Cancelar', onclick: dismiss }));
      foot.appendChild(h('button', { type: 'button', class: 'v-sbtn dark', text: android ? 'Pagar' : 'Pagar con Face ID (simulado)', onclick: function () { process(true); } }));
      foot.appendChild(h('button', { type: 'button', class: 'v-sbtn danger', text: 'Simular fallo', onclick: function () { process(false); } }));
    }
    function process(ok) {
      clear(foot);
      clear(area);
      area.appendChild(h('div', { class: 'v-pay-state' }, h('div', { class: 'ring' }), h('div', { text: 'Procesando… (simulado)' })));
      setTimeout(function () {
        clear(area);
        area.appendChild(h('div', { class: 'v-pay-state' }, h('div', { class: 'check' + (ok ? '' : ' bad'), text: ok ? '✓' : '✕' }), h('div', { text: ok ? 'Pago autorizado (simulado). No se ha cobrado nada.' : 'No se ha podido completar (fallo simulado).' })));
        setTimeout(function () { ctx.done(ok ? { status: 'authorized', reference: ref() } : { status: 'failed' }); }, 900);
      }, 1100);
    }
    review();
    ctx.add(h('div', { class: 'v-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Simulación de ' + brand },
      h('div', { class: 'grab' }),
      h('header', null, h('b', { text: brand })),
      h('div', { class: 'v-simbar', text: 'Simulación de ' + brand + ' — no se cobra nada' }),
      h('div', { class: 'content' }, area),
      foot
    ));
  });
};

/* ───────────── Biometría (SIMULADA: no se lee ningún rostro ni huella) ───────────── */
RPC.biometricPrompt = function (opts) {
  opts = opts || {};
  if (state.auto) return Promise.resolve('success');
  return modal(function (ctx) {
    var android = osOf() === 'android';
    var reason = opts.reason || 'Confirma que eres tú';
    var title = android ? 'Confirma tu identidad' : 'Face ID';
    var glyph = android
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a8 8 0 0 0-8 8v2M20 11a8 8 0 0 0-3-6.2M8 11a4 4 0 0 1 8 0v3c0 3-1 5-2 7M12 11v4c0 2-.5 3.5-1.5 5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 10v1M15 10v1M12 10v3h-1M9.5 16c1.5 1.3 3.5 1.3 5 0"/></svg>';
    scrim(ctx, null);
    ctx.escape = function () { ctx.done('cancel'); };
    var btns = [
      h('button', { type: 'button', class: 'v-sbtn primary', text: 'Simular acierto', onclick: function () { ctx.done('success'); } }),
      h('button', { type: 'button', class: 'v-sbtn', text: 'Simular fallo', onclick: function () { ctx.done('fail'); } }),
      h('button', { type: 'button', class: 'v-sbtn', text: 'Cancelar', onclick: function () { ctx.done('cancel'); } })
    ];
    ctx.add(h('div', { class: 'v-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'grab' }),
      h('header', null, h('b', { text: title })),
      h('div', { class: 'v-simbar', text: 'Simulación de biometría — no se lee ningún rostro ni huella' }),
      h('div', { class: 'content' }, h('div', { class: 'v-faceid' }, svgEl(glyph)), h('p', { style: 'text-align:center;margin:8px 0 4px;font-size:14px', text: reason })),
      h('div', { class: 'foot', style: 'flex-direction:column' }, btns)
    ));
  });
};

/* ───────────── Alertas del sistema ───────────── */
RPC.alert = function (opts) {
  opts = opts || {};
  var buttons = opts.buttons && opts.buttons.length ? opts.buttons : [{ id: 'ok', label: 'OK' }];
  if (state.auto) {
    var pick = buttons.filter(function (b) { return b.style !== 'cancel'; })[0] || buttons[0];
    return Promise.resolve(pick.id);
  }
  return modal(function (ctx) {
    var android = osOf() === 'android';
    var cancel = buttons.filter(function (b) { return b.style === 'cancel'; })[0];
    scrim(ctx, null);
    ctx.escape = cancel ? function () { ctx.done(cancel.id); } : null;
    if (!android) {
      var bs = buttons.map(function (b) { return h('button', { type: 'button', class: (b.style === 'destructive' ? 'destructive ' : '') + (b.style === 'cancel' ? '' : 'strong'), text: b.label, onclick: function () { ctx.done(b.id); } }); });
      ctx.add(h('div', { class: 'v-ios-alert', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Aviso' },
        h('div', { class: 'body' }, h('div', { class: 'title', text: opts.title || '' }), opts.message ? h('div', { class: 'msg', text: opts.message }) : null),
        h('div', { class: 'btns' + (bs.length === 2 ? ' row' : '') }, bs)
      ));
    } else {
      ctx.add(h('div', { class: 'v-and-alert', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Aviso' },
        h('div', { class: 'title', text: opts.title || '' }), opts.message ? h('div', { class: 'msg', text: opts.message }) : null,
        h('div', { class: 'btns' }, buttons.map(function (b) { return h('button', { type: 'button', class: b.style === 'destructive' ? 'destructive' : '', text: b.label, onclick: function () { ctx.done(b.id); } }); }))
      ));
    }
  });
};

/* ───────────── Avisos (banners) y SMS ───────────── */
function showBanner(n) {
  var holder = $('.v-banners', els.sys);
  if (!holder) { holder = h('div', { class: 'v-banners' }); els.sys.appendChild(holder); }
  var sms = n.app === 'Mensajes';
  var icon = sms ? h('div', { class: 'ai sms', text: '💬' }) : h('div', { class: 'ai' }, ASSETS.appIcon ? h('img', { src: ASSETS.appIcon, alt: '' }) : null);
  var timer = null;
  var swiped = false;
  var y0 = null;
  var el = h('button', { type: 'button', class: 'v-banner', 'data-tone': n.tone || 'info', 'data-app': sms ? 'sms' : 'mvc', 'aria-label': (sms ? 'Mensaje: ' : 'Notificación: ') + n.title, onclick: function () {
    if (swiped) { swiped = false; return; }
    clearTimeout(timer);
    el.remove();
    if (sms) openMessages();
    else sendEvent('notification-response', { id: n.id, data: n.data });
  } },
    icon,
    h('div', { class: 'tx' }, h('small', null, h('span', { text: sms ? 'Mensajes' : 'MVC' }), h('span', { text: 'ahora' })), h('b', { text: n.title }), n.body ? h('span', { text: n.body }) : null)
  );
  /* como en el móvil: deslizar el aviso hacia arriba lo descarta sin abrirlo */
  el.addEventListener('pointerdown', function (ev) { y0 = ev.clientY; });
  el.addEventListener('pointerup', function (ev) {
    if (y0 !== null && y0 - ev.clientY > 24) { swiped = true; clearTimeout(timer); el.remove(); }
    y0 = null;
  });
  holder.appendChild(el);
  while (holder.children.length > 3) holder.removeChild(holder.firstChild);
  timer = setTimeout(function () { el.remove(); }, sms ? 9000 : 6500);
  return el;
}
RPC.notify = function (n) {
  n = n || {};
  if (!n.title) return null;
  showBanner(n);
  bus.emit('notify', n);
  return null;
};
function deliverSmsMessage(sms) {
  var rec = { id: sms.id || uid('sms'), to: sms.to || '', from: sms.from || 'MVC', body: sms.body || '', code: sms.code, at: sms.at || nowMs() };
  state.sms.push(rec);
  showBanner({ app: 'Mensajes', title: rec.from, body: rec.body });
  bus.emit('sms', state.sms);
  return rec;
}
RPC.deliverSms = function (sms) { deliverSmsMessage(sms || {}); return null; };
RPC.sms = function (m) {
  m = m || {};
  deliverSmsMessage({ to: m.phone || m.to, from: 'MVC', body: m.body || ('Tu código de MVC es ' + m.code + '. Caduca en 10 minutos. No lo compartas con nadie.'), code: m.code });
  return null;
};

/* App «Mensajes» del móvil simulado: bandeja con los SMS recibidos (el código del OTP aparece aquí) */
function openMessages() {
  if (els.msgs) return;
  $$('.v-banner[data-app="sms"]', els.sys).forEach(function (b) { b.remove(); }); /* al abrir Mensajes, sus avisos ya están vistos */
  var list = h('div', { class: 'list' });
  function render() {
    clear(list);
    if (!state.sms.length) { list.appendChild(h('div', { class: 'empty', text: 'No has recibido ningún mensaje todavía. Cuando la app pida un código por SMS, aparecerá aquí.' })); return; }
    state.sms.forEach(function (m) {
      var parts = String(m.body).split(m.code || '\u0000');
      list.appendChild(h('div', { class: 'v-bubble-from', text: m.from + (m.to ? ' → ' + m.to : '') }));
      list.appendChild(h('div', { class: 'v-bubble' }, m.code && parts.length > 1 ? [parts[0], h('b', { text: m.code }), parts.slice(1).join(m.code)] : m.body));
      list.appendChild(h('div', { class: 'v-bubble-meta', text: fmtDateTime(m.at) + ' · SMS simulado' }));
      if (m.code) list.appendChild(h('button', { type: 'button', class: 'cp', text: 'Copiar código ' + m.code, onclick: function () { copyText(m.code).then(function () { stoast('Código copiado'); }, function () { stoast('El navegador no permite copiar'); }); } }));
    });
    list.scrollTop = list.scrollHeight;
  }
  render();
  var off = bus.on('sms', render);
  var close = function () { off(); if (els.msgs) { els.msgs.remove(); els.msgs = null; } els.msgsClose = null; };
  els.msgsClose = close;
  els.msgs = h('div', { class: 'v-full v-msgs', 'data-sb': 'dark', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Mensajes (simulación)' },
    h('header', null, h('button', { type: 'button', text: '‹ Volver', onclick: close }), h('b', { text: 'Mensajes' }), h('span', { style: 'width:52px' })),
    simTag('Simulación de Mensajes: la vista previa no envía ni recibe SMS reales.'),
    list
  );
  els.sys.appendChild(els.msgs);
}
