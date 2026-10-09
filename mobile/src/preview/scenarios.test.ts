/**
 * Escenarios de diseño (`design/scenarios/*.json`): cada fichero cumple el esquema, nombra una pantalla del diseño y una
 * ruta de la app, usa un perfil y una variante de datos que existen, un reloj válido, y sus `{ "$ref": … }` se resuelven
 * en el mundo que ese mismo escenario siembra. Los slices añaden aquí sus propios escenarios en la fase 2: un error de dedo
 * (`"seed": "request-pendiente"`, `"route": "TripResult"`) lo descubre `npm test`, no la herramienta de comparación.
 *
 * Esta prueba solo lee ficheros y siembra el backend en memoria; no necesita la app ni un navegador.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseClockInput } from "./core/clock";
import { PREVIEW_PROFILE_IDS, type PreviewProfileId } from "./core/types";
import { isAcceptedSeed, listSeedVariants } from "./register";
import { createPreviewRuntime } from "./runtime";
import { resolveRefsIn } from "./seeds";

const REPO = path.resolve(__dirname, "../../..");
const SCENARIOS_DIR = path.join(REPO, "design", "scenarios");
const FEATURES_DIR = path.join(REPO, "mobile", "src", "features");

/** Claves que entiende `tools/design/compare.mjs` (más `variant`, que es documentación). Las que empiezan por «_» son comentarios libres. */
const KNOWN_KEYS = new Set(["screen", "variant", "profile", "route", "params", "seed", "clock", "perm", "device", "height", "waitFor", "steps", "note"]);
const PERMS = ["granted", "ask", "denied", "blocked"];
const HAS_OFFSET = /(Z|[+-]\d\d:\d\d)$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProfile(value: unknown): value is PreviewProfileId {
  return typeof value === "string" && (PREVIEW_PROFILE_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------------------------------------------
// Lo que el repositorio dice (diseño y rutas de los slices)
// ---------------------------------------------------------------------------------------------------------------

/** Pantallas del diseño: `01`…`40` y las variantes `13a`, `13b`… con su sufijo. */
function loadDesignScreens(): Map<string, { variant: string }> {
  const manifest: unknown = JSON.parse(fs.readFileSync(path.join(REPO, "design", "manifest.json"), "utf8"));
  const screens = isRecord(manifest) && Array.isArray(manifest.screens) ? manifest.screens : [];
  const out = new Map<string, { variant: string }>();
  for (const entry of screens) {
    if (isRecord(entry) && typeof entry.screen === "string") out.set(entry.screen, { variant: typeof entry.variant === "string" ? entry.variant : "" });
  }
  return out;
}

interface RouteSources {
  /** Texto de todos los `routes.ts` de los slices (y las rutas de desarrollo). */
  text: string;
  /** Nombre de ruta → número de pantalla declarado en `defineRoute({ …, screen: "NN" })`, si se pudo leer. */
  screens: Map<string, string>;
}

function loadRouteSources(): RouteSources {
  const files: string[] = [];
  if (fs.existsSync(FEATURES_DIR)) {
    for (const slice of fs.readdirSync(FEATURES_DIR)) {
      const file = path.join(FEATURES_DIR, slice, "routes.ts");
      if (fs.existsSync(file)) files.push(file);
    }
  }
  const dev = path.join(REPO, "mobile", "src", "navigation", "devRoutes.tsx");
  if (fs.existsSync(dev)) files.push(dev);
  const screens = new Map<string, string>();
  let text = "";
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    text += `${source}\n`;
    for (const part of source.split("defineRoute(").slice(1)) {
      const name = /name:\s*"([A-Za-z][A-Za-z0-9]*)"/.exec(part)?.[1];
      const screen = /screen:\s*"(\d\d)"/.exec(part)?.[1];
      if (name && screen) screens.set(name, screen);
    }
  }
  return { text, screens };
}

const designScreens = loadDesignScreens();
const routeSources = loadRouteSources();

// ---------------------------------------------------------------------------------------------------------------
// El validador (se prueba a sí mismo con escenarios rotos a propósito)
// ---------------------------------------------------------------------------------------------------------------

/** Problemas de un escenario (lista vacía = correcto). */
function checkScenario(file: string, data: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const unknown = Object.keys(data).filter((key) => !KNOWN_KEYS.has(key) && !key.startsWith("_"));
  if (unknown.length > 0) problems.push(`claves desconocidas (¿errata?): ${unknown.join(", ")}. Válidas: ${[...KNOWN_KEYS].join(", ")}`);

  // pantalla del diseño
  if (typeof data.screen !== "string") problems.push('falta «screen» (texto, p. ej. "11" o "13a")');
  else {
    if (file !== `${data.screen}.json`) problems.push(`el fichero debe llamarse como su pantalla («${data.screen}.json»), no «${file}»`);
    const design = designScreens.get(data.screen);
    if (!design) problems.push(`la pantalla «${data.screen}» no está en design/manifest.json`);
    else if (data.variant !== undefined && data.variant !== design.variant) problems.push(`«variant» es «${String(data.variant)}» y la lámina del diseño es «${design.variant}»`);
  }

  // ruta de la app
  if (typeof data.route !== "string" || data.route === "") problems.push("falta «route» (nombre de la ruta de la app)");
  else {
    if (!routeSources.text.includes(`"${data.route}"`)) problems.push(`la ruta «${data.route}» no aparece en ningún routes.ts de los slices`);
    const declared = routeSources.screens.get(data.route);
    if (declared !== undefined && typeof data.screen === "string" && declared !== data.screen.slice(0, 2)) {
      problems.push(`«${data.route}» es la pantalla ${declared} del diseño y el escenario dice ${data.screen}`);
    }
  }

  // mundo que se siembra
  if (data.profile !== undefined && !isProfile(data.profile)) problems.push(`perfil desconocido «${String(data.profile)}» (${PREVIEW_PROFILE_IDS.join(", ")})`);
  if (data.seed !== undefined && !(typeof data.seed === "string" && isAcceptedSeed(data.seed))) {
    problems.push(`variante de datos desconocida «${String(data.seed)}». Disponibles: ${listSeedVariants().map((v) => v.name).join(", ")}`);
  }
  if (data.clock !== undefined) {
    if (typeof data.clock !== "string") problems.push("«clock» debe ser un texto ISO");
    else if (!HAS_OFFSET.test(data.clock)) problems.push("«clock» debe llevar desfase (+02:00 o Z): sin él depende de la zona horaria del navegador");
    else {
      try {
        parseClockInput(data.clock);
      } catch {
        problems.push(`«clock» no es una fecha-hora ISO válida: ${data.clock}`);
      }
    }
  }

  // opciones de la herramienta
  if (data.perm !== undefined && !PERMS.includes(String(data.perm))) problems.push(`«perm» debe ser ${PERMS.join("|")}`);
  if (data.device !== undefined && typeof data.device !== "string") problems.push("«device» debe ser un texto");
  if (data.height !== undefined && !(typeof data.height === "number" && data.height > 300 && data.height < 2000)) problems.push("«height» son puntos (300–2000)");
  if (data.waitFor !== undefined && typeof data.waitFor !== "string") problems.push("«waitFor» debe ser un texto");
  if (data.steps !== undefined && !Array.isArray(data.steps)) problems.push("«steps» debe ser una lista de pasos ({fill,text} | {click} | {wait})");
  if (data.note !== undefined && typeof data.note !== "string") problems.push("«note» debe ser un texto");

  // parámetros y referencias
  if (data.params !== undefined) {
    if (!isRecord(data.params)) problems.push("«params» debe ser un objeto");
    else {
      const walk = (node: unknown, where: string): void => {
        if (Array.isArray(node)) node.forEach((item, index) => walk(item, `${where}[${index}]`));
        else if (isRecord(node)) {
          if ("$ref" in node && Object.keys(node).length !== 1) problems.push(`${where}: un objeto con $ref no puede llevar más claves (se ignoraría)`);
          for (const [key, value] of Object.entries(node)) walk(value, `${where}.${key}`);
        }
      };
      walk(data.params, "params");
      if (problems.length === 0 && JSON.stringify(data.params).includes("$ref")) {
        const runtime = createPreviewRuntime({
          latency: 0,
          profile: isProfile(data.profile) ? data.profile : "passenger",
          seed: typeof data.seed === "string" ? data.seed : "default",
          ...(typeof data.clock === "string" ? { clock: data.clock } : {}),
        });
        try {
          const resolved = JSON.stringify(resolveRefsIn(runtime.db, data.params));
          if (resolved.includes("$ref")) problems.push("quedaron referencias sin resolver");
          else if ((resolved.match(UUID) ?? []).length === 0) problems.push("las referencias deberían haberse sustituido por ids");
        } catch (error) {
          problems.push(`referencia sin resolver: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// Pruebas
// ---------------------------------------------------------------------------------------------------------------

const GOOD: Record<string, unknown> = {
  screen: "20",
  variant: "",
  profile: "driver",
  route: "DriverRequests",
  params: { tripId: { $ref: "trip.anaMorning" } },
  seed: "request-pending",
  clock: "2026-10-05T07:17:00+02:00",
};

describe("validador de escenarios", () => {
  it("el diseño y las rutas de los slices se pudieron leer (si no, esta prueba no comprobaría nada)", () => {
    assert.ok(designScreens.size >= 40, `design/manifest.json lista ${designScreens.size} pantallas`);
    assert.ok(designScreens.has("13a") && designScreens.has("13b") && designScreens.has("11"));
    assert.ok(routeSources.text.length > 0, "no se encontró ningún routes.ts de slice");
    assert.ok(routeSources.screens.size >= 30, `se leyeron ${routeSources.screens.size} rutas con su pantalla`);
    assert.equal(routeSources.screens.get("TripResults"), "11");
    assert.equal(routeSources.screens.get("DriverRequests"), "20");
  });

  it("un escenario correcto no tiene problemas", () => {
    assert.deepEqual(checkScenario("20.json", GOOD), []);
    assert.deepEqual(checkScenario("11.json", { screen: "11", route: "TripResults" }), [], "solo «route» es obligatorio para la herramienta");
  });

  it("descubre las erratas típicas con un mensaje que dice qué arreglar", () => {
    const cases: Array<[string, Record<string, unknown>, RegExp, string?]> = [
      ["clave desconocida", { ...GOOD, perfil: "driver" }, /claves desconocidas.*perfil/],
      ["comentario libre con «_»", { ...GOOD, _comentario: "ok" }, /^$/],
      ["fichero que no se llama como la pantalla", GOOD, /debe llamarse como su pantalla/, "21.json"],
      ["pantalla que no existe", { ...GOOD, screen: "99" }, /«99» no está en design\/manifest\.json/, "99.json"],
      ["variante que no es la de la lámina", { ...GOOD, screen: "13a", route: "PickupPoint", variant: "b", params: undefined }, /«variant» es «b» y la lámina del diseño es «a»/, "13a.json"],
      ["ruta inexistente", { ...GOOD, route: "TripResult" }, /ruta «TripResult» no aparece en ningún routes\.ts/],
      ["ruta de otra pantalla", { ...GOOD, route: "TripResults" }, /«TripResults» es la pantalla 11 del diseño y el escenario dice 20/],
      ["perfil desconocido", { ...GOOD, profile: "conductor" }, /perfil desconocido «conductor»/],
      ["variante de datos con errata", { ...GOOD, seed: "request-pendiente" }, /variante de datos desconocida «request-pendiente»\. Disponibles: default/],
      ["reloj sin desfase", { ...GOOD, clock: "2026-10-05T07:17:00" }, /debe llevar desfase/],
      ["reloj imposible", { ...GOOD, clock: "2026-13-45T07:17:00+02:00" }, /no es una fecha-hora ISO válida/],
      ["perm inválido", { ...GOOD, perm: "siempre" }, /«perm» debe ser granted\|ask\|denied\|blocked/],
      ["$ref con claves de más", { ...GOOD, params: { tripId: { $ref: "trip.anaMorning", extra: 1 } } }, /un objeto con \$ref no puede llevar más claves/],
      ["$ref que no existe en el mundo del escenario", { ...GOOD, seed: "default", params: { requestId: { $ref: "request.miguel" } } }, /no existe en este mundo \(perfil «driver», variante «default»\)/],
      ["$ref con nombre desconocido", { ...GOOD, params: { x: { $ref: "nada.nada" } } }, /Referencia desconocida «nada\.nada»/],
      ["params que no es un objeto", { ...GOOD, params: "x" }, /«params» debe ser un objeto/],
    ];
    for (const [name, data, expected, file = "20.json"] of cases) {
      const problems = checkScenario(file, data);
      if (expected.source === "^$") assert.deepEqual(problems, [], name);
      else assert.ok(problems.some((p) => expected.test(p)), `${name}: se esperaba ${String(expected)} y salió ${JSON.stringify(problems)}`);
    }
  });
});

describe("escenarios de diseño (design/scenarios)", () => {
  const files = fs.existsSync(SCENARIOS_DIR) ? fs.readdirSync(SCENARIOS_DIR).filter((name) => name.endsWith(".json")).sort() : [];

  it("hay al menos los tres escenarios de ejemplo", () => {
    assert.ok(files.length >= 3, `hay ${files.length} escenarios`);
    for (const expected of ["11.json", "17.json", "20.json"]) assert.ok(files.includes(expected), `falta ${expected}`);
  });

  for (const file of files) {
    it(`${file} es válido`, () => {
      const text = fs.readFileSync(path.join(SCENARIOS_DIR, file), "utf8");
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch (error) {
        assert.fail(`design/scenarios/${file} no es JSON válido: ${error instanceof Error ? error.message : String(error)}`);
      }
      assert.ok(isRecord(data), "debe ser un objeto JSON");
      assert.deepEqual(checkScenario(file, data), []);
    });
  }
});
