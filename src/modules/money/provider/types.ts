import type { ChargeMethodKind, PaymentMethodKind, PaymentMethodPurpose } from "../types.js";

/**
 * Abstracción del proveedor de pagos (marketplace con payouts a terceros).
 *
 * NO se ha elegido proveedor (ver docs/contracts/money.md, «Decisiones y bloqueos»). Hoy solo existe
 * `DisabledPaymentProvider`. Un adaptador real implementará esta interfaz sin tocar el dominio:
 *  - el dominio calcula importes desde la cotización congelada y los pasa en céntimos enteros;
 *  - el proveedor NUNCA decide el estado de un pago en la app: solo informa por eventos firmados
 *    (`verifyAndParseWebhook`), que son lo único que mueve `payments.status`;
 *  - todas las operaciones llevan clave idempotente propia para que un reintento no duplique efectos en el proveedor.
 */

export type PaymentClientAction = {
  type: "none" | "sdk_payment_sheet" | "redirect";
  clientSecret: string | null;
  redirectUrl: string | null;
};

export interface CreatePaymentIntentInput {
  idempotencyKey: string;
  /** Identificador propio del pago (va en los metadatos del proveedor para correlacionar webhooks). */
  paymentId: string;
  amountCents: number;
  currency: "EUR";
  method: { kind: ChargeMethodKind; providerMethodRef: string | null };
  metadata: { requestId: string; passengerUserId: string };
}

export interface CreatedPaymentIntent {
  providerPaymentRef: string;
  /** Estado inicial según el proveedor. La confirmación (`succeeded`) solo llega por webhook. */
  status: "requires_action" | "processing";
  clientAction: PaymentClientAction;
}

export interface RefundPaymentInput {
  idempotencyKey: string;
  providerPaymentRef: string;
  amountCents: number;
  metadata: { refundRequestId: string };
}

export interface SubmittedRefund {
  providerRefundRef: string;
}

export interface AttachMethodInput {
  userId: string;
  purpose: PaymentMethodPurpose;
  /** Token que entregó el SDK del proveedor en el móvil. Nunca un número de tarjeta. */
  providerToken: string;
}

export interface AttachedMethod {
  providerMethodRef: string;
  kind: PaymentMethodKind;
  brand: string | null;
  last4: string | null;
  country: string | null;
  expMonth: number | null;
  expYear: number | null;
}

export interface CreatePayoutInput {
  idempotencyKey: string;
  payoutRunId: string;
  amountCents: number;
  destinationMethodRef: string;
}

export interface SubmittedPayout {
  providerPayoutRef: string;
}

export type ProviderEventBase = {
  provider: string;
  /** Identificador único del evento en el proveedor (clave de idempotencia). */
  eventId: string;
  /** Instante del evento según el proveedor. */
  occurredAt: Date;
};

export type NormalizedProviderEvent =
  | (ProviderEventBase & {
      object: "payment";
      type: "requires_action" | "processing" | "succeeded" | "failed" | "expired";
      providerPaymentRef: string;
      /** Importe cobrado, obligatorio en `succeeded` (se compara con el del intento). */
      amountCents: number | null;
      currency: string | null;
      failureCode: string | null;
    })
  | (ProviderEventBase & {
      object: "refund";
      type: "succeeded" | "failed";
      providerRefundRef: string;
      providerPaymentRef: string;
      amountCents: number;
      failureCode: string | null;
    })
  | (ProviderEventBase & {
      object: "payout";
      type: "paid" | "failed";
      providerPayoutRef: string;
      amountCents: number;
      failureCode: string | null;
    });

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface PaymentProvider {
  readonly name: string;
  readonly enabled: boolean;
  readonly capabilities: { chargeMethods: ChargeMethodKind[]; payouts: boolean; refunds: boolean };
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<CreatedPaymentIntent>;
  refundPayment(input: RefundPaymentInput): Promise<SubmittedRefund>;
  attachMethod(input: AttachMethodInput): Promise<AttachedMethod>;
  detachMethod(providerMethodRef: string): Promise<void>;
  createPayout(input: CreatePayoutInput): Promise<SubmittedPayout>;
  /**
   * Verifica la firma sobre el cuerpo CRUDO y devuelve eventos normalizados.
   * Debe lanzar `DomainError` 401 WEBHOOK_SIGNATURE_INVALID / 400 WEBHOOK_PAYLOAD_INVALID / 503 PAYMENTS_WEBHOOK_NOT_CONFIGURED.
   */
  verifyAndParseWebhook(rawBody: Buffer, headers: WebhookHeaders): NormalizedProviderEvent[];
}
