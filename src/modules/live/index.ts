import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { ModuleDeps } from "../register.js";
import { tx } from "./common.js";
import { registerLiveDataRights } from "./data-rights.js";
import { installLiveErrorHandler } from "./http.js";
import { expireDueRouteChanges } from "./route-change-service.js";
import { registerLiveRoutes } from "./routes.js";

/**
 * Módulo «live»: viaje en directo del pasajero (21 Esperando el coche, 23 En el coche, 24 Viaje terminado),
 * cambio de ruta con consentimiento (22), valoraciones, incidencias, «Compartir viaje (privado)» y consola del conductor.
 * Contrato: docs/contracts/live.md · tipos de la app: mobile/src/api/types/live.ts.
 *
 * Las rutas viven en un contexto Fastify encapsulado con su propio manejador de errores (400 VALIDATION_ERROR,
 * 429 RATE_LIMITED, DomainError) para no depender del manejador global.
 */
export async function registerLiveModule(app: FastifyInstance, deps: ModuleDeps): Promise<void> {
  await app.register(async scope => {
    installLiveErrorHandler(scope);
    registerLiveRoutes(scope, deps);
  });
  // Exportación y eliminación de cuenta (RGPD): se conectan al registro público de `comms`.
  if (!(await registerLiveDataRights())) {
    app.log.warn("live: la API pública de comms no está disponible; los datos de live no entrarán en la exportación ni en la eliminación de cuenta");
  }
}

/**
 * Barrido de caducidad de propuestas de cambio de ruta pendientes. La caducidad también se aplica de forma perezosa al leer o
 * responder; un barrido periódico (cron/worker del orquestador) garantiza el aviso aunque nadie abra la app. Devuelve cuántas caducaron.
 */
export async function expirePendingRouteChanges(pool: Pool, now: Date = new Date()): Promise<number> {
  // En una transacción: la caducidad y los avisos al conductor y a los pasajeros se confirman juntos (seguro con varias réplicas).
  return tx(pool, client => expireDueRouteChanges(client, {}, now));
}
