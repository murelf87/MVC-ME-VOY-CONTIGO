/**
 * Conformidad con el backend REAL: el recorrido de 119 peticiones (`flow.ts`) se ejecuta contra el backend en memoria y
 * se compara, paso a paso, con las respuestas reales fotografiadas en `real-backend-steps.json` (estado, código y
 * mensaje de error, y forma + valores del cuerpo).
 *
 * Las diferencias CONOCIDAS están en `DIVERGENCES`, cada una con su motivo. La prueba falla también si una excepción
 * ya no se produce (lista obsoleta) o si aparece una diferencia que no está listada.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { setUnexpectedErrorReporter } from "../core/server";
import { createPreviewRuntime, type PreviewRuntime } from "../runtime";
import { clearShell } from "../testing/harness";
import { canonicalize, diffJson, genericPath, type Difference } from "./compare";
import { FLOW_OTP, runRealBackendFlow, type FlowStep } from "./flow";

interface Golden {
  _capturedAgainst: string;
  steps: FlowStep[];
}

interface Divergence {
  /** Etiquetas de los pasos a los que aplica. */
  labels: readonly string[];
  reason: string;
  /** Estado `[real, vista previa]` si cambia. */
  status?: readonly [number, number];
  /** Caminos genéricos (`$.a[].b`) cuyo valor puede diferir; también cubren todo lo que cuelga de ellos. */
  ignore?: readonly string[];
}

const DIVERGENCES: readonly Divergence[] = [
  {
    labels: ["patch profile short", "vehicle bad seats", "intent too big", "trip no auth"],
    reason:
      "El manejador global del backend 0.14 (auth, perfil, vehículos, subidas) responde 500 INTERNAL_ERROR cuando falla la " +
      "validación del esquema (defecto conocido); los módulos nuevos (trips, live, money, comms, trust) responden 400 " +
      "VALIDATION_ERROR con details [{ path, message, keyword }]. La vista previa sigue a los módulos.",
    status: [500, 400],
    ignore: ["$.error"],
  },
  {
    labels: ["review doc insurance expired"],
    reason:
      "La ruta real descarta `verifiedExpiresOn` (el esquema del cuerpo no lo declara), así que un seguro NO se puede aprobar " +
      "por HTTP con fecha manual. La vista previa sí la respeta, para que las pantallas de revisión sean completas.",
    status: [400, 409],
    ignore: ["$.error"],
  },
  {
    labels: ["create vehicle", "put vehicle"],
    reason: "El contrato `trips` (docs/contracts/trips.md) añade el campo opcional `color` a los vehículos; el 0.14 no lo tiene.",
    ignore: ["$.color"],
  },
  {
    labels: ["list vehicles", "list vehicles after docs", "list vehicles approved"],
    reason: "El contrato `trips` añade `color` a GET /v1/me/vehicles; el 0.14 no lo tiene.",
    ignore: ["$.vehicles[].color"],
  },
  {
    labels: ["geocode", "reverse"],
    reason: "Proveedor de geocodificación simulado (gazetario de Sevilla) frente al proveedor falso del arnés real.",
    ignore: [
      "$.results[].formattedAddress",
      "$.results[].location",
      "$.results[].placeId",
      "$.results[].provider",
      "$.results[].types",
    ],
  },
  {
    labels: ["create trip"],
    reason: "Rutas calculadas por el proveedor de rutas simulado (preview-sim), no por el falso del arnés.",
    ignore: ["$.route_distance_m", "$.route_duration_s", "$.route_provider", "$.route_provider_ref"],
  },
  {
    labels: ["list trips", "list trips after"],
    reason: "Rutas calculadas por el proveedor de rutas simulado.",
    ignore: ["$.trips[].route_distance_m", "$.trips[].route_duration_s", "$.trips[].route_provider", "$.trips[].route_provider_ref"],
  },
  {
    labels: ["search", "search radius", "search after hold"],
    reason: "Distancia y duración por carretera del proveedor de rutas simulado.",
    ignore: ["$.trips[].estimatedDurationS", "$.trips[].roadDistanceM"],
  },
  {
    labels: ["pickup code"],
    reason: "El código de recogida es aleatorio en el real y determinista (pero distinto) en la vista previa; solo importa que tenga 6 cifras.",
    ignore: ["$.code"],
  },
];

/** Arrays que el backend real devuelve en un orden no garantizado (`array_agg` sin `ORDER BY`): se comparan como conjunto. */
const UNORDERED_PATHS = new Set(["$.roles", "$.user.roles"]);

function sortUnordered(value: unknown, at = "$"): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => sortUnordered(item, `${at}[]`));
    return UNORDERED_PATHS.has(at) ? [...items].sort() : items;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = sortUnordered(item, `${at}.${key}`);
    return out;
  }
  return value;
}

/** Los enlaces firmados al almacenamiento privado cambian de anfitrión y firma: se compara la clave del objeto. */
function normalizeStorageUrls(value: unknown): unknown {
  if (typeof value === "string") {
    const match = /^https:\/\/(?:upload|download|storage)[^/]*\.invalid\/([^?]+)\?/.exec(value);
    return match ? `<storage>/${match[1] ?? ""}` : value;
  }
  if (Array.isArray(value)) return value.map(normalizeStorageUrls);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = normalizeStorageUrls(item);
    return out;
  }
  return value;
}

function prepare(body: unknown): unknown {
  return canonicalize(sortUnordered(normalizeStorageUrls(body)));
}

function covers(ignorePath: string, diffPath: string): boolean {
  const generic = genericPath(diffPath);
  return generic === ignorePath || generic.startsWith(`${ignorePath}.`) || generic.startsWith(`${ignorePath}[`);
}

function describeDiff(diff: Difference): string {
  return `${diff.kind} ${diff.path}: real=${JSON.stringify(diff.expected)} preview=${JSON.stringify(diff.actual)}`;
}

describe("conformidad con las respuestas reales del backend 0.14", () => {
  let golden: Golden;
  let preview: FlowStep[];
  let runtime: PreviewRuntime;
  const unexpected: string[] = [];

  before(async () => {
    golden = JSON.parse(fs.readFileSync(path.join(__dirname, "real-backend-steps.json"), "utf8")) as Golden;
    setUnexpectedErrorReporter((error, method, route) => {
      // El 500 de «complete photo (not uploaded)» es un `ApiFailure` replicado a propósito: no pasa por aquí.
      unexpected.push(`${method} ${route}: ${error instanceof Error ? error.message : String(error)}`);
    });
    // El visor falso fija el código SMS (el proveedor falso del arnés real aceptaba 123456).
    (globalThis as { __MVC_PREVIEW_SHELL__?: unknown }).__MVC_PREVIEW_SHELL__ = { otp: FLOW_OTP };
    runtime = createPreviewRuntime({ latency: 0, skipSeed: true, profile: "new", rngSeed: "conformance", slices: false });
    preview = await runRealBackendFlow(runtime);
  });

  after(() => {
    clearShell();
    setUnexpectedErrorReporter((error, method, route) => {
      if (typeof console !== "undefined") console.error(`[mvc-preview] error inesperado en ${method} ${route}`, error);
    });
  });

  it("el recorrido tiene los mismos pasos, en el mismo orden y con las mismas rutas", () => {
    assert.equal(golden.steps.length, 119);
    assert.equal(preview.length, golden.steps.length);
    for (let i = 0; i < golden.steps.length; i += 1) {
      const real = golden.steps[i] as FlowStep;
      const sim = preview[i] as FlowStep;
      assert.equal(sim.label, real.label, `paso ${i}`);
      assert.equal(sim.method, real.method, `paso ${i} «${real.label}»`);
      assert.equal(canonicalize(sim.url), canonicalize(real.url), `paso ${i} «${real.label}»`);
    }
  });

  it("cada respuesta coincide con la real salvo las diferencias documentadas", () => {
    const failures: string[] = [];
    const used = new Set<Divergence>();
    for (let i = 0; i < golden.steps.length; i += 1) {
      const real = golden.steps[i] as FlowStep;
      const sim = preview[i] as FlowStep;
      const divergence = DIVERGENCES.find((d) => d.labels.includes(real.label));
      const problems: string[] = [];

      let statusDiffers = false;
      if (divergence?.status) {
        assert.ok(real.status === divergence.status[0], `«${real.label}»: la fotografía real ya no es ${divergence.status[0]}`);
        if (sim.status !== divergence.status[1]) problems.push(`estado ${sim.status}, se esperaba ${divergence.status[1]} (diferencia documentada)`);
        statusDiffers = true;
      } else if (sim.status !== real.status) {
        problems.push(`estado ${sim.status}, el real es ${real.status}`);
      }
      if ((sim.headers["content-type"] ?? "") !== (real.headers["content-type"] ?? "")) {
        problems.push(`content-type «${sim.headers["content-type"]}», el real es «${real.headers["content-type"]}»`);
      }

      const diffs = diffJson(prepare(real.body), prepare(sim.body));
      const ignore = divergence?.ignore ?? [];
      const consumed = diffs.filter((d) => ignore.some((entry) => covers(entry, d.path)));
      const remaining = diffs.filter((d) => !ignore.some((entry) => covers(entry, d.path)));
      for (const diff of remaining) problems.push(describeDiff(diff));
      if (divergence && (statusDiffers || consumed.length > 0)) used.add(divergence);

      if (problems.length > 0) failures.push(`#${i} «${real.label}»\n    ${problems.slice(0, 8).join("\n    ")}`);
    }
    assert.deepEqual(failures, [], `Diferencias con el backend real:\n${failures.join("\n")}`);
    const stale = DIVERGENCES.filter((d) => !used.has(d)).map((d) => d.labels.join(", "));
    assert.deepEqual(stale, [], `Excepciones obsoletas (ya no se producen): ${stale.join(" | ")}`);
  });

  it("el código de recogida son 6 cifras", () => {
    const step = preview.find((s) => s.label === "pickup code");
    const code = (step?.body as { code?: unknown } | undefined)?.code;
    assert.match(String(code), /^\d{6}$/);
  });

  it("el único 500 es el replicado a propósito (completar una subida que no existe) y ningún manejador falló", () => {
    const fiveHundreds = preview.filter((s) => s.status === 500).map((s) => s.label);
    assert.deepEqual(fiveHundreds, ["complete photo (not uploaded)"]);
    assert.deepEqual(unexpected, [], `Fallos inesperados en manejadores: ${unexpected.join(" || ")}`);
  });

  it("toda respuesta de error lleva requestId y la misma envoltura que el real", () => {
    for (const step of preview) {
      if (step.status < 400) continue;
      const body = step.body as { error?: { code?: unknown; message?: unknown }; requestId?: unknown; message?: unknown };
      if (step.status === 404 && typeof body.message === "string" && body.error === undefined) continue; // 404 por defecto de Fastify
      assert.equal(typeof body.error?.code, "string", `«${step.label}» sin error.code`);
      assert.equal(typeof body.error?.message, "string", `«${step.label}» sin error.message`);
      assert.match(String(body.requestId), /^req-[0-9a-z]+$/, `«${step.label}» sin requestId`);
    }
  });

  it("los pasos clave del flujo dejan el mundo en el estado esperado", () => {
    const { db } = runtime;
    const trip = db.trips.all()[0];
    assert.ok(trip);
    assert.equal(trip.status, "completed");
    const booking = db.bookings.all()[0];
    assert.ok(booking);
    assert.equal(booking.status, "completed");
    assert.equal(db.messages.all().length, 2, "dos mensajes (el reenvío idempotente no duplica)");
    assert.equal(db.blocks.all().length, 0, "el bloqueo se deshizo");
  });
});
