import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../register.js";
import { buildPaymentProvider } from "./provider/index.js";
import { registerMoneyRoutes } from "./routes/register.js";

/**
 * Módulo «money»: pago de la reserva, métodos de pago, cobros y liquidaciones del conductor, recibos, cancelación y
 * devoluciones (con revisión de finanzas), libro mayor y planes (pantallas 16, 28, 32, 33 y 39).
 * Contrato: docs/contracts/money.md · tipos de la app: mobile/src/api/types/money.ts.
 *
 * El proveedor de pagos sale de la configuración (`PAYMENTS_PROVIDER`, hoy solo «disabled»): nada se marca como pagado
 * sin un evento firmado confirmado por el servidor.
 */
export async function registerMoneyModule(app: FastifyInstance, deps: ModuleDeps): Promise<void> {
  const provider = buildPaymentProvider(deps.config);
  await app.register(async scope => {
    await registerMoneyRoutes(scope, { pool: deps.pool }, { provider });
  });
}

export { registerMoneyRoutes } from "./routes/register.js";
export { purgeIdempotencyKeys } from "./lib/idempotency.js";
export { buildPaymentProvider, DisabledPaymentProvider } from "./provider/index.js";
export type { PaymentProvider } from "./provider/types.js";
