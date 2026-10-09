import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAppUrl, parseDeepLink, resolveNotificationTarget } from "./deepLinks";

describe("parseAppUrl", () => {
  it("solo acepta el esquema mvc", () => {
    assert.deepEqual(parseAppUrl("mvc://trip/abc"), ["trip", "abc"]);
    assert.deepEqual(parseAppUrl("MVC://trip/abc"), ["trip", "abc"]);
    assert.equal(parseAppUrl("https://example.com/trip/abc"), null);
    assert.equal(parseAppUrl("javascript:alert(1)"), null);
    assert.equal(parseAppUrl(""), null);
  });

  it("ignora consulta y fragmento", () => {
    assert.deepEqual(parseAppUrl("mvc://trip/abc?utm=1#x"), ["trip", "abc"]);
  });

  it("sin ruta devuelve lista vacía", () => {
    assert.deepEqual(parseAppUrl("mvc://"), []);
  });
});

describe("parseDeepLink", () => {
  it("viaje, solicitud, chat y notificaciones", () => {
    assert.deepEqual(parseDeepLink("mvc://trip/abc123"), { name: "TripDetail", params: { tripId: "abc123" } });
    assert.deepEqual(parseDeepLink("mvc://request/r-1"), { name: "RequestStatusPayment", params: { requestId: "r-1" } });
    assert.deepEqual(parseDeepLink("mvc://chat/c_1"), { name: "BookingChat", params: { conversationId: "c_1" } });
    assert.deepEqual(parseDeepLink("mvc://notifications"), { name: "Notifications" });
  });

  it("acepta uuid y descarta espacios alrededor", () => {
    const id = "3f2b8c1e-5a47-4d3e-9c1a-0b6f7e8d9a10";
    assert.deepEqual(parseDeepLink(`  mvc://trip/${id}  `), { name: "TripDetail", params: { tripId: id } });
  });

  it("rechaza lo que no es un enlace conocido", () => {
    assert.equal(parseDeepLink("mvc://unknown/x"), null);
    assert.equal(parseDeepLink("mvc://"), null);
    assert.equal(parseDeepLink("https://mvc.example/trip/abc"), null);
  });

  it("rechaza identificadores ausentes, de más o con caracteres peligrosos", () => {
    assert.equal(parseDeepLink("mvc://trip"), null);
    assert.equal(parseDeepLink("mvc://trip/"), null);
    assert.equal(parseDeepLink("mvc://trip/a/b"), null);
    assert.equal(parseDeepLink("mvc://trip/../etc"), null);
    assert.equal(parseDeepLink("mvc://trip/a%2Fb"), null);
    assert.equal(parseDeepLink("mvc://trip/a%20b"), null);
    assert.equal(parseDeepLink("mvc://trip/%E0%A4%A"), null, "percent-encoding roto");
    assert.equal(parseDeepLink("mvc://trip/<script>"), null);
    assert.equal(parseDeepLink(`mvc://trip/${"a".repeat(65)}`), null);
    assert.deepEqual(parseDeepLink(`mvc://trip/${"a".repeat(64)}`), { name: "TripDetail", params: { tripId: "a".repeat(64) } });
  });

  it("notificaciones no admite segmentos extra", () => {
    assert.equal(parseDeepLink("mvc://notifications/extra"), null);
  });
});

describe("resolveNotificationTarget", () => {
  it("elige el destino más específico", () => {
    assert.deepEqual(resolveNotificationTarget({ conversationId: "c1", requestId: "r1", tripId: "t1" }), { name: "BookingChat", params: { conversationId: "c1" } });
    assert.deepEqual(resolveNotificationTarget({ requestId: "r1", bookingId: "b1", tripId: "t1" }), { name: "RequestStatusPayment", params: { requestId: "r1" } });
    assert.deepEqual(resolveNotificationTarget({ bookingId: "b1", tripId: "t1" }), { name: "WaitingForCar", params: { bookingId: "b1" } });
    assert.deepEqual(resolveNotificationTarget({ tripId: "t1", ticketId: "k1" }), { name: "TripDetail", params: { tripId: "t1" } });
    assert.deepEqual(resolveNotificationTarget({ ticketId: "k1" }), { name: "HelpCenter", params: { ticketId: "k1" } });
  });

  it("sin datos reconocibles lleva a la bandeja de notificaciones", () => {
    assert.deepEqual(resolveNotificationTarget({}), { name: "Notifications" });
    assert.deepEqual(resolveNotificationTarget({ foo: "bar" }), { name: "Notifications" });
  });

  it("ignora valores que no son texto o no son un identificador válido", () => {
    assert.deepEqual(resolveNotificationTarget({ conversationId: 42, tripId: "t1" }), { name: "TripDetail", params: { tripId: "t1" } });
    assert.deepEqual(resolveNotificationTarget({ conversationId: "a b", tripId: "t1" }), { name: "TripDetail", params: { tripId: "t1" } });
    assert.deepEqual(resolveNotificationTarget({ conversationId: "../x" }), { name: "Notifications" });
    assert.deepEqual(resolveNotificationTarget({ conversationId: null, requestId: undefined }), { name: "Notifications" });
  });
});
