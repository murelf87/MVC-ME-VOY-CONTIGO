/** «Ver todos»: lista paginada de pagos del pasajero y de cobros del conductor, con filtro por estado. */
import type { DriverEarningItem, DriverEarningState, PassengerPaymentItem, PassengerPaymentState } from "@/api/types/money";
import { usePaginatedQuery, type UsePaginatedQueryResult } from "@/hooks";
import { listEarnings, listPayments } from "../api";
import { moneyKeys } from "./keys";

const STALE_MS = 15_000;

export function usePaymentsList(state: PassengerPaymentState | null, enabled = true): UsePaginatedQueryResult<PassengerPaymentItem> {
  return usePaginatedQuery<PassengerPaymentItem>(
    moneyKeys.payments(state),
    ({ cursor, signal }) => listPayments({ state, cursor }, { signal }),
    { enabled, staleTimeMs: STALE_MS, getItemId: (item) => item.key },
  );
}

export function useEarningsList(state: DriverEarningState | null, enabled = true): UsePaginatedQueryResult<DriverEarningItem> {
  return usePaginatedQuery<DriverEarningItem>(
    moneyKeys.earnings(state),
    ({ cursor, signal }) => listEarnings({ state, cursor }, { signal }),
    { enabled, staleTimeMs: STALE_MS, getItemId: (item) => item.bookingId },
  );
}
