import crypto from "node:crypto";
import { DomainError } from "../errors.js";
import type { ParsedProviderEvent } from "./types.js";

/**
 * Stripe webhook verification and mapping. Only the documented signature scheme is used:
 * header `Stripe-Signature: t=<unix>,v1=<hex>` where v1 = HMAC-SHA256(secret, `${t}.${rawBody}`).
 * No Stripe account or key is configured in this repository; the adapter stays disabled until
 * PAYMENTS_PROVIDER=stripe and STRIPE_WEBHOOK_SECRET are set by the operator.
 */
export function verifyStripeSignature(
  rawBody: Buffer, header: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300
): void {
  if (!header) throw new DomainError("WEBHOOK_SIGNATURE_MISSING", "Missing Stripe-Signature header", 400);
  const parts = header.split(",").map(p => p.trim().split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isInteger(t) || !signatures.length) {
    throw new DomainError("WEBHOOK_SIGNATURE_INVALID", "Malformed Stripe-Signature header", 400);
  }
  if (Math.abs(nowSeconds - t) > toleranceSeconds) {
    throw new DomainError("WEBHOOK_SIGNATURE_EXPIRED", "Webhook timestamp outside tolerance", 400);
  }
  const expected = crypto.createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest();
  const ok = signatures.some(sig => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
  if (!ok) throw new DomainError("WEBHOOK_SIGNATURE_INVALID", "Stripe signature does not match", 400);
}

function cents(v: unknown): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new DomainError("WEBHOOK_PAYLOAD_INVALID", "Amount is not integer cents", 400);
  return n;
}

function eur(o: any) {
  if (o?.currency && String(o.currency).toLowerCase() !== "eur") {
    throw new DomainError("WEBHOOK_CURRENCY_UNSUPPORTED", "Only EUR is supported", 400);
  }
}

export function parseStripeEvent(body: any): ParsedProviderEvent {
  if (!body || typeof body.id !== "string" || typeof body.type !== "string" || !body.data?.object) {
    throw new DomainError("WEBHOOK_PAYLOAD_INVALID", "Not a Stripe event", 400);
  }
  const o = body.data.object;
  const base = {
    eventId: body.id as string,
    eventType: body.type as string,
    occurredAt: new Date(Number(body.created) * 1000).toISOString(),
    objectId: typeof o.id === "string" ? o.id : null
  };
  const pi = typeof o.payment_intent === "string" ? o.payment_intent : o.payment_intent?.id ?? null;
  switch (body.type) {
    case "payment_intent.succeeded":
      eur(o);
      return { ...base, internal: {
        type: "payment.succeeded", providerPaymentId: o.id, amountCents: cents(o.amount_received ?? o.amount),
        requestId: o.metadata?.requestId ?? null
      } };
    case "refund.created":
    case "refund.updated":
    case "charge.refund.updated":
    case "refund.failed":
      eur(o);
      if (body.type === "refund.failed" || o.status === "failed" || o.status === "canceled") {
        return { ...base, internal: { type: "refund.failed", providerPaymentId: pi, providerRefundId: o.id, reason: o.failure_reason ?? o.status ?? "failed" } };
      }
      if (o.status !== "succeeded") return { ...base, internal: null };
      return { ...base, internal: { type: "refund.succeeded", providerPaymentId: pi, providerRefundId: o.id, amountCents: cents(o.amount) } };
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
      return { ...base, internal: {
        type: "dispute.changed", providerDisputeId: o.id, providerPaymentId: pi, amountCents: cents(o.amount),
        status: o.status === "won" ? "won" : o.status === "lost" ? "lost" : "open", reason: o.reason ?? null
      } };
    case "payout.paid":
    case "payout.failed":
      eur(o);
      return { ...base, internal: {
        type: body.type === "payout.paid" ? "payout.paid" : "payout.failed",
        providerPayoutId: o.id, payoutId: o.metadata?.payoutId ?? null, amountCents: cents(o.amount),
        reason: o.failure_message ?? o.failure_code ?? null
      } };
    default:
      return { ...base, internal: null };
  }
}
