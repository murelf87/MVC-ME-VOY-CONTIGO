/**
 * Detalle de una devolución y sus tres acciones (aprobar, rechazar, pedir al proveedor).
 *
 * Las tres llevan `Idempotency-Key` (obligatoria en el contrato) que genera `useApiMutation`: reintentar tras un fallo
 * indeterminado reutiliza la misma clave y no duplica la acción. Nada se marca «devuelta» en la app: tras cada acción
 * se vuelve a leer el estado del servidor, que solo pasa a `refunded` con la confirmación firmada del proveedor.
 */
import type { AdminRefundDetail, AdminRefundItem, ApproveRefundRequest, RejectRefundRequest } from "@/api/types";
import { useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { approveRefund, executeRefund, getRefundDetail, rejectRefund } from "../api";
import { ADMIN_REFUNDS, HOME_OPEN_REFUNDS, refundDetailKey } from "../keys";

export function useRefundDetail(refundId: string, enabled = true): UseApiQueryResult<AdminRefundDetail> {
  return useApiQuery(refundDetailKey(refundId), ({ signal }) => getRefundDetail(refundId, { signal }), { enabled, staleTimeMs: 10_000 });
}

export interface ApproveVariables {
  refundId: string;
  body: ApproveRefundRequest;
}

export interface RejectVariables {
  refundId: string;
  body: RejectRefundRequest;
}

export interface RefundActions {
  approve: UseApiMutationResult<AdminRefundItem, ApproveVariables>;
  reject: UseApiMutationResult<AdminRefundItem, RejectVariables>;
  execute: UseApiMutationResult<AdminRefundItem, string>;
}

const INVALIDATES = [ADMIN_REFUNDS, HOME_OPEN_REFUNDS] as const;

export function useRefundActions(): RefundActions {
  const approve = useApiMutation<AdminRefundItem, ApproveVariables>(
    (variables, { idempotencyKey, signal }) => approveRefund(variables.refundId, variables.body, { idempotencyKey, signal }),
    { invalidates: INVALIDATES },
  );
  const reject = useApiMutation<AdminRefundItem, RejectVariables>(
    (variables, { idempotencyKey, signal }) => rejectRefund(variables.refundId, variables.body, { idempotencyKey, signal }),
    { invalidates: INVALIDATES },
  );
  const execute = useApiMutation<AdminRefundItem, string>(
    (refundId, { idempotencyKey, signal }) => executeRefund(refundId, { idempotencyKey, signal }),
    { invalidates: INVALIDATES },
  );
  return { approve, reject, execute };
}
