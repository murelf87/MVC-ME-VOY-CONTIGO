/**
 * «Usar mi ubicación»: estados y textos (lógica pura). El permiso y el GPS los resuelve `@/platform`; aquí solo se
 * decide qué le contamos a la persona y qué puede hacer en cada caso. Nunca se bloquea la búsqueda: siempre queda
 * escribir el municipio a mano.
 */
import type { GeocodeResult } from "@/api/types";
import type { LocationFailure } from "@/platform";
import { browseStrings } from "../strings";

export type LocateStatus = "idle" | "locating" | "denied" | "blocked" | "servicesOff" | "failed";

/** Estado del permiso del sistema (mismo vocabulario que `@/platform`). */
export type LocationPermissionStatus = "granted" | "denied" | "blocked" | "unavailable";

export function statusForPermission(status: LocationPermissionStatus): LocateStatus {
  switch (status) {
    case "granted":
      return "idle";
    case "blocked":
      return "blocked";
    case "unavailable":
      return "failed";
    case "denied":
      return "denied";
  }
}

export function statusForFailure(reason: LocationFailure): LocateStatus {
  switch (reason) {
    case "permission_denied":
      return "denied";
    case "permission_blocked":
      return "blocked";
    case "services_disabled":
      return "servicesOff";
    case "timeout":
    case "unavailable":
      return "failed";
  }
}

export interface LocateProblem {
  title: string;
  message: string;
  /** «Permitir ubicación» (se puede volver a preguntar). */
  canAllow: boolean;
  /** «Abrir ajustes» (bloqueado por el sistema). */
  needsSettings: boolean;
  /** «Reintentar» (GPS apagado o sin señal). */
  canRetry: boolean;
}

/** Los ocho textos que necesita una pantalla para explicar un problema de ubicación (los tienen `place`, `mapHome` y `defineRoute`). */
export interface LocateCopy {
  locationDeniedTitle: string;
  locationDeniedMessage: string;
  locationBlockedTitle: string;
  locationBlockedMessage: string;
  locationOffTitle: string;
  locationOffMessage: string;
  locationFailedTitle: string;
  locationFailedMessage: string;
}

/** Qué decir cuando no hay ubicación. `null` si no hay problema (reposo o localizando). */
export function locateProblem(status: LocateStatus, copy: LocateCopy = browseStrings.place): LocateProblem | null {
  switch (status) {
    case "denied":
      return { title: copy.locationDeniedTitle, message: copy.locationDeniedMessage, canAllow: true, needsSettings: false, canRetry: false };
    case "blocked":
      return { title: copy.locationBlockedTitle, message: copy.locationBlockedMessage, canAllow: false, needsSettings: true, canRetry: false };
    case "servicesOff":
      return { title: copy.locationOffTitle, message: copy.locationOffMessage, canAllow: false, needsSettings: false, canRetry: true };
    case "failed":
      return { title: copy.locationFailedTitle, message: copy.locationFailedMessage, canAllow: false, needsSettings: false, canRetry: true };
    case "idle":
    case "locating":
      return null;
  }
}

/**
 * De varios resultados de geocodificación inversa elige el municipio («Te sugerimos tu municipio actual»): el primero
 * de tipo `locality`; si no hay, el primero. `null` si la lista está vacía.
 */
export function pickMunicipalityResult(results: readonly GeocodeResult[]): GeocodeResult | null {
  const locality = results.find((result) => result.types.includes("locality"));
  return locality ?? results[0] ?? null;
}
