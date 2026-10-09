/**
 * Vocabulario común de permisos y su traducción desde Expo. Sin dependencias nativas: se prueba en Node.
 *
 *   granted      concedido.
 *   denied       no concedido, pero el sistema aún puede mostrar el diálogo (`canAskAgain`), o nunca se preguntó
 *                (`undetermined: true`). Aquí corresponde una explicación previa («primer plano») y luego pedirlo.
 *   blocked      denegado y el sistema ya NO volverá a preguntar: solo se arregla en Ajustes → `openAppSettings()`.
 *   unavailable  el dispositivo/servicio no lo ofrece (sin cámara, módulo ausente, restricción parental…).
 *
 * Ninguna función de `@/platform` lanza por un permiso: devuelven siempre uno de estos estados.
 */
export type PermissionStatus = "granted" | "denied" | "blocked" | "unavailable";

export interface PermissionResult {
  status: PermissionStatus;
  /** ¿Puede el sistema mostrar el diálogo todavía? */
  canAskAgain: boolean;
  /** Nunca se ha preguntado (el estado es `denied` pero con diálogo disponible). */
  undetermined: boolean;
}

/** Forma común de las respuestas de permisos de Expo (`PermissionResponse`). */
export interface ExpoPermissionLike {
  status?: string;
  granted?: boolean;
  canAskAgain?: boolean;
}

export const PERMISSION_UNAVAILABLE: PermissionResult = { status: "unavailable", canAskAgain: false, undetermined: false };

export function toPermissionResult(response: ExpoPermissionLike): PermissionResult {
  if (response.granted === true || response.status === "granted") {
    return { status: "granted", canAskAgain: true, undetermined: false };
  }
  if (response.status === "undetermined") {
    return { status: "denied", canAskAgain: true, undetermined: true };
  }
  const canAskAgain = response.canAskAgain !== false;
  return { status: canAskAgain ? "denied" : "blocked", canAskAgain, undetermined: false };
}

/** Ejecuta una lectura/petición de permiso de Expo sin dejar que una excepción nativa llegue a la pantalla. */
export async function guardPermission(read: () => Promise<ExpoPermissionLike>): Promise<PermissionResult> {
  try {
    return toPermissionResult(await read());
  } catch {
    return PERMISSION_UNAVAILABLE;
  }
}

export function isGranted(result: PermissionResult): boolean {
  return result.status === "granted";
}

/** ¿Hay que mandar a la persona a Ajustes del sistema para resolverlo? */
export function needsSettings(result: PermissionResult): boolean {
  return result.status === "blocked";
}

/** ¿Merece la pena mostrar el diálogo del sistema ahora? */
export function canRequest(result: PermissionResult): boolean {
  return result.status === "denied" && result.canAskAgain;
}
