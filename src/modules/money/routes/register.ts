import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { installMoneyErrorHandler } from "../lib/http.js";
import type { PaymentProvider } from "../provider/types.js";
import { registerAdminRoutes } from "./admin-routes.js";
import { registerCancelRoutes } from "./cancel-routes.js";
import { registerPaymentRoutes } from "./payment-routes.js";
import { registerPlanRoutes } from "./plan-routes.js";
import { registerReportRoutes } from "./report-routes.js";
import { registerWebhookRoutes } from "./webhook-routes.js";

export type MoneyRouteDeps = { pool: Pool };
export type MoneyRouteOptions = { provider: PaymentProvider };

/**
 * Registra TODAS las rutas del módulo en el contexto Fastify recibido (que debe ser propio/encapsulado: se instala un
 * manejador de errores y un hook de cabeceras). Separado de `registerMoneyModule` para que las pruebas puedan inyectar
 * un proveedor de pruebas; en producción el proveedor sale SIEMPRE de la configuración (hoy solo «disabled»).
 */
export async function registerMoneyRoutes(
  scope: FastifyInstance,
  deps: MoneyRouteDeps,
  options: MoneyRouteOptions
): Promise<void> {
  installMoneyErrorHandler(scope);
  // Importes, pagos y datos de personas: nunca deben quedar en cachés intermedias.
  scope.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  registerPaymentRoutes(scope, deps.pool, options.provider);
  registerReportRoutes(scope, deps.pool, options.provider);
  registerCancelRoutes(scope, deps.pool);
  registerAdminRoutes(scope, deps.pool, options.provider);
  registerPlanRoutes(scope, deps.pool);
  await scope.register(async webhookScope => {
    registerWebhookRoutes(webhookScope, deps.pool, options.provider);
  });
}
