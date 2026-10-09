import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../register.js";
import { type TrustConfig, loadTrustConfig } from "./config.js";
import type { TrustContext } from "./context.js";
import { trustErrorHandler } from "./http.js";
import { registerTrustDataRights } from "./public.js";
import { registerAdminOpsRoutes } from "./routes/admin-ops-routes.js";
import { registerAdminRoutes } from "./routes/admin-routes.js";
import { registerAdminSupportRoutes } from "./routes/admin-support-routes.js";
import { registerLegalRoutes } from "./routes/legal-routes.js";
import { registerUserRoutes } from "./routes/user-routes.js";

export type TrustModuleOptions = {
  /** Solo para pruebas: configuración explícita en lugar de leer el entorno. */
  trustConfig?: TrustConfig;
  /** Solo para pruebas: reloj inyectable. */
  now?: () => Date;
};

/** Contexto de servicios del módulo a partir de las dependencias de la aplicación. */
export function buildTrustContext(deps: ModuleDeps, options: TrustModuleOptions = {}): TrustContext {
  return {
    pool: deps.pool,
    storage: deps.privateStorage,
    config: options.trustConfig ?? loadTrustConfig(),
    uploadTtlSeconds: deps.config.privateUploadTtlSeconds,
    now: options.now ?? (() => new Date())
  };
}

/**
 * Módulo «trust»: foto de perfil y comprobación privada (pantallas 05–08), documentos legales versionados y panel de
 * administración con RBAC y auditoría (pantallas 37–40). Contrato: docs/contracts/trust.md · tipos: mobile/src/api/types/trust.ts.
 *
 * Las rutas viven en un contexto Fastify encapsulado con su propio manejador de errores (400 VALIDATION_ERROR,
 * 429 RATE_LIMITED, DomainError) para no depender del manejador global.
 * Nada de este módulo activa la economía: publicar tarifas está bloqueado por ECONOMICS_ACTIVATION (por defecto `disabled`).
 */
export async function registerTrustModule(app: FastifyInstance, deps: ModuleDeps, options: TrustModuleOptions = {}): Promise<void> {
  const ctx = buildTrustContext(deps, options);
  // Exportación de datos y eliminación de cuenta (registro de comms): si no está disponible, el arranque no falla.
  const dataRightsConnected = await registerTrustDataRights();
  if (!dataRightsConnected) app.log.warn("trust: no se pudo conectar con el registro de derechos sobre los datos de comms");
  await app.register(async scope => {
    scope.setErrorHandler(trustErrorHandler);
    // Respuestas privadas por defecto; las públicas (documentos legales, foto aprobada) fijan su propio Cache-Control.
    scope.addHook("onSend", async (_request, reply, payload) => {
      if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
      return payload;
    });
    registerUserRoutes(scope, ctx);
    registerLegalRoutes(scope, ctx);
    registerAdminRoutes(scope, ctx);
    registerAdminOpsRoutes(scope, ctx);
    registerAdminSupportRoutes(scope, ctx);
  });
}
