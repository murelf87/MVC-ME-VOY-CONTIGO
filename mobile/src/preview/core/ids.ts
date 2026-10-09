/**
 * Identificadores y azar DETERMINISTA del mundo simulado.
 *
 * Con la misma `seed` y la misma secuencia de acciones se generan los mismos ids, tokens y códigos, de modo que
 * una captura de pantalla o un escenario son reproducibles. `Math.random()` no se usa para datos del mundo
 * (solo para la latencia de red simulada, que no influye en el estado).
 */
import { base64Url, sha256Bytes, utf8Encode } from "./sha256";

/** FNV-1a de 32 bits: convierte un texto de semilla en un entero. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function toUuid(bytes: Uint8Array): string {
  const b = Uint8Array.from(bytes.subarray(0, 16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40; // versión 4
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variante RFC 4122
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * UUID v4 estable derivado de un nombre (`stableUuid("trip:ana:montequinto-us:0715")`). No consume azar: es el
 * mismo en cualquier reinicio, así los datos de las láminas conservan el id aunque cambie el orden de creación.
 */
export function stableUuid(key: string): string {
  return toUuid(sha256Bytes(utf8Encode(`mvc-preview:${key}`)));
}

export interface IdsState {
  rng: number;
  seqs: Record<string, number>;
  requestCounter: number;
}

export class PreviewIds {
  private rng: number;
  private seqs: Record<string, number> = {};
  private requestCounter = 0;
  seed: string;

  constructor(seed = "mvc-preview-v1") {
    this.seed = seed;
    this.rng = hashSeed(seed) || 0x9e3779b9;
  }

  /** mulberry32: entero de 32 bits → [0, 1). */
  next(): number {
    this.rng = (this.rng + 0x6d2b79f5) >>> 0;
    let t = this.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entero en [min, max] (ambos incluidos). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick() sobre una lista vacía");
    return items[this.int(0, items.length - 1)] as T;
  }

  bytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) out[i] = Math.floor(this.next() * 256);
    return out;
  }

  uuid(): string {
    return toUuid(this.bytes(16));
  }

  hex(length: number): string {
    return Array.from(this.bytes(Math.ceil(length / 2)), (x) => x.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, length);
  }

  /** `mvc_sess_` + 43 caracteres base64url (misma forma que el token opaco real). */
  sessionToken(): string {
    return `mvc_sess_${base64Url(this.bytes(32))}`;
  }

  /** Código numérico de `length` dígitos (nunca empieza por 0, como `crypto.randomInt(100000, 1000000)`). */
  digits(length: number): string {
    const min = 10 ** (length - 1);
    return String(this.int(min, min * 10 - 1));
  }

  /** Contador por nombre (equivale a una columna `bigserial`): 1, 2, 3… */
  seq(name: string): number {
    const next = (this.seqs[name] ?? 0) + 1;
    this.seqs[name] = next;
    return next;
  }

  /** `req-1`, `req-2`, … `req-b`: como el generador de ids de petición de Fastify (base 36). No consume azar. */
  requestId(): string {
    this.requestCounter += 1;
    return `req-${this.requestCounter.toString(36)}`;
  }

  /**
   * Cambia SOLO el flujo del azar a otro derivado de la semilla y de `label`; los contadores (`seq`, `requestId`) siguen
   * igual. Se usa al sembrar para que los ids de cada fase (variante, sesión viva) no dependan de cuánto azar haya
   * gastado la fase anterior (otro perfil, un `seedSlice` nuevo…).
   */
  forkRng(label: string): void {
    this.rng = hashSeed(`${this.seed}|${label}`) || 0x9e3779b9;
  }

  /** Reinicia el azar y los contadores con otra semilla (reinicio del mundo). */
  reseed(seed: string): void {
    this.seed = seed;
    this.rng = hashSeed(seed) || 0x9e3779b9;
    this.seqs = {};
    this.requestCounter = 0;
  }

  state(): IdsState {
    return { rng: this.rng, seqs: { ...this.seqs }, requestCounter: this.requestCounter };
  }

  restore(state: IdsState): void {
    this.rng = state.rng >>> 0;
    this.seqs = { ...state.seqs };
    this.requestCounter = state.requestCounter;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** El mismo patrón estricto que `assertUuid` del servicio de ubicación real (versión 1-5, variante 8-b). */
export const STRICT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
