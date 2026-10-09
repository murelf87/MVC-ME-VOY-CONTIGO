import { DomainError } from "../../../errors.js";
import type { PaymentProvider } from "./types.js";

export const PAYMENTS_DISABLED_MESSAGE = "Pagos aún no disponibles";

/**
 * Proveedor por defecto (`PAYMENTS_PROVIDER=disabled`): no existe ninguna integración real.
 * Toda operación que exigiría al proveedor responde 409 PAYMENTS_PROVIDER_DISABLED; los webhooks se rechazan.
 * No simula nada: ni intentos, ni cobros, ni devoluciones.
 */
export class DisabledPaymentProvider implements PaymentProvider {
  readonly name = "disabled";
  readonly enabled = false;
  readonly capabilities: PaymentProvider["capabilities"] = { chargeMethods: [], payouts: false, refunds: false };

  private disabled(): never {
    throw new DomainError("PAYMENTS_PROVIDER_DISABLED", `${PAYMENTS_DISABLED_MESSAGE}.`, 409);
  }

  createPaymentIntent(): never {
    return this.disabled();
  }

  refundPayment(): never {
    return this.disabled();
  }

  attachMethod(): never {
    return this.disabled();
  }

  detachMethod(): never {
    return this.disabled();
  }

  createPayout(): never {
    return this.disabled();
  }

  verifyAndParseWebhook(): never {
    throw new DomainError(
      "PAYMENTS_WEBHOOK_NOT_CONFIGURED",
      "No hay proveedor de pagos configurado: no se acepta ningún webhook.",
      503
    );
  }
}
