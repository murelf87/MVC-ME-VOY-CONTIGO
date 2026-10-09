/**
 * Formas de cable del módulo money (espejo de `mobile/src/api/types/money.ts`; mantener sincronizadas).
 * El backend no importa tipos de `mobile/` (otra configuración de TypeScript).
 */
import type { MoneyDto, PublicUserDto } from "../../lib/dto.js";

export type { MoneyDto, PublicUserDto };

export type ChargeMethodKind = "apple_pay" | "google_pay" | "card";
export type PaymentMethodKind = ChargeMethodKind | "sepa_debit" | "bank_account";
export type PaymentMethodPurpose = "charge" | "payout";
export type PaymentStatus = "requires_action" | "processing" | "succeeded" | "failed" | "expired" | "refunded";
export type PaymentOutcome =
  | "awaiting_payment"
  | "booking_confirmed"
  | "late_payment"
  | "amount_mismatch"
  | "duplicate_payment"
  | "request_not_payable"
  | "failed"
  | "expired"
  | "refunded";

export interface PaymentsAvailabilityDto {
  enabled: boolean;
  status: "enabled" | "provider_disabled";
  message: string | null;
  chargeMethods: ChargeMethodKind[];
  payoutsEnabled: boolean;
  refundsEnabled: boolean;
}

export interface PaymentMethodDto {
  id: string;
  purpose: PaymentMethodPurpose;
  kind: PaymentMethodKind;
  brand: string | null;
  last4: string | null;
  country: string | null;
  expMonth: number | null;
  expYear: number | null;
  title: string;
  maskedLabel: string;
  isDefault: boolean;
  status: "active" | "requires_action" | "expired";
  createdAt: string;
}

export interface PaymentViewDto {
  id: string;
  requestId: string;
  bookingId: string | null;
  status: PaymentStatus;
  outcome: PaymentOutcome;
  amount: MoneyDto;
  refunded: MoneyDto;
  method: { kind: PaymentMethodKind; maskedLabel: string | null };
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  succeededAt: string | null;
}

export interface MoneyTripRefDto {
  tripId: string;
  departureAt: string | null;
  originLabel: string | null;
  destinationLabel: string | null;
}

export interface PaymentSummaryDto {
  contribution: MoneyDto;
  platformFee: MoneyDto;
  processing: MoneyDto;
  taxes: MoneyDto;
  total: MoneyDto;
  tariffVersion: number | null;
  quoteSnapshotId: string | null;
}

export type CancellationPolicyStatus = "pending_review" | "approved";

export interface CancellationPolicyRefDto {
  status: CancellationPolicyStatus;
  version: number | null;
  effectiveFrom: string | null;
  summary: string | null;
}

export type RefundStatus = "pending_review" | "approved" | "executing" | "refunded" | "rejected" | "failed" | "not_applicable";
export type RefundOrigin =
  | "passenger_cancellation"
  | "driver_cancellation"
  | "platform_cancellation"
  | "force_majeure"
  | "no_show"
  | "late_payment"
  | "other";
export type RefundExecutionStatus = "not_started" | "awaiting_provider" | "submitted" | "succeeded" | "failed";
export type RefundDecisionBasis = "policy" | "manual_override" | "manual_without_policy" | "late_payment_full_refund";

export interface RefundViewDto {
  id: string;
  status: RefundStatus;
  origin: RefundOrigin;
  bookingId: string | null;
  requestId: string;
  paymentId: string | null;
  paid: MoneyDto;
  proposedRefund: MoneyDto;
  approvedRefund: MoneyDto;
  platformFee: MoneyDto;
  finalPassengerCost: MoneyDto;
  executionStatus: RefundExecutionStatus;
  policy: CancellationPolicyRefDto;
  createdAt: string;
  decidedAt: string | null;
  refundedAt: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type PaymentRequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "payment_pending"
  | "confirmed"
  | "expired"
  | "cancelled"
  | "payment_late";

export type PaymentHoldStatus = "active" | "released" | "consumed" | "none";

export interface PaymentHoldViewDto {
  status: PaymentHoldStatus;
  expiresAt: string | null;
  secondsRemaining: number | null;
}

export type PaymentBlockCode =
  | "PAYMENTS_PROVIDER_DISABLED"
  | "REQUEST_NOT_PAYABLE"
  | "HOLD_EXPIRED"
  | "PAYMENT_AMOUNT_NOT_DEFINED"
  | "PAYMENT_ALREADY_OPEN"
  | "REQUEST_ALREADY_PAID";

export interface PaymentBlockReasonDto {
  code: PaymentBlockCode;
  message: string;
}

export interface ChargeMethodOptionDto {
  kind: ChargeMethodKind;
  available: boolean;
}

export interface RequestPaymentContextDto {
  requestId: string;
  requestStatus: PaymentRequestStatus;
  driver: PublicUserDto;
  trip: MoneyTripRefDto;
  hold: PaymentHoldViewDto;
  availability: PaymentsAvailabilityDto;
  methods: ChargeMethodOptionDto[];
  savedMethods: PaymentMethodDto[];
  summary: PaymentSummaryDto;
  canPay: boolean;
  cannotPayReason: PaymentBlockReasonDto | null;
  payment: PaymentViewDto | null;
  bookingId: string | null;
}

export interface PaymentClientActionDto {
  type: "none" | "sdk_payment_sheet" | "redirect";
  clientSecret: string | null;
  redirectUrl: string | null;
}

export interface CreatePaymentIntentResponseDto {
  payment: PaymentViewDto;
  clientAction: PaymentClientActionDto;
}
