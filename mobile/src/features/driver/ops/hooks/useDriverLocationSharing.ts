import { useCallback, useEffect, useRef, useState } from "react";
import { newIdempotencyKey } from "@/api";
import { queryCache, useAppActive, useIsOnline } from "@/hooks";
import {
  IS_PREVIEW_BUILD,
  getCurrentPosition,
  getLocationPermission,
  openAppSettings,
  requestLocationPermission,
  watchPosition,
  type DevicePosition,
  type PositionWatch,
} from "@/platform";
import { postLocation } from "../api";
import { opsKeys } from "../keys";
import type { LngLat } from "../logic/geo";
import {
  SEND_FAILURES_BEFORE_WARNING,
  SEND_INTERVAL_MS,
  SEND_INTERVAL_STOPPED_MS,
  deriveMotion,
  monotonicRecordedAt,
  statusForFailure,
  statusForPermission,
  toLocationBody,
  type FailureReason,
  type SharingStatus,
} from "../logic/sharing";
import { createRouteWalker, type RouteWalker } from "../sim/routeWalker";
import type { DriverFix } from "../types";
import { describeOps } from "./describe";

/** Si no llega ninguna posición en este tiempo se comprueba el GPS por si se ha apagado o el permiso ha cambiado. */
const STALL_MS = 20_000;
const WATCHDOG_MS = 10_000;
const PROBE_TIMEOUT_MS = 6_000;
/** La simulación no avanza más de esto de una vez (pestaña dormida, depurador…). */
const MAX_SIM_STEP_SECONDS = 20;

export interface DriverLocationSharingOptions {
  tripId: string;
  /** El viaje está en curso (lo dice la consola del servidor). Solo entonces se comparte la ubicación. */
  enabled: boolean;
  /** Ruta del viaje (`[lng, lat][]`). SOLO la usa el recorrido simulado de la vista previa. */
  route: readonly LngLat[];
  /** Última posición que conoce el servidor: de ahí arranca el recorrido simulado. */
  resumeFrom: { lat: number; lng: number } | null;
}

export interface DriverLocationSharing {
  status: SharingStatus;
  /** Los últimos envíos han fallado (sin red, servidor caído…): se reintenta con la siguiente posición. */
  sendFailed: boolean;
  /** `true` solo en la vista previa: las posiciones salen de un recorrido simulado, no de un GPS. */
  simulated: boolean;
  /** Pide el permiso de ubicación (diálogo del sistema) y, si lo conceden, empieza a compartir. */
  allow(): void;
  /** Abre los ajustes del móvil (permiso bloqueado o GPS apagado). */
  openSettings(): void;
  /** «Seguir sin compartir»: el viaje continúa, los pasajeros no ven tu posición. */
  continueWithout(): void;
  /** Vuelve a compartir después de haberlo pausado. */
  resume(): void;
  /** Vuelve a comprobar permiso y GPS. */
  retry(): void;
}

const monotonicNow = (): number => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now());

interface SendItem {
  fix: DriverFix;
  eventId: string;
}

/**
 * Publica la posición del conductor mientras el viaje está en curso (`POST /v1/trips/{id}/location`, cada 5–15 s).
 *
 * - Solo ubicación en PRIMER PLANO (`@/platform`): al pasar la app a segundo plano se detiene y al volver se
 *   comprueba otra vez el permiso (por si la persona lo cambió en Ajustes).
 * - Nunca bloquea el viaje: sin permiso o sin GPS queda «Seguir sin compartir».
 * - Solo importa la posición MÁS RECIENTE: si un envío falla, se reintenta con el mismo `eventId` (idempotente) y, si
 *   llega otra posición, esa sustituye a la pendiente.
 * - Vista previa: los permisos, el GPS apagado y la red se siguen leyendo de la plataforma, pero las coordenadas
 *   enviadas recorren la ruta del viaje (`sim/routeWalker`). En un móvil real esa rama no existe.
 */
export function useDriverLocationSharing(options: DriverLocationSharingOptions): DriverLocationSharing {
  const { tripId, enabled, route, resumeFrom } = options;
  const appActive = useAppActive();
  const online = useIsOnline();

  const [status, setStatusState] = useState<SharingStatus>("inactive");
  const [sendFailed, setSendFailed] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [paused, setPaused] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const statusRef = useRef<SharingStatus>("inactive");
  const setStatus = useCallback((next: SharingStatus | ((previous: SharingStatus) => SharingStatus)) => {
    const value = typeof next === "function" ? next(statusRef.current) : next;
    statusRef.current = value;
    setStatusState(value);
  }, []);

  // Datos que el efecto lee al momento de usarlos (sin reiniciar el seguimiento cuando cambian).
  const routeRef = useRef<readonly LngLat[]>(route);
  routeRef.current = route;
  const resumeRef = useRef(resumeFrom);
  resumeRef.current = resumeFrom;
  const tripIdRef = useRef(tripId);
  tripIdRef.current = tripId;

  // Cola de envío: solo la posición más reciente.
  const pendingRef = useRef<SendItem | null>(null);
  const inFlightRef = useRef(false);
  const failuresRef = useRef(0);
  const sentOnceRef = useRef(false);
  const lastRecordedRef = useRef<number | null>(null);
  const previousFixRef = useRef<DriverFix | null>(null);
  const walkerRef = useRef<RouteWalker | null>(null);
  const walkerClockRef = useRef<number | null>(null);
  const stopRef = useRef<() => void>(() => undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    const item = pendingRef.current;
    if (!item) return;
    inFlightRef.current = true;
    try {
      await postLocation(tripIdRef.current, toLocationBody(item.fix, item.eventId));
      if (pendingRef.current === item) pendingRef.current = null;
      failuresRef.current = 0;
      if (mountedRef.current) setSendFailed(false);
      if (!sentOnceRef.current) {
        sentOnceRef.current = true;
        // Primer envío correcto: la consola pasa a «en directo» sin esperar al siguiente sondeo.
        void queryCache.invalidate(opsKeys.console(tripIdRef.current));
      }
    } catch (error) {
      const view = describeOps(error);
      if (view.code === "TRIP_NOT_LIVE") {
        // El servidor dice que el viaje ya no está en curso: se deja de compartir y la consola se actualiza.
        if (pendingRef.current === item) pendingRef.current = null;
        stopRef.current();
        void queryCache.invalidate(opsKeys.console(tripIdRef.current));
      } else if (view.code === "LOCATION_FORBIDDEN") {
        if (pendingRef.current === item) pendingRef.current = null;
        stopRef.current();
        if (mountedRef.current) setSendFailed(true);
      } else if (view.code === "LOCATION_EVENT_TOO_OLD" || view.code === "LOCATION_EVENT_FROM_FUTURE") {
        // Esa lectura ya no sirve; la siguiente llegará enseguida.
        if (pendingRef.current === item) pendingRef.current = null;
      } else {
        failuresRef.current += 1;
        if (failuresRef.current >= SEND_FAILURES_BEFORE_WARNING && mountedRef.current) setSendFailed(true);
      }
    } finally {
      inFlightRef.current = false;
    }
    // Si mientras tanto llegó una posición más nueva, se envía ya.
    if (pendingRef.current && pendingRef.current !== item) void flush();
  }, []);

  // Al volver la red se envía lo pendiente sin esperar a la siguiente lectura.
  useEffect(() => {
    if (online && pendingRef.current) void flush();
  }, [online, flush]);

  useEffect(() => {
    if (!enabled) {
      setStatus("inactive");
      setSendFailed(false);
      setSimulated(false);
      pendingRef.current = null;
      failuresRef.current = 0;
      sentOnceRef.current = false;
      walkerRef.current = null;
      walkerClockRef.current = null;
      previousFixRef.current = null;
      return undefined;
    }
    if (paused) {
      setStatus("paused");
      return undefined;
    }
    if (!appActive) return undefined; // segundo plano: no se sigue la posición (solo primer plano)

    let cancelled = false;
    let watch: PositionWatch | null = null;
    let starting = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let lastFixAt = monotonicNow();

    const stopWatch = (): void => {
      watch?.stop();
      watch = null;
    };
    const stopAll = (): void => {
      stopWatch();
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    stopRef.current = () => {
      stopAll();
      pendingRef.current = null;
      if (!cancelled) setStatus("inactive");
    };

    const applyFailure = (reason: FailureReason): void => {
      const next = statusForFailure(reason);
      if (next !== "searching" || statusRef.current !== "sharing") setStatus(next);
      if (next !== "searching") stopWatch();
    };

    const handleFix = (position: DevicePosition): void => {
      if (cancelled) return;
      lastFixAt = monotonicNow();

      let latitude = position.latitude;
      let longitude = position.longitude;
      let speedMps: number | null = null;
      let headingDegrees: number | null = null;
      if (IS_PREVIEW_BUILD) {
        if (!walkerRef.current && routeRef.current.length >= 2) {
          walkerRef.current = createRouteWalker(routeRef.current, { start: resumeRef.current });
        }
        const walker = walkerRef.current;
        if (walker) {
          const clock = monotonicNow();
          const seconds = walkerClockRef.current === null ? 0 : Math.min(MAX_SIM_STEP_SECONDS, (clock - walkerClockRef.current) / 1000);
          walkerClockRef.current = clock;
          const state = seconds > 0 ? walker.step(seconds) : walker.current();
          latitude = state.lat;
          longitude = state.lng;
          speedMps = state.speedMps;
          headingDegrees = state.headingDegrees;
          setSimulated(true);
        }
      }

      const recordedAtMs = monotonicRecordedAt(position.timestamp, lastRecordedRef.current);
      lastRecordedRef.current = recordedAtMs;
      const base: DriverFix = { latitude, longitude, accuracyM: position.accuracyM, recordedAtMs, speedMps, headingDegrees };
      const fix: DriverFix = { ...base, ...deriveMotion(previousFixRef.current, base) };
      previousFixRef.current = fix;

      setStatus("sharing");
      pendingRef.current = { fix, eventId: newIdempotencyKey() };
      void flush();
    };

    const ensureWatch = async (): Promise<void> => {
      if (cancelled || watch || starting) return;
      starting = true;
      const result = await watchPosition(handleFix, {
        accuracy: "high",
        minIntervalMs: SEND_INTERVAL_MS,
        // La simulación se mueve sola: no hay que esperar a que "se desplace" el GPS del navegador.
        minDistanceM: IS_PREVIEW_BUILD ? 0 : 10,
        heartbeatMs: SEND_INTERVAL_STOPPED_MS,
      });
      starting = false;
      if (cancelled) {
        if (result.ok) result.watch.stop();
        return;
      }
      if (result.ok) watch = result.watch;
      else applyFailure(result.reason);
    };

    const probe = async (): Promise<void> => {
      const result = await getCurrentPosition({ accuracy: "high", timeoutMs: PROBE_TIMEOUT_MS });
      if (cancelled) return;
      if (result.ok) {
        handleFix(result.position);
        void ensureWatch();
      } else {
        applyFailure(result.reason);
      }
    };

    void (async () => {
      setStatus((previous) => (previous === "inactive" ? "checking" : previous));
      const permission = await getLocationPermission();
      if (cancelled) return;
      const initial = statusForPermission(permission);
      if (initial !== "searching") {
        setStatus(initial);
        return;
      }
      setStatus((previous) => (previous === "sharing" ? previous : "searching"));
      await probe();
      if (cancelled) return;
      void ensureWatch();
      timer = setInterval(() => {
        const current = statusRef.current;
        // Sin permiso hace falta una acción de la persona: no se vuelve a probar a ciegas.
        if (current === "needs_permission" || current === "denied" || current === "blocked") return;
        if (monotonicNow() - lastFixAt > STALL_MS) void probe();
      }, WATCHDOG_MS);
    })();

    return () => {
      cancelled = true;
      stopAll();
      stopRef.current = () => undefined;
    };
  }, [enabled, paused, appActive, tripId, attempt, flush, setStatus]);

  const allow = useCallback(() => {
    void (async () => {
      const result = await requestLocationPermission();
      if (!mountedRef.current) return;
      const next = statusForPermission(result);
      if (next === "searching") setAttempt((value) => value + 1);
      else setStatus(next);
    })();
  }, [setStatus]);

  const openSettings = useCallback(() => {
    void openAppSettings();
  }, []);

  const continueWithout = useCallback(() => {
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    setPaused(false);
    setAttempt((value) => value + 1);
  }, []);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return { status, sendFailed, simulated, allow, openSettings, continueWithout, resume, retry };
}
