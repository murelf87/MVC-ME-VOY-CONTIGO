/** Devoluciones del pasajero. Mientras alguna siga abierta la lista se refresca sola para no enseñar un estado viejo. */
import type { RefundView } from "@/api/types/money";
import { usePaginatedQuery, type UsePaginatedQueryResult } from "@/hooks";
import { listRefunds } from "../api";
import { moneyKeys } from "./keys";

const POLL_MS = 30_000;

export function useRefundsList(): UsePaginatedQueryResult<RefundView> {
  return usePaginatedQuery<RefundView>(moneyKeys.refunds(), ({ cursor, signal }) => listRefunds({ cursor }, { signal }), {
    staleTimeMs: 15_000,
    refetchIntervalMs: POLL_MS,
  });
}
