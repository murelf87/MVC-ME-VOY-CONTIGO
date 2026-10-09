/* ═══════════════ Panel de pruebas (340 px a la derecha) ═══════════════
   «Estás en» · «Perfil de prueba» · «Ir a pantalla» · «Simulaciones» · «Correcciones» · «Cómo probarla» */

var CARET = '<svg class="v-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
var panelEls = {};

function segmented(options, value, onChange, label) {
  var box = h('div', { class: 'v-seg', role: 'group', 'aria-label': label || '' });
  options.forEach(function (o) {
    box.appendChild(h('button', { type: 'button', 'aria-pressed': o[0] === value ? 'true' : 'false', text: o[1], onclick: function () { onChange(o[0]); } }));
  });
  return box;
}
function switchEl(on, onChange, label) {
  var sw = h('button', { type: 'button', class: 'v-switch', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label || '', onclick: function () {
    var now = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', now ? 'true' : 'false');
    onChange(now);
  } });
  return sw;
}
function field(label, control, help) {
  return h('div', null, h('span', { class: 'v-lbl', text: label }), control, help ? h('div', { class: 'v-tiny', style: 'margin-top:4px', text: help }) : null);
}

/* ───────────── Diseños que corresponden a la pantalla actual ───────────── */
function designsForRoute(route) {
  if (!route) return [];
  var out = [];
  var viaBridge = null;
  state.bridge.routes.forEach(function (r) { if (r.name === route && r.screen) viaBridge = String(r.screen); });
  DATA.designs.forEach(function (d) {
    if (d.route === route) out.push(d);
    else if (viaBridge && (d.id === viaBridge || d.id.replace(/[a-z]$/, '') === viaBridge.replace(/[a-z]$/, ''))) out.push(d);
  });
  var seen = {};
  return out.filter(function (d) { if (seen[d.id]) return false; seen[d.id] = 1; return true; });
}
function bridgeRoute(name) {
  for (var i = 0; i < state.bridge.routes.length; i++) if (state.bridge.routes[i].name === name) return state.bridge.routes[i];
  return null;
}
function thumbOf(d) {
  var t = DATA.thumbs && DATA.thumbs[d.id];
  return t ? h('div', { class: 'v-thumb', title: 'Diseño ' + d.id + ' · ' + d.title }, h('img', { src: t.uri, alt: 'Diseño ' + d.id + ': ' + d.title }), h('div', { text: 'Diseño ' + d.id })) : null;
}

/* ───────────── «Estás en» ───────────── */
function buildHere(body) {
  var s = state.screen;
  var ds = designsForRoute(s.route);
  var br = s.route ? bridgeRoute(s.route) : null;
  var title = (br && br.title) || (ds[0] && ds[0].title) || '';
  body.appendChild(h('div', { class: 'v-where' },
    h('div', { style: 'flex:1;min-width:0' },
      h('div', { class: 'v-route', text: s.route || (state.booting ? 'Cargando…' : state.ready ? 'Sin nombre de pantalla' : '—') }),
      h('div', { class: 'v-sub', text: title ? title + (ds[0] ? ' · diseño ' + ds.map(function (d) { return d.id; }).join(', ') + ' (lámina ' + ds[0].board + ')' : '') : (s.route ? 'Esta ruta no corresponde a ninguna lámina del diseño.' : 'La app todavía no ha dicho en qué pantalla está.') })
    ),
    ds.length ? thumbOf(ds[0]) : null
  ));
  if (ds.length > 1) body.appendChild(h('div', { class: 'v-thumbs' }, ds.slice(1, 4).map(thumbOf)));
  if (s.params && Object.keys(s.params).length) {
    var det = h('details', null, h('summary', { class: 'v-tiny', text: 'Parámetros de la ruta' }), h('pre', { class: 'v-pre', text: JSON.stringify(s.params, null, 2) }));
    body.appendChild(det);
  }
  var chips = [h('span', { class: 'v-chip accent', text: profileName(state.profile) }), h('span', { class: 'v-chip', text: device().label })];
  if (state.sim.network !== 'wifi') chips.push(h('span', { class: 'v-chip warn', text: state.sim.network === 'none' ? 'Sin Internet' : 'Datos móviles' }));
  if (state.sim.gps !== 'good') chips.push(h('span', { class: 'v-chip warn', text: state.sim.gps === 'off' ? 'GPS apagado' : 'GPS débil' }));
  if (state.blocked.length) chips.push(h('span', { class: 'v-chip bad', title: 'Peticiones a Internet cortadas por el visor', text: state.blocked.length + (state.blocked.length === 1 ? ' petición cortada' : ' peticiones cortadas') }));
  if (state.errors.length) chips.push(h('span', { class: 'v-chip bad', title: state.errors.join('\n'), text: state.errors.length + ' error(es)' }));
  body.appendChild(h('div', { class: 'v-row' }, chips));
  var b = state.bridge;
  if (b.present === true) body.appendChild(h('div', { class: 'v-row' }, h('span', { class: 'v-chip ok', text: 'Puente de pruebas conectado' }), h('span', { class: 'v-tiny', text: b.routes.length + ' rutas' })));
  else if (b.present === false) body.appendChild(h('div', { class: 'v-card' }, h('span', { class: 'v-chip warn', text: 'Puente de pruebas ausente' }), h('div', { class: 'v-help', style: 'margin-top:6px', text: 'La app todavía no expone window.__mvc (lo escribe src/preview/install.ts). Sin él, «Ir a pantalla» no puede saltar a una pantalla: se puede navegar a mano. ' + (b.error || '') })));
  else body.appendChild(h('div', { class: 'v-tiny', text: state.ready ? 'Comprobando el puente de pruebas…' : 'La app está arrancando…' }));
  body.appendChild(h('div', { class: 'v-row' },
    h('button', { type: 'button', class: 'v-btn', text: 'Atrás', onclick: function () { callApp('goBack', [], 6000).catch(function (e) { vtoast('No se puede volver atrás: ' + errMsg(e)); }); } }),
    h('button', { type: 'button', class: 'v-btn', text: 'Reiniciar la app', title: 'Recarga la app conservando los datos', onclick: function () { mountApp(); } })
  ));
}

/* ───────────── «Perfil de prueba» ───────────── */
function buildProfileSection(body) {
  PROFILES.forEach(function (p) {
    body.appendChild(h('button', { type: 'button', class: 'v-radio', 'aria-pressed': p.id === state.profile ? 'true' : 'false', onclick: function () {
      if (p.id === state.profile) return;
      setProfile(p.id, { wipe: true }).then(function () { vtoast('Perfil: ' + p.name + ' (datos de ejemplo reiniciados)'); });
    } }, h('span', { class: 'dot' }), h('span', null, h('b', { text: p.name }), h('span', { text: p.desc }))));
  });
  var seed = h('input', { class: 'v-input', type: 'text', placeholder: 'p. ej. demo', value: state.seed || '', 'aria-label': 'Semilla de datos' });
  body.appendChild(field('Semilla de datos (opcional)', h('div', { class: 'v-row nowrap' }, h('div', { class: 'grow' }, seed), h('button', { type: 'button', class: 'v-btn', text: 'Aplicar', onclick: function () {
    state.seed = seed.value.trim() || null;
    store.set('seed', state.seed);
    setProfile(state.profile, { wipe: true });
  } })), 'La misma semilla reproduce los mismos datos de ejemplo.'));
  body.appendChild(h('div', { class: 'v-row' },
    h('button', { type: 'button', class: 'v-btn danger', text: 'Borrar datos y empezar de cero', onclick: function () { setProfile(state.profile, { wipe: true }).then(function () { vtoast('Datos de ejemplo reiniciados'); }); } })
  ));
  body.appendChild(h('div', { class: 'v-help', text: 'Cambiar de perfil reinicia la app: los datos de la vista previa viven en tu navegador y nunca salen de él.' }));
}

/* ───────────── «Ir a pantalla» ───────────── */
var gotoQuery = '';
function scenarioFor(id) { return DATA.scenarios[id] || DATA.scenarios[id.replace(/[a-z]$/, '')] || null; }
function gotoEntries() {
  var list = [];
  var used = {};
  DATA.designs.forEach(function (d) {
    var sc = scenarioFor(d.id);
    var route = (sc && sc.route) || d.route;
    var br = bridgeRoute(route);
    if (br) used[br.name] = true;
    list.push({ kind: 'design', id: d.id, label: d.id, title: d.title, sub: route + ' · lámina ' + d.board, route: route, scenario: sc, thumb: DATA.thumbs && DATA.thumbs[d.id], enabled: !!(sc || br) });
  });
  state.bridge.routes.forEach(function (r) {
    if (used[r.name]) return;
    var inDesign = DATA.designs.some(function (d) { return d.route === r.name; });
    if (inDesign) return;
    list.push({ kind: 'extra', id: r.name, label: '·', title: r.title || r.name, sub: r.name + (r.slice ? ' · ' + r.slice : ''), route: r.name, scenario: { params: r.params || undefined }, enabled: true });
  });
  return list;
}
function goTo(e) {
  var sc = e.scenario || {};
  var route = sc.route || e.route;
  var profile = sc.profile || state.profile;
  var opts = { profile: profile };
  var seed = sc.seed || state.seed;
  var clock = sc.clock || state.clock;
  if (seed) opts.seed = seed;
  if (clock) opts.clock = clock;
  if (state.bridge.present === false) { vtoast('La app aún no expone window.__mvc.open(): no puedo saltar a ' + route + '.'); return; }
  var br = bridgeRoute(route);
  var params = sc.params || (br && br.params) || {};
  callApp('open', [route, params, opts], 40000).then(function () {
    if (profile !== state.profile) { state.profile = profile; store.set('profile', profile); bus.emit('profile', profile); }
    if (sc.clock && sc.clock !== state.clock) setClock(sc.clock);
    if (state.bleed) { state.drawerOpen = false; layout(); }
  }, function (err) { vtoast('No se ha podido abrir ' + route + ': ' + errMsg(err), 5200); });
}
function buildGoto(body) {
  var listBox = h('div');
  var search = h('input', { class: 'v-input', type: 'search', placeholder: 'Buscar: «11», «Resultados», «TripDetail»…', value: gotoQuery, 'aria-label': 'Buscar pantalla' });
  search.addEventListener('input', function () { gotoQuery = search.value; renderList(); });
  body.appendChild(search);
  body.appendChild(listBox);
  function renderList() {
    clear(listBox);
    var q = gotoQuery.trim().toLowerCase();
    var entries = gotoEntries().filter(function (e) { return !q || (e.id + ' ' + e.title + ' ' + e.sub + ' ' + e.route).toLowerCase().indexOf(q) >= 0; });
    if (!entries.length) { listBox.appendChild(h('div', { class: 'v-help', text: 'Ninguna pantalla coincide.' })); return; }
    var groups = [['design', 'Láminas del diseño'], ['extra', 'Otras pantallas de la app']];
    groups.forEach(function (g) {
      var items = entries.filter(function (e) { return e.kind === g[0]; });
      if (!items.length) return;
      listBox.appendChild(h('div', { class: 'v-group', text: g[1] + ' (' + items.length + ')' }));
      var ul = h('ul', { class: 'v-list' });
      items.forEach(function (e) {
        var why = e.enabled ? '' : (state.bridge.present === false ? 'La app no expone window.__mvc todavía' : 'Aún no hay escenario (design/scenarios/' + e.id + '.json) ni ruta en la app');
        ul.appendChild(h('li', null, h('button', { type: 'button', class: 'v-go', disabled: !e.enabled || state.bridge.present === false, title: why, onclick: function () { goTo(e); } },
          h('span', { class: 'n', text: e.label }),
          e.thumb ? h('img', { src: e.thumb.uri, alt: '' }) : null,
          h('span', { class: 't' }, h('b', { text: e.title }), h('span', { text: e.sub + (e.enabled ? '' : ' · sin escenario') }))
        )));
      });
      listBox.appendChild(ul);
    });
  }
  if (state.bridge.present === false) body.insertBefore(h('div', { class: 'v-card' }, h('span', { class: 'v-chip warn', text: 'Puente de pruebas ausente' }), h('div', { class: 'v-help', style: 'margin-top:6px', text: 'Hasta que la app exponga window.__mvc (src/preview/install.ts), los saltos están desactivados. Puedes navegar a mano dentro del móvil.' })), search);
  renderList();
}

/* ───────────── «Simulaciones» ───────────── */
function buildSim(body) {
  body.appendChild(field('Móvil', (function () {
    var sel = h('select', { class: 'v-select', 'aria-label': 'Móvil simulado', onchange: function () { setDevice(sel.value); } }, DEVICE_ORDER.map(function (id) { return h('option', { value: id, text: DEVICES[id].label + ' · ' + DEVICES[id].width + '×' + DEVICES[id].height }); }));
    sel.value = state.device;
    return sel;
  })()));
  body.appendChild(field('Conexión', segmented([['wifi', 'Wi-Fi'], ['cellular', 'Datos móviles'], ['none', 'Sin Internet']], state.sim.network, function (v) { setSim({ network: v }); renderSection('sim'); }, 'Conexión'), state.sim.network === 'none' ? 'La app recibe «offline»: debe mostrar su estado sin conexión y reintentar al volver.' : null));
  body.appendChild(field('GPS', segmented([['good', 'Bueno'], ['weak', 'Débil'], ['off', 'Apagado']], state.sim.gps, function (v) { setSim({ gps: v }); renderSection('sim'); }, 'GPS')));
  body.appendChild(field('Dónde está el móvil', (function () {
    var sel = h('select', { class: 'v-select', 'aria-label': 'Lugar', onchange: function () { setSim({ place: placeById(sel.value) }); } }, PLACES.map(function (p) { return h('option', { value: p.id, text: p.label }); }));
    sel.value = state.sim.place.id;
    return sel;
  })()));

  /* Permisos */
  var tbl = h('table', { class: 'v-table' });
  PERM_KINDS.forEach(function (k) {
    var sel = h('select', { 'aria-label': PERM_LABEL[k], onchange: function () { RPC.setPermission(k, sel.value); if (sel.value === 'undetermined') { delete state.denies[k]; delete state.permOnce[k]; } } },
      ['undetermined', 'granted', 'denied', 'blocked'].map(function (s) { return h('option', { value: s, text: PERM_STATUS_LABEL[s] }); }));
    sel.value = state.perms[k];
    tbl.appendChild(h('tr', null, h('td', { text: PERM_LABEL[k] }), h('td', null, sel)));
  });
  body.appendChild(field('Permisos del sistema', tbl, 'Si está «Sin preguntar», la app muestra el diálogo del sistema. «Bloqueado» obliga a pasar por Ajustes.'));
  body.appendChild(h('div', { class: 'v-row nowrap' }, h('span', { class: 'grow', text: 'Responder «Permitir» solo (pruebas automáticas)' }), switchEl(state.autoperm, function (v) { state.autoperm = v; }, 'Responder Permitir solo')));
  body.appendChild(h('div', { class: 'v-row' }, h('button', { type: 'button', class: 'v-btn', text: 'Restablecer permisos', onclick: function () {
    PERM_KINDS.forEach(function (k) { setPerm(k, 'undetermined'); });
    state.denies = {}; state.permOnce = {};
    renderSection('sim');
    vtoast('Permisos restablecidos: la app volverá a preguntar');
  } })));

  /* Reloj */
  var clockInput = h('input', { class: 'v-input', type: 'datetime-local', value: state.clock ? isoToMadridLocal(state.clock) : '', 'aria-label': 'Fecha y hora simuladas (Madrid)' });
  body.appendChild(field('Reloj (hora de Madrid)', h('div', null,
    clockInput,
    h('div', { class: 'v-row', style: 'margin-top:6px' },
      h('button', { type: 'button', class: 'v-btn primary', text: 'Aplicar', onclick: function () {
        var iso = madridLocalToIso(clockInput.value);
        if (!iso) { vtoast('Escribe una fecha y hora válidas'); return; }
        setClock(iso); renderSection('sim'); vtoast('Reloj simulado: ' + iso);
      } }),
      h('button', { type: 'button', class: 'v-btn', text: 'Lunes 5 oct 2026 · 07:17', onclick: function () { setClock('2026-10-05T07:17:00+02:00'); renderSection('sim'); } }),
      h('button', { type: 'button', class: 'v-btn', text: 'Hora real', onclick: function () { setClock(null); renderSection('sim'); } })
    )
  ), state.clock ? 'Reloj simulado activo: la app y su backend creen que es esa hora.' : 'Hora real del ordenador.'));

  /* Barra de estado */
  var st = h('input', { class: 'v-input', type: 'text', value: state.sim.statusTime, maxlength: 5, placeholder: '09:41', 'aria-label': 'Hora de la barra de estado' });
  st.addEventListener('change', function () { if (/^\d{1,2}:\d{2}$/.test(st.value)) { state.statusFollowsClock = false; setSim({ statusTime: st.value }); } else { vtoast('Formato HH:mm'); st.value = state.sim.statusTime; } });
  body.appendChild(field('Hora de la barra de estado', st));
  body.appendChild(h('div', { class: 'v-row nowrap' }, h('span', { class: 'grow', text: 'Lector de pantalla (VoiceOver / TalkBack)' }), switchEl(!!state.sim.screenReader, function (v) { setSim({ screenReader: v }); }, 'Lector de pantalla')));

  /* SMS y avisos */
  var smsBox = h('div');
  function renderSms() {
    clear(smsBox);
    if (!state.sms.length) smsBox.appendChild(h('div', { class: 'v-help', text: 'Ningún SMS todavía. Cuando la app pida un código, llegará aquí (y como aviso en el móvil).' }));
    state.sms.slice(-3).reverse().forEach(function (m) {
      smsBox.appendChild(h('div', { class: 'v-sms', style: 'margin-bottom:6px' },
        h('div', { class: 'v-tiny', text: m.from + (m.to ? ' → ' + m.to : '') + ' · ' + fmtDateTime(m.at) }),
        m.code ? h('div', { class: 'code', text: m.code }) : null,
        h('div', { text: m.body }),
        m.code ? h('button', { type: 'button', class: 'v-btn', style: 'margin-top:6px', text: 'Copiar código', onclick: function () { copyText(m.code).then(function () { vtoast('Código copiado'); }, function () { vtoast('El navegador no permite copiar'); }); } }) : null
      ));
    });
  }
  renderSms();
  body.appendChild(field('SMS recibidos (simulados)', smsBox));
  body.appendChild(h('div', { class: 'v-row' },
    h('button', { type: 'button', class: 'v-btn', text: 'Abrir Mensajes en el móvil', onclick: function () { openMessages(); } }),
    h('button', { type: 'button', class: 'v-btn', text: 'SMS de prueba', onclick: function () { var code = String(Math.floor(100000 + Math.random() * 900000)); deliverSmsMessage({ to: '+34 600 000 000', from: 'MVC', body: 'Tu código de MVC es ' + code + '. Caduca en 10 minutos. No lo compartas con nadie.', code: code }); } })
  ));
  body.appendChild(h('div', { class: 'v-row' },
    h('button', { type: 'button', class: 'v-btn', text: 'Notificación de prueba', onclick: function () { RPC.notify({ app: 'MVC', title: 'Tu viaje sale en 30 minutos', body: 'Sevilla Este → Universidad Pablo de Olavide · 07:45', data: { test: true } }); } }),
    h('button', { type: 'button', class: 'v-btn', text: 'Aviso importante', onclick: function () { RPC.notify({ app: 'MVC', title: 'Cambio de ruta', body: 'El conductor ha cambiado el punto de recogida.', tone: 'warning' }); } })
  ));
  panelEls.renderSms = renderSms;

  /* Visor */
  body.appendChild(field('Tema del visor', segmented([['auto', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']], state.theme, function (v) {
    state.theme = v; store.set('theme', v);
    if (v === 'auto') D.documentElement.removeAttribute('data-theme'); else D.documentElement.setAttribute('data-theme', v);
    renderSection('sim');
  }, 'Tema del visor'), 'La app siempre es clara; esto solo cambia el marco y el panel.'));
}

/* ───────────── «Correcciones» ───────────── */
function notesMarkdown() {
  var lines = ['# Correcciones · MVC vista previa', '', 'Generado: ' + new Date().toISOString() + ' · compilación: ' + ((DATA.build && DATA.build.at) || 'desconocida'), ''];
  state.notes.forEach(function (n, i) {
    lines.push((i + 1) + '. [' + n.kind + '] ' + n.text.replace(/\n+/g, ' '));
    lines.push('   - Pantalla: ' + (n.route || 'desconocida') + (n.design ? ' (diseño ' + n.design + ')' : '') + (n.params ? ' · parámetros: ' + JSON.stringify(n.params) : ''));
    lines.push('   - Perfil: ' + profileName(n.profile) + ' · Móvil: ' + n.device + ' · Red: ' + n.network + ' · GPS: ' + n.gps + ' · ' + fmtDateTime(n.at));
  });
  return lines.join('\n');
}
function showText(title, text) {
  var ta = h('textarea', { class: 'v-textarea', style: 'min-height:220px;font-family:var(--mono);font-size:12px', readonly: true, 'aria-label': title });
  ta.value = text;
  var m = h('div', { class: 'v-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onclick: function (ev) { if (ev.target === m) m.remove(); } },
    h('div', null, h('h3', { text: title }), ta, h('div', { class: 'v-row', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'v-btn primary', text: 'Cerrar', onclick: function () { m.remove(); } }))));
  D.body.appendChild(m);
  ta.focus();
  ta.select();
}
function buildNotes(body) {
  var text = h('textarea', { class: 'v-textarea', placeholder: 'Qué hay que corregir en esta pantalla…', 'aria-label': 'Qué hay que corregir' });
  var kind = h('select', { class: 'v-select', 'aria-label': 'Tipo de corrección' }, ['Diseño', 'Texto', 'Funcionamiento', 'Otro'].map(function (k) { return h('option', { value: k, text: k }); }));
  var ds = designsForRoute(state.screen.route);
  body.appendChild(h('div', { class: 'v-tiny', text: 'Se anotará con la pantalla actual: ' + (state.screen.route || 'desconocida') + (ds[0] ? ' (diseño ' + ds[0].id + ')' : '') + ', el perfil y el móvil.' }));
  body.appendChild(text);
  body.appendChild(h('div', { class: 'v-row nowrap' }, h('div', { class: 'grow' }, kind), h('button', { type: 'button', class: 'v-btn primary', text: 'Añadir', onclick: function () {
    var t = text.value.trim();
    if (!t) { vtoast('Escribe qué hay que corregir'); text.focus(); return; }
    state.notes.push({ id: uid('n'), at: Date.now(), kind: kind.value, text: t, route: state.screen.route, params: state.screen.params, design: ds[0] ? ds[0].id : null, profile: state.profile, device: device().label, network: state.sim.network, gps: state.sim.gps });
    store.set('notes', state.notes);
    bus.emit('notes');
    vtoast('Corrección anotada');
  } })));
  var list = h('div');
  state.notes.slice().reverse().forEach(function (n) {
    list.appendChild(h('div', { class: 'v-note', style: 'margin-bottom:8px' },
      h('div', { class: 'v-note-h' }, h('span', { class: 'v-chip accent', text: n.kind }), n.route ? h('span', { class: 'v-chip', text: n.route }) : null, n.design ? h('span', { class: 'v-chip', text: 'diseño ' + n.design }) : null,
        h('button', { type: 'button', class: 'x', 'aria-label': 'Borrar corrección', text: '×', onclick: function () { state.notes = state.notes.filter(function (x) { return x.id !== n.id; }); store.set('notes', state.notes); bus.emit('notes'); } })),
      h('div', { text: n.text }),
      h('div', { class: 'meta', text: profileName(n.profile) + ' · ' + n.device + ' · ' + fmtDateTime(n.at) })
    ));
  });
  if (!state.notes.length) list.appendChild(h('div', { class: 'v-help', text: 'Todavía no hay correcciones. Anota lo que veas mal y copia la lista para enviarla.' }));
  body.appendChild(list);
  if (state.notes.length) {
    body.appendChild(h('div', { class: 'v-row' },
      h('button', { type: 'button', class: 'v-btn', text: 'Copiar todas', onclick: function () {
        var md = notesMarkdown();
        copyText(md).then(function () { vtoast(state.notes.length === 1 ? 'Copiada 1 corrección' : 'Copiadas ' + state.notes.length + ' correcciones'); }, function () { showText('Correcciones (copia el texto)', md); });
      } }),
      h('button', { type: 'button', class: 'v-btn', text: 'Ver texto', onclick: function () { showText('Correcciones', notesMarkdown()); } }),
      h('button', { type: 'button', class: 'v-btn', text: 'Descargar .md', onclick: function () { RPC.saveFile({ baseName: 'correcciones-mvc', ext: 'md', data: notesMarkdown() }).then(function (r) { if (r === 'failed') showText('Correcciones (copia el texto)', notesMarkdown()); }); } }),
      h('button', { type: 'button', class: 'v-btn danger', text: 'Borrar todas', onclick: function () { state.notes = []; store.set('notes', []); bus.emit('notes'); } })
    ));
  }
  body.appendChild(h('div', { class: 'v-help', text: 'Las correcciones se guardan solo en este navegador.' }));
}

/* ───────────── «Cómo probarla» ───────────── */
function buildHow(body) {
  body.appendChild(h('ol', { class: 'v-steps' },
    h('li', null, h('b', { text: 'Elige un perfil. ' }), 'Persona nueva empieza en Bienvenida; Pasajero, Conductor y Administración ya tienen sesión y datos de Sevilla.'),
    h('li', null, h('b', { text: 'Usa la app como en un móvil. ' }), 'Pulsa, desliza y escribe dentro del móvil. «Atrás» del panel equivale al gesto de volver.'),
    h('li', null, h('b', { text: 'Salta con «Ir a pantalla». ' }), 'Abre directamente cualquier pantalla del diseño con los datos del escenario (perfil, hora y parámetros incluidos).'),
    h('li', null, h('b', { text: 'Fuerza situaciones difíciles en «Simulaciones». ' }), 'Sin Internet, GPS apagado, permisos denegados o bloqueados, otra hora del día.'),
    h('li', null, h('b', { text: 'Anota lo que veas mal en «Correcciones». ' }), 'Guarda la pantalla, el perfil y el móvil; copia la lista cuando termines.')
  ));
  body.appendChild(h('div', { class: 'v-lbl', text: 'Qué es real y qué es simulado' }));
  body.appendChild(h('div', { class: 'v-card' },
    h('div', { class: 'v-help' }, h('b', { text: 'Real: ' }), 'es la misma app (React Native + Expo) compilada para web, con su navegación, sus pantallas y su validación de formularios.'),
    h('div', { class: 'v-help', style: 'margin-top:6px' }, h('b', { text: 'Simulado y etiquetado: ' }), 'el servidor (un backend en memoria con datos de ejemplo de Sevilla), los SMS, los permisos, la cámara y la galería, compartir, Apple Pay y Google Pay (no se cobra nada), la biometría y los avisos.'),
    h('div', { class: 'v-help', style: 'margin-top:6px' }, h('b', { text: 'Sin nube: ' }), 'el visor corta cualquier petición a Internet. Nada sale de tu navegador y lo que hagas se guarda solo aquí.')
  ));
  body.appendChild(h('div', { class: 'v-lbl', text: 'Límites conocidos' }));
  body.appendChild(h('ul', { class: 'v-steps', style: 'list-style:disc' },
    h('li', { text: 'Un navegador no es un móvil: los hápticos, la ubicación real, el GPS en segundo plano y las notificaciones push no se pueden probar aquí.' }),
    h('li', { text: 'El mapa es un dibujo propio de la provincia de Sevilla, sin teselas en línea.' }),
    h('li', { text: 'Los importes que no define la tarifa se muestran como «Por definir»; los ilustrativos van marcados como «ilustrativo».' }),
    h('li', { text: 'Las fotos y los documentos son de ejemplo (rotulados) salvo que elijas un archivo propio del ordenador.' }),
    h('li', { text: 'El teclado del móvil no se simula: en los campos de texto escribes con el teclado del ordenador, y la pantalla no se encoge como lo haría con el teclado real.' }),
    h('li', { text: 'Está probado en Chrome (Chromium). Safari 16.4 o superior y Firefox deberían funcionar, pero no se han probado.' })
  ));
  var b = DATA.build || {};
  body.appendChild(h('div', { class: 'v-lbl', text: 'Esta compilación' }));
  body.appendChild(h('dl', { class: 'v-kv' },
    h('dt', { text: 'Generada' }), h('dd', { text: b.at ? fmtDateTime(Date.parse(b.at)) : '—' }),
    h('dt', { text: 'App' }), h('dd', { text: (b.app || '?') + ' · Expo ' + (b.expo || '?') + ' · RN ' + (b.reactNative || '?') }),
    h('dt', { text: 'Bundle' }), h('dd', { text: b.appBytes ? (b.appBytes / 1024 / 1024).toFixed(2) + ' MB de JavaScript' : '—' }),
    h('dt', { text: 'Diseños' }), h('dd', { text: DATA.designs.length + ' pantallas · ' + Object.keys(DATA.scenarios).length + ' escenarios' }),
    h('dt', { text: 'Atajo' }), h('dd', { text: '?chrome=0 muestra solo la app; ?profile=driver, ?device=pixel8, ?perm=granted' })
  ));
}

/* ───────────── Montaje del panel ───────────── */
var SECTIONS = [
  { id: 'here', title: 'Estás en', build: buildHere },
  { id: 'profile', title: 'Perfil de prueba', build: buildProfileSection },
  { id: 'goto', title: 'Ir a pantalla', build: buildGoto },
  { id: 'sim', title: 'Simulaciones', build: buildSim },
  { id: 'notes', title: 'Correcciones', build: buildNotes },
  { id: 'how', title: 'Cómo probarla', build: buildHow }
];
var sectionEls = {};

function renderSection(id) {
  var sec = sectionEls[id];
  if (!sec || !state.sections[id]) return;
  var body = sec.body;
  var scroll = body.scrollTop;
  clear(body);
  try { SECTIONS.filter(function (s) { return s.id === id; })[0].build(body); } catch (e) { body.appendChild(h('div', { class: 'v-help', text: 'Error en el panel: ' + errMsg(e) })); if (W.console) console.error(e); }
  body.scrollTop = scroll;
  var badge = $('.v-badge', sec.head);
  if (badge) {
    var n = id === 'notes' ? state.notes.length : 0;
    badge.textContent = String(n);
    badge.hidden = !n;
  }
}
function toggleSection(id, open) {
  var sec = sectionEls[id];
  if (open === undefined) open = !state.sections[id];
  /* acordeón: solo una abierta a la vez, salvo «Estás en» */
  if (open && id !== 'here') SECTIONS.forEach(function (s) { if (s.id !== 'here' && s.id !== id) { state.sections[s.id] = false; sectionEls[s.id].el.setAttribute('data-open', '0'); sectionEls[s.id].head.setAttribute('aria-expanded', 'false'); } });
  state.sections[id] = !!open;
  store.set('sections', state.sections);
  sec.el.setAttribute('data-open', open ? '1' : '0');
  sec.head.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) renderSection(id);
}

function buildPanel() {
  var panel = $('#v-panel');
  clear(panel);
  var themeBtn = h('button', { type: 'button', class: 'v-iconbtn', 'aria-label': 'Cambiar el tema del visor', title: 'Tema del visor: ' + state.theme, onclick: function () {
    var order = ['auto', 'light', 'dark'];
    state.theme = order[(order.indexOf(state.theme) + 1) % 3];
    store.set('theme', state.theme);
    if (state.theme === 'auto') D.documentElement.removeAttribute('data-theme'); else D.documentElement.setAttribute('data-theme', state.theme);
    themeBtn.title = 'Tema del visor: ' + state.theme;
    vtoast('Tema del visor: ' + ({ auto: 'según el sistema', light: 'claro', dark: 'oscuro' })[state.theme]);
  } }, svgEl('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8"/></svg>'));
  var closeBtn = h('button', { type: 'button', class: 'v-iconbtn', 'aria-label': 'Ocultar el panel', title: 'Ocultar el panel', onclick: function () { setPanel(false); } }, svgEl('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>'));
  panel.appendChild(h('div', { class: 'v-ph' },
    ASSETS.wordLogo ? h('img', { class: 'v-logo', src: ASSETS.wordLogo, alt: 'MVC · Me voy contigo' }) : h('b', { text: 'MVC' }),
    h('div', { class: 'v-ph-t' }, h('b', { text: 'Vista previa interactiva' }), h('span', { text: 'La app real · datos de ejemplo · sin nube' })),
    themeBtn, closeBtn
  ));
  SECTIONS.forEach(function (s) {
    var head = h('button', { type: 'button', class: 'v-sec-h', 'aria-expanded': state.sections[s.id] ? 'true' : 'false', onclick: function () { toggleSection(s.id); } }, h('span', { text: s.title }), h('span', { class: 'v-badge', hidden: true, text: '0' }), svgEl(CARET));
    var bodyEl = h('div', { class: 'v-sec-b' });
    var el = h('section', { class: 'v-sec', 'data-open': state.sections[s.id] ? '1' : '0', 'aria-label': s.title }, head, bodyEl);
    sectionEls[s.id] = { el: el, head: head, body: bodyEl };
    panel.appendChild(el);
  });
  var handle = h('button', { type: 'button', class: 'v-handle', 'aria-label': 'Abrir el panel de pruebas', text: 'PANEL', onclick: function () { setPanel(true); } });
  $('#v-root').appendChild(handle);
  SECTIONS.forEach(function (s) { renderSection(s.id); });
}
function setPanel(open) {
  if (state.bleed) state.drawerOpen = !!open;
  else { state.panelOpen = !!open; store.set('panelOpen', state.panelOpen); }
  layout();
}

/* Los apartados se refrescan cuando cambia lo que muestran */
bus.on('screen', function () { renderSection('here'); renderSection('notes'); });
bus.on('boot', function () { renderSection('here'); renderSection('goto'); });
bus.on('ready', function () { renderSection('here'); renderSection('goto'); });
bus.on('bridge', function () { renderSection('here'); renderSection('goto'); });
bus.on('profile', function () { renderSection('profile'); renderSection('here'); });
bus.on('device', function () { renderSection('here'); });
bus.on('blocked', function () { renderSection('here'); });
bus.on('error', function () { renderSection('here'); });
bus.on('notes', function () { renderSection('notes'); });
bus.on('perm', function () { if (state.sections.sim && !$('select:focus', sectionEls.sim.body)) renderSection('sim'); });
bus.on('sms', function () { if (panelEls.renderSms && state.sections.sim) panelEls.renderSms(); });
bus.on('sim', function () { renderSection('here'); });
