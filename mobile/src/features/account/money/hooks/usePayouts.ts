/** Liquidaciones del conductor: lista paginada (con calendario, próximo abono y cuenta de cobro) y detalle. */
import type { MyPayoutsResponse, PayoutDetail, PayoutView } from "@/api/types/money";
import { useApiQuery, usePaginatedQuery, type UseApiQueryResult, type UsePaginatedQueryResult } from "@/hooks";
import { getPayout, listPayouts } from "../api";
import { moneyKeys } from "./keys";

export interface PayoutsListState extends Omit<UsePaginatedQueryResult<PayoutView>, "pages"> {
  /** Calendario, próximo abono, disponibilidad y cuenta de cobro (de la primera página). */
  overview: Pick<MyPayoutsResponse, "availability" | "schedule" | "nextPayout" | "payoutAccount"> | null;
}

export function usePayoutsList(enabled = true): PayoutsListState {
  const { pages, ...list } = usePaginatedQuery<PayoutView>(moneyKeys.payouts(), ({ cursor, signal }) => listPayouts({ cursor }, { signal }), {
    enabled,
    staleTimeMs: 15_000,
  });
  const first = pages[0] as MyPayoutsResponse | undefined;
  return {
    ...list,
    overview:
      first === undefined
        ? null
        : { availability: first.availability, schedule: first.schedule, nextPayout: first.nextPayout, payoutAccount: first.payoutAccount },
  };
}

export function usePayout(payoutId: string): UseApiQueryResult<PayoutDetail> {
  return useApiQuery(moneyKeys.payout(payoutId), ({ signal }) => getPayout(payoutId, { signal }), { staleTimeMs: 15_000 });
}
