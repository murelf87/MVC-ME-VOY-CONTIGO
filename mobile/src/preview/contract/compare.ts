/**
 * Comparación «forma + valor» entre una respuesta REAL del backend (fotografía en `real-backend-steps.json`) y la del
 * backend en memoria. Los valores que cambian en cada ejecución (uuid, instantes, tokens, ids de petición) se
 * normalizan a marcadores; todo lo demás (claves, tipos, números, textos, mensajes de error) debe coincidir.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_RE = /mvc_sess_[A-Za-z0-9_-]+/g;
const REQUEST_ID_RE = /^req-[0-9a-z]+$/i;

/** Sustituye lo no determinista de un texto por marcadores estables. */
export function canonicalString(value: string): string {
  if (REQUEST_ID_RE.test(value)) return "<requestId>";
  if (DATE_RE.test(value)) return "<date>";
  return value.replace(TOKEN_RE, "<token>").replace(ISO_RE, "<instant>").replace(UUID_RE, "<uuid>");
}

export function canonicalize(value: unknown): unknown {
  if (typeof value === "string") return canonicalString(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

export interface Difference {
  path: string;
  kind: "missing" | "extra" | "type" | "value" | "length";
  expected: unknown;
  actual: unknown;
}

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Diferencias entre dos valores YA canonizados. `path` usa `$.a.b[0]`. */
export function diffJson(expected: unknown, actual: unknown, path = "$"): Difference[] {
  const expectedKind = kindOf(expected);
  const actualKind = kindOf(actual);
  if (expectedKind !== actualKind) return [{ path, kind: "type", expected, actual }];
  if (expectedKind === "array") {
    const a = expected as unknown[];
    const b = actual as unknown[];
    const out: Difference[] = [];
    if (a.length !== b.length) out.push({ path, kind: "length", expected: a.length, actual: b.length });
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 1) out.push(...diffJson(a[i], b[i], `${path}[${i}]`));
    return out;
  }
  if (expectedKind === "object") {
    const a = expected as Record<string, unknown>;
    const b = actual as Record<string, unknown>;
    const out: Difference[] = [];
    for (const key of Object.keys(a)) {
      if (!(key in b)) out.push({ path: `${path}.${key}`, kind: "missing", expected: a[key], actual: undefined });
      else out.push(...diffJson(a[key], b[key], `${path}.${key}`));
    }
    for (const key of Object.keys(b)) {
      if (!(key in a)) out.push({ path: `${path}.${key}`, kind: "extra", expected: undefined, actual: b[key] });
    }
    return out;
  }
  return Object.is(expected, actual) || expected === actual ? [] : [{ path, kind: "value", expected, actual }];
}

/** Quita los índices de los caminos (`$.a[3].b` → `$.a[].b`) para poder listar excepciones por forma. */
export function genericPath(path: string): string {
  return path.replace(/\[\d+\]/g, "[]");
}
