import type { LiveConsole } from "@/api/types";
import { queryCache, useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getConsole } from "../api";
import { opsKeys } from "../keys";

/** Con el viaje en curso se refresca cada 10 s; publicado, cada 30 s; terminado o cancelado, no se sondea. */
export const CONSOLE_POLL_ACTIVE_MS = 10_000;
export const CONSOLE_POLL_SCHEDULED_MS = 30_000;

export type DriverConsoleResult = UseApiQueryResult<LiveConsole> & {
  /** Instante (reloj del móvil) en que llegó la respuesta que se está mostrando. */
  receivedAtMs: number | null;
};

/** Consola del conductor (`GET /v1/me/trips/{tripId}/console`) con sondeo según el estado del viaje. */
export function useDriverConsole(tripId: string): DriverConsoleResult {
  const key = opsKeys.console(tripId);
  const status = queryCache.getData<LiveConsole>(key)?.status;
  const refetchIntervalMs = status === "active" ? CONSOLE_POLL_ACTIVE_MS : status === "published" ? CONSOLE_POLL_SCHEDULED_MS : false;
  const query = useApiQuery<LiveConsole>(key, ({ signal }) => getConsole(tripId, { signal }), {
    staleTimeMs: 5_000,
    refetchIntervalMs,
  });
  return { ...query, receivedAtMs: query.updatedAt };
}
