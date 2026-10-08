/** Provider-neutral payment events; every adapter maps its own webhooks onto these. */
export type InternalPaymentEvent =
  | { type: "payment.succeeded"; providerPaymentId: string; amountCents: number; requestId: string | null }
  | { type: "refund.succeeded"; providerPaymentId: string | null; providerRefundId: string; amountCents: number }
  | { type: "refund.failed"; providerPaymentId: string | null; providerRefundId: string; reason: string }
  | { type: "dispute.changed"; providerDisputeId: string; providerPaymentId: string | null; amountCents: number; status: "open" | "won" | "lost"; reason: string | null }
  | { type: "payout.paid" | "payout.failed"; providerPayoutId: string; payoutId: string | null; amountCents: number; reason: string | null };

export type ParsedProviderEvent = {
  eventId: string;
  eventType: string;
  occurredAt: string;
  objectId: string | null;
  /** null when the event is irrelevant to MVC; it is stored and marked ignored. */
  internal: InternalPaymentEvent | null;
};
