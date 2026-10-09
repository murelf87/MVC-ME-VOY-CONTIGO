/**
 * Resultado del pago (pantalla «Resultado del pago») a partir de lo que DICE el servidor. Función pura: nunca decide por
 * su cuenta que algo está pagado; con pagos todavía abiertos o sin respuesta el resultado es «pending».
 */
import type { PaymentView } from "@/api/types";
import { moneyParts } from "@/i18n";
import { requestStrings } from "../strings";

const copy = requestStrings.result;

export type ResultKind = "confirmed" | "partial" | "late" | "review" | "failed" | "expired" | "refunded" | "cancelled" | "pending";
export type ResultTone = "success" | "warning" | "error" | "info";

export interface ResultModel {
  kind: ResultKind;
  tone: ResultTone;
  title: string;
  message: string;
  /** Importe pagado y método, solo cuando hay reserva confirmada. */
  paid: { amount: string; method: string } | null;
  confirmed: number;
  total: number;
  /** Se puede volver a intentar el pago (el servidor no cobró y la reserva puede seguir viva). */
  canRetry: boolean;
  bookingId: string | null;
}

const METHOD_LABEL = { apple_pay: "Apple Pay", google_pay: "Google Pay", card: "Tarjeta" } as const;

const REVIEW_OUTCOMES: readonly PaymentView["outcome"][] = ["amount_mismatch", "duplicate_payment", "request_not_payable"];

function methodText(p: PaymentView): string {
  const base = METHOD_LABEL[p.method.kind as keyof typeof METHOD_LABEL] ?? "Tarjeta";
  return p.method.maskedLabel ? `${base} ${p.method.maskedLabel}` : base;
}

export function buildResultModel(payments: readonly PaymentView[], expected: number, forced?: "cancelled" | "timeout"): ResultModel {
  const total = Math.max(expected, payments.length);
  const base = { paid: null, confirmed: 0, total, canRetry: false, bookingId: null } as const;
  if (forced === "cancelled") return { ...base, kind: "cancelled", tone: "info", title: copy.cancelledTitle, message: copy.cancelledMessage, canRetry: true };
  const open = payments.some((p) => p.status === "processing" || p.status === "requires_action");
  if (forced === "timeout" || open || payments.length < expected) {
    return { ...base, kind: "pending", tone: "warning", title: copy.pendingTitle, message: copy.pendingMessage };
  }
  const confirmed = payments.filter((p) => p.outcome === "booking_confirmed");
  const late = payments.find((p) => p.outcome === "late_payment");
  const review = payments.find((p) => REVIEW_OUTCOMES.includes(p.outcome));
  const failed = payments.find((p) => p.status === "failed" || p.outcome === "failed");
  const expired = payments.find((p) => p.status === "expired" || p.outcome === "expired");
  const refunded = payments.find((p) => p.status === "refunded" || p.outcome === "refunded");
  const first = confirmed[0];
  if (confirmed.length > 0 && confirmed.length === payments.length) {
    const cents = confirmed.reduce((sum, p) => sum + (p.amount.cents ?? 0), 0);
    const amount = moneyParts({ ...confirmed[0]!.amount, cents }).text;
    return {
      ...base,
      kind: "confirmed",
      tone: "success",
      title: copy.confirmedTitle,
      message: total > 1 ? copy.confirmedWeeklyMessage(confirmed.length) : copy.confirmedMessage,
      paid: { amount, method: methodText(confirmed[0]!) },
      confirmed: confirmed.length,
      bookingId: first?.bookingId ?? null,
    };
  }
  if (confirmed.length > 0) {
    return { ...base, kind: "partial", tone: "warning", title: copy.partialTitle, message: copy.partialMessage(confirmed.length, total), confirmed: confirmed.length, bookingId: first?.bookingId ?? null };
  }
  if (late !== undefined) return { ...base, kind: "late", tone: "warning", title: copy.lateTitle, message: copy.lateMessage };
  if (review !== undefined) return { ...base, kind: "review", tone: "warning", title: copy.reviewTitle, message: copy.reviewMessage };
  if (refunded !== undefined) return { ...base, kind: "refunded", tone: "info", title: copy.refundedTitle, message: copy.refundedMessage };
  if (expired !== undefined) return { ...base, kind: "expired", tone: "warning", title: copy.expiredTitle, message: copy.expiredMessage, canRetry: true };
  if (failed !== undefined) {
    const detail = failed.failureCode === "card_declined" ? copy.failedCardDeclined : failed.failureCode === "insufficient_funds" ? copy.failedInsufficient : copy.failedMessage;
    return { ...base, kind: "failed", tone: "error", title: copy.failedTitle, message: detail, canRetry: true };
  }
  return { ...base, kind: "pending", tone: "warning", title: copy.pendingTitle, message: copy.pendingMessage };
}
