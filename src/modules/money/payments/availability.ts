import { PAYMENTS_DISABLED_MESSAGE } from "../provider/disabled.js";
import type { PaymentProvider } from "../provider/types.js";
import type { ChargeMethodKind, PaymentsAvailabilityDto } from "../types.js";

export const ALL_CHARGE_METHODS: readonly ChargeMethodKind[] = ["apple_pay", "google_pay", "card"];

export function describeAvailability(provider: PaymentProvider): PaymentsAvailabilityDto {
  if (!provider.enabled) {
    return {
      enabled: false,
      status: "provider_disabled",
      message: PAYMENTS_DISABLED_MESSAGE,
      chargeMethods: [],
      payoutsEnabled: false,
      refundsEnabled: false
    };
  }
  return {
    enabled: true,
    status: "enabled",
    message: null,
    chargeMethods: [...provider.capabilities.chargeMethods],
    payoutsEnabled: provider.capabilities.payouts,
    refundsEnabled: provider.capabilities.refunds
  };
}
