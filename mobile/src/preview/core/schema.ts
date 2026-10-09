/**
 * Validador de JSON Schema «tipo Ajv» para el router de la vista previa.
 *
 * Reproduce las opciones por defecto de Fastify 5 (Ajv 8 con ajv-formats):
 *   coerceTypes: "array" · useDefaults: true · removeAdditional: true · allErrors: false
 *
 * Consecuencias que el backend real también tiene (y por eso se mantienen aquí):
 *  - Los parámetros de la URL y la query llegan como texto y se COERCEN al tipo declarado ("5" → 5).
 *  - Con `additionalProperties: false` las propiedades desconocidas NO fallan: se ELIMINAN en silencio.
 *  - Se informa solo del primer error (`allErrors: false`).
 *
 * Modo `strict` (`validateSchema(schema, data, { strict: true })`): sin coerción, sin defaults y sin eliminar propiedades;
 * es lo que usa `scripts/preview-contract-check.ts` para comprobar RESPUESTAS contra los esquemas de `docs/openapi.json`.
 *
 * Subconjunto soportado: type, properties, required, additionalProperties, items, enum, const, minLength,
 * maxLength, pattern, format (uuid, date-time, date, time, email, uri), minimum, maximum, exclusiveMinimum,
 * exclusiveMaximum, multipleOf, minItems, maxItems, uniqueItems, minProperties, maxProperties, oneOf, anyOf,
 * allOf, nullable, default.
 */

export type SchemaType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

export interface JsonSchema {
  type?: SchemaType | readonly SchemaType[];
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: readonly unknown[];
  const?: unknown;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  oneOf?: readonly JsonSchema[];
  anyOf?: readonly JsonSchema[];
  allOf?: readonly JsonSchema[];
  nullable?: boolean;
  default?: unknown;
  /** Texto libre (ignorado al validar). */
  description?: string;
  title?: string;
  example?: unknown;
}

export interface ValidationIssue {
  /** Puntero JSON como en Ajv: "" (raíz), "/displayName", "/origin/latitude". */
  instancePath: string;
  keyword: string;
  message: string;
  params: Record<string, unknown>;
}

export type ValidationResult = { ok: true; value: unknown } | { ok: false; issues: ValidationIssue[] };

export interface ValidateOptions {
  /** Sin coerción de tipos, sin `default` y sin eliminar propiedades no declaradas (las rechaza si `additionalProperties:false`). */
  strict?: boolean;
}

interface Ctx {
  strict: boolean;
}

class Stop extends Error {
  constructor(readonly issue: ValidationIssue) {
    super(issue.message);
  }
}

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

type ValueType = SchemaType | "undefined";

function jsonType(value: unknown): ValueType {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    default:
      return "object";
  }
}

function matchesType(value: unknown, type: SchemaType): boolean {
  const actual = jsonType(value);
  if (type === "number") return actual === "number" || actual === "integer";
  return actual === type;
}

/** Coerción de Ajv (`coerceTypes: "array"`). Devuelve `undefined` si no se puede coercionar. */
function coerceScalar(value: unknown, type: SchemaType): { value: unknown } | undefined {
  switch (type) {
    case "string":
      if (typeof value === "number" || typeof value === "boolean") return { value: String(value) };
      if (value === null) return { value: "" };
      return undefined;
    case "number":
    case "integer":
      if (typeof value === "string" && value !== "" && NUMBER_RE.test(value)) {
        const n = Number(value);
        if (type === "integer" && !Number.isInteger(n)) return undefined;
        return { value: n };
      }
      if (typeof value === "boolean") return { value: value ? 1 : 0 };
      if (value === null) return { value: 0 };
      return undefined;
    case "boolean":
      if (value === "true" || value === 1) return { value: true };
      if (value === "false" || value === 0 || value === null) return { value: false };
      return undefined;
    case "null":
      if (value === "" || value === 0 || value === false) return { value: null };
      return undefined;
    default:
      return undefined;
  }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[zZ]|[+-]\d{2}:\d{2})$/;
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[tT ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([zZ]|[+-]\d{2}:\d{2})$/;
const UUID_FORMAT_RE = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const EMAIL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const URI_RE = /^[a-z][a-z0-9+.-]*:[^\s]*$/i;

function validDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
  return day <= days;
}

export function checkFormat(format: string, value: string): boolean {
  switch (format) {
    case "uuid":
      return UUID_FORMAT_RE.test(value);
    case "date": {
      const m = DATE_RE.exec(value);
      return !!m && validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    }
    case "time": {
      const m = TIME_RE.exec(value);
      return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59 && Number(m[3]) <= 60;
    }
    case "date-time": {
      const m = DATE_TIME_RE.exec(value);
      if (!m) return false;
      const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
      if (offset && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return false;
      return (
        validDate(Number(m[1]), Number(m[2]), Number(m[3])) && Number(m[4]) <= 23 && Number(m[5]) <= 59 && Number(m[6]) <= 60
      );
    }
    case "email":
      return EMAIL_RE.test(value);
    case "uri":
      return URI_RE.test(value);
    default:
      return true; // formato desconocido: Ajv con `strict: false` lo ignora
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  return keys.length === Object.keys(bo).length && keys.every((k) => k in bo && deepEqual(ao[k], bo[k]));
}

function fail(path: string, keyword: string, message: string, params: Record<string, unknown> = {}): never {
  throw new Stop({ instancePath: path, keyword, message, params });
}

function typeNames(schema: JsonSchema): SchemaType[] | undefined {
  if (schema.type === undefined) return undefined;
  return Array.isArray(schema.type) ? [...(schema.type as readonly SchemaType[])] : [schema.type as SchemaType];
}

function walk(schema: JsonSchema, input: unknown, path: string, ctx: Ctx): unknown {
  let value = input;

  // 1. tipo (con coerción)
  const types = typeNames(schema);
  if (types) {
    const allowed = schema.nullable && !types.includes("null") ? [...types, "null" as const] : types;
    if (!allowed.some((t) => matchesType(value, t))) {
      let coerced: { value: unknown } | undefined;
      if (ctx.strict) fail(path, "type", `must be ${allowed.join(",")}`, { type: allowed.length === 1 ? allowed[0] : allowed });
      const wantsArray = allowed.includes("array");
      if (!wantsArray && Array.isArray(value) && value.length === 1) {
        // coerceTypes: "array" → [x] se trata como x
        const single = value[0];
        if (allowed.some((t) => matchesType(single, t))) coerced = { value: single };
        else {
          for (const t of allowed) {
            coerced = coerceScalar(single, t);
            if (coerced) break;
          }
        }
      } else if (wantsArray && (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null)) {
        // Ajv solo envuelve ESCALARES (un objeto no se convierte en lista de un elemento)
        coerced = { value: [value] };
      } else {
        for (const t of allowed) {
          coerced = coerceScalar(value, t);
          if (coerced) break;
        }
      }
      if (!coerced) {
        fail(path, "type", `must be ${allowed.join(",")}`, { type: allowed.length === 1 ? allowed[0] : allowed });
      }
      value = coerced.value;
    }
  }

  // 2. enum / const
  if (schema.enum && !schema.enum.some((candidate) => deepEqual(candidate, value))) {
    fail(path, "enum", "must be equal to one of the allowed values", { allowedValues: schema.enum });
  }
  if ("const" in schema && !deepEqual(schema.const, value)) {
    fail(path, "const", "must be equal to constant", { allowedValue: schema.const });
  }

  // 3. por tipo de valor
  if (typeof value === "string") {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) {
      fail(path, "minLength", `must NOT have fewer than ${schema.minLength} characters`, { limit: schema.minLength });
    }
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) {
      fail(path, "maxLength", `must NOT have more than ${schema.maxLength} characters`, { limit: schema.maxLength });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) {
      fail(path, "pattern", `must match pattern "${schema.pattern}"`, { pattern: schema.pattern });
    }
    if (schema.format !== undefined && !checkFormat(schema.format, value)) {
      fail(path, "format", `must match format "${schema.format}"`, { format: schema.format });
    }
  } else if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      fail(path, "minimum", `must be >= ${schema.minimum}`, { comparison: ">=", limit: schema.minimum });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      fail(path, "maximum", `must be <= ${schema.maximum}`, { comparison: "<=", limit: schema.maximum });
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      fail(path, "exclusiveMinimum", `must be > ${schema.exclusiveMinimum}`, { comparison: ">", limit: schema.exclusiveMinimum });
    }
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
      fail(path, "exclusiveMaximum", `must be < ${schema.exclusiveMaximum}`, { comparison: "<", limit: schema.exclusiveMaximum });
    }
    if (schema.multipleOf !== undefined) {
      const q = value / schema.multipleOf;
      if (Math.abs(q - Math.round(q)) > 1e-9) {
        fail(path, "multipleOf", `must be multiple of ${schema.multipleOf}`, { multipleOf: schema.multipleOf });
      }
    }
  } else if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail(path, "minItems", `must NOT have fewer than ${schema.minItems} items`, { limit: schema.minItems });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      fail(path, "maxItems", `must NOT have more than ${schema.maxItems} items`, { limit: schema.maxItems });
    }
    if (schema.uniqueItems) {
      for (let i = 1; i < value.length; i += 1) {
        for (let j = 0; j < i; j += 1) {
          if (deepEqual(value[i], value[j])) {
            fail(path, "uniqueItems", `must NOT have duplicate items (items ## ${j} and ${i} are identical)`, { i, j });
          }
        }
      }
    }
    if (schema.items) {
      const items = schema.items;
      value = value.map((item, index) => walk(items, item, `${path}/${index}`, ctx));
    }
  } else if (value !== null && typeof value === "object") {
    value = walkObject(schema, value as Record<string, unknown>, path, ctx);
  }

  // 4. combinadores
  if (schema.allOf) {
    for (const part of schema.allOf) value = walk(part, value, path, ctx);
  }
  if (schema.anyOf) {
    let matched = false;
    for (const part of schema.anyOf) {
      try {
        value = walk(part, value, path, ctx);
        matched = true;
        break;
      } catch (error) {
        if (!(error instanceof Stop)) throw error;
      }
    }
    if (!matched) fail(path, "anyOf", "must match a schema in anyOf");
  }
  if (schema.oneOf) {
    let matches = 0;
    let chosen: unknown = value;
    for (const part of schema.oneOf) {
      try {
        chosen = walk(part, value, path, ctx);
        matches += 1;
      } catch (error) {
        if (!(error instanceof Stop)) throw error;
      }
    }
    if (matches !== 1) fail(path, "oneOf", "must match exactly one schema in oneOf", { passingSchemas: matches });
    value = chosen;
  }

  return value;
}

function walkObject(schema: JsonSchema, input: Record<string, unknown>, path: string, ctx: Ctx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const properties = schema.properties ?? {};
  const keys = Object.keys(input);

  if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
    fail(path, "minProperties", `must NOT have fewer than ${schema.minProperties} properties`, { limit: schema.minProperties });
  }
  if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
    fail(path, "maxProperties", `must NOT have more than ${schema.maxProperties} properties`, { limit: schema.maxProperties });
  }

  // useDefaults (no en modo estricto)
  const withDefaults: Record<string, unknown> = { ...input };
  if (!ctx.strict) {
    for (const [key, sub] of Object.entries(properties)) {
      if (withDefaults[key] === undefined && sub.default !== undefined) withDefaults[key] = sub.default;
    }
  }

  for (const required of schema.required ?? []) {
    if (withDefaults[required] === undefined) {
      fail(path, "required", `must have required property '${required}'`, { missingProperty: required });
    }
  }

  for (const key of Object.keys(withDefaults)) {
    const raw = withDefaults[key];
    if (raw === undefined) continue;
    const sub = properties[key];
    if (sub) {
      out[key] = walk(sub, raw, `${path}/${escapePointer(key)}`, ctx);
      continue;
    }
    // propiedad no declarada
    const additional = schema.additionalProperties;
    if (additional === false) {
      if (ctx.strict) fail(path, "additionalProperties", "must NOT have additional properties", { additionalProperty: key });
      continue; // removeAdditional: true → se elimina en silencio
    }
    if (additional !== undefined && additional !== true) {
      out[key] = walk(additional, raw, `${path}/${escapePointer(key)}`, ctx);
      continue;
    }
    out[key] = raw;
  }
  return out;
}

function escapePointer(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Valida y coerciona `data` contra `schema`. Nunca muta la entrada. */
export function validateSchema(schema: JsonSchema, data: unknown, options: ValidateOptions = {}): ValidationResult {
  try {
    return { ok: true, value: walk(schema, data, "", { strict: options.strict === true }) };
  } catch (error) {
    if (error instanceof Stop) return { ok: false, issues: [error.issue] };
    throw error;
  }
}
