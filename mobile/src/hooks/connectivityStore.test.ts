import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isNetworkOffline, setNetworkOffline } from "@/api/runtime";
import { connectivityStore, createConnectivityStore, deriveConnectivity, UNKNOWN_CONNECTIVITY } from "./connectivityStore";

describe("deriveConnectivity", () => {
  it("sin interfaz de red = offline por no_network", () => {
    const state = deriveConnectivity({ type: "none", isConnected: false, isInternetReachable: false });
    assert.equal(state.status, "offline");
    assert.equal(state.offlineReason, "no_network");
    assert.equal(state.isOffline, true);
    assert.equal(state.isOnline, false);
    assert.equal(state.type, "none");
  });

  it("red sin Internet alcanzable = offline por no_internet", () => {
    const state = deriveConnectivity({ type: "wifi", isConnected: true, isInternetReachable: false });
    assert.equal(state.status, "offline");
    assert.equal(state.offlineReason, "no_internet");
    assert.equal(state.type, "wifi");
  });

  it("Wi-Fi con Internet = online", () => {
    const state = deriveConnectivity({ type: "wifi", isConnected: true, isInternetReachable: true });
    assert.equal(state.status, "online");
    assert.equal(state.isOnline, true);
    assert.equal(state.offlineReason, null);
  });

  it("conectado con alcance sin determinar = online (se asume que hay servicio)", () => {
    assert.equal(deriveConnectivity({ type: "cellular", isConnected: true, isInternetReachable: null }).status, "online");
    assert.equal(deriveConnectivity({ type: "cellular", isConnected: true }).status, "online");
  });

  it("sin lectura todavía = unknown, y unknown cuenta como online", () => {
    const state = deriveConnectivity({ isConnected: null });
    assert.equal(state.status, "unknown");
    assert.equal(state.isOnline, true);
    assert.equal(state.isOffline, false);
    assert.equal(state.type, "unknown");
  });

  it("clasifica el tipo de conexión y el coste", () => {
    assert.equal(deriveConnectivity({ type: "cellular", isConnected: true, isConnectionExpensive: true }).isExpensive, true);
    assert.equal(deriveConnectivity({ type: "cellular", isConnected: true, isConnectionExpensive: true }).type, "cellular");
    assert.equal(deriveConnectivity({ type: "ethernet", isConnected: true }).type, "other");
    assert.equal(deriveConnectivity({ type: "vpn", isConnected: true }).type, "other");
    assert.equal(deriveConnectivity({ type: "wifi", isConnected: true, isConnectionExpensive: null }).isExpensive, false);
  });
});

describe("createConnectivityStore", () => {
  it("arranca en unknown y notifica solo cuando algo relevante cambia", () => {
    let t = 100;
    const store = createConnectivityStore({ now: () => t });
    assert.equal(store.getState(), UNKNOWN_CONNECTIVITY);
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    const online = store.setRaw({ type: "wifi", isConnected: true, isInternetReachable: true });
    assert.equal(online.status, "online");
    assert.equal(online.since, 100);
    assert.equal(notifications, 1);

    t = 200;
    // misma lectura: misma referencia y sin aviso
    assert.equal(store.setRaw({ type: "wifi", isConnected: true, isInternetReachable: true }), online);
    assert.equal(notifications, 1);

    // cambia solo el tipo: aviso, pero `since` (desde cuándo está online) se conserva
    const cellular = store.setRaw({ type: "cellular", isConnected: true, isInternetReachable: true });
    assert.equal(cellular.type, "cellular");
    assert.equal(cellular.since, 100);
    assert.equal(notifications, 2);
  });

  it("avisa de la reconexión solo al pasar de offline a online", () => {
    const store = createConnectivityStore();
    let reconnects = 0;
    store.onReconnect(() => {
      reconnects += 1;
    });
    store.setRaw({ type: "wifi", isConnected: true }); // arranque: no es reconexión
    assert.equal(reconnects, 0);
    store.setRaw({ type: "none", isConnected: false });
    assert.equal(reconnects, 0);
    store.setRaw({ type: "cellular", isConnected: true, isInternetReachable: true });
    assert.equal(reconnects, 1);
    store.setRaw({ type: "wifi", isConnected: true, isInternetReachable: true }); // online → online
    assert.equal(reconnects, 1);
  });

  it("fuerza el modo sin red solo con isConnected=false y lo suelta al volver", () => {
    const calls: boolean[] = [];
    const store = createConnectivityStore({ onForcedOfflineChange: (forced) => calls.push(forced) });
    store.setRaw({ type: "wifi", isConnected: true, isInternetReachable: false }); // no_internet: NO se fuerza
    assert.deepEqual(calls, []);
    store.setRaw({ type: "none", isConnected: false });
    assert.deepEqual(calls, [true]);
    store.setRaw({ type: "none", isConnected: false, isInternetReachable: false }); // sigue forzado: sin repetir
    assert.deepEqual(calls, [true]);
    store.setRaw({ type: "wifi", isConnected: true, isInternetReachable: true });
    assert.deepEqual(calls, [true, false]);
  });

  it("un oyente que falla no impide avisar a los demás", () => {
    const store = createConnectivityStore();
    let received = 0;
    store.subscribe(() => {
      throw new Error("oyente roto");
    });
    store.subscribe(() => {
      received += 1;
    });
    store.setRaw({ type: "wifi", isConnected: true });
    assert.equal(received, 1);
  });

  it("darse de baja deja de notificar", () => {
    const store = createConnectivityStore();
    let received = 0;
    const unsubscribe = store.subscribe(() => {
      received += 1;
    });
    store.setRaw({ type: "wifi", isConnected: true });
    unsubscribe();
    store.setRaw({ type: "none", isConnected: false });
    assert.equal(received, 1);
  });

  it("el almacén global conecta con el modo sin red de apiRequest", () => {
    setNetworkOffline(false);
    connectivityStore.setRaw({ type: "none", isConnected: false });
    assert.equal(isNetworkOffline(), true);
    connectivityStore.setRaw({ type: "wifi", isConnected: true, isInternetReachable: true });
    assert.equal(isNetworkOffline(), false);
    connectivityStore.reset();
  });
});
