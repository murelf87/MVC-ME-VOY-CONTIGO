import type { AppConfig } from "../../../config.js";
import { DisabledPaymentProvider } from "./disabled.js";
import type { PaymentProvider } from "./types.js";

export type { PaymentProvider } from "./types.js";
export { DisabledPaymentProvider, PAYMENTS_DISABLED_MESSAGE } from "./disabled.js";

/**
 * Único punto donde se decide el proveedor. Hoy `loadConfig()` solo admite «disabled»; cuando exista un adaptador
 * real se añadirá aquí (y a `PaymentsProviderName`) tras la decisión de proveedor y con credenciales reales.
 */
export function buildPaymentProvider(config: AppConfig): PaymentProvider {
  switch (config.paymentsProvider) {
    case "disabled":
      return new DisabledPaymentProvider();
  }
}
