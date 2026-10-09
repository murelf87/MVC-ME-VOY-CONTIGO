/**
 * Identificador estable de ESTA instalación de la app: un UUID aleatorio guardado en las preferencias (`mvc.device.id`).
 * No es un identificador del hardware (ni IMEI ni ID de publicidad) y desaparece al desinstalar la app.
 *
 * Quién lo usa: el registro del token push (`deviceId` de `POST /v1/me/push-tokens`) y el cierre de sesión, que da de
 * baja SOLO el token push de este móvil (`DELETE /v1/me/push-tokens/:id` de aquel cuyo `deviceId` coincide), sin tocar
 * los de otros dispositivos de la misma persona.
 */
import { preferences } from "./storage";

export const DEVICE_ID_KEY = "mvc.device.id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface MinimalCrypto {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
}

function randomUuid(): string {
  const webCrypto = (globalThis as { crypto?: MinimalCrypto }).crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
  } else {
    // Último recurso: unicidad, no secreto (es solo un identificador de instalación).
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
}

let cached: string | null = null;
let inFlight: Promise<string> | null = null;

/** Devuelve el identificador de esta instalación (lo crea y guarda la primera vez). Nunca lanza. */
export function getDeviceId(): Promise<string> {
  if (cached !== null) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const stored = await preferences.get(DEVICE_ID_KEY);
    if (stored !== null && UUID_V4.test(stored)) {
      cached = stored;
      return stored;
    }
    const created = randomUuid();
    cached = created;
    await preferences.set(DEVICE_ID_KEY, created);
    return created;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
