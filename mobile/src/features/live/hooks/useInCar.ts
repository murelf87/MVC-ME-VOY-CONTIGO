import { useMemo } from "react";
import type { LiveInCarState } from "@/api/types";
import { queryCache, useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getBookingInCar } from "../api";
import { etaView, remainingLine, type EtaView } from "../model/eta";
import { inCarPollInterval } from "../model/phase";
import { resolveSignal, type SignalState } from "../model/signal";
import { elapsedSince } from "../model/time";
import { liveKeys } from "./keys";
import { useNow } from "./useNow";

/** Umbral de señal vieja: el contrato lo da en `/live`; `/in-car` usa el mismo valor por defecto. */
const DEFAULT_STALE_AFTER_SECONDS = 60;

export interface InCarViewState {
  query: UseApiQueryResult<LiveInCarState>;
  state: LiveInCarState | undefined;
  signal: SignalState | null;
  /** Llegada al destino del pasajero («Llegada estimada 08:20»). */
  eta: EtaView | null;
  /** «Faltan 15 min · 6,8 km». */
  remaining: string | null;
  elapsedSeconds: number;
  nowMs: number;
}

function ageFrom(state: LiveInCarState): number | null {
  if (state.lastUpdateAt === null) return null;
  const last = Date.parse(state.lastUpdateAt);
  const server = Date.parse(state.serverTime);
  if (!Number.isFinite(last) || !Number.isFinite(server)) return null;
  return Math.max(0, (server - last) / 1000);
}

export interface UseInCarOptions {
  /** `false` no pide nada (p. ej. la hoja del código de «Esperando el coche» mientras está cerrada). */
  enabled?: boolean;
}

/** Estado de «En el coche» (pantalla 23). Sondeo suave (20 s) mientras está a la vista. */
export function useInCar(bookingId: string, options: UseInCarOptions = {}): InCarViewState {
  const key = liveKeys.inCar(bookingId);
  const knownPhase = queryCache.getData<LiveInCarState>(key)?.phase;
  const query = useApiQuery<LiveInCarState>(key, ({ signal }) => getBookingInCar(bookingId, { signal }), {
    enabled: options.enabled ?? true,
    staleTimeMs: 5_000,
    refetchIntervalMs: inCarPollInterval(knownPhase),
  });
  const nowMs = useNow(1_000);
  const state = query.data;
  const elapsedSeconds = elapsedSince(query.updatedAt, nowMs);

  return useMemo<InCarViewState>(() => {
    if (state === undefined) return { query, state, signal: null, eta: null, remaining: null, elapsedSeconds, nowMs };
    return {
      query,
      state,
      signal: resolveSignal({
        signal: state.signal,
        position: null,
        lastUpdateAgeSeconds: ageFrom(state),
        staleAfterSeconds: DEFAULT_STALE_AFTER_SECONDS,
        elapsedSeconds,
      }),
      eta: etaView(state.etaAtDestination),
      remaining: remainingLine(state.remaining),
      elapsedSeconds,
      nowMs,
    };
  }, [query, state, elapsedSeconds, nowMs]);
}
