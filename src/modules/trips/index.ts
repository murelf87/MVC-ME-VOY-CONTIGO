import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../register.js";
import { tripsErrorHandler } from "./common.js";
import { registerTripsRoutes } from "./routes.js";
import { startTripsSweeper } from "./sweeper.js";

/**
 * Módulo «trips» (migraciones 020–029): mapa de inicio, búsqueda, detalle del viaje, puntos de recogida A/B, solicitudes,
 * reservas semanales, presupuesto (`quote`), lado conductor (preparación, planificación de ruta con verificación de provincia
 * por parada, publicación, bandeja de solicitudes), «Mis viajes», favoritos y rutina.
 * Contrato: docs/contracts/trips.md · tipos de la app: mobile/src/api/types/trips.ts.
 *
 * Las rutas viven en un contexto Fastify ENCAPSULADO con su propio manejador de errores (400 VALIDATION_ERROR,
 * 429 RATE_LIMITED, DomainError), de modo que no dependen de que el manejador global convierta los errores de validación y
 * de límite de tasa (hoy los devuelve como 500). También arranca el barrido interno (caducidad de retenciones y ampliación
 * de la ventana de las series); se desactiva con `TRIPS_SWEEP_INTERVAL_SECONDS=0` y se detiene al cerrar la aplicación.
 */
export async function registerTripsModule(app: FastifyInstance, deps: ModuleDeps): Promise<void> {
  await app.register(async scope => {
    scope.setErrorHandler(tripsErrorHandler);
    await registerTripsRoutes(scope, {
      pool: deps.pool,
      routeProvider: deps.routeProvider,
      geocodingProvider: deps.geocodingProvider
    });
    const sweeper = startTripsSweeper(deps.pool, scope.log);
    scope.addHook("onClose", async () => { sweeper.stop(); });
  });
}

// API pública del módulo para otros módulos y para un planificador externo (cron/worker del orquestador).
export { registerRatingSummaryProvider } from "./public-user.js";
export { runTripsSweep, startTripsSweeper, type SweepResult } from "./sweeper.js";
export { computeQuote, computeWeeklyQuote, loadApprovedTariff, lockQuoteForRequest, quoteForRequest } from "./quote-service.js";
export { tripsSettings } from "./settings.js";
