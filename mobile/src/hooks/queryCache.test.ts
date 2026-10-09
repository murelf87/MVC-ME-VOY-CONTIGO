import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, OfflineError, createAbortError } from "@/api/errors";
import { emitSessionCleared } from "@/api/runtime";
import { QueryCache, hashKey, isKeyPrefix, queryCache } from "./queryCache";

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Promesa que se resuelve/rechaza a mano, para controlar el orden de las respuestas. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("claves de consulta", () => {
  it("hashKey no depende del orden de las claves de un objeto", () => {
    assert.equal(hashKey(["trips", { b: 2, a: 1 }]), hashKey(["trips", { a: 1, b: 2 }]));
  });

  it("una clave de texto equivale a un array de un elemento", () => {
    assert.equal(hashKey("me"), hashKey(["me"]));
  });

  it("claves distintas producen hashes distintos", () => {
    assert.notEqual(hashKey(["trips", 1]), hashKey(["trips", 2]));
    assert.notEqual(hashKey(["trips", "1"]), hashKey(["trips", 1]));
  });

  it("isKeyPrefix compara por prefijo, también con objetos", () => {
    assert.equal(isKeyPrefix(["trips"], ["trips", { id: 1 }]), true);
    assert.equal(isKeyPrefix(["trips", { id: 1 }], ["trips", { id: 1 }, "legs"]), true);
    assert.equal(isKeyPrefix(["trips", { id: 2 }], ["trips", { id: 1 }]), false);
    assert.equal(isKeyPrefix(["trips", "legs", "x"], ["trips", "legs"]), false);
    assert.equal(isKeyPrefix("trips", ["trips"]), true);
  });
});

describe("QueryCache.fetch", () => {
  it("empieza en idle, pasa por loading y termina en success con los datos", async () => {
    const cache = new QueryCache();
    assert.equal(cache.getState("a").status, "idle");
    const gate = deferred<string>();
    const pending = cache.fetch("a", () => gate.promise);
    assert.equal(cache.getState("a").status, "loading");
    assert.equal(cache.getState("a").isFetching, true);
    gate.resolve("hola");
    assert.equal(await pending, "hola");
    const state = cache.getState<string>("a");
    assert.equal(state.status, "success");
    assert.equal(state.data, "hola");
    assert.equal(state.error, null);
    assert.equal(state.isFetching, false);
    assert.equal(typeof state.updatedAt, "number");
  });

  it("deduplica peticiones simultáneas con la misma clave", async () => {
    const cache = new QueryCache();
    let calls = 0;
    const gate = deferred<number>();
    const fetcher = () => {
      calls += 1;
      return gate.promise;
    };
    const first = cache.fetch(["trip", { id: 7 }], fetcher);
    const second = cache.fetch(["trip", { id: 7 }], fetcher);
    gate.resolve(42);
    assert.deepEqual(await Promise.all([first, second]), [42, 42]);
    assert.equal(calls, 1);
  });

  it("no vuelve a pedir datos frescos y sí con force", async () => {
    let now = 1_000;
    const cache = new QueryCache({ now: () => now });
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return calls;
    };
    await cache.fetch("k", fetcher, { staleTimeMs: 10_000 });
    now += 5_000;
    assert.equal(await cache.fetch("k", fetcher, { staleTimeMs: 10_000 }), 1);
    assert.equal(calls, 1);
    now += 6_000; // ya caducó
    assert.equal(await cache.fetch("k", fetcher, { staleTimeMs: 10_000 }), 2);
    assert.equal(await cache.fetch("k", fetcher, { staleTimeMs: 10_000, force: true }), 3);
    assert.equal(calls, 3);
  });

  it("stale-while-revalidate: mantiene los datos antiguos mientras revalida", async () => {
    const cache = new QueryCache();
    await cache.fetch("k", async () => "viejo");
    const gate = deferred<string>();
    const pending = cache.fetch("k", () => gate.promise);
    const during = cache.getState<string>("k");
    assert.equal(during.status, "success");
    assert.equal(during.data, "viejo");
    assert.equal(during.isFetching, true);
    gate.resolve("nuevo");
    await pending;
    assert.equal(cache.getState<string>("k").data, "nuevo");
    assert.equal(cache.getState("k").isFetching, false);
  });

  it("una revalidación fallida conserva los datos y deja el error", async () => {
    const cache = new QueryCache();
    await cache.fetch("k", async () => "dato");
    const result = await cache.fetch("k", async () => {
      throw new ApiError("boom", "INTERNAL_ERROR", 500);
    });
    assert.equal(result, undefined);
    const state = cache.getState<string>("k");
    assert.equal(state.status, "success");
    assert.equal(state.data, "dato");
    assert.ok(state.error instanceof ApiError);
    assert.equal(typeof state.errorUpdatedAt, "number");
    // y el siguiente éxito limpia el error
    await cache.fetch("k", async () => "otra vez");
    assert.equal(cache.getState("k").error, null);
  });

  it("sin datos: un fallo de red da offline y cualquier otro error da error", async () => {
    const cache = new QueryCache();
    await cache.fetch("net", async () => {
      throw new OfflineError();
    });
    assert.equal(cache.getState("net").status, "offline");
    assert.equal(cache.getState("net").data, undefined);

    await cache.fetch("srv", async () => {
      throw new ApiError("boom", "INTERNAL_ERROR", 500);
    });
    assert.equal(cache.getState("srv").status, "error");

    // un error que no es Error se envuelve
    await cache.fetch("raw", async () => {
      throw "texto";
    });
    assert.ok(cache.getState("raw").error instanceof Error);
  });

  it("fetch nunca rechaza", async () => {
    const cache = new QueryCache();
    await assert.doesNotReject(cache.fetch("k", async () => Promise.reject(new Error("x"))));
  });

  it("tras un fallo, un nuevo fetch vuelve a intentarlo", async () => {
    const cache = new QueryCache();
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      if (calls === 1) throw new OfflineError();
      return "ok";
    };
    await cache.fetch("k", fetcher);
    assert.equal(cache.getState("k").status, "offline");
    await cache.fetch("k", fetcher);
    assert.equal(cache.getState("k").status, "success");
    assert.equal(cache.getState("k").error, null);
  });

  it("una cancelación no es un error: queda sin error y sin isFetching", async () => {
    const cache = new QueryCache();
    const result = await cache.fetch("k", async () => {
      throw createAbortError();
    });
    assert.equal(result, undefined);
    const state = cache.getState("k");
    assert.equal(state.error, null);
    assert.equal(state.isFetching, false);
  });

  it("getState devuelve la misma referencia mientras no cambie (useSyncExternalStore)", async () => {
    const cache = new QueryCache();
    await cache.fetch("k", async () => 1);
    assert.equal(cache.getState("k"), cache.getState("k"));
    assert.equal(cache.getState("nunca"), cache.getState("nunca-tampoco"));
  });

  it("notifica a los suscriptores en cada cambio", async () => {
    const cache = new QueryCache();
    let notifications = 0;
    const unsubscribe = cache.subscribe("k", () => {
      notifications += 1;
    });
    await cache.fetch("k", async () => 1);
    assert.ok(notifications >= 2, `esperaba >= 2 notificaciones (loading + success), hubo ${notifications}`);
    const before = notifications;
    unsubscribe();
    await cache.fetch("k", async () => 2, { force: true });
    assert.equal(notifications, before);
  });
});

describe("cancelación y GC", () => {
  it("aborta la petición en curso cuando se va el último observador", async () => {
    const cache = new QueryCache();
    let signal: AbortSignal | null = null;
    const unsubscribe = cache.subscribe("k", () => undefined);
    const pending = cache.fetch("k", ({ signal: received }) => {
      signal = received;
      return new Promise<string>((_resolve, reject) => {
        received.addEventListener("abort", () => reject(createAbortError()));
      });
    });
    assert.ok(signal);
    assert.equal((signal as AbortSignal).aborted, false);
    unsubscribe();
    await tick(5);
    assert.equal((signal as AbortSignal).aborted, true);
    assert.equal(await pending, undefined);
    assert.equal(cache.getState("k").isFetching, false);
    assert.equal(cache.getState("k").error, null);
  });

  it("no aborta si otro observador se suscribe en el mismo ciclo (StrictMode)", async () => {
    const cache = new QueryCache();
    const first = cache.subscribe("k", () => undefined);
    let signal: AbortSignal | null = null;
    const gate = deferred<string>();
    const pending = cache.fetch("k", ({ signal: received }) => {
      signal = received;
      return gate.promise;
    });
    first();
    const second = cache.subscribe("k", () => undefined);
    await tick(5);
    assert.equal((signal as unknown as AbortSignal).aborted, false);
    gate.resolve("ok");
    assert.equal(await pending, "ok");
    second();
  });

  it("no aborta una petición lanzada sin observadores si nadie se ha ido", async () => {
    // Un `fetch` imperativo (p. ej. prefetch) sin suscriptores no se cancela por sí solo.
    const cache = new QueryCache();
    const gate = deferred<string>();
    const pending = cache.fetch("k", () => gate.promise);
    await tick(5);
    gate.resolve("ok");
    assert.equal(await pending, "ok");
  });

  it("descarta la entrada tras gcTimeMs sin observadores", async () => {
    const cache = new QueryCache({ gcTimeMs: 15 });
    const unsubscribe = cache.subscribe("k", () => undefined);
    await cache.fetch("k", async () => 1);
    assert.equal(cache.size, 1);
    unsubscribe();
    await tick(40);
    assert.equal(cache.size, 0);
    assert.equal(cache.getState("k").status, "idle");
  });

  it("no descarta una entrada observada, ni una que se vuelve a observar antes del GC", async () => {
    const cache = new QueryCache({ gcTimeMs: 25 });
    const first = cache.subscribe("k", () => undefined);
    await cache.fetch("k", async () => 1);
    first();
    await tick(5);
    const second = cache.subscribe("k", () => undefined);
    await tick(50);
    assert.equal(cache.size, 1);
    assert.equal(cache.getData("k"), 1);
    second();
  });
});

describe("setData / isStale / remove", () => {
  it("setData acepta un valor o una función y marca success", () => {
    const cache = new QueryCache();
    cache.setData<number[]>("list", [1]);
    cache.setData<number[]>("list", (old) => [...(old ?? []), 2]);
    const state = cache.getState<number[]>("list");
    assert.deepEqual(state.data, [1, 2]);
    assert.equal(state.status, "success");
  });

  it("isStale considera la edad y la invalidación", async () => {
    let now = 0;
    const cache = new QueryCache({ now: () => now });
    assert.equal(cache.isStale("k", 1000), true); // nunca pedida
    await cache.fetch("k", async () => 1);
    assert.equal(cache.isStale("k", 1000), false);
    now = 999;
    assert.equal(cache.isStale("k", 1000), false);
    now = 1000;
    assert.equal(cache.isStale("k", 1000), true);
    now = 0;
    await cache.invalidate("k");
    assert.equal(cache.isStale("k", 1_000_000), true);
  });

  it("remove borra la entrada y devuelve a los observadores a idle", async () => {
    const cache = new QueryCache();
    let notified = 0;
    cache.subscribe("k", () => {
      notified += 1;
    });
    await cache.fetch("k", async () => 1);
    const before = notified;
    cache.remove("k");
    assert.equal(cache.size, 0);
    assert.equal(cache.getState("k").status, "idle");
    assert.ok(notified > before);
  });
});

describe("invalidate", () => {
  it("revalida las consultas observadas con ese prefijo y solo marca las demás", async () => {
    const cache = new QueryCache();
    let tripCalls = 0;
    let otherCalls = 0;
    const tripFetcher = async () => ++tripCalls;
    const otherFetcher = async () => ++otherCalls;
    const unsubscribe = cache.subscribe(["trips", 1], () => undefined);
    await cache.fetch(["trips", 1], tripFetcher);
    await cache.fetch(["trips", 2], tripFetcher); // sin observador
    await cache.fetch(["wallet"], otherFetcher); // otro prefijo

    await cache.invalidate(["trips"]);
    assert.equal(tripCalls, 3, "solo la observada se revalida (1 + 1 de trips/2 + 1 de la revalidación)");
    assert.equal(cache.getData(["trips", 1]), 3);
    assert.equal(cache.getState(["trips", 2]).isInvalidated, true);
    assert.equal(cache.getState(["wallet"]).isInvalidated, false);
    assert.equal(otherCalls, 1);
    unsubscribe();
  });

  it("una consulta invalidada se vuelve a pedir en el siguiente fetch aunque esté fresca", async () => {
    const cache = new QueryCache();
    let calls = 0;
    const fetcher = async () => ++calls;
    await cache.fetch("k", fetcher, { staleTimeMs: 60_000 });
    await cache.invalidate("k");
    assert.equal(await cache.fetch("k", fetcher, { staleTimeMs: 60_000 }), 2);
    assert.equal(cache.getState("k").isInvalidated, false);
  });

  it("cancela y repite la petición en vuelo de una consulta observada", async () => {
    const cache = new QueryCache();
    cache.subscribe("k", () => undefined);
    const signals: AbortSignal[] = [];
    const first = deferred<string>();
    let call = 0;
    const fetcher = ({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      call += 1;
      if (call === 1) {
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(createAbortError()));
          void first.promise;
        });
      }
      return Promise.resolve("fresco");
    };
    const initial = cache.fetch("k", fetcher);
    await cache.invalidate("k");
    assert.equal(signals[0]?.aborted, true);
    assert.equal(await initial, undefined);
    assert.equal(cache.getData("k"), "fresco");
    assert.equal(call, 2);
  });

  it("sin filtro invalida todo; con función filtra por clave", async () => {
    const cache = new QueryCache();
    await cache.fetch(["a", 1], async () => 1);
    await cache.fetch(["b", 1], async () => 1);
    await cache.invalidate((key) => key[0] === "a");
    assert.equal(cache.getState(["a", 1]).isInvalidated, true);
    assert.equal(cache.getState(["b", 1]).isInvalidated, false);
    await cache.invalidate();
    assert.equal(cache.getState(["b", 1]).isInvalidated, true);
  });
});

describe("clear y fin de sesión", () => {
  it("clear vacía las entradas, cancela las peticiones y avisa a los observadores", async () => {
    const cache = new QueryCache();
    let notified = 0;
    cache.subscribe("k", () => {
      notified += 1;
    });
    await cache.fetch("k", async () => "dato de la cuenta A");
    let signal: AbortSignal | null = null;
    void cache.fetch("otra", ({ signal: received }) => {
      signal = received;
      return new Promise<string>(() => undefined);
    });
    const before = notified;
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.getState("k").data, undefined);
    assert.equal(cache.getState("k").status, "idle");
    assert.equal((signal as unknown as AbortSignal).aborted, true);
    assert.ok(notified > before);
  });

  it("la caché global se vacía con el evento sessionCleared (nunca datos de otra cuenta)", async () => {
    queryCache.setData(["me"], { id: "usuario-a" });
    assert.deepEqual(queryCache.getData(["me"]), { id: "usuario-a" });
    emitSessionCleared();
    assert.equal(queryCache.getData(["me"]), undefined);
    assert.equal(queryCache.size, 0);
  });

  it("el resultado de una petición vieja no resucita una entrada tras clear", async () => {
    const cache = new QueryCache();
    const gate = deferred<string>();
    const pending = cache.fetch("k", () => gate.promise);
    cache.clear();
    gate.resolve("dato de la cuenta A");
    assert.equal(await pending, undefined);
    assert.equal(cache.getState("k").data, undefined);
  });
});
