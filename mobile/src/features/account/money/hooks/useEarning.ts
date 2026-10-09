/** Detalle de un cobro (`GET /v1/me/earnings/{bookingId}`). */
import type { DriverEarningDetail } from "@/api/types/money";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getEarning } from "../api";
import { moneyKeys } from "./keys";

export function useEarning(bookingId: string): UseApiQueryResult<DriverEarningDetail> {
  return useApiQuery(moneyKeys.earning(bookingId), ({ signal }) => getEarning(bookingId, { signal }), { staleTimeMs: 15_000 });
}
