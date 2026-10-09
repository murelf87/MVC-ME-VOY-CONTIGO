/**
 * Estado de la señal del coche tal y como lo debe pintar la pantalla. Regla del contrato: NUNCA se presenta como «en
 * directo» una posición vieja, y el coche nunca se muestra con más precisión que la que da el servidor.
 *
 *   live         posición reciente y precisa → «Última actualización: hace 5 s»
 *   approximate  posición reciente pero de zona (el conductor no comparte su ubicación exacta) → se dibuja una ZONA
 *   stale        hay última posición pero es vieja → «Sin señal · Última posición: hace 2 min»
 *   none         nunca hubo posición (viaje sin iniciar o sin GPS) → «Sin señal»
 */
import type { LivePosition, LiveSignal } from "@/api/types";
import { ageNow } from "./time";

export type SignalKind = "live" | "approximate" | "stale" | "none";

export interface SignalState {
  kind: SignalKind;
  /** Antigüedad de la última posición con el tiempo transcurrido ya sumado; `null` si nunca hubo posición. */
  ageSeconds: number | null;
}

export interface SignalInput {
  signal: LiveSignal;
  position: LivePosition | null;
  lastUpdateAgeSeconds: number | null;
  staleAfterSeconds: number;
  /** Segundos transcurridos en este dispositivo desde la respuesta (véase `elapsedSince`). */
  elapsedSeconds: number;
}

export function resolveSignal(input: SignalInput): SignalState {
  const baseAge = input.position?.ageSeconds ?? input.lastUpdateAgeSeconds;
  const age = ageNow(baseAge, input.elapsedSeconds);
  if (input.signal === "none" || age === null) return { kind: "none", ageSeconds: null };
  const stale = input.signal === "stale" || input.position?.stale === true || age > input.staleAfterSeconds;
  if (stale) return { kind: "stale", ageSeconds: age };
  if (input.position?.precision === "approximate") return { kind: "approximate", ageSeconds: age };
  return { kind: "live", ageSeconds: age };
}

/** `true` si se debe dibujar un coche en el mapa (posición precisa; con señal vieja se dibuja atenuado, no «en directo»). */
export function showsCarMarker(position: LivePosition | null): boolean {
  return position !== null && position.precision === "precise";
}

/** `true` si la posición es una zona aproximada (se dibuja un círculo de radio `accuracyM`, sin coche ni trayectoria). */
export function showsZone(position: LivePosition | null): boolean {
  return position !== null && position.precision === "approximate";
}
