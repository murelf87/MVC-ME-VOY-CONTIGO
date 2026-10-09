/**
 * Instalador: solo actúa con EXPO_PUBLIC_PREVIEW=1, sustituye `fetch` solo para el API/almacenamiento reservados, respeta
 * el arranque del visor (perfil, variante, reloj), la red simulada (modo avión), las señales de cancelación, la
 * persistencia en sessionStorage y se puede deshacer.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { installPreview, installPreviewIfEnabled, SESSION_ME_KEY, SESSION_TOKEN_KEY, type PreviewInstallation } from "./install";
import { PERSIST_KEY } from "./persist";
import { installBrowserStorage, clearShell, withShell } from "./testing/harness";

type Holder = {
  fetch?: typeof fetch;
  location?: { search?: string };
  __mvc?: unknown;
  __MVC_PREVIEW_BACKEND__?: unknown;
};
const holder = globalThis as unknown as Holder;

const API = "https://api.mvc-preview.invalid";
let installation: PreviewInstallation | null = null;
let originalFetch: typeof fetch | undefined;
let outsideCalls: string[] = [];
let browser: ReturnType<typeof installBrowserStorage>;
let savedEnv: { preview: string | undefined; apiUrl: string | undefined };

beforeEach(() => {
  savedEnv = { preview: process.env.EXPO_PUBLIC_PREVIEW, apiUrl: process.env.EXPO_PUBLIC_API_URL };
  delete process.env.EXPO_PUBLIC_PREVIEW;
  delete process.env.EXPO_PUBLIC_API_URL;
  originalFetch = holder.fetch;
  outsideCalls = [];
  holder.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    outsideCalls.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    return new Response("fuera", { status: 200 });
  }) as typeof fetch;
  browser = installBrowserStorage();
});

afterEach(() => {
  installation?.uninstall();
  installation = null;
  holder.fetch = originalFetch;
  browser.restore();
  clearShell();
  delete holder.location;
  if (savedEnv.preview === undefined) delete process.env.EXPO_PUBLIC_PREVIEW;
  else process.env.EXPO_PUBLIC_PREVIEW = savedEnv.preview;
  if (savedEnv.apiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = savedEnv.apiUrl;
});

function install(options: Parameters<typeof installPreview>[0] = {}): PreviewInstallation {
  const result = installPreview({ force: true, latency: 0, persist: false, jobsIntervalMs: 0, ...options });
  assert.ok(result, "debía instalarse");
  installation = result;
  return result;
}

describe("activación", () => {
  it("sin EXPO_PUBLIC_PREVIEW=1 no hace nada: ni fetch, ni window.__mvc, ni backend", () => {
    const before = holder.fetch;
    assert.equal(installPreview(), null);
    installPreviewIfEnabled();
    assert.equal(holder.fetch, before);
    assert.equal(holder.__mvc, undefined);
    assert.equal(holder.__MVC_PREVIEW_BACKEND__, undefined);
  });

  it("con EXPO_PUBLIC_PREVIEW=1 installPreviewIfEnabled instala y es idempotente", () => {
    process.env.EXPO_PUBLIC_PREVIEW = "1";
    installPreviewIfEnabled();
    const first = (holder.__MVC_PREVIEW_BACKEND__ as { installation: PreviewInstallation } | undefined)?.installation;
    assert.ok(first, "instalado");
    installation = first;
    installPreviewIfEnabled();
    assert.equal(installPreview(), first, "una segunda instalación devuelve la primera");
    assert.equal(typeof (holder.__mvc as { open?: unknown } | undefined)?.open, "function");
  });

  it("uninstall() restaura fetch, retira window.__mvc y permite instalar de nuevo", () => {
    const before = holder.fetch;
    const first = install();
    assert.notEqual(holder.fetch, before);
    first.uninstall();
    installation = null;
    assert.equal(holder.fetch, before);
    assert.equal(holder.__mvc, undefined);
    assert.equal(holder.__MVC_PREVIEW_BACKEND__, undefined);
    const second = install();
    assert.notEqual(second, first);
  });
});

describe("red", () => {
  it("atiende el API reservado con la marca de simulación y deja pasar lo demás al fetch anterior", async () => {
    install();
    const health = await fetch(`${API}/health/live`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    assert.match(health.headers.get("x-mvc-simulation") ?? "", /simulacion/);
    assert.deepEqual(outsideCalls, []);
    const other = await fetch("https://example.com/algo");
    assert.equal(await other.text(), "fuera");
    assert.deepEqual(outsideCalls, ["https://example.com/algo"]);
  });

  it("reconoce los tres orígenes reservados, cualquier api.*.invalid y el host de EXPO_PUBLIC_API_URL", async () => {
    process.env.EXPO_PUBLIC_API_URL = "https://staging.mvc.example/api";
    install();
    for (const origin of [
      "https://api.mvc-preview.invalid",
      "https://api.preview.mvc.invalid",
      "https://preview.mvc.local",
      "https://api.otro-sitio.invalid",
      "https://staging.mvc.example",
    ]) {
      const res = await fetch(`${origin}/health/live`);
      assert.equal(res.status, 200, origin);
    }
    assert.deepEqual(outsideCalls, []);
  });

  it("modo avión simulado: el API rechaza con TypeError «Failed to fetch» y al volver la red responde", async () => {
    let offline = true;
    await withShell({ isOffline: () => offline } as never, async () => {
      install();
      await assert.rejects(() => fetch(`${API}/health/live`), (error: unknown) => error instanceof TypeError && error.message === "Failed to fetch");
      offline = false;
      assert.equal((await fetch(`${API}/health/live`)).status, 200);
    });
  });

  it("sin isOffline, sim.network === 'none' también corta la red", async () => {
    await withShell({ sim: { network: "none" } } as never, async () => {
      install();
      await assert.rejects(() => fetch(`${API}/health/live`), TypeError);
    });
  });

  it("una señal de cancelación aborta la petición en vuelo con AbortError", async () => {
    install({ latency: 200 });
    const controller = new AbortController();
    const pending = fetch(`${API}/health/live`, { signal: controller.signal });
    setTimeout(() => controller.abort(), 15);
    await assert.rejects(pending, (error: unknown) => (error as Error).name === "AbortError");
    const already = new AbortController();
    already.abort();
    await assert.rejects(() => fetch(`${API}/health/live`, { signal: already.signal }), (error: unknown) => (error as Error).name === "AbortError");
  });

  it("la latencia simulada se respeta (y 0 la desactiva)", async () => {
    install({ latency: 60 });
    const started = Date.now();
    await fetch(`${API}/health/live`);
    assert.ok(Date.now() - started >= 50, "tardó al menos ~60 ms");
  });

  it("onRequest del visor recibe cada petición atendida", async () => {
    const seen: string[] = [];
    await withShell({ onRequest: (entry: { path: string; status: number | null }) => void seen.push(`${entry.path}:${entry.status}`) } as never, async () => {
      install();
      await fetch(`${API}/health/live`);
      await fetch(`${API}/no-existe`);
    });
    assert.deepEqual(seen, ["/health/live:200", "/no-existe:404"]);
  });
});

describe("arranque pedido por el visor o por la URL", () => {
  it("toma perfil, variante y reloj de shell.boot, y mueve el reloj del anfitrión con setClock", async () => {
    const clockCalls: Array<string | null> = [];
    await withShell(
      {
        boot: { profile: "driver", seed: "request-pending", clock: "2026-10-05T07:58:00+02:00" },
        setClock: (iso: string | null) => void clockCalls.push(iso),
      } as never,
      () => {
        const i = install();
        assert.equal(i.runtime.db.profile, "driver");
        assert.equal(i.runtime.db.seedName, "request-pending");
        assert.equal(i.clockMode, "host");
        assert.deepEqual(clockCalls, ["2026-10-05T07:58:00+02:00"]);
        assert.equal(browser.local.getItem(SESSION_TOKEN_KEY), i.runtime.sessionToken("driver"));
      }
    );
  });

  it("sin visor lee mvcProfile / mvcSeed / mvcClock de la URL y el reloj corre (modo running)", () => {
    holder.location = { search: "?mvcProfile=admin&mvcSeed=empty&mvcClock=2026-10-06T09:00:00%2B02:00" };
    const i = install();
    assert.equal(i.runtime.db.profile, "admin");
    assert.equal(i.runtime.db.seedName, "empty");
    assert.equal(i.clockMode, "running");
    assert.equal(i.runtime.db.clock.getMode(), "running");
    const now = i.runtime.db.clock.nowMs();
    assert.ok(Math.abs(now - Date.parse("2026-10-06T09:00:00+02:00")) < 5_000);
  });

  it("opciones explícitas mandan sobre el visor y la URL; un perfil desconocido en la URL se ignora", () => {
    holder.location = { search: "?mvcProfile=superusuario" };
    const unknown = install();
    assert.equal(unknown.runtime.db.profile, "new");
    unknown.uninstall();
    installation = null;
    holder.location = { search: "?mvcProfile=admin" };
    const explicit = install({ profile: "passenger" });
    assert.equal(explicit.runtime.db.profile, "passenger");
  });

  it("una variante desconocida en la URL no rompe el arranque: se usa «default» y se avisa con las disponibles", () => {
    holder.location = { search: "?mvcProfile=passenger&mvcSeed=request-pendiente" };
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
    try {
      const i = install();
      assert.equal(i.runtime.db.seedName, "default");
      assert.equal(i.runtime.db.profile, "passenger");
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /«request-pendiente» no existe; se usa «default»\. Disponibles: default, driver-requests, empty/);
  });

  it("clockMode del visor: «frozen» deja el reloj de las láminas quieto", async () => {
    await withShell({ clockMode: "frozen" } as never, async () => {
      const i = install();
      assert.equal(i.runtime.db.clock.iso(), "2026-10-05T05:17:00.000Z");
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(i.runtime.db.clock.iso(), "2026-10-05T05:17:00.000Z");
    });
  });

  it("clock: null significa hora real", () => {
    const i = install({ clock: null });
    assert.ok(Math.abs(i.runtime.db.clock.nowMs() - Date.now()) < 5_000);
  });
});

describe("Date global y sesión en el navegador", () => {
  it("sin visor y con el reloj en marcha sustituye Date; el modo host y patchDate:false no lo tocan", () => {
    const real = Date.now();
    const i = install({ clock: "2026-10-05T07:17:00+02:00" });
    assert.ok(Math.abs(Date.now() - Date.parse("2026-10-05T07:17:00+02:00")) < 5_000, "Date.now() es la hora virtual");
    i.uninstall();
    installation = null;
    assert.ok(Math.abs(Date.now() - real) < 5_000, "uninstall devuelve la hora real");
    const untouched = install({ patchDate: false });
    assert.ok(Math.abs(Date.now() - real) < 5_000);
    untouched.uninstall();
    installation = null;
  });

  it("escribe el token del perfil en localStorage y retira la copia de /me; «Persona nueva» lo borra", () => {
    browser.local.setItem(SESSION_ME_KEY, "{}");
    const i = install({ profile: "passenger" });
    assert.equal(browser.local.getItem(SESSION_TOKEN_KEY), i.runtime.sessionToken("passenger"));
    assert.equal(browser.local.getItem(SESSION_ME_KEY), null);
    i.uninstall();
    installation = null;
    install({ profile: "new" });
    assert.equal(browser.local.getItem(SESSION_TOKEN_KEY), null);
  });

  it("writeSessionToken:false no toca localStorage", () => {
    browser.local.setItem(SESSION_TOKEN_KEY, "otro");
    install({ profile: "passenger", writeSessionToken: false });
    assert.equal(browser.local.getItem(SESSION_TOKEN_KEY), "otro");
  });

  it("el token escrito abre sesión en el backend: GET /me responde con el perfil", async () => {
    const i = install({ profile: "passenger" });
    const res = await fetch(`${API}/me`, { headers: { authorization: `Bearer ${browser.local.getItem(SESSION_TOKEN_KEY)}` } });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { display_name: string }).display_name, "Miguel Torres");
    assert.equal(i.runtime.db.profile, "passenger");
  });
});

describe("persistencia y tareas", () => {
  it("guarda el mundo en sessionStorage y lo restaura al reinstalar con el mismo arranque", async () => {
    const first = install({ persist: true, profile: "passenger" });
    const signUp = await fetch(`${API}/v1/auth/phone/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+34644000111" }),
    });
    assert.equal(signUp.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 520));
    assert.ok(browser.session.getItem(PERSIST_KEY), "hay una copia guardada");
    first.uninstall();
    installation = null;
    const second = install({ persist: true, profile: "passenger" });
    assert.equal(second.runtime.db.challenges.filter((c) => c.phone_e164 === "+34644000111").length, 1, "el desafío sobrevive a la recarga");
  });

  it("si cambia el perfil pedido, la copia guardada se descarta", async () => {
    const first = install({ persist: true, profile: "passenger" });
    await fetch(`${API}/v1/auth/phone/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+34644000112" }),
    });
    await new Promise((resolve) => setTimeout(resolve, 520));
    first.uninstall();
    installation = null;
    const other = install({ persist: true, profile: "driver" });
    assert.equal(other.runtime.db.challenges.filter((c) => c.phone_e164 === "+34644000112").length, 0);
  });

  it("las reglas dependientes del tiempo se evalúan fuera de las peticiones y dejan de hacerlo al desinstalar", async () => {
    const i = install({ jobsIntervalMs: 15 });
    let runs = 0;
    i.runtime.db.jobs.register("prueba", () => {
      runs += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.ok(runs >= 2, `se ejecutó ${runs} veces`);
    i.uninstall();
    installation = null;
    const after = runs;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(runs, after);
  });

  it("window.__mvc queda publicado y marca que es una simulación", () => {
    const i = install({ appLoader: () => null });
    assert.equal(holder.__mvc, i.bridge);
    assert.equal(i.bridge.simulation, true);
    assert.equal(i.bridge.ready(), false, "sin app cargada (Node) no hay navegación");
    assert.deepEqual(i.bridge.routes(), []);
  });
});
