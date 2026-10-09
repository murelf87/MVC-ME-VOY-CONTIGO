/**
 * Métodos de pago (solo referencias tokenizadas): lista, alta y baja. El alta recibe el token del proveedor, nunca un
 * número de tarjeta; con el proveedor desactivado el servidor responde `409 PAYMENTS_PROVIDER_DISABLED`.
 */
import type { AddPaymentMethodRequest, PaymentMethod, PaymentMethodPurpose, PaymentMethodsResponse, RemovePaymentMethodResponse } from "@/api/types/money";
import { useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { addPaymentMethod, listPaymentMethods, removePaymentMethod } from "../api";
import { MONEY, moneyKeys } from "./keys";

export function usePaymentMethods(purpose: PaymentMethodPurpose | null, enabled = true): UseApiQueryResult<PaymentMethodsResponse> {
  return useApiQuery(moneyKeys.methods(purpose), ({ signal }) => listPaymentMethods(purpose, { signal }), { enabled, staleTimeMs: 15_000 });
}

export function useAddPaymentMethod(): UseApiMutationResult<PaymentMethod, AddPaymentMethodRequest> {
  return useApiMutation<PaymentMethod, AddPaymentMethodRequest>(
    (body, { idempotencyKey, signal }) => addPaymentMethod(body, { idempotencyKey, signal }),
    { invalidates: [MONEY] },
  );
}

export function useRemovePaymentMethod(): UseApiMutationResult<RemovePaymentMethodResponse, string> {
  return useApiMutation<RemovePaymentMethodResponse, string>((methodId, { signal }) => removePaymentMethod(methodId, { signal }), {
    invalidates: [MONEY],
  });
}
