/**
 * Iniciar el pago de una solicitud aceptada (o de todos los días aceptados de una reserva semanal).
 *
 *  1. `POST /v1/ride-requests/:id/payment-intents` por solicitud, con `Idempotency-Key` OBLIGATORIA derivada de la clave
 *     del intento (`<clave>-<i>`): reintentar tras un corte devuelve el mismo intento, nunca cobra dos veces.
 *  2. Apple Pay / Google Pay: se abre la hoja del sistema. Autorizar en la hoja NO es haber pagado: la pantalla de
 *     «Procesando» espera la confirmación del servidor.
 *  3. Tarjeta guardada: el servidor ya tiene su `paymentMethodId`; no hay hoja.
 */
import type { ChargeMethodKind, PaymentView } from "@/api/types";
import { useApiMutation, type UseApiMutationResult } from "@/hooks";
import { presentWalletSheet } from "@/platform";
import { postPaymentIntent } from "../api";
import { AFFECTED_ELSEWHERE, REQUEST_ALL } from "./keys";

export interface PayVars {
  requestIds: readonly string[];
  method: { kind: ChargeMethodKind; paymentMethodId?: string };
  /** Concepto y total ya formateados para la hoja del sistema. */
  sheetLabel: string;
  amountLabel: string;
}

export type PayOutcome =
  | { kind: "started"; payments: PaymentView[] }
  | { kind: "cancelled"; payments: PaymentView[] }
  | { kind: "sheet_failed"; payments: PaymentView[] }
  | { kind: "sdk_unsupported"; payments: PaymentView[] };

export function usePayRequest(): UseApiMutationResult<PayOutcome, PayVars> {
  return useApiMutation<PayOutcome, PayVars>(
    async (vars, { idempotencyKey, signal }) => {
      const payments: PaymentView[] = [];
      for (let i = 0; i < vars.requestIds.length; i += 1) {
        const requestId = vars.requestIds[i];
        if (requestId === undefined) continue;
        const created = await postPaymentIntent(requestId, { method: vars.method }, { idempotencyKey: `${idempotencyKey}-${i}`, signal });
        payments.push(created.payment);
      }
      if (vars.method.kind === "card") return { kind: "started", payments };
      const sheet = await presentWalletSheet({
        kind: vars.method.kind,
        merchant: "MVC · Me voy contigo",
        label: vars.sheetLabel,
        amountLabel: vars.amountLabel,
      });
      switch (sheet.status) {
        case "authorized":
          return { kind: "started", payments };
        case "cancelled":
          return { kind: "cancelled", payments };
        case "failed":
          return { kind: "sheet_failed", payments };
        case "unavailable":
          return { kind: "sdk_unsupported", payments };
      }
    },
    { invalidates: [REQUEST_ALL, ...AFFECTED_ELSEWHERE] },
  );
}
