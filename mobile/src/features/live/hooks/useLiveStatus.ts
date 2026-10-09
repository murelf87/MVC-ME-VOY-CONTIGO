import { useMemo } from "react";
import type { LiveBookingStatusView } from "@/api/types";
import { queryCache, useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getBookingLive } from "../api";
import { etaView, type EtaView } from "../model/eta";
import { waitingBanner, waitingPollInterval, type WaitingBanner } from "../model/phase";
import { resolveSignal, type SignalState } from "../model/signal";
import { elapsedSince } from "../model/time";
import { liveKeys } from "./keys";
import { useNow } from "./useNow";

export interface LiveStatusState {
  query: UseApiQueryResult<LiveBookingStatusView>;
  view: LiveBookingStatusView | undefined;
  /** Señal ya corregida con el tiempo transcurrido desde la última respuesta. */
  signal: SignalState | null;
  banner: WaitingBanner | null;
  eta: EtaView | null;
  /** Segundos desde la última respuesta (para que «hace 5 s» siga corriendo entre sondeos). */
  elapsedSeconds: number;
  nowMs: number;
}

/**
 * Estado en directo de una reserva (pantalla 21). Sondea mientras el coche está en marcha (8 s) y se para solo al salir de
 * la pantalla, al pasar la app a segundo plano o sin red (lo hace `useApiQuery`); en fases finales no sondea.
 */
export function useLiveStatus(bookingId: string): LiveStatusState {
  const key = liveKeys.status(bookingId);
  const knownPhase = queryCache.getData<LiveBookingStatusView>(key)?.phase;
  const query = useApiQuery<LiveBookingStatusView>(key, ({ signal }) => getBookingLive(bookingId, { signal }), {
    staleTimeMs: 3_000,
    refetchIntervalMs: waitingPollInterval(knownPhase),
  });
  const nowMs = useNow(1_000);
  const view = query.data;
  const elapsedSeconds = elapsedSince(query.updatedAt, nowMs);

  return useMemo<LiveStatusState>(() => {
    if (view === undefined) return { query, view, signal: null, banner: null, eta: null, elapsedSeconds, nowMs };
    return {
      query,
      view,
      signal: resolveSignal({
        signal: view.signal,
        position: view.position,
        lastUpdateAgeSeconds: view.lastUpdateAgeSeconds,
        staleAfterSeconds: view.staleAfterSeconds,
        elapsedSeconds,
      }),
      banner: waitingBanner(view),
      eta: etaView(view.eta),
      elapsedSeconds,
      nowMs,
    };
  }, [query, view, elapsedSeconds, nowMs]);
}
