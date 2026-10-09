import { isAbortError, isApiError, isAuthExpiredError, isOfflineError, isTimeoutError } from "./errors";

/**
 * Claves de idempotencia (`Idempotency-Key`) para acciones que crean cosas (solicitar plaza, pagar, publicar).
 * Una clave identifica UNA intención del usuario: se reutiliza en los reintentos de esa intención y se renueva
 * en cuanto es otra (ver `useApiMutation`).
 */

interface MinimalCrypto {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
}

function hex(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

/** UUID v4. Usa la API criptográfica si existe; si no, expo-crypto; como último recurso, Math.random (unicidad, no secreto). */
export function newIdempotencyKey(): string {
  const webCrypto = (globalThis as { crypto?: MinimalCrypto }).crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();

  try {
    // expo-crypto (nativo): se carga bajo demanda para no arrastrarlo a los tests en Node.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expoCrypto = require("expo-crypto") as { randomUUID?: () => string };
    if (expoCrypto.randomUUID) return expoCrypto.randomUUID();
  } catch {
    // sin expo-crypto: seguimos con el respaldo
  }

  const bytes = new Uint8Array(16);
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(bytes, hex);
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
}

/**
 * ¿Pudo haberse procesado la petición aunque no hayamos recibido respuesta? (sin red a mitad, timeout, 5xx, 408).
 * Solo en ese caso un reintento DEBE reutilizar la clave de idempotencia: el servidor devolverá el resultado de la
 * primera ejecución en lugar de duplicar la acción. Un rechazo claro (4xx) significa que no se hizo nada.
 */
export function isIndeterminateFailure(error: unknown): boolean {
  if (isOfflineError(error) || isTimeoutError(error)) return true;
  if (isApiError(error)) return error.status >= 500 || error.status === 408;
  if (isAuthExpiredError(error)) return false;
  return !isAbortError(error);
}

export interface IdempotencyChain {
  /** Clave para el intento que empieza: nueva, o la del intento anterior si fue el mismo con fallo indeterminado. */
  begin(variables: unknown): string;
  /** El intento terminó bien: la siguiente acción (aunque sea idéntica) es otra intención y tendrá otra clave. */
  succeeded(): void;
  /** El intento falló: si el fallo es indeterminado la clave se conserva para el reintento exacto. */
  failed(error: unknown): void;
  /** Olvida la clave pendiente (el usuario cambió de idea / reinicia el formulario). */
  reset(): void;
}

function variablesFingerprint(variables: unknown): string {
  return JSON.stringify(variables, (_key, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return value;
  }) ?? "undefined";
}

/**
 * Cadena de intentos de UNA intención del usuario (p. ej. «solicitar plaza»). Es lo que usa `useApiMutation`:
 *   - dos pulsaciones seguidas del mismo botón tras un fallo de red envían la MISMA `Idempotency-Key`;
 *   - cambiar los datos del formulario, o un éxito/rechazo claro, empieza una intención nueva con clave nueva.
 */
export function createIdempotencyChain(makeKey: () => string = newIdempotencyKey): IdempotencyChain {
  let pending: { key: string; fingerprint: string } | null = null;
  return {
    begin(variables) {
      const fingerprint = variablesFingerprint(variables);
      if (!pending || pending.fingerprint !== fingerprint) pending = { key: makeKey(), fingerprint };
      return pending.key;
    },
    succeeded() {
      pending = null;
    },
    failed(error) {
      if (!isIndeterminateFailure(error)) pending = null;
    },
    reset() {
      pending = null;
    },
  };
}
