/**
 * Liquidaciones (finanzas): lista por periodo, generar y pedir el abono. Generar y ejecutar llevan `Idempotency-Key`
 * (la misma al reintentar un fallo indeterminado). Nada se da por abonado hasta que el servidor devuelve `paid`.
 */
import type { AdminPayoutRun, ExecutePayoutRunResponse, GeneratePayoutRunsResponse, PaymentMethodsResponse, PayoutStatus } from "@/api/types";
import {
  useApiMutation,
  useApiQuery,
  usePaginatedQuery,
  type UseApiMutationResult,
  type UseApiQueryResult,
  type UsePaginatedQueryResult,
} from "@/hooks";
import { executePayoutRun, generatePayoutRuns, getPayoutAvailability, listPayoutRuns } from "../api";
import { ADMIN_AUDIT, ADMIN_PAYOUTS, PAYOUT_AVAILABILITY_KEY, payoutRunsKey } from "./keys";

export function usePayoutRuns(period: string | null, status: PayoutStatus | null, enabled: boolean): UsePaginatedQueryResult<AdminPayoutRun> {
  return usePaginatedQuery<AdminPayoutRun>(
    payoutRunsKey(period, status),
    ({ cursor, signal }) => listPayoutRuns({ period, status, cursor, limit: 20 }, { signal }),
    { enabled, staleTimeMs: 10_000 },
  );
}

/** ¿Hay proveedor de pago? Misma fuente que ven las personas conductoras (`availability.payoutsEnabled`). */
export function usePayoutAvailability(enabled: boolean): UseApiQueryResult<PaymentMethodsResponse> {
  return useApiQuery<PaymentMethodsResponse>(PAYOUT_AVAILABILITY_KEY, ({ signal }) => getPayoutAvailability({ signal }), {
    enabled,
    staleTimeMs: 60_000,
    refetchOnFocus: false,
  });
}

export function useGeneratePayoutRuns(): UseApiMutationResult<GeneratePayoutRunsResponse, string> {
  return useApiMutation<GeneratePayoutRunsResponse, string>(
    (period, { signal, idempotencyKey }) => generatePayoutRuns({ period }, { signal, idempotencyKey }),
    { invalidates: [ADMIN_PAYOUTS, ADMIN_AUDIT] },
  );
}

export function useExecutePayoutRun(): UseApiMutationResult<ExecutePayoutRunResponse, string> {
  return useApiMutation<ExecutePayoutRunResponse, string>(
    (payoutId, { signal, idempotencyKey }) => executePayoutRun(payoutId, { signal, idempotencyKey }),
    { invalidates: [ADMIN_PAYOUTS, ADMIN_AUDIT] },
  );
}
