/**
 * Redacción de datos personales en los metadatos de auditoría que ve el personal.
 * Se oculta por NOMBRE de clave (teléfono, correo, nombre, dirección, IP, tokens, claves/URL de almacenamiento, coordenadas…)
 * y por FORMA del valor (correo, teléfono, IPv4) incluso dentro de textos libres.
 */
export const REDACTED = "[oculto]";

const SENSITIVE_WORDS = new Set([
  "phone", "telefono", "tel", "mobile", "movil", "email", "mail", "correo",
  "name", "nombre", "address", "direccion",
  "ip", "token", "secret", "password", "contrasena", "cookie", "authorization", "signature",
  "storage", "url", "key",
  "lat", "lng", "lon", "latitude", "longitude", "coords", "coordinates", "location",
  "contact", "iban", "card", "dni", "nif", "passport"
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE_PLUS = /\+\d[\d\s().-]{7,}\d/g;
const PHONE_ES = /(?<![\d.])[6-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?![\d.])/g;
const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
const MAX_DEPTH = 6;
const MAX_ITEMS = 50;

function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase());
}

export function isSensitiveKey(key: string): boolean {
  return words(key).some(w => SENSITIVE_WORDS.has(w));
}

function scrubString(value: string, counter: { n: number }): string {
  if (UUID.test(value)) return value;
  let out = value;
  for (const re of [EMAIL, PHONE_PLUS, PHONE_ES, IPV4]) {
    out = out.replace(re, () => {
      counter.n += 1;
      return REDACTED;
    });
  }
  return out;
}

function redactValue(value: unknown, depth: number, counter: { n: number }): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return scrubString(value, counter);
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map(item => redactValue(item, depth + 1, counter));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
        counter.n += 1;
      } else {
        out[key] = redactValue(inner, depth + 1, counter);
      }
    }
    return out;
  }
  return String(value);
}

export function redactMetadata(metadata: unknown): { value: Record<string, unknown>; redactions: number } {
  const counter = { n: 0 };
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return { value: {}, redactions: 0 };
  }
  const value = redactValue(metadata, 0, counter) as Record<string, unknown>;
  return { value, redactions: counter.n };
}
