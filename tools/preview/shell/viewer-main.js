/* ═══════════════ Arranque del visor y API para herramientas ═══════════════ */
(function main() {
  buildChrome();
  buildPanel();
  layout();
  updateStatusBar();
  updateBootOverlay();

  /* La barra de estado y el indicador de inicio se adaptan a la pantalla completa del sistema que haya encima (Ajustes, cámara, Mensajes) */
  new W.MutationObserver(function () {
    var full = els.sys.querySelectorAll('.v-full[data-sb]');
    var tone = full.length ? full[full.length - 1].getAttribute('data-sb') : '';
    els.sb.setAttribute('data-over', tone);
    els.home.setAttribute('data-over', tone);
  }).observe(els.sys, { childList: true });

  var resizeTimer = null;
  W.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 50);
  });

  /* ?route=Nombre&params={json}: al terminar de arrancar la app, salta a esa pantalla */
  var wantedRoute = qv('route');
  if (wantedRoute) {
    var wantedParams = {};
    try { wantedParams = qv('params') ? JSON.parse(qv('params')) : {}; } catch (e) { wantedParams = {}; }
    var offReady = bus.on('ready', function () {
      offReady();
      var opts = { profile: state.profile };
      if (state.seed) opts.seed = state.seed;
      if (state.clock) opts.clock = state.clock;
      callApp('open', [wantedRoute, wantedParams, opts], 40000).catch(function (e) { vtoast('?route=' + wantedRoute + ': ' + errMsg(e), 5200); });
    });
  }

  /* API para Playwright y otras herramientas (el documento de la app expone window.__mvc; el visor, window.__mvcViewer) */
  W.__mvcViewer = {
    version: VERSION,
    state: state,
    devices: DEVICES,
    /** Se resuelve cuando la app ha arrancado (evento «ready» de inner.js). */
    whenReady: function (timeoutMs) {
      return new Promise(function (resolve, reject) {
        if (state.ready) { resolve(state); return; }
        var t = setTimeout(function () { off(); reject(new Error('La app no ha arrancado en ' + Math.round((timeoutMs || 60000) / 1000) + ' s' + (state.bootError ? ': ' + state.bootError : ''))); }, timeoutMs || 60000);
        var off = bus.on('ready', function () { clearTimeout(t); off(); resolve(state); });
      });
    },
    call: callApp,
    open: function (route, params, opts) { return callApp('open', [route, params || {}, opts || {}], 40000); },
    setSim: setSim,
    setClock: setClock,
    setDevice: setDevice,
    setProfile: setProfile,
    setPermission: function (kind, status) { return RPC.setPermission(kind, status); },
    reload: function (opts) { return mountApp(opts); },
    pendingDialogs: pendingDialogs,
    /** Cierra (como «cancelar») el diálogo del sistema que esté abierto. */
    /** Cierra todo lo que el sistema simulado tenga abierto. */
    resetDialogs: resetDialogs,
    dismissDialog: function () { if (modalCurrent && modalCurrent.escape) { modalCurrent.escape(); return true; } return false; },
    sms: function () { return state.sms.slice(); },
    notes: function () { return state.notes.slice(); },
    blocked: function () { return state.blocked.slice(); },
    errors: function () { return state.errors.slice(); },
    frame: function () { return host.frame; }
  };

  mountApp();
})();
