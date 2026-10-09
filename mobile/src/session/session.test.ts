import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, AuthExpiredError, OfflineError, TimeoutError } from "@/api/errors";
import type { MeProfile } from "@/api/types";
import { getFirstName, getOnboardingRequirements, hasStaffRole, resolveActiveRole, selfServiceRoles } from "./selectors";
import { initialSessionState, sessionReducer } from "./sessionReducer";
import { createSessionService, isSessionRejected, type SessionApi, type SessionStorage } from "./sessionService";
import { createSessionStore } from "./sessionStore";
import type { ActiveRole, SessionState } from "./types";

function makeMe(overrides: Partial<MeProfile> = {}): MeProfile {
  return {
    id: "user-1",
    phone_e164: "+34600111222",
    status: "active",
    display_name: "Miguel Torres",
    public_photo_key: "photos/user-1.jpg",
    public_photo_status: "approved",
    identity_status: "unverified",
    presence_status: null,
    roles: ["passenger"],
    ...overrides,
  };
}

describe("selectores de roles y alta", () => {
  it("personal = cualquier rol administrativo", () => {
    assert.equal(hasStaffRole(["passenger"]), false);
    assert.equal(hasStaffRole(["passenger", "admin"]), true);
    assert.equal(hasStaffRole(["verification_admin"]), true);
    assert.equal(hasStaffRole(["finance_admin"]), true);
    assert.equal(hasStaffRole(["support_admin"]), true);
    assert.equal(hasStaffRole([]), false);
  });

  it("selfServiceRoles descarta los roles de personal", () => {
    assert.deepEqual(selfServiceRoles(["admin", "driver", "passenger"]), ["driver", "passenger"]);
  });

  it("resolveActiveRole respeta la preferencia solo si el usuario sigue teniendo ese rol", () => {
    assert.equal(resolveActiveRole(["passenger", "driver"], "driver"), "driver");
    assert.equal(resolveActiveRole(["passenger"], "driver"), "passenger");
    assert.equal(resolveActiveRole(["driver"], null), "driver");
    assert.equal(resolveActiveRole(["passenger", "driver"], null), "passenger");
    assert.equal(resolveActiveRole(["admin"], "passenger"), null);
    assert.equal(resolveActiveRole([], null), null);
  });

  it("alta completa = rol de viajero + foto pública subida", () => {
    assert.deepEqual(getOnboardingRequirements(makeMe()), []);
    assert.deepEqual(getOnboardingRequirements(makeMe({ roles: ["driver"] })), []);
  });

  it("persona nueva: falta elegir rol y subir foto", () => {
    assert.deepEqual(getOnboardingRequirements(makeMe({ roles: [], public_photo_key: null, public_photo_status: "pending" })), ["role", "photo"]);
  });

  it("con rol pero sin foto, o con la foto rechazada, falta la foto", () => {
    assert.deepEqual(getOnboardingRequirements(makeMe({ public_photo_key: null, public_photo_status: "pending" })), ["photo"]);
    assert.deepEqual(getOnboardingRequirements(makeMe({ public_photo_status: "rejected" })), ["photo"]);
  });

  it("foto pendiente de revisión (subida) no bloquea el alta", () => {
    assert.deepEqual(getOnboardingRequirements(makeMe({ public_photo_status: "pending" })), []);
  });

  it("personal sin rol de viajero no necesita elegir rol ni foto", () => {
    assert.deepEqual(getOnboardingRequirements(makeMe({ roles: ["admin"], public_photo_key: null, public_photo_status: "pending" })), []);
  });

  it("personal que además es viajero sí debe completar su alta", () => {
    assert.deepEqual(getOnboardingRequirements(makeMe({ roles: ["admin", "passenger"], public_photo_key: null, public_photo_status: "pending" })), ["photo"]);
  });

  it("getFirstName", () => {
    assert.equal(getFirstName(makeMe({ display_name: "  Ana García López " })), "Ana");
    assert.equal(getFirstName(makeMe({ display_name: null })), null);
    assert.equal(getFirstName(makeMe({ display_name: "   " })), null);
    assert.equal(getFirstName(null), null);
  });
});

describe("sessionReducer", () => {
  const booted = (state: SessionState = initialSessionState) => sessionReducer(state, { type: "BOOTED", token: null, me: null, storedRole: null });

  it("arranca en booting con epoch 0", () => {
    assert.equal(initialSessionState.status, "booting");
    assert.equal(initialSessionState.epoch, 0);
  });

  it("BOOTED sin token → signedOut y sube el epoch", () => {
    const state = booted();
    assert.equal(state.status, "signedOut");
    assert.equal(state.epoch, 1);
    assert.equal(state.token, null);
  });

  it("BOOTED con token → signedIn con rol activo coherente", () => {
    const me = makeMe({ roles: ["passenger", "driver"] });
    const state = sessionReducer(initialSessionState, { type: "BOOTED", token: "mvc_sess_a", me, storedRole: "driver" });
    assert.equal(state.status, "signedIn");
    assert.equal(state.activeRole, "driver");
    assert.equal(state.meStale, false);
    assert.equal(state.epoch, 1);
  });

  it("BOOTED con token pero sin `me` queda marcado como obsoleto", () => {
    const state = sessionReducer(initialSessionState, { type: "BOOTED", token: "mvc_sess_a", me: null, storedRole: null });
    assert.equal(state.status, "signedIn");
    assert.equal(state.me, null);
    assert.equal(state.meStale, true);
  });

  it("BOOTED guarda el motivo si la sesión recordada ya no valía", () => {
    const state = sessionReducer(initialSessionState, { type: "BOOTED", token: null, me: null, storedRole: null, reason: "expired" });
    assert.equal(state.signOutReason, "expired");
  });

  it("BOOTED solo vale desde booting", () => {
    const signedOut = booted();
    assert.equal(sessionReducer(signedOut, { type: "BOOTED", token: "x", me: makeMe(), storedRole: null }), signedOut);
  });

  it("GUEST_STARTED solo desde signedOut", () => {
    const guest = sessionReducer(booted(), { type: "GUEST_STARTED" });
    assert.equal(guest.status, "guest");
    assert.equal(guest.token, null);
    assert.equal(guest.epoch, 2);
    assert.equal(sessionReducer(initialSessionState, { type: "GUEST_STARTED" }), initialSessionState);
    assert.equal(sessionReducer(guest, { type: "GUEST_STARTED" }), guest);
  });

  it("SIGNED_IN desde invitado entra con la cuenta", () => {
    const guest = sessionReducer(booted(), { type: "GUEST_STARTED" });
    const state = sessionReducer(guest, { type: "SIGNED_IN", token: "mvc_sess_b", me: makeMe(), storedRole: null });
    assert.equal(state.status, "signedIn");
    assert.equal(state.activeRole, "passenger");
    assert.equal(state.epoch, guest.epoch + 1);
  });

  it("SIGNED_IN sin `me` (sin red justo después de verificar) deja la sesión válida y obsoleta", () => {
    const state = sessionReducer(booted(), { type: "SIGNED_IN", token: "mvc_sess_b", me: null, storedRole: null });
    assert.equal(state.status, "signedIn");
    assert.equal(state.meStale, true);
  });

  it("ME_LOADED actualiza `me` sin tocar el epoch", () => {
    const signedIn = sessionReducer(booted(), { type: "SIGNED_IN", token: "t1", me: makeMe(), storedRole: null });
    const next = sessionReducer(signedIn, { type: "ME_LOADED", token: "t1", me: makeMe({ roles: ["passenger", "driver"], display_name: "Otro" }) });
    assert.equal(next.me?.display_name, "Otro");
    assert.equal(next.epoch, signedIn.epoch);
    assert.equal(next.meStale, false);
  });

  it("ME_LOADED/ME_FAILED de un token anterior se ignoran", () => {
    const signedIn = sessionReducer(booted(), { type: "SIGNED_IN", token: "t2", me: makeMe(), storedRole: null });
    assert.equal(sessionReducer(signedIn, { type: "ME_LOADED", token: "t1", me: makeMe({ display_name: "Intruso" }) }), signedIn);
    assert.equal(sessionReducer(signedIn, { type: "ME_FAILED", token: "t1" }), signedIn);
  });

  it("ME_LOADED corrige el rol activo si el usuario perdió ese rol", () => {
    let state = sessionReducer(booted(), { type: "SIGNED_IN", token: "t", me: makeMe({ roles: ["passenger", "driver"] }), storedRole: "driver" });
    assert.equal(state.activeRole, "driver");
    state = sessionReducer(state, { type: "ME_LOADED", token: "t", me: makeMe({ roles: ["passenger"] }) });
    assert.equal(state.activeRole, "passenger");
  });

  it("ACTIVE_ROLE_SET solo acepta roles que el usuario tiene", () => {
    const signedIn = sessionReducer(booted(), { type: "SIGNED_IN", token: "t", me: makeMe({ roles: ["passenger"] }), storedRole: null });
    assert.equal(sessionReducer(signedIn, { type: "ACTIVE_ROLE_SET", role: "driver" }), signedIn);
    const both = sessionReducer(booted(), { type: "SIGNED_IN", token: "t", me: makeMe({ roles: ["passenger", "driver"] }), storedRole: null });
    const driver = sessionReducer(both, { type: "ACTIVE_ROLE_SET", role: "driver" });
    assert.equal(driver.activeRole, "driver");
    assert.equal(driver.epoch, both.epoch);
  });

  it("SIGNED_OUT limpia todo, guarda el motivo y sube el epoch", () => {
    const signedIn = sessionReducer(booted(), { type: "SIGNED_IN", token: "t", me: makeMe(), storedRole: null });
    const out = sessionReducer(signedIn, { type: "SIGNED_OUT", reason: "expired" });
    assert.equal(out.status, "signedOut");
    assert.equal(out.token, null);
    assert.equal(out.me, null);
    assert.equal(out.activeRole, null);
    assert.equal(out.signOutReason, "expired");
    assert.equal(out.epoch, signedIn.epoch + 1);
    assert.equal(sessionReducer(out, { type: "SIGNED_OUT", reason: "user" }), out);
  });

  it("SIGNED_OUT desde invitado vuelve a Bienvenida", () => {
    const guest = sessionReducer(booted(), { type: "GUEST_STARTED" });
    assert.equal(sessionReducer(guest, { type: "SIGNED_OUT", reason: "user" }).status, "signedOut");
  });
});

describe("isSessionRejected", () => {
  it("401/403 y usuario inexistente = el servidor rechaza la sesión", () => {
    assert.equal(isSessionRejected(new AuthExpiredError("AUTH_INVALID_OR_EXPIRED")), true);
    assert.equal(isSessionRejected(new ApiError("x", "AUTH_REQUIRED", 401)), true);
    assert.equal(isSessionRejected(new ApiError("x", "ACCOUNT_NOT_ACTIVE", 403)), true);
    assert.equal(isSessionRejected(new ApiError("x", "USER_NOT_FOUND", 404)), true);
  });

  it("sin red, timeout o 5xx NO es un rechazo (no se cierra la sesión)", () => {
    assert.equal(isSessionRejected(new OfflineError()), false);
    assert.equal(isSessionRejected(new TimeoutError(6000)), false);
    assert.equal(isSessionRejected(new ApiError("x", "INTERNAL_ERROR", 500)), false);
    assert.equal(isSessionRejected(new ApiError("x", "NOT_FOUND", 404)), false);
    assert.equal(isSessionRejected(new Error("raro")), false);
  });
});

/* ───────────────────────────── servicio con dependencias simuladas ───────────────────────────── */

interface Harness {
  store: ReturnType<typeof createSessionStore>;
  service: ReturnType<typeof createSessionService>;
  disk: { token: string | null; me: MeProfile | null; roles: Record<string, ActiveRole> };
  calls: { getMe: number; logout: string[]; accessToken: (string | null)[]; cleared: number };
  setGetMe(next: (options: { token?: string }) => Promise<MeProfile>): void;
  setLogout(next: (token: string) => Promise<void>): void;
}

function harness(initial: { token?: string | null; me?: MeProfile | null } = {}): Harness {
  const disk: Harness["disk"] = { token: initial.token ?? null, me: initial.me ?? null, roles: {} };
  const calls: Harness["calls"] = { getMe: 0, logout: [], accessToken: [], cleared: 0 };
  let getMe: (options: { token?: string }) => Promise<MeProfile> = async () => makeMe();
  let logout: (token: string) => Promise<void> = async () => undefined;
  const storage: SessionStorage = {
    readToken: async () => disk.token,
    writeToken: async (token) => {
      disk.token = token;
      return true;
    },
    clearToken: async () => {
      disk.token = null;
    },
    readMeCache: async () => disk.me,
    writeMeCache: async (me) => {
      disk.me = me;
    },
    clearMeCache: async () => {
      disk.me = null;
    },
    readActiveRole: async (userId) => disk.roles[userId] ?? null,
    writeActiveRole: async (userId, role) => {
      disk.roles[userId] = role;
    },
  };
  const api: SessionApi = {
    getMe: (options) => {
      calls.getMe += 1;
      return getMe(options);
    },
    logout: (token) => {
      calls.logout.push(token);
      return logout(token);
    },
  };
  const store = createSessionStore();
  const service = createSessionService({
    store,
    storage,
    api,
    setAccessToken: (token) => calls.accessToken.push(token),
    onSessionCleared: () => {
      calls.cleared += 1;
    },
  });
  return {
    store,
    service,
    disk,
    calls,
    setGetMe: (next) => {
      getMe = next;
    },
    setLogout: (next) => {
      logout = next;
    },
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createSessionService.boot", () => {
  it("sin token guardado → signedOut", async () => {
    const h = harness();
    await h.service.boot();
    assert.equal(h.store.getState().status, "signedOut");
    assert.equal(h.calls.getMe, 0);
  });

  it("con token válido → signedIn con `me`, copia en disco y token compartido", async () => {
    const me = makeMe({ roles: ["passenger", "driver"] });
    const h = harness({ token: "mvc_sess_ok" });
    h.setGetMe(async () => me);
    h.disk.roles[me.id] = "driver";
    await h.service.boot();
    await flush();
    const state = h.store.getState();
    assert.equal(state.status, "signedIn");
    assert.equal(state.token, "mvc_sess_ok");
    assert.equal(state.me?.id, me.id);
    assert.equal(state.activeRole, "driver");
    assert.equal(state.meStale, false);
    assert.deepEqual(h.disk.me, me);
    assert.deepEqual(h.calls.accessToken, ["mvc_sess_ok"]);
  });

  it("es idempotente: llamarlo dos veces (StrictMode) pide `/me` una sola vez", async () => {
    const h = harness({ token: "mvc_sess_ok" });
    await Promise.all([h.service.boot(), h.service.boot()]);
    await h.service.boot();
    assert.equal(h.calls.getMe, 1);
  });

  it("token rechazado (401) → borra el almacén y vuelve a Bienvenida con motivo", async () => {
    const h = harness({ token: "mvc_sess_old", me: makeMe() });
    h.setGetMe(async () => {
      throw new AuthExpiredError("AUTH_INVALID_OR_EXPIRED");
    });
    await h.service.boot();
    const state = h.store.getState();
    assert.equal(state.status, "signedOut");
    assert.equal(state.signOutReason, "expired");
    assert.equal(h.disk.token, null);
    assert.equal(h.disk.me, null);
    assert.equal(h.calls.accessToken.at(-1), null);
  });

  it("cuenta no activa → motivo 'inactive'", async () => {
    const h = harness({ token: "mvc_sess_x" });
    h.setGetMe(async () => {
      throw new ApiError("Cuenta no activa", "ACCOUNT_NOT_ACTIVE", 403);
    });
    await h.service.boot();
    assert.equal(h.store.getState().signOutReason, "inactive");
  });

  it("sin red NO cierra la sesión: usa la última copia de `me` y queda marcada como obsoleta", async () => {
    const cached = makeMe({ display_name: "Copia" });
    const h = harness({ token: "mvc_sess_ok", me: cached });
    h.setGetMe(async () => {
      throw new OfflineError();
    });
    await h.service.boot();
    const state = h.store.getState();
    assert.equal(state.status, "signedIn");
    assert.equal(state.me?.display_name, "Copia");
    assert.equal(state.meStale, true);
    assert.equal(h.disk.token, "mvc_sess_ok", "el token sigue guardado");
  });

  it("servidor caído (5xx) sin copia: signedIn sin `me`", async () => {
    const h = harness({ token: "mvc_sess_ok" });
    h.setGetMe(async () => {
      throw new ApiError("caído", "INTERNAL_ERROR", 503);
    });
    await h.service.boot();
    const state = h.store.getState();
    assert.equal(state.status, "signedIn");
    assert.equal(state.me, null);
    assert.equal(state.meStale, true);
  });
});

describe("createSessionService.signIn / signOut", () => {
  it("signIn guarda el token, carga `/me` y entra", async () => {
    const h = harness();
    await h.service.boot();
    const me = await h.service.signIn({ token: "mvc_sess_new" });
    await flush();
    assert.equal(me?.id, "user-1");
    assert.equal(h.disk.token, "mvc_sess_new");
    assert.deepEqual(h.disk.me, me);
    const state = h.store.getState();
    assert.equal(state.status, "signedIn");
    assert.equal(state.token, "mvc_sess_new");
    assert.equal(h.calls.accessToken.at(-1), "mvc_sess_new");
  });

  it("signIn sin red justo tras verificar el código: la sesión es válida aunque `me` no cargue", async () => {
    const h = harness();
    await h.service.boot();
    h.setGetMe(async () => {
      throw new OfflineError();
    });
    const me = await h.service.signIn({ token: "mvc_sess_new" });
    assert.equal(me, null);
    const state = h.store.getState();
    assert.equal(state.status, "signedIn");
    assert.equal(state.meStale, true);
    assert.equal(h.disk.token, "mvc_sess_new");
  });

  it("signIn rechaza y no deja token guardado si el servidor rechaza el token", async () => {
    const h = harness();
    await h.service.boot();
    h.setGetMe(async () => {
      throw new AuthExpiredError();
    });
    await assert.rejects(h.service.signIn({ token: "mvc_sess_bad" }));
    assert.equal(h.store.getState().status, "signedOut");
    assert.equal(h.disk.token, null);
    assert.equal(h.calls.accessToken.at(-1), null);
  });

  it("signOut revoca el token, borra el almacén, vacía las cachés y vuelve a Bienvenida", async () => {
    const h = harness({ token: "mvc_sess_ok" });
    await h.service.boot();
    await flush();
    await h.service.signOut();
    const state = h.store.getState();
    assert.equal(state.status, "signedOut");
    assert.equal(state.signOutReason, "user");
    assert.deepEqual(h.calls.logout, ["mvc_sess_ok"]);
    assert.equal(h.disk.token, null);
    assert.equal(h.disk.me, null);
    assert.equal(h.calls.cleared, 1);
    assert.equal(h.calls.accessToken.at(-1), null);
  });

  it("signOut cierra la sesión local aunque falle la revocación en el servidor", async () => {
    const h = harness({ token: "mvc_sess_ok" });
    await h.service.boot();
    h.setLogout(async () => {
      throw new OfflineError();
    });
    await h.service.signOut();
    assert.equal(h.store.getState().status, "signedOut");
    assert.equal(h.disk.token, null);
  });

  it("signOut desde invitado no llama al servidor", async () => {
    const h = harness();
    await h.service.boot();
    h.service.continueAsGuest();
    assert.equal(h.store.getState().status, "guest");
    await h.service.signOut();
    assert.deepEqual(h.calls.logout, []);
    assert.equal(h.store.getState().status, "signedOut");
  });
});

describe("createSessionService.handleAuthExpired / refreshMe / roles", () => {
  it("un 401 del token vigente cierra la sesión sin intentar revocar", async () => {
    const h = harness({ token: "mvc_sess_ok" });
    await h.service.boot();
    h.service.handleAuthExpired({ token: "mvc_sess_ok", code: "AUTH_INVALID_OR_EXPIRED" });
    await flush();
    const state = h.store.getState();
    assert.equal(state.status, "signedOut");
    assert.equal(state.signOutReason, "expired");
    assert.deepEqual(h.calls.logout, []);
    assert.equal(h.disk.token, null);
    assert.equal(h.calls.cleared, 1);
  });

  it("un 401 de un token antiguo NO cierra la sesión nueva", async () => {
    const h = harness({ token: "mvc_sess_ok" });
    await h.service.boot();
    h.service.handleAuthExpired({ token: "mvc_sess_viejo", code: "AUTH_INVALID_OR_EXPIRED" });
    await flush();
    assert.equal(h.store.getState().status, "signedIn");
  });

  it("refreshMe actualiza el perfil", async () => {
    const h = harness({ token: "mvc_sess_ok" });
    await h.service.boot();
    h.setGetMe(async () => makeMe({ display_name: "Nuevo nombre", roles: ["passenger", "driver"] }));
    const me = await h.service.refreshMe();
    assert.equal(me?.display_name, "Nuevo nombre");
    assert.equal(h.store.getState().me?.display_name, "Nuevo nombre");
    assert.equal(h.store.getState().meStale, false);
  });

  it("refreshMe deduplica llamadas simultáneas", async () => {
    const h = harness({ token: "mvc_sess_ok" });
    await h.service.boot();
    const before = h.calls.getMe;
    await Promise.all([h.service.refreshMe(), h.service.refreshMe(), h.service.refreshMe()]);
    assert.equal(h.calls.getMe - before, 1);
  });

  it("refreshMe sin red conserva el perfil y lo marca obsoleto", async () => {
    const h = harness({ token: "mvc_sess_ok" });
    await h.service.boot();
    h.setGetMe(async () => {
      throw new OfflineError();
    });
    assert.equal(await h.service.refreshMe(), null);
    assert.equal(h.store.getState().status, "signedIn");
    assert.equal(h.store.getState().meStale, true);
    assert.equal(h.store.getState().me?.id, "user-1");
  });

  it("refreshMe con cuenta rechazada (403 no 401) termina la sesión", async () => {
    const h = harness({ token: "mvc_sess_ok" });
    await h.service.boot();
    h.setGetMe(async () => {
      throw new ApiError("Cuenta no activa", "ACCOUNT_NOT_ACTIVE", 403);
    });
    await h.service.refreshMe();
    assert.equal(h.store.getState().status, "signedOut");
    assert.equal(h.store.getState().signOutReason, "inactive");
  });

  it("refreshMe sin sesión no hace nada", async () => {
    const h = harness();
    await h.service.boot();
    assert.equal(await h.service.refreshMe(), null);
    assert.equal(h.calls.getMe, 0);
  });

  it("setActiveRole persiste por usuario y rechaza roles que no se tienen", async () => {
    const me = makeMe({ roles: ["passenger", "driver"] });
    const h = harness({ token: "mvc_sess_ok" });
    h.setGetMe(async () => me);
    await h.service.boot();
    assert.equal(h.service.setActiveRole("driver"), true);
    await flush();
    assert.equal(h.store.getState().activeRole, "driver");
    assert.equal(h.disk.roles[me.id], "driver");

    const h2 = harness({ token: "mvc_sess_ok" });
    await h2.service.boot(); // solo pasajero
    assert.equal(h2.service.setActiveRole("driver"), false);
    assert.equal(h2.store.getState().activeRole, "passenger");
  });

  it("continueAsGuest solo desde signedOut", async () => {
    const h = harness({ token: "mvc_sess_ok" });
    await h.service.boot();
    h.service.continueAsGuest();
    assert.equal(h.store.getState().status, "signedIn");
  });
});
