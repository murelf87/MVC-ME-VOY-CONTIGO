/**
 * Seguimiento de uno o varios pagos (`GET /v1/payments/:id`). SOLO el servidor decide: mientras el estado sea
 * `processing` / `requires_action` se sigue sondeando; pasado `PAYMENT_WAIT_MS` sin respuesta definitiva NO se da por
 * pagado ni por fallido (`timedOut`): se ofrece volver a comprobar.
 */
import { useEffect, useMemo, useState } from "react";
import type { PaymentView } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { fetchPayment } from "../api";
import { requestKeys } from "./keys";

export const PAYMENT_WAIT_MS = 45_000;
const POLL_MS = 1_500;

export const isOpenPayment = (p: PaymentView): boolean => p.status === "processing" || p.status === "requires_action";

function usePayment(paymentId: string | undefined, polling: boolean): UseApiQueryResult<PaymentView> {
  return useApiQuery(requestKeys.payment(paymentId ?? ""), ({ signal }) => fetchPayment(paymentId ?? "", { signal }), {
    enabled: paymentId !== undefined,
    staleTimeMs: 0,
    refetchIntervalMs: polling ? POLL_MS : false,
  });
}

export interface PaymentsStatus {
  payments: PaymentView[];
  queries: UseApiQueryResult<PaymentView>[];
  loading: boolean;
  /** Algún pago sigue abierto. */
  open: boolean;
  settled: boolean;
  timedOut: boolean;
  offline: boolean;
  failed: UseApiQueryResult<PaymentView> | undefined;
  recheck(): void;
}

/** Hasta 4 pagos a la vez (una reserva semanal puede tener varios días). Los hooks son fijos: no se condicionan. */
export function usePaymentsStatus(ids: readonly string[]): PaymentsStatus {
  const [attempt, setAttempt] = useState(0);
  const [startedAt, setStartedAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  const [stop, setStop] = useState(false);
  const polling = !stop;
  const q0 = usePayment(ids[0], polling);
  const q1 = usePayment(ids[1], polling);
  const q2 = usePayment(ids[2], polling);
  const q3 = usePayment(ids[3], polling);
  const queries = useMemo(() => [q0, q1, q2, q3].slice(0, Math.min(ids.length, 4)), [q0, q1, q2, q3, ids.length]);
  const payments = queries.flatMap((q) => (q.data === undefined ? [] : [q.data]));
  const loading = queries.some((q) => q.data === undefined && q.isLoading);
  const open = payments.length < queries.length || payments.some(isOpenPayment);
  const timedOut = open && now - startedAt >= PAYMENT_WAIT_MS;

  useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, attempt]);
  useEffect(() => {
    setStop(timedOut);
  }, [timedOut]);

  return {
    payments,
    queries,
    loading,
    open,
    settled: !loading && !open && payments.length === queries.length,
    timedOut,
    offline: queries.some((q) => q.isOffline),
    failed: queries.find((q) => q.isError),
    recheck: () => {
      setAttempt((n) => n + 1);
      setStartedAt(Date.now());
      setNow(Date.now());
      setStop(false);
      for (const q of queries) void q.refetch();
    },
  };
}
