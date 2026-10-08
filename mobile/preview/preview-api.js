/* Vista previa de MVC: backend de ejemplo en memoria dentro del navegador.
   Solo se usa en la vista previa (npm run preview:build). La app real nunca carga este archivo. */
(function () {
  var BASE = "https://preview.mvc.invalid";
  var realFetch = window.fetch.bind(window);
  var uid = function () { return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); }); };
  var now = function () { return new Date().toISOString(); };
  var inMin = function (m) { return new Date(Date.now() + m * 60000).toISOString(); };

  var PROV = [
    { id: "p-41", code: "41", name: "Sevilla" }, { id: "p-11", code: "11", name: "Cádiz" },
    { id: "p-14", code: "14", name: "Córdoba" }, { id: "p-21", code: "21", name: "Huelva" }, { id: "p-29", code: "29", name: "Málaga" }
  ].map(function (p) { return Object.assign(p, { sourceName: "Vista previa (datos de ejemplo)" }); });
  var PLACES = [
    ["Sevilla, Plaza Nueva", 37.38863, -5.99534], ["Sevilla, Estación de Santa Justa", 37.39176, -5.97556],
    ["Sevilla, Hospital Virgen del Rocío", 37.3613, -5.98014], ["Sevilla, Universidad Pablo de Olavide", 37.35532, -5.93836],
    ["Palomares del Río", 37.32176, -6.05589], ["Dos Hermanas", 37.28287, -5.92088], ["Alcalá de Guadaíra", 37.33791, -5.83951],
    ["Mairena del Aljarafe", 37.34461, -6.06313], ["Coria del Río", 37.28788, -6.05407], ["Utrera", 37.18516, -5.78093],
    ["Carmona", 37.47125, -5.64618], ["Écija", 37.54193, -5.08262], ["Osuna", 37.23768, -5.10368], ["Lebrija", 36.9207, -6.07513]
  ].map(function (p) { return { provider: "preview", placeId: "pv:" + p[0], formattedAddress: p[0] + " (Sevilla)", location: { latitude: p[1], longitude: p[2] }, types: ["locality"] }; });
  var place = function (name) { return PLACES.find(function (p) { return p.formattedAddress.indexOf(name) === 0; }); };
  var norm = function (s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); };
  var dist = function (a, b) {
    var r = 6371000, t = Math.PI / 180, dLa = (b.latitude - a.latitude) * t, dLo = (b.longitude - a.longitude) * t;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.latitude * t) * Math.cos(b.latitude * t) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * r * Math.asin(Math.sqrt(h));
  };

  // ---- estado ----
  var users = {
    ana: { id: "u-ana", email: "ana@ejemplo.es", display_name: "Ana", roles: ["driver", "passenger"] },
    luis: { id: "u-luis", email: "luis@ejemplo.es", display_name: "Luis", roles: ["passenger"] }
  };
  var me = null, token = null, accounts = {}, codes = {}, demoReady = false;
  var vehicles = [];
  var trips = [];
  var requests = [];
  var messages = [];
  var notices = [];
  var reports = [];
  var blocks = [];
  var auditLog = [];
  // Sin tarifa aprobada no se muestra ningún precio: la administración la crea y la aprueba.
  var tariffs = [];
  // Conditions: the preview starts with none, like a fresh install; the team publishes its own text.
  var legalDocs = [], legalAccepted = {};
  function legalPending() { return legalDocs.filter(function (d) { return d.status === "published" && !legalAccepted[d.id]; }); }
  function legalView(d) { return { id: d.id, kind: d.kind, version: d.version, title: d.title, body: d.body, published_at: d.published_at }; }
  var routeChanges = [];
  var payouts = [];
  // Ganancias de ejemplo con la misma regla que el libro contable: pendiente hasta terminar el viaje con el pasajero a bordo.
  function earnings(uid2) {
    var pending = 0, available = 0, inTransit = 0;
    requests.forEach(function (r) {
      var t = tripById(r.trip_id); if (!t || t.driver.id !== uid2 || !r.quote_driver_net_cents) return;
      if (r.booking_status === "confirmed") pending += r.quote_driver_net_cents;
      if (r.booking_status === "completed") available += r.quote_driver_net_cents;
    });
    payouts.forEach(function (p) { if (p.driver_user_id === uid2) { available -= p.amount_cents; if (p.status === "pending_provider") inTransit += p.amount_cents; } });
    return { pendingCents: pending, availableCents: Math.max(0, available), inTransitCents: inTransit };
  }
  var users_marta = { id: "u-marta", display_name: "Marta" };
  // Distancia de un punto a la recta de un viaje (aprox. plana, suficiente para la vista previa) y posición relativa.
  function offRoute(t, p) {
    var k = 111320, cos = Math.cos(t.origin.latitude * Math.PI / 180);
    var ax = t.origin.longitude * k * cos, ay = t.origin.latitude * k, bx = t.destination.longitude * k * cos, by = t.destination.latitude * k;
    var px = p.longitude * k * cos, py = p.latitude * k, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    var f = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
    return { m: Math.round(Math.hypot(px - ax - f * dx, py - ay - f * dy)), f: f };
  }
  function approvedTariff() { return tariffs.find(function (t) { return t.status === "approved"; }) || null; }
  function halfUp(n, d) { return Math.floor((n * 2 + d) / (2 * d)); }
  function quoteFor(meters) {
    var t = approvedTariff(); if (!t) return null;
    var c = halfUp(meters * t.rate_micros_per_km, 10000000);
    if (t.shared_cost_cap_cents != null) c = Math.min(c, t.shared_cost_cap_cents);
    var pc = halfUp(c * t.passenger_commission_bps, 10000);
    return { tariffVersion: t.version, contributionCents: c, passengerCommissionCents: pc, passengerTotalCents: c + pc };
  }
  var extraUsers = [
    { id: "u-marta", display_name: "Marta", email: "marta@ejemplo.es", status: "active", roles: ["passenger"], identity_status: "pending", public_photo_status: "approved", rating: 4.9, reports_against: 0 },
    { id: "u-pedro", display_name: "Pedro", email: "pedro@ejemplo.es", status: "active", roles: ["driver", "passenger"], identity_status: "verified", public_photo_status: "approved", rating: 4.2, reports_against: 1 }
  ];
  var pendingVehicles = [{ id: uid(), make: "Renault", model: "Clio", plate: "1234 KLM", passenger_seats: 4, review_status: "pending", documentation_status: "pending", vehicle_photo_status: "pending", insurance_status: "pending", driver_user_id: "u-pedro", driver_display_name: "Pedro", created_at: inMin(-120) }];
  function log(action, type) { auditLog.unshift({ id: auditLog.length + 1, action: action, entity_type: type, entity_id: uid(), metadata: {}, created_at: now(), actor_user_id: me ? me.id : null, actor_display_name: me ? me.display_name : null }); }

  function mkTrip(driver, from, to, minutes, seats, status) {
    var o = place(from).location, d = place(to).location, m = Math.round(dist(o, d) * 1.3);
    var t = { id: uid(), driver: driver, province_id: "p-41", origin: o, destination: d, originName: from, destinationName: to,
      status: status || "published", departure_at: inMin(minutes), category: "work", offered_seats: seats, flexibility_minutes: 0, max_detour_m: 0,
      route_distance_m: m, route_duration_s: Math.round(m / 19.4), started_at: null, pos: 0 };
    trips.push(t); return t;
  }
  var series = {};
  function repeatTrip(t, weekdays, weeks) {
    var sid = "s-" + uid(); series[sid] = { id: sid, weekdays: weekdays.slice().sort(), template: t.id };
    t.series_id = sid; t.series_weekdays = series[sid].weekdays;
    var base = new Date(t.departure_at), made = [];
    for (var i = 1; i <= weeks * 7; i++) {
      var d = new Date(base.getTime() + i * 86400000), dow = (d.getDay() + 6) % 7 + 1;
      if (weekdays.indexOf(dow) < 0) continue;
      var o = Object.assign({}, t, { id: uid(), departure_at: d.toISOString(), status: "published", pos: 0, started_at: null, driverPos: null });
      trips.push(o); made.push(o);
    }
    return made;
  }
  var anaDaily = mkTrip(users.ana, "Dos Hermanas", "Sevilla, Estación de Santa Justa", 45, 3);
  repeatTrip(anaDaily, [1, 2, 3, 4, 5], 2);
  mkTrip(users.ana, "Palomares del Río", "Sevilla, Plaza Nueva", 24 * 60 + 30, 2);
  mkTrip(users.ana, "Alcalá de Guadaíra", "Sevilla, Universidad Pablo de Olavide", 26 * 60, 3);
  var users_pedro = { id: "u-pedro", display_name: "Pedro" };
  var pedroTrip = mkTrip(users_pedro, "Utrera", "Sevilla, Plaza Nueva", 70, 3);
  pedroTrip.max_detour_m = 15000; pedroTrip.flexibility_minutes = 10;

  // ---- utilidades ----
  function banner(text) {
    var el = document.getElementById("pv-banner");
    if (!el) {
      el = document.createElement("div"); el.id = "pv-banner";
      el.style.cssText = "position:fixed;left:12px;right:12px;bottom:74px;z-index:99999;background:#08255C;color:#fff;font:600 13px system-ui,sans-serif;padding:10px 12px;border-radius:12px;box-shadow:0 10px 24px rgba(0,0,0,.25);transition:opacity .3s;pointer-events:none";
      document.body.appendChild(el);
    }
    el.textContent = text; el.style.opacity = "1";
    clearTimeout(el._t); el._t = setTimeout(function () { el.style.opacity = "0"; }, 9000);
  }
  function maskEmail(e) { if (!e) return null; var p = e.split("@"); return p[0].slice(0, 2) + "•".repeat(Math.max(1, p[0].length - 2)) + "@" + p[1]; }
  function json(status, body) { return new Response(body === undefined ? null : JSON.stringify(body), { status: status, headers: { "content-type": "application/json" } }); }
  function err(status, code, message) { return json(status, { error: { code: code, message: message } }); }
  function profile(u) {
    return { id: u.id, email: u.email, email_verified: !!u.email_verified, status: "active", display_name: u.display_name, public_photo_key: null,
      public_photo_status: "approved", identity_status: "verified", presence_status: null, roles: u.roles };
  }
  function peerName(id) { var all = [users.ana, users.luis, users_marta, me].filter(Boolean); var u = all.find(function (x) { return x.id === id; }); return u ? u.display_name : null; }
  function tripById(id) { return trips.find(function (t) { return t.id === id; }); }
  function booked(t) { return requests.filter(function (r) { return r.trip_id === t.id && ["accepted", "payment_pending", "confirmed"].indexOf(r.status) >= 0; }).length; }
  function later(ms, fn) { setTimeout(fn, ms); }
  function notice(kind, t, payload, asDriver) {
    if (!me) return;
    notices.unshift({ id: uid(), kind: kind, trip_id: t ? t.id : null, payload: payload || {}, created_at: now(), read_at: null, departure_at: t ? t.departure_at : null, as_driver: !!asDriver });
  }
  function freezeQuote(r) {
    if (r.quote_total_cents != null) return;
    var t = tripById(r.trip_id), qt = t && quoteFor(t.route_distance_m);
    if (qt) { r.quote_total_cents = qt.passengerTotalCents; r.quote_contribution_cents = qt.contributionCents; r.quote_road_distance_m = t.route_distance_m;
      var tf = approvedTariff(); r.quote_driver_net_cents = qt.contributionCents - halfUp(qt.contributionCents * tf.driver_commission_bps, 10000); }
  }
  function say(tripId, from, to, body) { messages.push({ id: uid(), trip_id: tripId, sender_user_id: from, recipient_user_id: to, body: body, created_at: now() }); }

  // El pasajero de ejemplo responde a lo que hace un conductor.
  function luisRequests(t) {
    later(3500, function () {
      if (t.status !== "published") return;
      requests.push({ id: uid(), trip_id: t.id, passenger_user_id: users.luis.id, from_segment_seq: 0, to_segment_seq: 1, status: "pending", requested_at: now(), updated_at: now(), booking_id: null, booking_status: null, picked_up_at: null, code: null });
      notice("ride_request.received", t, { passengerName: "Luis" }, true);
      banner("Luis ha solicitado plaza en tu viaje. Ve a Viajes › Conduzco.");
      if (t.max_detour_m > 0) later(9000, function () {
        if ((t.status !== "published" && t.status !== "active") || t.offered_seats - booked(t) <= 0) return;
        var add = Math.min(t.max_detour_m, 1800), rc = { id: uid(), trip_id: t.id, status: "awaiting_driver", requester: "u-marta",
          added_distance_m: add, added_duration_s: Math.round(add / 9), expires_at: inMin(10), created_at: now(),
          pickup_label: "Rotonda de la Guardia Civil", dropoff_label: null, request_id: null, passenger_display_name: "Marta", answers_pending: 0 };
        routeChanges.push(rc);
        notice("route_change.requested", t, { passengerName: "Marta", addedDistanceM: rc.added_distance_m, addedDurationS: rc.added_duration_s }, true);
        banner("Marta pide que la recojas con un pequeño desvío. Ve a Viajes › Conduzco.");
      });
    });
  }
  // La conductora de ejemplo acepta y el pago de ejemplo se confirma.
  function anaAccepts(r) {
    later(2500, function () {
      if (r.status !== "pending") return;
      r.status = "payment_pending"; r.hold_expires_at = inMin(10); r.updated_at = now(); freezeQuote(r);
      notice("ride_request.accepted", tripById(r.trip_id), { driverName: "Ana" });
      banner("Ana ha aceptado tu solicitud. Plaza retenida mientras se confirma el pago.");
      later(3000, function () {
        if (r.status !== "payment_pending") return;
        notice("booking.confirmed", tripById(r.trip_id), { driverName: "Ana" });
        r.status = "confirmed"; r.booking_id = uid(); r.booking_status = "confirmed"; r.hold_expires_at = null; r.updated_at = now();
        say(r.trip_id, users.ana.id, me.id, "¡Hola! Te recojo en el punto de salida. Llevo un Seat León gris.");
        banner("Reserva confirmada (pago de ejemplo). Ya puedes escribir a Ana.");
        var t = tripById(r.trip_id);
        later(13000, function () {
          if (r.booking_status !== "confirmed" || (t.status !== "published" && t.status !== "active") || routeChanges.some(function (x) { return x.trip_id === t.id; })) return;
          var rc = { id: uid(), trip_id: t.id, status: "awaiting_passengers", requester: "u-marta", added_distance_m: 1400, added_duration_s: 240,
            expires_at: inMin(10), created_at: now(), pickup_label: "Avenida de España", dropoff_label: null, request_id: null,
            passenger_display_name: "Marta", driver_display_name: "Ana", departure_at: t.departure_at, extra_delay_s: 240, decision: "pending", askMe: true };
          routeChanges.push(rc);
          notice("route_change.proposed", t, { proposalId: rc.id, driverName: "Ana", extraDelayS: 240 });
          banner("Ana quiere recoger a Marta por el camino (4 min más). Responde en Viajes › Mis reservas.");
        });
        later(6000, function () {
          if (t.status === "published" && r.booking_status === "confirmed" && new Date(t.departure_at).getTime() - Date.now() < 2 * 3600000) { t.status = "active"; t.started_at = now(); t.timeline = Date.now(); notice("trip.started", t, { driverName: "Ana" }); banner("Ana ha iniciado el viaje y va hacia tu punto. Síguela en Mis reservas › Seguir coche."); }
        });
      });
    });
  }

  // El coche de Ana sale a unos km de tu punto y avanza con el reloj; los demás avanzan a cada consulta.
  function advance(t) {
    if (t.timeline) t.pos = Math.min(1, -0.3 + (Date.now() - t.timeline) / 1000 * 0.006);
    else t.pos = Math.min(1, t.pos + 0.03);
  }
  function location(t, precise) {
    if (t.status !== "active") return null;
    advance(t);
    var lat = t.origin.latitude + (t.destination.latitude - t.origin.latitude) * t.pos;
    var lng = t.origin.longitude + (t.destination.longitude - t.origin.longitude) * t.pos;
    if (t.driverPos) { lat = t.driverPos.latitude; lng = t.driverPos.longitude; }
    var snap = function (v) { return Math.round(v * 100) / 100; };
    return { tripId: t.id, precision: precise ? "precise" : "approximate", latitude: precise ? lat : snap(lat), longitude: precise ? lng : snap(lng),
      recordedAt: now(), receivedAt: now(), stale: false, ageSeconds: 2, accuracyM: precise ? 9 : undefined, speedMps: precise ? 14.2 : undefined };
  }

  function applyMarta(rc, t) {
    rc.status = "applied"; rc.answers_pending = 0;
    t.route_distance_m += rc.added_distance_m; t.route_duration_s += rc.added_duration_s;
    requests.push({ id: uid(), trip_id: t.id, passenger_user_id: "u-marta", from_segment_seq: 1, to_segment_seq: 2, status: "payment_pending", requested_at: now(), updated_at: now(), booking_id: null, booking_status: null, picked_up_at: null });
    notice("route_change.applied", t, { proposalId: rc.id, passengerName: "Marta" }, true);
    log("route_change.applied", "route_change");
  }
  // Hora estimada con la misma regla que el servidor: sin posición reciente no hay hora; aviso de llegada a 2 min o 500 m.
  function eta(t) {
    var base = { status: t ? t.status : "draft", live: false, stale: false, recordedAt: null, ageSeconds: null, passedStopSeq: -1, carFraction: null, stops: [], me: null };
    if (!t || t.status !== "active") return base;
    var mine = requests.find(function (r) { return r.trip_id === t.id && r.passenger_user_id === me.id && r.booking_status === "confirmed"; });
    if (t.timeline) advance(t);
    var pos = t.pos, D = t.route_distance_m, T = t.route_duration_s;
    var res = Object.assign(base, { live: true, recordedAt: now(), ageSeconds: 2, passedStopSeq: pos > 0 ? 0 : -1, carFraction: pos });
    var toEnd = { etaS: Math.round(Math.max(0, 1 - pos) * T), roadDistanceM: Math.round(Math.max(0, 1 - pos) * D) };
    if (t.driver.id === me.id) res.stops = [
      { seq: 0, kind: "origin", label: t.originName || null, latitude: t.origin.latitude, longitude: t.origin.longitude, passed: pos > 0, etaS: pos > 0 ? null : Math.round(-pos * T), roadDistanceM: pos > 0 ? null : Math.round(-pos * D) },
      { seq: 1, kind: "destination", label: t.destinationName || null, latitude: t.destination.latitude, longitude: t.destination.longitude, passed: false, etaS: toEnd.etaS, roadDistanceM: toEnd.roadDistanceM }];
    if (mine) {
      var pe = pos < 0 ? Math.round(-pos * T) : null, pdm = pos < 0 ? Math.round(-pos * D) : null;
      var arriving = !mine.picked_up_at && pe != null && (pe <= 120 || pdm <= 500);
      if (arriving && !mine.arrival_notified) { mine.arrival_notified = true; notice("trip.driver_arriving", t, { driverName: t.driver.display_name, etaS: pe }); banner(t.driver.display_name + " está llegando a tu punto de recogida."); }
      res.me = { pickupStopSeq: 0, dropoffStopSeq: 1, pickedUp: !!mine.picked_up_at, pickupEtaS: mine.picked_up_at ? null : pe, pickupDistanceM: mine.picked_up_at ? null : pdm,
        dropoffEtaS: toEnd.etaS + (pos < 0 ? Math.round(-pos * T) : 0), dropoffDistanceM: toEnd.roadDistanceM + (pos < 0 ? Math.round(-pos * D) : 0), arriving: arriving };
    }
    return res;
  }

  // ---- rutas ----
  async function handle(method, path, q, body) {
    var m;
    if (path === "/health/live") return json(200, { status: "ok" });
    function code6() { return String(Math.floor(100000 + Math.random() * 900000)); }
    function mailCode(to, purpose) {
      var c = code6(); codes[to + "|" + purpose] = c;
      later(600, function () { banner("Correo de ejemplo para " + to + ": tu código " + (purpose === "verify" ? "para confirmar el correo" : "para cambiar la contraseña") + " es " + c); });
    }
    function weak(pw) { return typeof pw !== "string" || pw.length < 10 || /^\d+$/.test(pw) || new Set(pw.split("")).size < 4; }
    function signIn(acc) {
      me = acc.user; token = "preview_" + uid();
      if (!demoReady) {
        demoReady = true;
        reports.push({ id: uid(), trip_id: null, reporter_user_id: users.luis.id, reporter_display_name: "Luis", reported_user_id: "u-pedro", reported_display_name: "Pedro", category: "behaviour", description: "Puso música muy alta y no quiso bajarla aunque se lo pedimos dos veces.", status: "open", created_at: inMin(-90) });
        ["vehicle.created", "ride_request.created", "booking.confirmed", "trip.completed"].forEach(function (a, i) { auditLog.push({ id: 100 - i, action: a, entity_type: a.split(".")[0], entity_id: uid(), metadata: {}, created_at: inMin(-60 * (i + 1)), actor_user_id: "u-luis", actor_display_name: i % 2 ? "Luis" : "Ana" }); });
        var past = mkTrip(users.ana, "Mairena del Aljarafe", "Sevilla, Hospital Virgen del Rocío", -3 * 24 * 60, 3, "completed");
        requests.push({ id: uid(), trip_id: past.id, passenger_user_id: me.id, from_segment_seq: 0, to_segment_seq: 1, status: "confirmed", requested_at: inMin(-5 * 1440), updated_at: inMin(-3 * 1440), booking_id: uid(), booking_status: "completed", picked_up_at: inMin(-3 * 1440), my_rating_score: null });
        notices.push({ id: uid(), kind: "trip.completed", trip_id: past.id, payload: { driverName: "Ana" }, created_at: inMin(-3 * 1440 + 40), read_at: null, departure_at: past.departure_at, as_driver: false });
      }
      return json(200, { token: token, expiresAt: inMin(60 * 24), user: { id: me.id, roles: me.roles, email: me.email, emailVerified: !!me.email_verified } });
    }
    var emailOk = function (e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); };
    if (path === "/v1/auth/register" && method === "POST") {
      var em = (body.email || "").trim().toLowerCase();
      if (!emailOk(em)) return err(400, "INVALID_EMAIL", "Correo no válido");
      if (accounts[em]) return err(409, "EMAIL_ALREADY_REGISTERED", "Ya existe");
      if (weak(body.password)) return err(400, "PASSWORD_TOO_WEAK", "Contraseña débil");
      var rr = (body.roles || ["passenger"]).filter(function (r) { return r === "passenger" || r === "driver"; });
      if (rr.indexOf("passenger") < 0) rr = rr.concat(["passenger"]);
      // The preview account also gets the admin panel so every screen can be tried.
      accounts[em] = { password: body.password, user: { id: uid(), email: em, email_verified: false, display_name: "Tú", roles: rr.concat(["admin"]) } };
      mailCode(em, "verify");
      var res = signIn(accounts[em]); return new Response(res.body, { status: 201, headers: res.headers });
    }
    if (path === "/v1/auth/login" && method === "POST") {
      var acc = accounts[(body.email || "").trim().toLowerCase()];
      if (!acc || acc.password !== body.password) return err(401, "INVALID_CREDENTIALS", "Correo o contraseña incorrectos");
      return signIn(acc);
    }
    if (path === "/v1/auth/password/forgot" && method === "POST") {
      var fe = (body.email || "").trim().toLowerCase();
      if (accounts[fe]) mailCode(fe, "reset");
      return json(202, { accepted: true });
    }
    if (path === "/v1/auth/password/reset" && method === "POST") {
      var re = (body.email || "").trim().toLowerCase(), ra = accounts[re];
      if (!ra || codes[re + "|reset"] !== body.code) return err(401, "AUTH_CODE_INVALID_OR_EXPIRED", "Código incorrecto");
      if (weak(body.newPassword)) return err(400, "PASSWORD_TOO_WEAK", "Contraseña débil");
      delete codes[re + "|reset"]; ra.password = body.newPassword; ra.user.email_verified = true;
      return signIn(ra);
    }
    var auth = function () { return me && token; };
    if (path === "/v1/auth/session") return auth() ? json(200, { user: { id: me.id, roles: me.roles }, session: { id: "s", expiresAt: inMin(1440) } }) : err(401, "AUTH_INVALID_OR_EXPIRED", "Sesión caducada");
    if (path === "/v1/auth/logout") { me = null; token = null; return json(204); }
    if (path === "/v1/auth/email/verify" && method === "POST") {
      if (!auth()) return err(401, "AUTH_INVALID_OR_EXPIRED", "Sesión caducada");
      if (codes[me.email + "|verify"] !== body.code) return err(401, "AUTH_CODE_INVALID_OR_EXPIRED", "Código incorrecto");
      delete codes[me.email + "|verify"]; me.email_verified = true; return json(200, { emailVerified: true });
    }
    if (path === "/v1/auth/email/resend" && method === "POST") {
      if (!auth()) return err(401, "AUTH_INVALID_OR_EXPIRED", "Sesión caducada");
      if (me.email_verified) return json(200, { alreadyVerified: true, sent: false });
      mailCode(me.email, "verify"); return json(200, { alreadyVerified: false, sent: true });
    }
    if (path === "/v1/auth/password/change" && method === "POST") {
      if (!auth()) return err(401, "AUTH_INVALID_OR_EXPIRED", "Sesión caducada");
      var ca = accounts[me.email];
      if (!ca || ca.password !== body.currentPassword) return err(401, "INVALID_CREDENTIALS", "Contraseña actual incorrecta");
      if (weak(body.newPassword)) return err(400, "PASSWORD_TOO_WEAK", "Contraseña débil");
      ca.password = body.newPassword; return json(200, { changed: true });
    }
    if (path === "/v1/provinces") return json(200, { provinces: PROV });
    if (path === "/v1/provinces/resolve") return json(200, { province: PROV[0] });
    if (path === "/v1/live/map") return json(200, { trips: trips.filter(function (t) { return t.status === "active"; }).map(function (t) { var l = location(t, false); return { tripId: t.id, latitude: l.latitude, longitude: l.longitude, recordedAt: l.recordedAt, stale: false, ageSeconds: 2 }; }) });
    if ((m = path.match(/^\/v1\/trips\/([^/]+)\/location$/)) && method === "GET") {
      var tl = tripById(m[1]); if (!tl) return err(404, "TRIP_NOT_FOUND", "Viaje no encontrado");
      var precise = me && (tl.driver.id === me.id || requests.some(function (r) { return r.trip_id === tl.id && r.passenger_user_id === me.id && r.booking_status === "confirmed"; }));
      return json(200, { location: location(tl, precise) });
    }
    if (path === "/v1/trips/search") {
      var o = { latitude: +q.get("originLatitude"), longitude: +q.get("originLongitude") }, d = { latitude: +q.get("destinationLatitude"), longitude: +q.get("destinationLongitude") };
      var found = trips.filter(function (t) { return t.status === "published" && (!me || t.driver.id !== me.id) && dist(o, t.origin) < 8000 && dist(d, t.destination) < 8000; })
        .map(function (t) { return { tripId: t.id, category: t.category, leg: "outbound", departureAt: t.departure_at, fromSegmentSeq: 0, toSegmentSeq: 1,
          pickupDistanceM: Math.round(dist(o, t.origin)), dropoffDistanceM: Math.round(dist(d, t.destination)), roadDistanceM: t.route_distance_m,
          estimatedDurationS: t.route_duration_s, availableSeats: t.offered_seats - booked(t), driverDisplayName: t.driver.display_name, seriesId: t.series_id || null, seriesWeekdays: t.series_weekdays || null, quote: quoteFor(t.route_distance_m), inProgress: false }; })
        .filter(function (t) { return t.availableSeats > 0; });
      return json(200, { trips: found });
    }
    if (path === "/v1/maps/geocode") {
      if (!auth()) return err(401, "AUTH_REQUIRED", "Inicia sesión");
      var qq = norm(q.get("query") || "");
      return json(200, { results: PLACES.filter(function (p) { return norm(p.formattedAddress).indexOf(qq) >= 0; }) });
    }
    if (!auth()) return err(401, "AUTH_REQUIRED", "Inicia sesión");

    if (path === "/me") return json(200, profile(me));
    if (path === "/v1/me/profile" && method === "PATCH") { if (body.displayName) me.display_name = body.displayName; return json(200, profile(me)); }
    if (path === "/v1/me/documents") return json(200, { documents: [] });
    if (path === "/v1/me/vehicles" && method === "GET") return json(200, { vehicles: vehicles });
    if (path === "/v1/me/vehicles" && method === "POST") {
      var v = { id: uid(), make: body.make, model: body.model, plate: String(body.plate || "").toUpperCase(), passenger_seats: body.passengerSeats,
        review_status: "approved", documentation_status: "approved", vehicle_photo_status: "approved", insurance_status: "approved",
        insurance_expires_on: inMin(525600).slice(0, 10) };
      vehicles.push(v);
      banner("Vista previa: el coche queda aprobado al momento. En la app real lo revisa el equipo de MVC.");
      return json(201, v);
    }
    if (path.indexOf("/v1/me/uploads") === 0) return err(503, "PRIVATE_STORAGE_UNAVAILABLE", "La subida de fotos no está disponible en la vista previa.");
    if (path === "/v1/me/trips" && method === "GET") return json(200, { trips: trips.filter(function (t) { return t.driver.id === me.id; }).slice().sort(function (a, b) { return a.departure_at < b.departure_at ? -1 : 1; }) });
    if (path === "/v1/me/trips" && method === "POST") {
      var oo = body.origin, dd = body.destination, mm = Math.round(dist(oo, dd) * 1.3);
      if (mm < 500) return err(400, "ROUTE_TOO_SHORT", "Origen y destino están demasiado cerca.");
      var nt = { id: uid(), driver: me, province_id: body.provinceId, origin: oo, destination: dd, status: "draft", departure_at: body.departureAt,
        category: body.category, offered_seats: body.offeredSeats, route_distance_m: mm, route_duration_s: Math.round(mm / 19.4), pos: 0,
        flexibility_minutes: body.flexibilityMinutes || 0, max_detour_m: body.maxDetourM || 0 };
      trips.push(nt); return json(201, nt);
    }
    if ((m = path.match(/^\/v1\/me\/trips\/([^/]+)\/(publish|start|complete)$/))) {
      var t = tripById(m[1]); if (!t || t.driver.id !== me.id) return err(404, "TRIP_NOT_FOUND", "Viaje no encontrado");
      if (m[2] === "publish") { t.status = "published"; luisRequests(t); return json(204); }
      if (m[2] === "start") { if (t.status !== "published") return err(409, "TRIP_NOT_STARTABLE", "Solo se puede iniciar un viaje publicado."); t.status = "active"; t.started_at = now();
        requests.forEach(function (r) { if (r.trip_id === t.id && r.booking_status === "confirmed" && r.passenger_user_id === users.luis.id) { r.code = String(Math.floor(100000 + Math.random() * 900000)); later(2500, function () { say(t.id, users.luis.id, me.id, "Ya estoy en el punto de recogida. Mi código es " + r.code); banner("Luis te ha escrito con su código de recogida."); }); } });
        return json(200, { id: t.id, status: t.status, started_at: t.started_at }); }
      if (t.status !== "active") return err(409, "TRIP_NOT_COMPLETABLE", "Solo se puede finalizar un viaje en marcha.");
      t.status = "completed";
      requests.forEach(function (r) { if (r.trip_id === t.id && r.booking_status === "confirmed") r.booking_status = r.picked_up_at ? "completed" : "no_show"; });
      return json(200, { id: t.id, status: "completed", completed_at: now() });
    }
    if ((m = path.match(/^\/v1\/trips\/([^/]+)\/requests$/))) {
      var tr = tripById(m[1]); if (!tr) return err(404, "TRIP_NOT_FOUND", "Viaje no encontrado");
      if (method === "GET") return json(200, { requests: requests.filter(function (r) { return r.trip_id === tr.id; }).map(function (r) { return Object.assign({}, r, { passenger_display_name: peerName(r.passenger_user_id), my_rating_score: r.driver_rating || null }); }) });
      if (legalPending().length) return err(409, "LEGAL_ACCEPTANCE_REQUIRED", "Acepta las condiciones vigentes para reservar.");
      if (tr.driver.id === me.id) return err(409, "DRIVER_CANNOT_REQUEST_OWN_TRIP", "No puedes reservar en tu propio viaje.");
      if (requests.some(function (r) { return r.trip_id === tr.id && r.passenger_user_id === me.id; })) return err(409, "REQUEST_ALREADY_EXISTS", "Ya has solicitado plaza en este viaje.");
      var nr = { id: uid(), trip_id: tr.id, passenger_user_id: me.id, from_segment_seq: 0, to_segment_seq: 1, status: "pending", requested_at: now(), updated_at: now(), booking_id: null, booking_status: null, picked_up_at: null };
      requests.push(nr); anaAccepts(nr); return json(201, nr);
    }
    if (path === "/v1/me/account/deletion") {
      var bl = [];
      var openTrips = trips.filter(function (t) { return t.driver.id === me.id && (t.status === "published" || t.status === "active"); }).length;
      if (openTrips) bl.push({ code: "OPEN_TRIPS_AS_DRIVER", count: openTrips });
      var openReq = requests.filter(function (r) { var t = tripById(r.trip_id); return r.passenger_user_id === me.id && ["pending", "accepted", "payment_pending", "confirmed"].indexOf(r.status) >= 0 && t && t.status !== "completed" && t.status !== "cancelled"; }).length;
      if (openReq) bl.push({ code: "OPEN_BOOKINGS", count: openReq });
      var eb = earnings(me.id); if (eb.pendingCents || eb.availableCents || eb.inTransitCents) bl.push({ code: "DRIVER_BALANCE_UNSETTLED", count: 1 });
      // The preview account is the only administrator, so the real server would refuse too.
      bl.push({ code: "LAST_ADMIN", count: 1 });
      return json(200, { canDelete: false, blockers: bl });
    }
    if (path === "/v1/me/account/delete" && method === "POST") return err(409, "ACCOUNT_HAS_OPEN_ACTIVITY", "Todavía no se puede eliminar la cuenta.");
    if (path === "/v1/legal/current") return json(200, { documents: legalDocs.filter(function (d) { return d.status === "published"; }).map(legalView) });
    if (path === "/v1/me/legal") return json(200, { pending: legalPending().map(legalView), accepted: [] });
    if (path === "/v1/me/legal/accept" && method === "POST") {
      var ids = body.documentIds || [];
      if (ids.some(function (id) { var d = legalDocs.find(function (x) { return x.id === id; }); return !d || d.status !== "published"; }))
        return err(409, "LEGAL_DOCUMENT_NOT_CURRENT", "Solo se puede aceptar la versión vigente.");
      ids.forEach(function (id) { legalAccepted[id] = now(); var d = legalDocs.find(function (x) { return x.id === id; }); d.acceptances++; });
      return json(200, { pending: legalPending().map(legalView) });
    }
    if (path === "/v1/cancellation-policy") return json(200, { policy: null });
    if (path === "/v1/me/earnings") return json(200, Object.assign(earnings(me.id), { schedule: "monthly", providerConfigured: false,
      payouts: payouts.filter(function (p) { return p.driver_user_id === me.id; }) }));
    if (path === "/v1/trips/detour-search") {
      var po = { latitude: +q.get("originLatitude"), longitude: +q.get("originLongitude") }, pd = { latitude: +q.get("destinationLatitude"), longitude: +q.get("destinationLongitude") };
      return json(200, { trips: trips.filter(function (t) {
        if (t.status !== "published" || t.driver.id === me.id || !t.max_detour_m) return false;
        var a = offRoute(t, po), b = offRoute(t, pd);
        return a.f < b.f && 2 * (a.m + b.m) <= t.max_detour_m;
      }).map(function (t) { return { tripId: t.id, inProgress: t.status === "active", departureAt: t.departure_at, driverDisplayName: t.driver.display_name,
        maxDetourM: t.max_detour_m, pickupOffRouteM: offRoute(t, po).m, dropoffOffRouteM: offRoute(t, pd).m }; }) });
    }
    if ((m = path.match(/^\/v1\/trips\/([^/]+)\/route-changes$/)) && method === "POST") {
      var dt = tripById(m[1]); if (!dt) return err(404, "TRIP_NOT_FOUND", "Viaje no encontrado");
      if (!dt.max_detour_m) return err(409, "DETOUR_NOT_ALLOWED", "Este conductor no acepta desvíos en este viaje.");
      if (routeChanges.some(function (x) { return x.trip_id === dt.id && x.requester === me.id && (x.status === "awaiting_driver" || x.status === "awaiting_passengers"); })) return err(409, "DUPLICATE_OPEN_ROUTE_CHANGE", "Ya has pedido un desvío a este conductor.");
      var a1 = offRoute(dt, body.pickup), b1 = offRoute(dt, body.dropoff);
      var added = Math.round(2 * (a1.m + b1.m) * 1.3);
      if (added > dt.max_detour_m) return err(422, "DETOUR_TOO_LONG", "El desvío supera el máximo que acepta el conductor.");
      var mrc = { id: uid(), trip_id: dt.id, status: "awaiting_driver", requester: me.id, added_distance_m: added, added_duration_s: Math.round(added / 9),
        expires_at: inMin(10), created_at: now(), pickup_label: body.pickupLabel || null, dropoff_label: body.dropoffLabel || null, request_id: null,
        driver_display_name: dt.driver.display_name, departure_at: dt.departure_at };
      routeChanges.push(mrc);
      later(3500, function () {
        if (mrc.status !== "awaiting_driver") return;
        // Nadie más va en el coche de Pedro: se aplica sin preguntar a otros pasajeros.
        var meters = Math.round(dist(body.pickup, body.dropoff) * 1.3);
        var nr2 = { id: uid(), trip_id: dt.id, passenger_user_id: me.id, from_segment_seq: 1, to_segment_seq: 2, status: "payment_pending", requested_at: now(), updated_at: now(),
          booking_id: null, booking_status: null, picked_up_at: null, hold_expires_at: inMin(10) };
        var qq2 = quoteFor(meters); if (qq2) { nr2.quote_total_cents = qq2.passengerTotalCents; nr2.quote_contribution_cents = qq2.contributionCents; nr2.quote_road_distance_m = meters; }
        requests.push(nr2); mrc.status = "applied"; mrc.request_id = nr2.id;
        dt.route_distance_m += added; dt.route_duration_s += mrc.added_duration_s;
        notice("route_change.applied", dt, { proposalId: mrc.id, requestId: nr2.id, driverName: dt.driver.display_name });
        banner(dt.driver.display_name + " acepta el desvío y te recoge. Plaza retenida mientras se confirma el pago.");
        later(3000, function () { if (nr2.status !== "payment_pending") return; nr2.status = "confirmed"; nr2.booking_id = uid(); nr2.booking_status = "confirmed"; nr2.hold_expires_at = null;
          notice("booking.confirmed", dt, { driverName: dt.driver.display_name }); banner("Reserva confirmada con " + dt.driver.display_name + " (pago de ejemplo)."); });
      });
      return json(201, { id: mrc.id, status: mrc.status, added_distance_m: added, added_duration_s: mrc.added_duration_s, expires_at: mrc.expires_at });
    }
    if (path === "/v1/me/route-changes") return json(200, {
      requested: routeChanges.filter(function (x) { return x.requester === me.id; }),
      toAnswer: routeChanges.filter(function (x) { return x.askMe && x.status === "awaiting_passengers" && x.decision === "pending"; }) });
    if ((m = path.match(/^\/v1\/me\/trips\/([^/]+)\/route-changes$/))) return json(200, { routeChanges: routeChanges.filter(function (x) { return x.trip_id === m[1] && x.requester !== me.id && !x.askMe; }) });
    if ((m = path.match(/^\/v1\/route-changes\/([^/]+)\/(decision|response)$/)) && method === "POST") {
      var rcx = routeChanges.find(function (x) { return x.id === m[1]; }); if (!rcx) return err(404, "ROUTE_CHANGE_NOT_FOUND", "Desvío no encontrado");
      var tx2 = tripById(rcx.trip_id);
      if (m[2] === "decision") {
        if (rcx.status !== "awaiting_driver") return err(409, "ROUTE_CHANGE_NOT_PENDING", "Este desvío ya no espera tu respuesta.");
        if (body.decision === "reject") { rcx.status = "rejected"; log("route_change.rejected", "route_change"); return json(200, { id: rcx.id, status: "rejected" }); }
        var luisOn = requests.some(function (r) { return r.trip_id === tx2.id && r.booking_status === "confirmed"; });
        if (luisOn && rcx.added_duration_s > (tx2.flexibility_minutes || 0) * 60) {
          rcx.status = "awaiting_passengers"; rcx.answers_pending = 1;
          later(4000, function () { if (rcx.status !== "awaiting_passengers") return; applyMarta(rcx, tx2); banner("Luis acepta llegar un poco más tarde. Ruta actualizada: recoges a Marta."); });
          return json(200, { id: rcx.id, status: "awaiting_passengers", passengersAsked: 1 });
        }
        if (tx2.offered_seats - booked(tx2) <= 0) { rcx.status = "expired"; return json(200, { id: rcx.id, status: "expired" }); }
        applyMarta(rcx, tx2);
        return json(200, { id: rcx.id, status: "applied" });
      }
      if (rcx.status !== "awaiting_passengers" || rcx.decision !== "pending") return err(409, "ROUTE_CHANGE_NOT_PENDING", "Este cambio ya no espera tu respuesta.");
      rcx.decision = body.decision === "accept" ? "accepted" : "rejected";
      if (body.decision === "reject") { rcx.status = "rejected"; log("route_change.rejected", "route_change"); return json(200, { id: rcx.id, status: "rejected" }); }
      rcx.status = "applied"; tx2.route_distance_m += rcx.added_distance_m; tx2.route_duration_s += rcx.added_duration_s; log("route_change.applied", "route_change");
      return json(200, { id: rcx.id, status: "applied" });
    }
    if ((m = path.match(/^\/v1\/trips\/([^/]+)\/eta$/))) return json(200, eta(tripById(m[1])));
    if ((m = path.match(/^\/v1\/series\/([^/]+)\/weekly-requests$/)) && method === "POST") {
      var ws = new Date(body.weekStart + "T00:00:00"), we = new Date(ws.getTime() + 7 * 86400000), gid = uid(), results = [];
      trips.filter(function (t) { return t.series_id === m[1] && t.status === "published" && new Date(t.departure_at) >= ws && new Date(t.departure_at) < we && new Date(t.departure_at) > new Date(); })
        .sort(function (a, b) { return a.departure_at < b.departure_at ? -1 : 1; })
        .forEach(function (t) {
          if (requests.some(function (r) { return r.trip_id === t.id && r.passenger_user_id === me.id && ["pending", "accepted", "payment_pending", "confirmed"].indexOf(r.status) >= 0; })) { results.push({ tripId: t.id, departureAt: t.departure_at, status: "skipped", code: "DUPLICATE_OPEN_REQUEST" }); return; }
          if (t.offered_seats - booked(t) <= 0) { results.push({ tripId: t.id, departureAt: t.departure_at, status: "skipped", code: "NO_CAPACITY_ON_SEGMENT" }); return; }
          var wr = { id: uid(), trip_id: t.id, passenger_user_id: me.id, from_segment_seq: 0, to_segment_seq: 1, status: "pending", requested_at: now(), updated_at: now(), booking_id: null, booking_status: null, picked_up_at: null, weekly_group_id: gid };
          requests.push(wr); results.push({ tripId: t.id, departureAt: t.departure_at, status: "requested", requestId: wr.id });
        });
      if (!results.some(function (r) { return r.status === "requested"; })) return err(409, "WEEK_NOT_BOOKABLE", "Esa semana ya está solicitada o sin plazas.", { results: results });
      later(2500, function () {
        var mine2 = requests.filter(function (r) { return r.weekly_group_id === gid && r.status === "pending"; });
        mine2.forEach(function (r) { r.status = "payment_pending"; r.hold_expires_at = inMin(10); });
        banner("Ana ha aceptado tu semana entera (" + mine2.length + " días).");
        notice("ride_request.accepted", tripById(mine2[0].trip_id), { driverName: "Ana" });
        later(3000, function () { mine2.forEach(function (r) { if (r.status === "payment_pending") { r.status = "confirmed"; r.booking_id = uid(); r.booking_status = "confirmed"; r.hold_expires_at = null; } }); notice("booking.confirmed", tripById(mine2[0].trip_id), { driverName: "Ana" }); banner("Semana confirmada (pago de ejemplo)."); });
      });
      return json(201, { weeklyGroupId: gid, results: results });
    }
    if ((m = path.match(/^\/v1\/me\/trips\/([^/]+)\/repeat$/)) && method === "POST") {
      var tt = tripById(m[1]); if (!tt || tt.driver.id !== me.id) return err(404, "TRIP_NOT_FOUND", "Viaje no encontrado");
      if (tt.series_id) return err(409, "TRIP_ALREADY_IN_SERIES", "Este viaje ya se repite.");
      var made = repeatTrip(tt, body.weekdays, 4);
      // Luis pide la primera semana completa al poco.
      later(4000, function () {
        var first = made.filter(function (o) { return new Date(o.departure_at).getTime() - new Date(made[0].departure_at).getTime() < 7 * 86400000; });
        var gid2 = uid();
        first.forEach(function (o) { requests.push({ id: uid(), trip_id: o.id, passenger_user_id: users.luis.id, from_segment_seq: 0, to_segment_seq: 1, status: "pending", requested_at: now(), updated_at: now(), booking_id: null, booking_status: null, picked_up_at: null, weekly_group_id: gid2 }); });
        if (first.length) { notice("ride_request.received", first[0], { passengerName: "Luis" }, true); banner("Luis quiere ir contigo toda la semana (" + first.length + " días). Ve a Viajes › Conduzco."); }
      });
      return json(201, { series: series[tt.series_id], created: made.map(function (o) { return o.id; }), published: made.map(function (o) { return o.id; }), failed: [] });
    }
    if ((m = path.match(/^\/v1\/weekly-groups\/([^/]+)\/decision$/)) && method === "POST") {
      var grp = requests.filter(function (r) { return r.weekly_group_id === m[1] && r.status === "pending"; });
      if (!grp.length) return err(404, "WEEKLY_GROUP_NOT_FOUND", "No hay solicitudes pendientes de esa semana.");
      grp.forEach(function (r) { r.status = body.decision === "accept" ? "payment_pending" : "rejected"; });
      if (body.decision === "accept") later(2500, function () { grp.forEach(function (r) { if (r.status === "payment_pending") { r.status = "confirmed"; r.booking_id = uid(); r.booking_status = "confirmed"; } }); notice("booking.confirmed", tripById(grp[0].trip_id), { passengerName: "Luis" }, true); banner("Luis ha pagado su semana (pago de ejemplo)."); });
      return json(200, { results: grp.map(function (r) { return { requestId: r.id, tripId: r.trip_id, status: body.decision === "accept" ? "accepted" : "rejected" }; }) });
    }
    if (path === "/v1/me/notifications" && method === "GET") {
      var lim = +(q.get("limit") || 50);
      return json(200, { notifications: notices.slice(0, lim), unread: notices.filter(function (n) { return !n.read_at; }).length });
    }
    if (path === "/v1/me/notifications/read" && method === "POST") {
      var marked = 0; notices.forEach(function (n) { if (!n.read_at && (!body.ids || body.ids.indexOf(n.id) >= 0)) { n.read_at = now(); marked++; } });
      return json(200, { marked: marked });
    }
    if ((m = path.match(/^\/v1\/bookings\/([^/]+)\/rating$/)) && method === "POST") {
      var rb = requests.find(function (r) { return r.booking_id === m[1]; }); if (!rb) return err(404, "BOOKING_NOT_FOUND", "Reserva no encontrada");
      var tr0 = tripById(rb.trip_id);
      if (tr0.status !== "completed") return err(409, "RATING_NOT_AVAILABLE", "Podrás valorar cuando termine el viaje.");
      var asDriver = tr0.driver.id === me.id;
      if (asDriver ? rb.driver_rating : rb.my_rating_score) return err(409, "RATING_ALREADY_SUBMITTED", "Ya has valorado este viaje.");
      if (asDriver) rb.driver_rating = body.score; else rb.my_rating_score = body.score;
      return json(201, { id: uid(), booking_id: rb.booking_id, score: body.score, comment: body.comment || null, created_at: now() });
    }
    if ((m = path.match(/^\/v1\/users\/([^/]+)\/rating$/))) return json(200, { userId: m[1], count: 12, average: 4.8 });
    if (path === "/v1/reports" && method === "POST") {
      log("incident_report.created", "incident_report");
      var rep = { id: uid(), reporter_user_id: me.id, reporter_display_name: me.display_name, reported_display_name: peerName(body.reportedUserId), trip_id: body.tripId, reported_user_id: body.reportedUserId || null, category: body.category, description: body.description, status: "open", created_at: now() };
      reports.unshift(rep);
      if (body.blockUser && body.reportedUserId && !blocks.some(function (b) { return b.user_id === body.reportedUserId; })) blocks.unshift({ user_id: body.reportedUserId, display_name: peerName(body.reportedUserId), created_at: now() });
      later(8000, function () { if (rep.status !== "open") return; rep.status = "resolved"; rep.resolution_note = "Hemos hablado con la otra persona y revisado el viaje."; notice("report.closed", tripById(rep.trip_id), { status: "resolved", note: "Hemos hablado con la otra persona y revisado el viaje. Gracias por avisar." }); banner("Soporte ha respondido a tu reporte (respuesta de ejemplo)."); });
      return json(201, rep);
    }
    if (path === "/v1/me/reports") return json(200, { reports: reports });
    if (path === "/v1/me/blocks") return json(200, { blocks: blocks });
    if ((m = path.match(/^\/v1\/me\/blocks\/([^/]+)$/))) {
      if (method === "DELETE") blocks = blocks.filter(function (b) { return b.user_id !== m[1]; });
      else if (!blocks.some(function (b) { return b.user_id === m[1]; })) blocks.unshift({ user_id: m[1], display_name: peerName(m[1]), created_at: now() });
      return json(204);
    }
    if ((m = path.match(/^\/v1\/ride-requests\/([^/]+)\/cancel$/)) && method === "POST") {
      var rc = requests.find(function (r) { return r.id === m[1] && r.passenger_user_id === me.id; }); if (!rc) return err(404, "REQUEST_NOT_FOUND", "Solicitud no encontrada");
      if (rc.picked_up_at && rc.booking_status === "confirmed") return err(409, "CANCEL_AFTER_PICKUP", "Ya vas a bordo; no se puede cancelar.");
      if (["pending", "accepted", "payment_pending", "confirmed"].indexOf(rc.status) < 0) return err(409, "REQUEST_NOT_CANCELLABLE", "Esta solicitud ya no se puede cancelar.");
      var hadBooking = rc.booking_status === "confirmed";
      rc.status = "cancelled"; rc.hold_expires_at = null; rc.updated_at = now();
      if (hadBooking) { rc.booking_status = "cancelled"; rc.refund_status = "pending_policy"; rc.refund_cents = null; }
      return json(200, { requestId: rc.id, status: "cancelled", cancellation: hadBooking ? { refund_status: "pending_policy" } : null });
    }
    if ((m = path.match(/^\/v1\/me\/trips\/([^/]+)\/cancel$/)) && method === "POST") {
      var tcx = tripById(m[1]); if (!tcx || tcx.driver.id !== me.id) return err(404, "TRIP_NOT_FOUND", "Viaje no encontrado");
      if (tcx.status === "active") return err(409, "TRIP_ALREADY_STARTED", "Un viaje en marcha no se cancela; finalízalo.");
      if (["draft", "published"].indexOf(tcx.status) < 0) return err(409, "TRIP_NOT_CANCELLABLE", "Este viaje ya no se puede cancelar.");
      var affected = 0;
      requests.forEach(function (r) { if (r.trip_id === tcx.id && ["pending", "accepted", "payment_pending", "confirmed"].indexOf(r.status) >= 0) { affected++; r.status = "cancelled"; if (r.booking_status === "confirmed") { r.booking_status = "driver_cancelled"; r.refund_status = "pending_policy"; } } });
      tcx.status = "cancelled";
      return json(200, { tripId: tcx.id, status: "cancelled", affectedPassengers: affected, cancellations: [] });
    }
    if (path.indexOf("/v1/admin/") === 0) {
      var openReports = reports.filter(function (r) { return r.status === "open" || r.status === "reviewing"; });
      var refunds = requests.filter(function (r) { return r.refund_status; }).map(function (r) { return { id: r.id, booking_id: r.booking_id, actor: r.booking_status === "driver_cancelled" ? "driver" : "passenger", rule_applied: null, paid_cents: 450, refund_cents: null, retained_cents: null, refund_status: r.refund_status, created_at: r.updated_at, policy_version: null }; });
      var allUsers = [users.ana, users.luis].map(function (u) { return { id: u.id, display_name: u.display_name, email: u.email, status: "active", roles: u.roles, rating: u.id === "u-ana" ? 4.8 : 4.6, reports_against: reports.filter(function (r) { return r.reported_user_id === u.id; }).length }; })
        .concat(extraUsers).concat([{ id: me.id, display_name: me.display_name, email: me.email, status: "active", roles: me.roles, rating: null, reports_against: 0 }]);
      var mask = function (p) { return p.slice(0, 5) + "••••" + p.slice(-3); };
      if (path === "/v1/admin/overview") return json(200, { roles: ["admin"],
        verification: { pendingVehicles: pendingVehicles.length, pendingDocuments: 0, pendingProfiles: extraUsers.filter(function (u) { return u.identity_status === "pending"; }).length },
        support: { openReports: openReports.length, activeTrips: trips.filter(function (t) { return t.status === "active"; }).length, publishedTrips: trips.filter(function (t) { return t.status === "published"; }).length, activeUsers: allUsers.filter(function (u) { return u.status === "active"; }).length },
        finance: { pendingRefunds: refunds.length, pendingCompensations: 0, activePolicyVersion: null, approvedTariffVersion: approvedTariff() ? approvedTariff().version : null },
        integrations: { sms: "dev_console", maps: "dev_local", storage: "disabled", insuranceOcr: "disabled", payments: "disabled", push: "disabled" } });
      if (path === "/v1/admin/verification-queue") return json(200, { vehicles: pendingVehicles, documents: [],
        profiles: extraUsers.filter(function (u) { return u.identity_status === "pending"; }).map(function (u) { return { user_id: u.id, display_name: u.display_name, email: maskEmail(u.email), public_photo_status: u.public_photo_status, identity_status: u.identity_status }; }) });
      if ((m = path.match(/^\/v1\/admin\/users\/([^/]+)\/profile-review$/))) {
        if (body.decision === "rejected" && !(body.reason || "").trim()) return err(400, "REVIEW_REASON_REQUIRED", "Escribe el motivo del rechazo.");
        var pu = extraUsers.find(function (u) { return u.id === m[1]; }); if (pu) pu.identity_status = body.decision === "approved" ? "verified" : "rejected";
        log("profile.reviewed", "user"); return json(200, {});
      }
      if ((m = path.match(/^\/v1\/admin\/vehicles\/([^/]+)\/review$/))) {
        if (body.decision === "rejected" && !(body.reason || "").trim()) return err(400, "REVIEW_REASON_REQUIRED", "Escribe el motivo del rechazo.");
        var pv = pendingVehicles.find(function (v) { return v.id === m[1]; });
        if (pv) { if (body.area === "vehicle") { pv.review_status = body.decision; pv.vehicle_photo_status = body.decision; } else { pv.documentation_status = body.decision; pv.insurance_status = body.decision; } }
        pendingVehicles = pendingVehicles.filter(function (v) { return [v.review_status, v.documentation_status, v.vehicle_photo_status, v.insurance_status].indexOf("pending") >= 0 && v.review_status !== "rejected"; });
        log("vehicle.reviewed", "vehicle"); return json(200, {});
      }
      if (path === "/v1/admin/reports") return json(200, { reports: reports.slice().sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; }) });
      if ((m = path.match(/^\/v1\/admin\/reports\/([^/]+)\/status$/))) {
        var ar = reports.find(function (r) { return r.id === m[1]; }); if (!ar) return err(404, "REPORT_NOT_FOUND", "Incidencia no encontrada");
        if (ar.status === "resolved" || ar.status === "dismissed") return err(409, "REPORT_CLOSED", "Esta incidencia ya está cerrada.");
        if (body.status !== "reviewing" && !(body.note || "").trim()) return err(400, "RESOLUTION_NOTE_REQUIRED", "Para cerrar una incidencia escribe una nota.");
        ar.status = body.status; if (body.note) ar.resolution_note = body.note;
        if (body.status !== "reviewing" && ar.reporter_user_id === me.id) notice("report.closed", null, { status: body.status, note: body.note });
        log("incident_report.status_changed", "incident_report"); return json(200, ar);
      }
      if (path === "/v1/admin/trips") return json(200, { trips: trips.filter(function (t) { return t.status !== "draft"; }).map(function (t) { return { id: t.id, status: t.status, departure_at: t.departure_at, offered_seats: t.offered_seats, driver_display_name: t.driver.display_name, province_name: "Sevilla", requests: requests.filter(function (r) { return r.trip_id === t.id; }).length, bookings: requests.filter(function (r) { return r.trip_id === t.id && (r.booking_status === "confirmed" || r.booking_status === "completed"); }).length }; }) });
      if (path === "/v1/admin/refunds/pending") return json(200, { refunds: refunds });
      if (path === "/v1/admin/cancellation-policies") return json(200, { policies: [] });
      if (path === "/v1/admin/users" && method === "GET") {
        var term = norm(q.get("q") || "");
        return json(200, { users: allUsers.filter(function (u) { return !term || norm(u.display_name || "").indexOf(term) >= 0 || (term.length >= 3 && (u.email || "").indexOf(term) >= 0); }).map(function (u) { return Object.assign({}, u, { email: maskEmail(u.email) }); }) });
      }
      if ((m = path.match(/^\/v1\/admin\/users\/([^/]+)\/status$/))) {
        if (m[1] === me.id) return err(403, "SELF_SUSPEND_FORBIDDEN", "No puedes cambiar el estado de tu propia cuenta.");
        if (!(body.reason || "").trim() || body.reason.trim().length < 3) return err(400, "REASON_REQUIRED", "Escribe el motivo.");
        var su = extraUsers.find(function (u) { return u.id === m[1]; }); if (!su) return err(409, "PREVIEW_ONLY", "En la vista previa solo puedes suspender a Marta o a Pedro.");
        su.status = body.status; log(body.status === "suspended" ? "user.suspended" : "user.reactivated", "user"); return json(200, { id: su.id, status: su.status });
      }
      if (path === "/v1/admin/legal-documents" && method === "GET") return json(200, { documents: legalDocs.slice().sort(function (a, b) { return a.kind.localeCompare(b.kind) || b.version - a.version; }) });
      if (path === "/v1/admin/legal-documents" && method === "POST") {
        if (!(body.title || "").trim() || !(body.body || "").trim()) return err(400, "INVALID_LEGAL_DOCUMENT", "Escribe título y texto.");
        var nl = { id: uid(), kind: body.kind, version: legalDocs.filter(function (d) { return d.kind === body.kind; }).length + 1, title: body.title.trim(), body: body.body.trim(),
          status: "draft", created_at: now(), published_at: null, retired_at: null, acceptances: 0 };
        legalDocs.push(nl); log("legal_document.created", "legal_document"); return json(201, nl);
      }
      if ((m = path.match(/^\/v1\/admin\/legal-documents\/([^/]+)\/publish$/))) {
        var ld = legalDocs.find(function (d) { return d.id === m[1]; }); if (!ld) return err(404, "LEGAL_DOCUMENT_NOT_FOUND", "No encontrado");
        if (ld.status !== "draft") return err(409, "LEGAL_DOCUMENT_NOT_DRAFT", "Solo se puede publicar un borrador.");
        legalDocs.forEach(function (d) { if (d.kind === ld.kind && d.status === "published") { d.status = "retired"; d.retired_at = now(); } });
        ld.status = "published"; ld.published_at = now(); log("legal_document.published", "legal_document"); return json(200, ld);
      }
      if (path === "/v1/admin/tariffs" && method === "GET") return json(200, { tariffs: tariffs.slice().sort(function (a, b) { return b.version - a.version; }) });
      if (path === "/v1/admin/tariffs" && method === "POST") {
        var okInt = function (v, max) { return Number.isInteger(v) && v >= 0 && v <= max; };
        if (!okInt(body.rateMicrosPerKm, 10000000) || !okInt(body.passengerCommissionBps, 10000) || !okInt(body.driverCommissionBps, 10000) || (body.sharedCostCapCents != null && !okInt(body.sharedCostCapCents, 100000000)))
          return err(400, "INVALID_TARIFF", "Revisa los valores de la tarifa.");
        var nt = { id: uid(), version: tariffs.length + 1, status: "draft", rate_micros_per_km: body.rateMicrosPerKm, passenger_commission_bps: body.passengerCommissionBps, driver_commission_bps: body.driverCommissionBps, shared_cost_cap_cents: body.sharedCostCapCents == null ? null : body.sharedCostCapCents, effective_from: null, notes: body.notes || null, created_at: now(), approved_at: null, retired_at: null };
        tariffs.push(nt); log("tariff.created", "tariff"); return json(201, nt);
      }
      if ((m = path.match(/^\/v1\/admin\/tariffs\/([^/]+)\/approve$/))) {
        var at = tariffs.find(function (t) { return t.id === m[1]; }); if (!at) return err(404, "TARIFF_NOT_FOUND", "Tarifa no encontrada");
        if (at.status !== "draft") return err(409, "TARIFF_NOT_DRAFT", "Solo se puede aprobar un borrador.");
        tariffs.forEach(function (t) { if (t.status === "approved") { t.status = "retired"; t.retired_at = now(); } });
        at.status = "approved"; at.approved_at = now(); log("tariff.approved", "tariff"); return json(200, at);
      }
      if (path === "/v1/admin/payments") {
        var captured = requests.filter(function (r) { return (r.booking_status === "confirmed" || r.booking_status === "completed") && r.quote_total_cents; }).reduce(function (a, r) { return a + r.quote_total_cents; }, 0);
        return json(200, { providerConfigured: false, events: [], problems: [], accounts: [], ledgerBalanced: true,
          reconciliation: { providerClearingCents: captured, expectedCents: captured, matches: true, bookingsWithoutCapture: 0 }, disputes: [],
          payouts: payouts.map(function (p) { return Object.assign({}, p, { driver_display_name: me.display_name }); }) });
      }
      if (path === "/v1/admin/payouts/prepare" && method === "POST") {
        var e2 = earnings(me.id), made2 = [];
        if (e2.availableCents > 0 && !payouts.some(function (p) { return p.period_month === body.month + "-01"; })) {
          var po2 = { id: uid(), driver_user_id: me.id, period_month: body.month + "-01", amount_cents: e2.availableCents, status: "pending_provider", failure_reason: null, paid_at: null };
          payouts.push(po2); made2.push(po2); log("payouts.prepared", "payout_period");
        }
        return json(200, { period: body.month + "-01", created: made2 });
      }
      if (path === "/v1/admin/audit") return json(200, { events: auditLog.slice(0, 60) });
      return err(404, "NOT_FOUND", "No disponible en la vista previa");
    }
    if (path === "/v1/me/ride-requests") return json(200, { requests: requests.filter(function (r) { return r.passenger_user_id === me.id; }).map(function (r) {
      var t = tripById(r.trip_id); return Object.assign({}, r, { driver_user_id: t.driver.id, driver_display_name: t.driver.display_name, trip_status: t.status, departure_at: t.departure_at }); }) });
    if ((m = path.match(/^\/v1\/ride-requests\/([^/]+)\/decision$/))) {
      var rq = requests.find(function (r) { return r.id === m[1]; }); if (!rq) return err(404, "REQUEST_NOT_FOUND", "Solicitud no encontrada");
      if (body.decision === "reject") { rq.status = "rejected"; return json(200, rq); }
      rq.status = "payment_pending"; rq.updated_at = now(); freezeQuote(rq);
      later(2500, function () { if (rq.status !== "payment_pending") return; rq.status = "confirmed"; rq.booking_id = uid(); rq.booking_status = "confirmed"; notice("booking.confirmed", tripById(rq.trip_id), { passengerName: "Luis" }, true); say(rq.trip_id, users.luis.id, me.id, "¡Gracias! Pago hecho. Nos vemos en la salida."); banner("Luis ha pagado (pago de ejemplo). Reserva confirmada."); });
      return json(200, rq);
    }
    if ((m = path.match(/^\/v1\/bookings\/([^/]+)\/pickup-(code|verify)$/))) {
      var b = requests.find(function (r) { return r.booking_id === m[1]; }); if (!b) return err(404, "BOOKING_NOT_FOUND", "Reserva no encontrada");
      if (m[2] === "code") { b.code = String(Math.floor(100000 + Math.random() * 900000)); var tb = tripById(b.trip_id);
        // Ana verifica el código cuando el coche llega a tu punto, y termina el viaje un rato después.
        var waitPickup = setInterval(function () {
          if (tb.timeline) advance(tb);
          if (b.picked_up_at || tb.status !== "active") { clearInterval(waitPickup); return; }
          if (!tb.timeline || tb.pos >= 0) {
            clearInterval(waitPickup); b.picked_up_at = now(); banner("Ana ha verificado tu código. ¡Buen viaje!");
            later(16000, function () { if (tb.status === "active") { tb.status = "completed"; b.booking_status = "completed"; notice("trip.completed", tb, { driverName: "Ana" }); banner("Ana ha finalizado el viaje. Ya puedes valorarla en Mis reservas."); } });
          }
        }, 2500);
        return json(200, { bookingId: b.booking_id, code: b.code, generatedAt: now() }); }
      if (body.code !== b.code) return err(400, "PICKUP_CODE_INVALID", "El código no coincide.");
      b.picked_up_at = now(); return json(200, { bookingId: b.booking_id, pickedUpAt: b.picked_up_at, alreadyVerified: false });
    }
    if ((m = path.match(/^\/v1\/trips\/([^/]+)\/chat\/([^/]+)\/messages$/))) {
      var tid = m[1], peer = m[2];
      if (method === "POST") {
        say(tid, me.id, peer, body.body);
        var tc = tripById(tid);
        later(2500, function () { say(tid, peer, me.id, tc && tc.driver.id === peer ? "¡Perfecto! Te aviso cuando esté llegando." : "¡Genial, gracias!"); });
        return json(201, messages[messages.length - 1]);
      }
      return json(200, { messages: messages.filter(function (x) { return x.trip_id === tid && ((x.sender_user_id === me.id && x.recipient_user_id === peer) || (x.sender_user_id === peer && x.recipient_user_id === me.id)); }) });
    }
    if ((m = path.match(/^\/v1\/trips\/([^/]+)\/location$/)) && method === "POST") {
      var tp = tripById(m[1]); if (tp) tp.driverPos = { latitude: body.latitude, longitude: body.longitude }; return json(200, { accepted: true });
    }
    return err(404, "NOT_FOUND", "No disponible en la vista previa");
  }

  window.fetch = async function (input, init) {
    var url = typeof input === "string" ? input : input.url;
    if (url.indexOf(BASE) !== 0) return realFetch(input, init);
    var u = new URL(url), method = (init && init.method) || "GET", body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
    await new Promise(function (r) { setTimeout(r, 180); });
    return handle(method, u.pathname, u.searchParams, body);
  };

  // GPS de ejemplo para el conductor (el navegador de la vista previa no da ubicación).
  try {
    var fake = { latitude: 37.30, longitude: -5.95 };
    var geo = {
      getCurrentPosition: function (ok) { ok({ coords: Object.assign({ accuracy: 10, speed: 13, altitude: null, altitudeAccuracy: null, heading: null }, fake), timestamp: Date.now() }); },
      watchPosition: function (ok) { var id = setInterval(function () { fake.latitude += 0.004; fake.longitude -= 0.002; geo.getCurrentPosition(ok); }, 4000); geo.getCurrentPosition(ok); return id; },
      clearWatch: function (id) { clearInterval(id); }
    };
    Object.defineProperty(navigator, "geolocation", { value: geo, configurable: true });
    if (navigator.permissions) { var origQuery = navigator.permissions.query.bind(navigator.permissions); navigator.permissions.query = function (d) { return d && d.name === "geolocation" ? Promise.resolve({ state: "granted", onchange: null }) : origQuery(d); }; }
  } catch (e) {}
  // Perfil inicial elegido arriba en la vista previa: pasajero o conductor con la cuenta ya lista, o persona nueva.
  // La pantalla en la que estás se avisa al marco con postMessage.
  var PROFILE = window.MVC_PREVIEW_PROFILE || "passenger";
  window.__MVC_PREVIEW__ = {
    accessMode: PROFILE === "new" ? "register" : "login",
    screen: function (name) { try { window.parent.postMessage({ mvcPreview: "screen", name: name }, "*"); } catch (e) {} }
  };
  try {
    window.localStorage.removeItem("mvc.session.token");
    if (PROFILE === "passenger" || PROFILE === "driver") {
      var driver = PROFILE === "driver";
      var em0 = driver ? "conductora@ejemplo.es" : "pasajera@ejemplo.es";
      accounts[em0] = { password: "una frase larga", user: { id: uid(), email: em0, email_verified: true, display_name: "Tú",
        roles: (driver ? ["driver", "passenger"] : ["passenger"]).concat(["admin"]) } };
      if (driver) vehicles.push({ id: uid(), make: "SEAT", model: "León", plate: "1234ABC", passenger_seats: 3,
        review_status: "approved", documentation_status: "approved", vehicle_photo_status: "approved", insurance_status: "approved",
        insurance_expires_on: inMin(525600).slice(0, 10) });
      handle("POST", "/v1/auth/login", new URLSearchParams(), { email: em0, password: "una frase larga" });
      if (token) window.localStorage.setItem("mvc.session.token", token);
    }
  } catch (e) {}
})();
