/**
 * Ubicación en primer plano. NUNCA se pide ubicación en segundo plano: ninguna función de MVC la necesita
 * (el GPS del viaje se publica con la app abierta; ver README → «Permisos»).
 *
 * Todas las funciones devuelven uniones explícitas y no lanzan. Pedir el permiso es siempre una decisión de la
 * pantalla (primero se explica para qué, luego `requestLocationPermission()`).
 */
import * as Location from "expo-location";
import {
  classifyPrecision,
  createPositionThrottle,
  type PositionPrecision,
  type PositionThrottleOptions,
} from "./locationMath";
import { guardPermission, isGranted, type PermissionResult } from "./permissions";

export type { PositionPrecision } from "./locationMath";

export interface DevicePosition {
  latitude: number;
  longitude: number;
  /** Radio de incertidumbre en metros; `null` si el sistema no lo da. */
  accuracyM: number | null;
  /** `approximate` si la persona solo concedió ubicación aproximada o la incertidumbre es > 500 m. */
  precision: PositionPrecision;
  /** Instante de la lectura (ms desde epoch). */
  timestamp: number;
  /** `true` = última posición conocida guardada por el sistema, no una medida nueva. */
  cached: boolean;
}

export type LocationFailure =
  | "permission_denied"
  | "permission_blocked"
  | "services_disabled"
  | "timeout"
  | "unavailable";

export type PositionResult = { ok: true; position: DevicePosition } | { ok: false; reason: LocationFailure };

export function getLocationPermission(): Promise<PermissionResult> {
  return guardPermission(() => Location.getForegroundPermissionsAsync());
}

export function requestLocationPermission(): Promise<PermissionResult> {
  return guardPermission(() => Location.requestForegroundPermissionsAsync());
}

async function permissionIsCoarse(): Promise<boolean> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    return permission.android?.accuracy === "coarse";
  } catch {
    return false;
  }
}

function toDevicePosition(location: Location.LocationObject, coarse: boolean, cached: boolean): DevicePosition {
  const accuracyM = typeof location.coords.accuracy === "number" ? location.coords.accuracy : null;
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracyM,
    precision: classifyPrecision(accuracyM, coarse),
    timestamp: location.timestamp,
    cached,
  };
}

function failureFor(permission: PermissionResult): LocationFailure | null {
  if (isGranted(permission)) return null;
  if (permission.status === "unavailable") return "unavailable";
  return permission.status === "blocked" ? "permission_blocked" : "permission_denied";
}

function failureFromError(error: unknown): LocationFailure {
  const code = typeof error === "object" && error !== null ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "E_LOCATION_UNAUTHORIZED") return "permission_denied";
  if (code === "E_LOCATION_SERVICES_DISABLED") return "services_disabled";
  if (code === "E_LOCATION_TIMEOUT") return "timeout";
  return "unavailable";
}

export interface CurrentPositionOptions {
  accuracy?: "balanced" | "high";
  /** Tiempo máximo esperando una medida nueva. Por defecto 10 s; al vencer se usa la última conocida si es reciente. */
  timeoutMs?: number;
  /** Antigüedad máxima aceptable de la última posición conocida cuando vence el tiempo. Por defecto 2 min. */
  maxAgeMs?: number;
}

/** Una medida de la posición actual. Requiere el permiso ya concedido (no muestra el diálogo). */
export async function getCurrentPosition(options: CurrentPositionOptions = {}): Promise<PositionResult> {
  const { accuracy = "balanced", timeoutMs = 10_000, maxAgeMs = 120_000 } = options;

  const permissionFailure = failureFor(await getLocationPermission());
  if (permissionFailure) return { ok: false, reason: permissionFailure };

  try {
    if (!(await Location.hasServicesEnabledAsync())) return { ok: false, reason: "services_disabled" };
  } catch {
    // si no se puede comprobar, se intenta igualmente
  }

  const coarse = await permissionIsCoarse();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fresh = Location.getCurrentPositionAsync({
      accuracy: accuracy === "high" ? Location.Accuracy.High : Location.Accuracy.Balanced,
    });
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const winner = await Promise.race([fresh, timedOut]);
    if (winner !== "timeout") return { ok: true, position: toDevicePosition(winner, coarse, false) };
    fresh.catch(() => undefined); // la medida tardía se descarta sin error no gestionado
  } catch (error) {
    return { ok: false, reason: failureFromError(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }

  const cached = await getLastKnownPosition(maxAgeMs);
  return cached ? { ok: true, position: cached } : { ok: false, reason: "timeout" };
}

/** Última posición que guardó el sistema (sin encender el GPS). `null` si no hay o es demasiado vieja. */
export async function getLastKnownPosition(maxAgeMs = 120_000): Promise<DevicePosition | null> {
  try {
    if (!isGranted(await getLocationPermission())) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: maxAgeMs });
    return last ? toDevicePosition(last, await permissionIsCoarse(), true) : null;
  } catch {
    return null;
  }
}

export interface PositionWatch {
  stop(): void;
}

export type WatchResult = { ok: true; watch: PositionWatch } | { ok: false; reason: LocationFailure };

export interface WatchPositionOptions extends PositionThrottleOptions {
  accuracy?: "balanced" | "high";
}

/**
 * Sigue la posición con la app abierta. Las lecturas se REGULAN en JS (`minIntervalMs`, `minDistanceM`,
 * `heartbeatMs`) porque iOS ignora `timeInterval`: así el comportamiento es el mismo en ambas plataformas.
 */
export async function watchPosition(
  onPosition: (position: DevicePosition) => void,
  options: WatchPositionOptions = {},
): Promise<WatchResult> {
  const { accuracy = "balanced", minIntervalMs = 5_000, minDistanceM = 0, heartbeatMs } = options;

  const permissionFailure = failureFor(await getLocationPermission());
  if (permissionFailure) return { ok: false, reason: permissionFailure };

  const coarse = await permissionIsCoarse();
  const accept = createPositionThrottle({
    minIntervalMs,
    minDistanceM,
    ...(heartbeatMs !== undefined ? { heartbeatMs } : {}),
  });
  try {
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: accuracy === "high" ? Location.Accuracy.High : Location.Accuracy.Balanced,
        timeInterval: minIntervalMs,
        distanceInterval: minDistanceM,
      },
      (location) => {
        if (!accept({ latitude: location.coords.latitude, longitude: location.coords.longitude, timestamp: location.timestamp })) return;
        onPosition(toDevicePosition(location, coarse, false));
      },
    );
    return { ok: true, watch: { stop: () => subscription.remove() } };
  } catch (error) {
    return { ok: false, reason: failureFromError(error) };
  }
}
