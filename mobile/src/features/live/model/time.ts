/**
 * Tiempo de las pantallas en directo: antigüedad de un dato («hace 5 s»), cuentas atrás y tiempo transcurrido desde
 * la última respuesta del servidor. Puro: recibe `nowMs`, nunca lee el reloj.
 *
 * Todas las edades que manda el servidor (`ageSeconds`, `lastUpdateAgeSeconds`) son «respecto a `serverTime`», es decir,
 * del instante de la respuesta. Entre dos sondeos el dato envejece: se corrige sumando el tiempo transcurrido en ESTE
 * dispositivo desde que llegó la respuesta (una duración local, que no depende de que el reloj del móvil esté en hora).
 */
import { liveStrings } from "../strings";

const copy = liveStrings.signal.age;

/** `ahora mismo` (< 5 s) · `hace 5 s` · `hace 2 min` · `hace 3 h`. Nunca negativo. */
export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  if (s < 5) return copy.now;
  if (s < 60) return copy.seconds(s);
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return copy.minutes(minutes);
  return copy.hours(Math.floor(minutes / 60));
}

/** Segundos transcurridos desde que se recibió una respuesta (`fetchedAtMs`); 0 si aún no se conoce. */
export function elapsedSince(fetchedAtMs: number | null | undefined, nowMs: number): number {
  if (fetchedAtMs === null || fetchedAtMs === undefined || !Number.isFinite(fetchedAtMs)) return 0;
  return Math.max(0, (nowMs - fetchedAtMs) / 1000);
}

/** Edad de un dato de servidor corregida con el tiempo transcurrido desde la respuesta. `null` si no hay dato. */
export function ageNow(serverAgeSeconds: number | null | undefined, elapsedSeconds: number): number | null {
  if (serverAgeSeconds === null || serverAgeSeconds === undefined || !Number.isFinite(serverAgeSeconds)) return null;
  return Math.max(0, serverAgeSeconds) + Math.max(0, elapsedSeconds);
}

/**
 * Segundos que faltan para `targetIso` medidos desde `referenceIso` (normalmente `serverTime`) menos el tiempo ya
 * transcurrido. `null` si falta alguna fecha o no son válidas. Puede ser negativo (ya pasó).
 */
export function secondsUntil(targetIso: string | null | undefined, referenceIso: string | null | undefined, elapsedSeconds: number): number | null {
  if (targetIso === null || targetIso === undefined || referenceIso === null || referenceIso === undefined) return null;
  const target = Date.parse(targetIso);
  const reference = Date.parse(referenceIso);
  if (!Number.isFinite(target) || !Number.isFinite(reference)) return null;
  return (target - reference) / 1000 - Math.max(0, elapsedSeconds);
}

/** Segundos hasta `targetIso` medidos con el reloj del dispositivo (para datos que no traen `serverTime`). */
export function secondsUntilNow(targetIso: string | null | undefined, nowMs: number): number | null {
  if (targetIso === null || targetIso === undefined) return null;
  const target = Date.parse(targetIso);
  if (!Number.isFinite(target)) return null;
  return (target - nowMs) / 1000;
}
