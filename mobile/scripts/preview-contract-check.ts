/**
 * Contrato del backend EN MEMORIA de la vista previa frente a `docs/openapi.json` (solo lectura; el OpenAPI lo genera
 * el backend real y es del orquestador).
 *
 *   cd mobile && ../node_modules/.bin/tsx scripts/preview-contract-check.ts [--openapi <ruta>] [--json] [--verbose]
 *                                                                          [--strict-coverage] [--help]
 *
 * Qué comprueba (todo contra la simulación, sin red):
 *
 *   1. COBERTURA   cada operación del OpenAPI tiene ruta en la vista previa (falta = FALLO). Las rutas que la vista previa
 *                  tiene y el OpenAPI aún no documenta (módulos nuevos) se listan como INFO (con --strict-coverage, FALLO).
 *   2. SEGURIDAD   las operaciones con `security` responden 401 sin sesión y las públicas no.
 *   3. PETICIÓN    paridad de validación: de cada esquema de parámetros/cuerpo del OpenAPI se derivan casos límite (falta
 *                  una propiedad obligatoria, tipo erróneo, mínimo−1, máximo+1, fuera del enum, formato inválido, lista
 *                  corta o larga, propiedad extra…). La respuesta esperada la da el validador «tipo Ajv» aplicado al ESQUEMA
 *                  DEL OPENAPI; la vista previa debe aceptar o rechazar (400 VALIDATION_ERROR) exactamente lo mismo.
 *   4. RESPUESTA   toda respuesta de la vista previa cuyo estado tenga esquema en el OpenAPI se valida en modo ESTRICTO
 *                  (sin coerción de tipos). Hoy solo /health/* tienen esquema de respuesta; si el orquestador regenera el
 *                  OpenAPI con más, se validan sin tocar este script: se usan las respuestas del recorrido de
 *                  conformidad más una llamada a cada GET sin parámetros obligatorios.
 *   5. ENVOLTURA   todo error es `{ error: { code, message, details? }, requestId }` y los 400 de validación traen
 *                  `details: [{ path, message, keyword }]`.
 *
 * Código de salida: 0 todo bien · 1 hay fallos · 2 uso o lectura erróneos.
 *
 * SIMULACIÓN: esto no prueba el servidor real; prueba que la vista previa habla el mismo contrato que el OpenAPI.
 */
import { runRealBackendFlow, FLOW_OTP } from "../src/preview/contract/flow";
import { validateSchema, type JsonSchema } from "../src/preview/core/schema";
import { setUnexpectedErrorReporter } from "../src/preview/core/server";
import { createPreviewRuntime, type PreviewRuntime } from "../src/preview/runtime";
import { createApi, type Api } from "../src/preview/testing/harness";

// ---------------------------------------------------------------------------------------------------------------
// Frontera con Node
// ---------------------------------------------------------------------------------------------------------------
// El tsconfig del proyecto NO incluye @types/node (TypeScript 6 no carga ningún @types sin pedirlo) ni debe: el código de la
// app corre en React Native. Este script es lo único de `mobile/` que lee ficheros, así que lo poco que usa de Node se tipa a
// mano aquí y se obtiene en tiempo de ejecución con `import()` dinámico y `globalThis`, sin importar tipos de Node (que
// contaminarían globalmente la comprobación de tipos de toda la app).

interface Host {
  fs: { readFileSync(file: string, encoding: "utf8"): string };
  path: { resolve(...parts: string[]): string; dirname(file: string): string };
  proc: {
    argv: string[];
    cwd(): string;
    stdout: { write(text: string): unknown };
    stderr: { write(text: string): unknown };
    exitCode?: number | undefined;
  };
}

async function loadHost(): Promise<Host> {
  // El especificador pasa por una función para que TypeScript no intente resolver «node:*» como módulo tipado.
  const spec = (name: string): string => name;
  const [fs, path] = (await Promise.all([import(spec("node:fs")), import(spec("node:path"))])) as unknown as [Host["fs"], Host["path"]];
  const proc = (globalThis as unknown as { process: Host["proc"] }).process;
  return { fs, path, proc };
}

// ---------------------------------------------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------------------------------------------

interface Options {
  openapi: string;
  json: boolean;
  verbose: boolean;
  strictCoverage: boolean;
}

const HELP = `Uso: tsx scripts/preview-contract-check.ts [opciones]

  --openapi <ruta>     OpenAPI a usar (por defecto ../docs/openapi.json)
  --json               resultado en JSON (una sola línea con contadores, hallazgos y notas)
  --verbose            lista todos los casos, no solo los fallidos
  --strict-coverage    las rutas de la vista previa que el OpenAPI no documenta cuentan como fallo
  --help               esta ayuda
`;

function parseArgs(argv: readonly string[], host: Host): Options | null {
  const { path, proc } = host;
  const script = proc.argv[1];
  const scriptDir = script ? path.dirname(path.resolve(script)) : path.resolve(proc.cwd(), "scripts");
  const options: Options = {
    openapi: path.resolve(scriptDir, "../../docs/openapi.json"),
    json: false,
    verbose: false,
    strictCoverage: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return null;
    else if (arg === "--json") options.json = true;
    else if (arg === "--verbose") options.verbose = true;
    else if (arg === "--strict-coverage") options.strictCoverage = true;
    else if (arg === "--openapi") {
      const value = argv[i + 1];
      if (!value) throw new UsageError("--openapi necesita una ruta");
      options.openapi = path.resolve(proc.cwd(), value);
      i += 1;
    } else throw new UsageError(`Opción desconocida: ${String(arg)}`);
  }
  return options;
}

class UsageError extends Error {}

// ---------------------------------------------------------------------------------------------------------------
// OpenAPI
// ---------------------------------------------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Method = "get" | "post" | "put" | "patch" | "delete";
const METHODS: readonly Method[] = ["get", "post", "put", "patch", "delete"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ParamSpec {
  location: "path" | "query" | "header" | "cookie";
  name: string;
  required: boolean;
  schema: JsonSchema;
}

interface Operation {
  method: Method;
  /** Plantilla OpenAPI: `/v1/trips/{tripId}/requests`. */
  template: string;
  /** Misma ruta en el formato de la vista previa: `/v1/trips/:tripId/requests`. */
  pattern: string;
  secured: boolean;
  params: ParamSpec[];
  body: { required: boolean; schema: JsonSchema } | null;
  /** Esquema de respuesta por estado (`"200"`, `"default"`). */
  responses: Map<string, JsonSchema>;
  /** Estados documentados aunque no tengan esquema. */
  documentedStatuses: string[];
}

interface OpenApiDoc {
  title: string;
  version: string;
  openapi: string;
  operations: Operation[];
}

/** Sustituye `$ref: "#/components/schemas/X"` por su contenido (con protección contra ciclos). */
function deref(node: unknown, doc: Record<string, unknown>, stack: readonly string[] = []): unknown {
  if (Array.isArray(node)) return node.map((item) => deref(item, doc, stack));
  if (!isRecord(node)) return node;
  const ref = node.$ref;
  if (typeof ref === "string") {
    if (stack.includes(ref) || stack.length > 20) return {};
    const target = ref
      .replace(/^#\//, "")
      .split("/")
      .reduce<unknown>((current, key) => (isRecord(current) ? current[key.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined), doc);
    if (target === undefined) throw new Error(`Referencia sin resolver en el OpenAPI: ${ref}`);
    return deref(target, doc, [...stack, ref]);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) out[key] = deref(value, doc, stack);
  return out;
}

// Frontera tipada: un fragmento del OpenAPI (ya desreferenciado) que sabemos que es un esquema JSON.
function asSchema(value: unknown): JsonSchema {
  return (isRecord(value) ? value : {}) as JsonSchema;
}

function jsonContentSchema(content: unknown): JsonSchema | null {
  if (!isRecord(content)) return null;
  const json = content["application/json"];
  if (!isRecord(json) || json.schema === undefined) return null;
  return asSchema(json.schema);
}

function loadOpenApi(file: string, host: Host): OpenApiDoc {
  const raw: unknown = JSON.parse(host.fs.readFileSync(file, "utf8"));
  if (!isRecord(raw) || !isRecord(raw.paths)) throw new Error("El fichero no parece un OpenAPI (falta «paths»).");
  const info = isRecord(raw.info) ? raw.info : {};
  const operations: Operation[] = [];
  for (const [template, item] of Object.entries(raw.paths)) {
    if (!isRecord(item)) continue;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of METHODS) {
      const op = item[method];
      if (!isRecord(op)) continue;
      const parameters = [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])].map((p) => deref(p, raw));
      const params: ParamSpec[] = [];
      for (const p of parameters) {
        if (!isRecord(p) || typeof p.name !== "string" || typeof p.in !== "string") continue;
        if (p.in !== "path" && p.in !== "query" && p.in !== "header" && p.in !== "cookie") continue;
        params.push({ location: p.in, name: p.name, required: p.required === true || p.in === "path", schema: asSchema(p.schema) });
      }
      const requestBody = deref(op.requestBody, raw);
      const bodySchema = isRecord(requestBody) ? jsonContentSchema(requestBody.content) : null;
      const responses = new Map<string, JsonSchema>();
      const documentedStatuses: string[] = [];
      if (isRecord(op.responses)) {
        for (const [status, response] of Object.entries(op.responses)) {
          documentedStatuses.push(status);
          const resolved = deref(response, raw);
          const schema = isRecord(resolved) ? jsonContentSchema(resolved.content) : null;
          if (schema) responses.set(status, schema);
        }
      }
      operations.push({
        method,
        template,
        pattern: template.replace(/\{([^}]+)\}/g, ":$1"),
        secured: Array.isArray(op.security) && op.security.length > 0,
        params,
        body: bodySchema ? { required: isRecord(requestBody) && requestBody.required === true, schema: bodySchema } : null,
        responses,
        documentedStatuses,
      });
    }
  }
  return {
    title: typeof info.title === "string" ? info.title : "(sin título)",
    version: typeof info.version === "string" ? info.version : "?",
    openapi: typeof raw.openapi === "string" ? raw.openapi : "?",
    operations,
  };
}

const opKey = (method: string, pattern: string): string => `${method.toUpperCase()} ${pattern}`;

// ---------------------------------------------------------------------------------------------------------------
// Muestras y casos límite derivados de un esquema
// ---------------------------------------------------------------------------------------------------------------

const OMIT: unique symbol = Symbol("omitir");
type Probe = Json | typeof OMIT | undefined;

const SAMPLE_UUID = "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa01";
const PATTERN_GUESSES = ["+34600111222", "2026-10-05", "123456", "1234 ABC", "ABC123", "abc", "A1", "a", "1", "x"];

function firstType(schema: JsonSchema): string {
  if (schema.type !== undefined) return Array.isArray(schema.type) ? String((schema.type as readonly string[]).find((t) => t !== "null") ?? "null") : String(schema.type);
  if (schema.properties) return "object";
  if (schema.items) return "array";
  if (schema.enum && schema.enum.length > 0) return typeof schema.enum[0];
  return "string";
}

function acceptsStrict(schema: JsonSchema, value: unknown): boolean {
  return validateSchema(schema, value, { strict: true }).ok;
}

/** Un valor válido del esquema (o `undefined` si no sabemos construirlo). */
function sample(schema: JsonSchema, depth = 0): Json | undefined {
  if (depth > 6) return undefined;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0] as Json;
  if ("const" in schema) return schema.const as Json;
  if (schema.oneOf?.[0]) return sample(schema.oneOf[0], depth + 1);
  if (schema.anyOf?.[0]) return sample(schema.anyOf[0], depth + 1);
  if (schema.allOf?.[0]) return sample(schema.allOf[0], depth + 1);

  const type = firstType(schema);
  let candidate: Json | undefined;
  switch (type) {
    case "string": {
      const format = schema.format;
      if (format === "uuid") candidate = SAMPLE_UUID;
      else if (format === "date-time") candidate = "2026-10-05T07:17:00.000Z";
      else if (format === "date") candidate = "2026-10-05";
      else if (format === "time") candidate = "07:17:00Z";
      else if (format === "email") candidate = "ana@example.com";
      else if (format === "uri") candidate = "https://example.com/x";
      else if (schema.pattern) candidate = PATTERN_GUESSES.find((guess) => acceptsStrict(schema, guess));
      else candidate = "x".repeat(Math.max(1, schema.minLength ?? 1));
      if (typeof candidate === "string" && schema.minLength !== undefined && candidate.length < schema.minLength) candidate = candidate.padEnd(schema.minLength, "x");
      break;
    }
    case "integer":
    case "number": {
      let value = schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : type === "integer" ? 1 : 0);
      if (schema.maximum !== undefined && value > schema.maximum) value = schema.maximum;
      if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) value = schema.exclusiveMaximum - 1;
      if (schema.multipleOf) value = Math.ceil(value / schema.multipleOf) * schema.multipleOf;
      candidate = value;
      break;
    }
    case "boolean":
      candidate = true;
      break;
    case "null":
      candidate = null;
      break;
    case "array": {
      const count = Math.max(schema.minItems ?? 0, schema.items ? 1 : 0);
      const items: Json[] = [];
      for (let i = 0; i < count; i += 1) {
        const item = schema.items ? sample(schema.items, depth + 1) : "x";
        if (item === undefined) return undefined;
        items.push(schema.uniqueItems && i > 0 && typeof item === "string" ? `${item}${i}` : item);
      }
      candidate = items;
      break;
    }
    case "object": {
      const out: { [key: string]: Json } = {};
      for (const name of schema.required ?? []) {
        const property = schema.properties?.[name];
        const value = property ? sample(property, depth + 1) : "x";
        if (value === undefined) return undefined;
        out[name] = value;
      }
      candidate = out;
      break;
    }
    default:
      candidate = undefined;
  }
  return candidate !== undefined && acceptsStrict(schema, candidate) ? candidate : undefined;
}

interface Candidate {
  label: string;
  value: Probe;
}

/** Valores de prueba para UN esquema (no recursivo): tipo erróneo, límites, enum, formato… */
function candidatesFor(schema: JsonSchema, required: boolean): Candidate[] {
  const out: Candidate[] = [];
  const type = firstType(schema);
  const add = (label: string, value: Probe): void => {
    out.push({ label, value });
  };

  if (required) add("omitida", OMIT);
  add("null", null);
  switch (type) {
    case "string":
      add("objeto en vez de texto", { a: 1 });
      add("lista de dos textos", ["a", "b"]);
      if (schema.minLength !== undefined) {
        if (schema.minLength > 0) add(`minLength-1 (${schema.minLength - 1})`, "x".repeat(schema.minLength - 1));
        add(`minLength (${schema.minLength})`, "x".repeat(schema.minLength));
      }
      if (schema.maxLength !== undefined && schema.maxLength <= 5_000) {
        add(`maxLength (${schema.maxLength})`, "x".repeat(schema.maxLength));
        add(`maxLength+1 (${schema.maxLength + 1})`, "x".repeat(schema.maxLength + 1));
      }
      if (schema.format === "uuid") add("no es un uuid", "no-es-un-uuid");
      if (schema.format === "date-time") {
        add("fecha-hora sin zona", "2026-10-05T07:17:00");
        add("no es una fecha-hora", "mañana por la mañana");
      }
      if (schema.format === "date") add("fecha imposible", "2026-02-30");
      if (schema.pattern) add("no cumple el patrón", "¡no!");
      add("texto vacío", "");
      add("número en vez de texto", 12345);
      break;
    case "integer":
    case "number":
      add("texto no numérico", "abc");
      add("texto numérico", "7");
      add("booleano", true);
      add("objeto", { a: 1 });
      if (type === "integer") add("decimal", 1.5);
      if (schema.minimum !== undefined) {
        add(`minimum (${schema.minimum})`, schema.minimum);
        add(`minimum-1 (${schema.minimum - 1})`, schema.minimum - 1);
      }
      if (schema.maximum !== undefined) {
        add(`maximum (${schema.maximum})`, schema.maximum);
        add(`maximum+1 (${schema.maximum + 1})`, schema.maximum + 1);
      }
      if (schema.exclusiveMinimum !== undefined) {
        add(`exclusiveMinimum (${schema.exclusiveMinimum})`, schema.exclusiveMinimum);
        add(`exclusiveMinimum+1 (${schema.exclusiveMinimum + 1})`, schema.exclusiveMinimum + 1);
      }
      if (schema.exclusiveMaximum !== undefined) {
        add(`exclusiveMaximum (${schema.exclusiveMaximum})`, schema.exclusiveMaximum);
        add(`exclusiveMaximum-1 (${schema.exclusiveMaximum - 1})`, schema.exclusiveMaximum - 1);
      }
      break;
    case "boolean":
      add("texto true", "true");
      add("texto no booleano", "quizá");
      add("número 2", 2);
      break;
    case "array":
      add("objeto en vez de lista", { a: 1 });
      add("lista vacía", []);
      add("texto suelto", "x");
      if (schema.minItems !== undefined && schema.minItems > 0) add(`minItems-1 (${schema.minItems - 1})`, new Array<Json>(schema.minItems - 1).fill("x"));
      if (schema.maxItems !== undefined && schema.maxItems <= 200) {
        add(`maxItems+1 (${schema.maxItems + 1})`, Array.from({ length: schema.maxItems + 1 }, (_, i) => `v${i}`));
      }
      if (schema.uniqueItems) add("elementos repetidos", ["x", "x"]);
      break;
    case "object":
      add("texto en vez de objeto", "x");
      add("lista en vez de objeto", []);
      add("objeto vacío", {});
      break;
    default:
      break;
  }
  if (schema.enum && schema.enum.length > 0) {
    add("fuera del enum", "__fuera_del_enum__");
    for (const value of schema.enum.slice(0, 12)) add(`enum ${JSON.stringify(value)}`, value as Json);
  }
  return out;
}

type PathStep = string | number;

function setAt(root: Json, steps: readonly PathStep[], value: Probe): Json {
  const copy = JSON.parse(JSON.stringify(root)) as Json;
  if (steps.length === 0) return value === OMIT || value === undefined ? copy : value;
  let node: Json = copy;
  for (let i = 0; i < steps.length - 1; i += 1) {
    const step = steps[i] as PathStep;
    const next = (node as Record<PathStep, Json>)[step];
    if (next === undefined || next === null || typeof next !== "object") return copy;
    node = next;
  }
  const last = steps[steps.length - 1] as PathStep;
  if (value === OMIT) {
    if (Array.isArray(node)) node.splice(Number(last), 1);
    else delete (node as { [key: string]: Json })[String(last)];
  } else if (value !== undefined) {
    (node as Record<PathStep, Json>)[last] = value;
  }
  return copy;
}

interface Probe1 {
  label: string;
  /** Valor completo del contenedor (objeto de parámetros o cuerpo) con la mutación aplicada; `OMIT` = sin cuerpo. */
  value: Probe;
}

/** Casos límite de un contenedor (objeto de parámetros o cuerpo) con su muestra válida `base`. */
function probesFor(schema: JsonSchema, base: Json, maxDepth = 3): Probe1[] {
  const out: Probe1[] = [];
  const visit = (node: JsonSchema, steps: readonly PathStep[], required: boolean, label: string, depth: number): void => {
    if (steps.length > 0) {
      for (const candidate of candidatesFor(node, required)) {
        out.push({ label: `${label}: ${candidate.label}`, value: setAt(base, steps, candidate.value) });
      }
    }
    if (depth >= maxDepth) return;
    if (firstType(node) === "object" && node.properties) {
      const names = Object.keys(node.properties);
      for (const name of names) {
        const child = node.properties[name] as JsonSchema;
        visit(child, [...steps, name], (node.required ?? []).includes(name), label ? `${label}.${name}` : name, depth + 1);
      }
      if (node.additionalProperties === false) {
        out.push({ label: `${label || "(raíz)"}: propiedad no declarada`, value: setAt(base, [...steps, "__no_declarada__"], 1) });
      }
    } else if (firstType(node) === "array" && node.items) {
      const items = (steps.length === 0 ? base : (steps.reduce<unknown>((current, step) => (isRecord(current) || Array.isArray(current) ? (current as Record<PathStep, unknown>)[step] : undefined), base) ?? null)) as Json;
      if (Array.isArray(items) && items.length > 0) visit(node.items, [...steps, 0], true, `${label}[0]`, depth + 1);
    }
  };
  visit(schema, [], false, "", 0);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Ejecución contra la vista previa
// ---------------------------------------------------------------------------------------------------------------

interface Finding {
  section: "cobertura" | "seguridad" | "peticion" | "respuesta" | "envoltura" | "manejadores";
  operation: string;
  message: string;
}

interface Report {
  findings: Finding[];
  info: string[];
  counters: Record<string, number>;
}

function newReport(): Report {
  return { findings: [], info: [], counters: {} };
}

function bump(report: Report, key: string, by = 1): void {
  report.counters[key] = (report.counters[key] ?? 0) + by;
}

function stringifyParam(value: Json): string | null {
  if (value === null) return null;
  if (typeof value === "object") return null;
  return String(value);
}

/** Lo que viaja de verdad en la URL: texto (Fastify nunca ve un booleano ni un número en `params` o `querystring`). */
type Wire = Record<string, string | string[]>;

/**
 * Forma «en el cable» de un objeto de parámetros: todo texto; una lista de un elemento viaja como texto suelto (es lo que
 * entrega el analizador de la query ante `?a=1`), una lista vacía no viaja. Devuelve `skip` si algún valor no cabe en
 * una URL (`null`, objetos): ese caso no se puede expresar y no se prueba.
 */
function toWire(values: Json): { wire: Wire } | { skip: string } {
  const wire: Wire = {};
  if (!isRecord(values)) return { wire };
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      const texts: string[] = [];
      for (const item of value) {
        const text = stringifyParam(item as Json);
        if (text === null) return { skip: "elemento de lista no expresable en la URL" };
        texts.push(text);
      }
      if (texts.length === 1) wire[name] = texts[0] as string;
      else if (texts.length > 1) wire[name] = texts;
    } else {
      const text = stringifyParam(value as Json);
      if (text === null) return { skip: "valor no expresable en la URL" };
      wire[name] = text;
    }
  }
  return { wire };
}

interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body?: string;
}

function buildRequest(op: Operation, pathWire: Wire, queryWire: Wire, body: Probe): BuiltRequest {
  let url = op.pattern;
  const headers: Record<string, string> = {};
  for (const param of op.params.filter((p) => p.location === "path")) {
    const raw = pathWire[param.name];
    const text = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
    url = url.replace(`:${param.name}`, encodeURIComponent(text));
  }
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(queryWire)) {
    for (const item of Array.isArray(value) ? value : [value]) query.append(name, item);
  }
  const search = query.toString();
  const request: BuiltRequest = { url: search ? `${url}?${search}` : url, headers };
  if (body !== OMIT && body !== undefined) {
    request.body = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  return request;
}

function isValidationRejection(status: number, body: unknown): boolean {
  return status === 400 && isRecord(body) && isRecord(body.error) && body.error.code === "VALIDATION_ERROR";
}

/** Comprueba la envoltura de error de una respuesta; devuelve el problema o `null`. */
function envelopeProblem(status: number, body: unknown): string | null {
  if (status < 400) return null;
  if (!isRecord(body)) return `cuerpo no JSON en un ${status}`;
  if (status === 404 && typeof body.message === "string" && body.error !== undefined && typeof body.error === "string") return null; // 404 por defecto de Fastify
  if (status === 404 && typeof body.message === "string" && body.statusCode === 404) return null;
  if (!isRecord(body.error)) return `falta «error» en un ${status}`;
  if (typeof body.error.code !== "string" || typeof body.error.message !== "string") return `«error» sin code/message en un ${status}`;
  if (typeof body.requestId !== "string" || !/^req-[0-9a-z]+$/.test(body.requestId)) return `requestId ausente o con otra forma en un ${status}`;
  if (isValidationRejection(status, body)) {
    const details = body.error.details;
    const ok =
      Array.isArray(details) &&
      details.length > 0 &&
      details.every((d) => isRecord(d) && typeof d.path === "string" && typeof d.message === "string" && typeof d.keyword === "string");
    if (!ok) return "un 400 VALIDATION_ERROR sin details [{ path, message, keyword }]";
  }
  return null;
}

async function runApi(api: Api, request: BuiltRequest, method: string, token: string | null): Promise<{ status: number; body: unknown }> {
  const res = await api(method.toUpperCase(), request.url, {
    token,
    headers: request.headers,
    ...(request.body !== undefined ? { rawBody: request.body } : {}),
  });
  return { status: res.status, body: res.body };
}

// ---- 1. cobertura ----

function checkCoverage(doc: OpenApiDoc, runtime: PreviewRuntime, options: Options, report: Report): void {
  const documented = new Set(doc.operations.map((op) => opKey(op.method, op.pattern)));
  const have = new Set(runtime.router.routes().map((r) => opKey(r.method, r.pattern)));
  for (const op of doc.operations) {
    if (!have.has(opKey(op.method, op.pattern))) {
      report.findings.push({ section: "cobertura", operation: opKey(op.method, op.template), message: "el OpenAPI la documenta y la vista previa no tiene la ruta" });
    }
  }
  const extra = [...have].filter((key) => !documented.has(key)).sort();
  bump(report, "operaciones del OpenAPI", doc.operations.length);
  bump(report, "rutas de la vista previa", have.size);
  if (extra.length > 0) {
    const note = `${extra.length} ruta(s) de la vista previa no están en el OpenAPI (módulos nuevos aún sin regenerar): ${extra.join(", ")}`;
    if (options.strictCoverage) report.findings.push({ section: "cobertura", operation: "(varias)", message: note });
    else report.info.push(note);
  }
}

// ---- 2 y 3. seguridad y validación de la petición ----

interface Prepared {
  op: Operation;
  paramSchemas: { path: JsonSchema; query: JsonSchema; header: JsonSchema };
  baseValues: { path: Json; query: Json; body: Json | undefined };
  baseWire: { path: Wire; query: Wire };
  usable: boolean;
  why?: string;
}

function compositeSchema(params: readonly ParamSpec[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const param of params) {
    properties[param.name] = param.schema;
    if (param.required) required.push(param.name);
  }
  return { type: "object", properties, required };
}

function prepare(op: Operation): Prepared {
  const byLocation = (location: ParamSpec["location"]): ParamSpec[] => op.params.filter((p) => p.location === location);
  const paramSchemas = { path: compositeSchema(byLocation("path")), query: compositeSchema(byLocation("query")), header: compositeSchema(byLocation("header")) };
  const basePath = sample(paramSchemas.path);
  const baseQuery = sample(paramSchemas.query);
  const baseBody = op.body ? sample(op.body.schema) : undefined;
  const pathWire = basePath === undefined ? null : toWire(basePath);
  const queryWire = baseQuery === undefined ? null : toWire(baseQuery);
  const usable = pathWire !== null && "wire" in pathWire && queryWire !== null && "wire" in queryWire && (!op.body || baseBody !== undefined);
  return {
    op,
    paramSchemas,
    baseValues: { path: basePath ?? {}, query: baseQuery ?? {}, body: baseBody },
    baseWire: {
      path: pathWire !== null && "wire" in pathWire ? pathWire.wire : {},
      query: queryWire !== null && "wire" in queryWire ? queryWire.wire : {},
    },
    usable,
    ...(usable ? {} : { why: "no se pudo construir una petición válida a partir del esquema" }),
  };
}

async function checkRequests(
  prepared: readonly Prepared[],
  api: Api,
  token: string,
  options: Options,
  report: Report
): Promise<void> {
  for (const p of prepared) {
    const { op } = p;
    const label = opKey(op.method, op.template);
    if (!p.usable) {
      report.info.push(`${label}: ${p.why ?? "sin petición base"} (no se comprueba la validación de esta operación)`);
      bump(report, "operaciones omitidas");
      continue;
    }

    // ---- seguridad: sin sesión, con una petición válida ----
    const baseRequest = buildRequest(op, p.baseWire.path, p.baseWire.query, p.baseValues.body ?? OMIT);
    const anonymous = await runApi(api, baseRequest, op.method, null);
    bump(report, "casos de seguridad");
    const gotAuthError = anonymous.status === 401;
    if (op.secured && !gotAuthError) {
      report.findings.push({ section: "seguridad", operation: label, message: `el OpenAPI exige sesión (security) y sin ella la vista previa respondió ${anonymous.status}` });
    } else if (!op.secured && gotAuthError) {
      report.findings.push({ section: "seguridad", operation: label, message: "el OpenAPI no exige sesión y la vista previa respondió 401" });
    }
    const envelope = envelopeProblem(anonymous.status, anonymous.body);
    if (envelope) report.findings.push({ section: "envoltura", operation: label, message: envelope });

    // ---- validación: casos límite por contenedor ----
    const containers: Array<{ kind: "path" | "query" | "body"; schema: JsonSchema; base: Json }> = [];
    if (op.params.some((x) => x.location === "path")) containers.push({ kind: "path", schema: p.paramSchemas.path, base: p.baseValues.path });
    if (op.params.some((x) => x.location === "query")) containers.push({ kind: "query", schema: p.paramSchemas.query, base: p.baseValues.query });
    if (op.body && p.baseValues.body !== undefined) containers.push({ kind: "body", schema: op.body.schema, base: p.baseValues.body });

    for (const container of containers) {
      const probes = probesFor(container.schema, container.base);
      if (container.kind === "body" && op.body?.required) probes.push({ label: "(cuerpo): sin cuerpo", value: OMIT });
      for (const probe of probes) {
        // Lo que ve el servidor: en path y query, solo texto (un `true` de la muestra viaja como «true»).
        let expected: boolean;
        let request: BuiltRequest;
        if (container.kind === "body") {
          expected = !validateSchema(container.schema, probe.value === OMIT ? undefined : probe.value).ok;
          request = buildRequest(op, p.baseWire.path, p.baseWire.query, probe.value);
        } else {
          if (probe.value === OMIT) continue;
          const converted = toWire(probe.value as Json);
          const pathParams = op.params.filter((x) => x.location === "path");
          if (
            "skip" in converted ||
            (container.kind === "path" && (pathParams.some((x) => converted.wire[x.name] === undefined) || Object.values(converted.wire).some(Array.isArray)))
          ) {
            // `null`, objetos o listas en un segmento de ruta y un segmento ausente (que cambiaría la estructura de la URL): no se expresan.
            bump(report, "casos no expresables");
            continue;
          }
          expected = !validateSchema(container.schema, converted.wire).ok;
          request = buildRequest(
            op,
            container.kind === "path" ? converted.wire : p.baseWire.path,
            container.kind === "query" ? converted.wire : p.baseWire.query,
            p.baseValues.body ?? OMIT
          );
        }
        const actual = await runApi(api, request, op.method, token);
        bump(report, "casos de validación");
        const rejected = isValidationRejection(actual.status, actual.body);
        const caseLabel = `${container.kind} · ${probe.label}`;
        if (rejected !== expected) {
          report.findings.push({
            section: "peticion",
            operation: label,
            message: `${caseLabel} → el esquema del OpenAPI ${expected ? "RECHAZA" : "ACEPTA"} el valor y la vista previa ${rejected ? "lo rechazó (400)" : `lo aceptó (${actual.status})`}`,
          });
        } else if (options.verbose) {
          report.info.push(`${label} · ${caseLabel}: ${rejected ? "rechazado" : "aceptado"} (${actual.status})`);
        }
        const problem = envelopeProblem(actual.status, actual.body);
        if (problem) report.findings.push({ section: "envoltura", operation: label, message: `${caseLabel}: ${problem}` });
      }
    }
  }
}

// ---- 4. respuestas ----

function responseSchemaFor(op: Operation, status: number): JsonSchema | null {
  return op.responses.get(String(status)) ?? op.responses.get("default") ?? null;
}

interface Observed {
  method: string;
  url: string;
  status: number;
  body: unknown;
  source: string;
}

function validateResponses(doc: OpenApiDoc, runtime: PreviewRuntime, observed: readonly Observed[], report: Report): void {
  const byKey = new Map(doc.operations.map((op) => [opKey(op.method, op.pattern), op]));
  const covered = new Set<string>();
  for (const item of observed) {
    const pathname = new URL(item.url, "https://api.mvc-preview.invalid").pathname;
    const matched = runtime.router.match(item.method.toUpperCase(), pathname);
    if (!matched) continue;
    const op = byKey.get(opKey(item.method, matched.route.pattern));
    if (!op) continue;
    const schema = responseSchemaFor(op, item.status);
    if (!schema) {
      bump(report, "respuestas sin esquema en el OpenAPI");
      continue;
    }
    bump(report, "respuestas validadas");
    covered.add(opKey(op.method, op.template));
    const result = validateSchema(schema, item.body, { strict: true });
    if (!result.ok) {
      const issue = result.issues[0];
      report.findings.push({
        section: "respuesta",
        operation: opKey(op.method, op.template),
        message: `${item.source}: ${item.status} no cumple el esquema (${issue?.instancePath || "/"} ${issue?.message ?? ""})`.trim(),
      });
    }
  }
  const withSchema = doc.operations.filter((op) => op.responses.size > 0);
  bump(report, "operaciones con esquema de respuesta", withSchema.length);
  const missing = withSchema.filter((op) => !covered.has(opKey(op.method, op.template)));
  for (const op of missing) {
    report.findings.push({ section: "respuesta", operation: opKey(op.method, op.template), message: "tiene esquema de respuesta en el OpenAPI y no se observó ninguna respuesta suya" });
  }
  const without = doc.operations.length - withSchema.length;
  if (without > 0) report.info.push(`${without} operación(es) del OpenAPI no declaran esquema de respuesta: no hay nada que validar en ellas`);
}

async function collectObserved(doc: OpenApiDoc, probes: PreviewRuntime, token: string): Promise<Observed[]> {
  const observed: Observed[] = [];
  const g = globalThis as { __MVC_PREVIEW_SHELL__?: unknown };

  // (a) el recorrido de conformidad (119 peticiones) sobre un mundo sin sembrar y con el SMS simulado fijo
  const previousShell = g.__MVC_PREVIEW_SHELL__;
  g.__MVC_PREVIEW_SHELL__ = { otp: FLOW_OTP };
  try {
    const flow = createPreviewRuntime({ latency: 0, skipSeed: true, profile: "new", rngSeed: "contract-check" });
    const steps = await runRealBackendFlow(flow);
    for (const step of steps) observed.push({ method: step.method, url: step.url, status: step.status, body: step.body, source: `recorrido «${step.label}»` });
    // el router del recorrido es el mismo que el de `probes`: se resuelven las plantillas con cualquiera de los dos
  } finally {
    if (previousShell === undefined) delete g.__MVC_PREVIEW_SHELL__;
    else g.__MVC_PREVIEW_SHELL__ = previousShell;
  }

  // (b) cada GET sin parámetros obligatorios, sin sesión y con la del perfil conductor
  const api = createApi(probes);
  for (const op of doc.operations) {
    if (op.method !== "get" || op.params.some((p) => p.required)) continue;
    const request = buildRequest(op, {}, {}, OMIT);
    for (const [who, auth] of [["sin sesión", null], ["con sesión", token]] as const) {
      const res = await runApi(api, request, "get", auth);
      observed.push({ method: "get", url: request.url, status: res.status, body: res.body, source: `GET ${request.url} ${who}` });
    }
  }
  return observed;
}

// ---------------------------------------------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------------------------------------------

const SECTION_TITLES: Record<Finding["section"], string> = {
  cobertura: "Cobertura de rutas",
  seguridad: "Seguridad (Bearer)",
  peticion: "Validación de la petición (paridad con los esquemas del OpenAPI)",
  respuesta: "Respuestas con esquema (modo estricto)",
  envoltura: "Envoltura de errores",
  manejadores: "Fallos inesperados de manejadores",
};

function print(doc: OpenApiDoc, options: Options, report: Report, host: Host): void {
  if (options.json) {
    host.proc.stdout.write(
      `${JSON.stringify({
        simulation: true,
        openapi: { title: doc.title, version: doc.version, spec: doc.openapi, file: options.openapi, operations: doc.operations.length },
        ok: report.findings.length === 0,
        counters: report.counters,
        findings: report.findings,
        info: report.info,
      })}\n`
    );
    return;
  }
  const out: string[] = [];
  out.push("MVC · contrato de la vista previa (SIMULACIÓN en memoria) frente a docs/openapi.json");
  out.push(`OpenAPI ${doc.openapi} · «${doc.title}» ${doc.version} · ${doc.operations.length} operaciones · ${options.openapi}`);
  out.push("");
  for (const section of Object.keys(SECTION_TITLES) as Array<Finding["section"]>) {
    const found = report.findings.filter((f) => f.section === section);
    out.push(`${found.length === 0 ? "OK   " : "FALLO"} ${SECTION_TITLES[section]}${found.length > 0 ? `: ${found.length}` : ""}`);
    const shown = options.verbose ? found : found.slice(0, 25);
    for (const finding of shown) out.push(`       - ${finding.operation}: ${finding.message}`);
    if (shown.length < found.length) out.push(`       … y ${found.length - shown.length} más (usa --verbose)`);
  }
  out.push("");
  out.push("Recuento");
  for (const [key, value] of Object.entries(report.counters).sort(([a], [b]) => a.localeCompare(b))) out.push(`  ${String(value).padStart(6)}  ${key}`);
  if (report.info.length > 0) {
    out.push("");
    out.push("Notas");
    const shown = options.verbose ? report.info : report.info.slice(0, 20);
    for (const note of shown) out.push(`  · ${note}`);
    if (shown.length < report.info.length) out.push(`  · … y ${report.info.length - shown.length} más (usa --verbose)`);
  }
  out.push("");
  out.push(report.findings.length === 0 ? "RESULTADO: CORRECTO" : `RESULTADO: FALLO (${report.findings.length} problema(s))`);
  host.proc.stdout.write(`${out.join("\n")}\n`);
}

async function main(host: Host): Promise<number> {
  let options: Options | null;
  try {
    options = parseArgs(host.proc.argv.slice(2), host);
  } catch (error) {
    host.proc.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
    return 2;
  }
  if (!options) {
    host.proc.stdout.write(HELP);
    return 0;
  }

  let doc: OpenApiDoc;
  try {
    doc = loadOpenApi(options.openapi, host);
  } catch (error) {
    host.proc.stderr.write(`No se pudo leer el OpenAPI (${options.openapi}): ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  const report = newReport();
  const unexpected: string[] = [];
  setUnexpectedErrorReporter((error, method, route) => {
    unexpected.push(`${method} ${route}: ${error instanceof Error ? error.message : String(error)}`);
  });

  const runtime = createPreviewRuntime({ latency: 0, profile: "driver", rngSeed: "contract-check" });
  const token = runtime.sessionToken() ?? "";
  const api = createApi(runtime);

  checkCoverage(doc, runtime, options, report);
  const prepared = doc.operations.filter((op) => runtime.router.has(op.method.toUpperCase() as "GET", op.pattern)).map(prepare);
  await checkRequests(prepared, api, token, options, report);
  const observed = await collectObserved(doc, runtime, token);
  validateResponses(doc, runtime, observed, report);
  for (const item of observed) {
    const problem = envelopeProblem(item.status, item.body);
    if (problem) report.findings.push({ section: "envoltura", operation: `${item.method.toUpperCase()} ${item.url}`, message: `${item.source}: ${problem}` });
  }
  for (const message of unexpected) report.findings.push({ section: "manejadores", operation: "(varias)", message });
  bump(report, "respuestas observadas del recorrido y de los GET", observed.length);

  print(doc, options, report, host);
  return report.findings.length === 0 ? 0 : 1;
}

// Si `loadHost` fallara (no hay Node), el rechazo sin capturar termina el proceso con el error: no hay nada mejor que hacer.
void loadHost().then(async (host) => {
  try {
    host.proc.exitCode = await main(host);
  } catch (error) {
    host.proc.stderr.write(`Error inesperado: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    host.proc.exitCode = 2;
  }
});
