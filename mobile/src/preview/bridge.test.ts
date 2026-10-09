/**
 * Puente `window.__mvc` con un doble de la app: abrir rutas con un perfil, re-abrir el mismo perfil, reiniciar,
 * reloj, variantes de datos, espera de red inactiva y borrado de datos del navegador.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createMvcBridge, type ClockControl, type MvcBridge } from "./bridge";
import { DEFAULT_PREVIEW_NOW } from "./core/clock";
import type { PreviewProfileId } from "./core/types";
import { PERSIST_KEY } from "./persist";
import type { PreviewRuntime } from "./runtime";
import { SEED_USER_IDS } from "./seeds";
import { clearShell, createApi, installBrowserStorage, testRuntime, withShell } from "./testing/harness";
import { createFakeApp, type FakeApp } from "./testing/fakeApp";

interface Rig {
  rt: PreviewRuntime;
  app: FakeApp;
  bridge: MvcBridge;
  clockCalls: Array<string | null>;
}

function rig(profile: PreviewProfileId = "passenger", latency: number | readonly [number, number] = 0): Rig {
  const rt = testRuntime({ profile, latency });
  const app = createFakeApp(rt);
  const clockCalls: Array<string | null> = [];
  const clock: ClockControl = {
    mode: "frozen",
    apply(iso) {
      clockCalls.push(iso);
      rt.db.clock.set(iso ?? DEFAULT_PREVIEW_NOW);
    },
  };
  const bridge = createMvcBridge({ runtime: rt, loader: () => app, clock, persist: null, settleMs: 0, readyTimeoutMs: 300 });
  return { rt, app, bridge, clockCalls };
}

afterEach(() => clearShell());

describe("estado de la app", () => {
  it("ready() es falso hasta que la navegación está montada; routes()/route() no fallan antes de tiempo", async () => {
    const rt = testRuntime({ profile: "passenger" });
    const app = createFakeApp(rt);
    app.state.navReady = false;
    let present = false;
    const bridge = createMvcBridge({ runtime: rt, loader: () => (present ? app : null), clock: { mode: "frozen", apply: () => undefined }, persist: null, settleMs: 0, readyTimeoutMs: 100 });
    assert.equal(bridge.ready(), false);
    assert.deepEqual(bridge.routes(), []);
    assert.equal(bridge.route(), null);
    assert.equal(bridge.params(), undefined);
    present = true;
    assert.equal(bridge.ready(), false, "app cargada pero navegación sin montar");
    app.state.navReady = true;
    assert.equal(bridge.ready(), true);
    assert.ok(bridge.routes().some((r) => r.name === "SearchResults"));
  });

  it("open() rechaza con un mensaje claro si la app no llega a estar lista", async () => {
    const rt = testRuntime({ profile: "passenger" });
    const bridge = createMvcBridge({ runtime: rt, loader: () => null, clock: { mode: "frozen", apply: () => undefined }, persist: null, settleMs: 0, readyTimeoutMs: 80 });
    await assert.rejects(() => bridge.open("Home"), /La app no está lista/);
  });
});

describe("open()", () => {
  let r: Rig;
  beforeEach(async () => {
    r = rig("passenger");
    await r.app.boot(r.rt.sessionToken());
  });

  it("abre la ruta con el perfil: sesión del perfil en la app y pila coherente", async () => {
    await r.bridge.open("SearchResults", { originLabel: "Montequinto" }, { profile: "passenger" });
    assert.equal(r.bridge.route(), "SearchResults");
    assert.deepEqual(r.bridge.params(), { originLabel: "Montequinto" });
    assert.equal(r.app.state.status, "signedIn");
    assert.equal(r.app.state.token, r.rt.sessionToken("passenger"));
    assert.equal(r.app.state.activeRole, "passenger");
    const api = createApi(r.rt);
    assert.equal((await api("GET", "/me", { token: r.app.state.token })).status, 200);
    assert.equal(r.bridge.profile(), "passenger");
  });

  it("cierra sesión ANTES de re-sembrar y abre sesión DESPUÉS: el cierre no revoca la sesión recién sembrada", async () => {
    await r.bridge.open("Home", undefined, { profile: "passenger" });
    const calls = r.app.calls;
    const signOut = calls.indexOf("signOut");
    const logout = calls.findIndex((c) => c.startsWith("logout:"));
    const signIn = calls.findIndex((c) => c.startsWith("signIn:"));
    assert.ok(signOut >= 0 && logout > signOut && signIn > logout, `orden inesperado: ${calls.join(" > ")}`);
    assert.equal(calls[logout], "logout:204", "el cierre se hizo contra el mundo anterior, donde el token valía");
  });

  it("re-abrir el MISMO perfil dos veces seguidas funciona (antes: AuthExpiredError en la segunda)", async () => {
    await r.bridge.open("SearchResults", undefined, { profile: "passenger" });
    await r.bridge.open("Home"); // sin perfil: el mismo
    await r.bridge.open("TripDetail", { tripId: "x" });
    assert.equal(r.bridge.route(), "TripDetail");
    assert.equal(r.app.state.status, "signedIn");
    assert.equal((await createApi(r.rt)("GET", "/me", { token: r.app.state.token })).status, 200);
    assert.equal(r.app.calls.filter((c) => c.startsWith("logout:")).every((c) => c === "logout:204"), true);
  });

  for (const profile of ["driver", "admin"] as const) {
    it(`reset("${profile}") dos veces seguidas funciona`, async () => {
      await r.bridge.reset(profile);
      await r.bridge.reset(profile);
      assert.equal(r.app.state.status, "signedIn");
      assert.equal(r.app.state.token, r.rt.sessionToken(profile));
      assert.equal(r.bridge.profile(), profile);
      assert.equal((await createApi(r.rt)("GET", "/me", { token: r.app.state.token })).status, 200);
    });
  }

  it("cambiar de perfil deja la sesión del nuevo y el rol activo que le corresponde", async () => {
    await r.bridge.open("DriverHome", undefined, { profile: "driver" });
    assert.equal(r.app.state.token, r.rt.sessionToken("driver"));
    assert.equal(r.app.state.activeRole, "driver");
    await r.bridge.open("AdminHome", undefined, { profile: "admin" });
    assert.equal(r.app.state.activeRole, null, "el perfil de administración no tiene rol de app");
    assert.equal(r.bridge.profile(), "admin");
  });

  it("«Persona nueva» deja la app sin sesión y sin token", async () => {
    await r.bridge.open("Welcome", undefined, { profile: "new" });
    assert.equal(r.app.state.status, "signedOut");
    assert.equal(r.app.state.token, null);
    assert.equal(r.rt.sessionToken("new"), null);
    assert.equal(r.bridge.route(), "Welcome");
  });

  it("sin ruta aplica la puerta de la sesión (primera pantalla de ese perfil)", async () => {
    await r.bridge.open("", undefined, { profile: "passenger" });
    assert.equal(r.bridge.route(), "Home");
    await r.bridge.open("", undefined, { profile: "new" });
    assert.equal(r.bridge.route(), "Welcome");
  });

  it("una ruta que no existe se rechaza antes de tocar nada", async () => {
    const before = r.rt.db.getRevision();
    await assert.rejects(() => r.bridge.open("NoExiste", undefined, { profile: "driver" }), /La ruta «NoExiste» no existe en la app/);
    assert.equal(r.rt.db.getRevision(), before, "el mundo no se ha re-sembrado");
    assert.equal(r.bridge.profile(), "passenger");
  });

  it("una variante de datos desconocida (una errata del escenario) se rechaza antes de tocar nada y lista las disponibles", async () => {
    const before = r.rt.db.getRevision();
    await assert.rejects(
      () => r.bridge.open("Home", undefined, { profile: "driver", seed: "request-pendiente" }),
      /La variante de datos «request-pendiente» no existe\. Disponibles: default, driver-requests, empty,.*request-pending/
    );
    assert.equal(r.rt.db.getRevision(), before, "el mundo no se ha re-sembrado");
    assert.equal(r.bridge.profile(), "passenger");
    assert.equal(r.bridge.seed(), "default");
  });

  it("un perfil desconocido se rechaza", async () => {
    await assert.rejects(() => r.bridge.open("Home", undefined, { profile: "superusuario" as PreviewProfileId }), /Perfil de prueba desconocido/);
  });

  it("aplica el reloj y la variante de datos pedidos", async () => {
    await r.bridge.open("Home", undefined, { profile: "passenger", seed: "request-pending", clock: "2026-10-05T07:58:00+02:00" });
    assert.equal(r.rt.db.clock.iso(), "2026-10-05T05:58:00.000Z");
    assert.equal(r.bridge.now(), "2026-10-05T05:58:00.000Z");
    assert.equal(r.bridge.seed(), "request-pending");
    assert.deepEqual(r.clockCalls, ["2026-10-05T07:58:00+02:00"]);
    const mine = await createApi(r.rt)("GET", "/v1/me/ride-requests", { token: r.app.state.token });
    const statuses = (mine.body as { requests: Array<{ status: string }> }).requests.map((x) => x.status);
    assert.ok(statuses.includes("pending"), "la variante deja una solicitud pendiente de Miguel");
    await r.bridge.open("Home", undefined, { profile: "passenger" });
    assert.equal(r.bridge.seed(), "default", "sin seed vuelve a la variante por defecto");
    assert.equal(r.bridge.now(), "2026-10-05T05:58:00.000Z", "sin clock el reloj no se toca");
  });

  it("sustituye { $ref } de los parámetros por el id sembrado DESPUÉS de sembrar (escenarios sin ids a mano)", async () => {
    await r.bridge.open(
      "SearchResults",
      { requestId: { $ref: "request.miguel" }, trip: { id: { $ref: "trip.anaMorning" } }, ids: [{ $ref: "user.ana" }] },
      { profile: "passenger", seed: "request-pending" }
    );
    const mine = await createApi(r.rt)("GET", "/v1/me/ride-requests", { token: r.app.state.token });
    const created = (mine.body as { requests: Array<{ id: string; trip_id: string; status: string }> }).requests.find((x) => x.status === "pending");
    assert.ok(created);
    assert.deepEqual(r.bridge.params(), { requestId: created.id, trip: { id: created.trip_id }, ids: [SEED_USER_IDS.ana] });
  });

  it("una referencia que no existe en la variante rechaza con un mensaje claro y deja la app en su primera pantalla", async () => {
    await assert.rejects(
      () => r.bridge.open("SearchResults", { requestId: { $ref: "request.miguel" } }, { profile: "passenger", seed: "default" }),
      /«request\.miguel» no existe en este mundo \(perfil «passenger», variante «default»\)/
    );
    assert.equal(r.app.state.status, "signedIn", "el mundo ya estaba sembrado y la sesión abierta");
    assert.equal(r.bridge.route(), "Home");
    await assert.rejects(() => r.bridge.open("Home", { x: { $ref: "nada.nada" } }), /Referencia desconocida «nada\.nada»/);
  });

  it("refs() devuelve las referencias resueltas en el mundo actual", async () => {
    await r.bridge.open("Home", undefined, { profile: "passenger", seed: "booking-confirmed" });
    const refs = r.bridge.refs();
    assert.equal(refs["user.miguel"], SEED_USER_IDS.miguel);
    assert.equal(typeof refs["request.miguel"], "string");
    assert.equal(typeof refs["booking.miguel"], "string");
    await r.bridge.open("Home", undefined, { profile: "passenger", seed: "default" });
    assert.equal(r.bridge.refs()["booking.miguel"], null);
  });

  it("seeds() lista las variantes disponibles", () => {
    const names = r.bridge.seeds();
    for (const expected of ["default", "empty", "request-pending", "request-accepted", "booking-confirmed", "trip-live-in-car", "trip-finished"]) {
      assert.ok(names.includes(expected), `falta la variante «${expected}»`);
    }
  });

  it("reset() vuelve a la hora de las láminas y a los datos por defecto", async () => {
    await r.bridge.open("Home", undefined, { profile: "passenger", seed: "empty", clock: "2026-10-06T10:00:00+02:00" });
    await r.bridge.reset();
    assert.equal(r.bridge.seed(), "default");
    assert.equal(r.bridge.now(), "2026-10-05T05:17:00.000Z");
    assert.equal(r.bridge.route(), "Home");
  });

  it("goBack() vuelve a la pantalla anterior", async () => {
    await r.bridge.open("SearchResults", undefined, { profile: "passenger" });
    r.app.state.history.push({ name: "TripDetail", params: { tripId: "x" } });
    assert.equal(r.bridge.route(), "TripDetail");
    r.bridge.goBack();
    assert.equal(r.bridge.route(), "SearchResults");
  });

  it("la aplicación sin red (modo avión) no impide abrir: el cierre de sesión es de mejor esfuerzo", async () => {
    await withShell({ isOffline: () => true } as never, async () => {
      await r.bridge.open("Home", undefined, { profile: "passenger" });
    }).catch((error: unknown) => {
      // signIn necesita /me: sin red el doble lanza; el puente debe propagar el fallo, no quedarse colgado
      assert.match(String(error), /Failed to fetch|AuthExpiredError|TypeError/);
    });
  });
});

describe("idle() y registro", () => {
  it("idle() espera a que no queden peticiones en vuelo", async () => {
    const r = rig("passenger", 40);
    await r.app.boot(null);
    const api = createApi(r.rt);
    const pending = api("GET", "/health/live");
    assert.equal(r.rt.server.inFlight, 1);
    await r.bridge.idle(2_000);
    assert.equal(r.rt.server.inFlight, 0);
    assert.equal((await pending).status, 200);
  });

  it("idle() no se queda esperando para siempre", async () => {
    const r = rig("passenger", 400);
    const api = createApi(r.rt);
    void api("GET", "/health/live");
    const started = Date.now();
    await r.bridge.idle(120);
    assert.ok(Date.now() - started < 1_000);
  });

  it("requests(limit) devuelve las últimas peticiones y lastSms() el último código enviado", async () => {
    const r = rig("new");
    const api = createApi(r.rt);
    await api("GET", "/health/live");
    await api("POST", "/v1/auth/phone/start", { body: { phone: "+34633000111" } });
    const entries = r.bridge.requests(5);
    assert.equal(entries.length, 2);
    assert.equal(entries.at(-1)?.path, "/v1/auth/phone/start");
    assert.equal(r.bridge.requests(1).length, 1);
    assert.equal(r.bridge.lastSms()?.phone, "+34633000111");
    assert.equal(r.bridge.simulation, true);
  });
});

describe("datos del navegador", () => {
  let browser: ReturnType<typeof installBrowserStorage>;
  beforeEach(() => {
    browser = installBrowserStorage();
  });
  afterEach(() => browser.restore());

  it("reset() borra lo que la app guardó (claves mvc.*) y la copia guardada del mundo, pero conserva lo ajeno", async () => {
    const r = rig("passenger");
    await r.app.boot(r.rt.sessionToken());
    browser.local.setItem("mvc.settings.fontScale", "large");
    browser.local.setItem("otra.cosa", "se queda");
    browser.session.setItem("mvc.draft", "borrador");
    browser.session.setItem(PERSIST_KEY, "{}");
    await r.bridge.reset("passenger");
    assert.equal(browser.local.getItem("mvc.settings.fontScale"), null);
    assert.equal(browser.local.getItem("otra.cosa"), "se queda");
    assert.equal(browser.session.getItem("mvc.draft"), null);
    assert.equal(browser.session.getItem(PERSIST_KEY), null, "un reinicio descarta también la copia guardada del mundo");
  });
});
