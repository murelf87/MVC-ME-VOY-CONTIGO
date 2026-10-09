import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../register.js";
import { loadCommsConfig, type CommsConfig } from "./config.js";
import type { CommsRouteContext, DataRightsDeps } from "./deps.js";
import { authenticate, installCommsErrorHandler, installEmptyBodyTolerance } from "./http.js";
import { startCommsJobs } from "./jobs.js";
import { buildObjectEraser, type ObjectEraser } from "./object-eraser.js";
import { registerChatRoutes } from "./routes-chat.js";
import { registerNotificationRoutes } from "./routes-notifications.js";
import { registerPrivacyRoutes } from "./routes-privacy.js";
import { registerSupportRoutes } from "./routes-support.js";

export type CommsModuleOverrides = {
  /** Sustituye valores de la configuración leída del entorno (pruebas). */
  config?: Partial<CommsConfig>;
  /** Borrado de objetos privados (pruebas). Por defecto S3 si está configurado. */
  eraser?: ObjectEraser | null;
  /** `fetch` usado para subir exportaciones por URL firmada (pruebas). */
  fetchImpl?: typeof fetch;
};

/**
 * Módulo «comms»: notificaciones, mensajes (chat de reserva y de grupo), ayuda, ajustes y derechos sobre los datos.
 * Las rutas viven en un contexto encapsulado con su propio manejador de errores (validación → 400, límite → 429) y
 * `Cache-Control: no-store` (todo es privado).
 */
export async function registerCommsModule(app: FastifyInstance, deps: ModuleDeps, overrides: CommsModuleOverrides = {}): Promise<void> {
  const config: CommsConfig = { ...loadCommsConfig(), ...overrides.config };
  const eraser = overrides.eraser !== undefined ? overrides.eraser : buildObjectEraser(deps.config);

  const rights: DataRightsDeps = {
    pool: deps.pool,
    config,
    storage: deps.privateStorage,
    eraser,
    ...(overrides.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
    log: {
      info: (meta, message) => app.log.info(meta, message),
      warn: (meta, message) => app.log.warn(meta, message),
      error: (meta, message) => app.log.error(meta, message)
    }
  };
  const ctx: CommsRouteContext = {
    pool: deps.pool,
    config,
    rights,
    storage: deps.privateStorage,
    uploadTtlSeconds: deps.config.privateUploadTtlSeconds
  };

  await app.register(async scope => {
    installCommsErrorHandler(scope);
    installEmptyBodyTolerance(scope);
    scope.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "no-store");
    });
    // Todas las rutas del módulo son privadas. La sesión se exige en `preValidation`: DESPUÉS del límite de frecuencia (que es un
    // gancho de ruta de `onRequest` y acota las consultas a la base de datos de quien envía tokens inventados) y ANTES de validar,
    // para que quien no tiene sesión reciba siempre 401 y nunca detalles del esquema.
    scope.addHook("preValidation", async request => {
      await authenticate(deps.pool, request);
    });
    registerNotificationRoutes(scope, ctx);
    registerChatRoutes(scope, ctx);
    registerSupportRoutes(scope, ctx);
    registerPrivacyRoutes(scope, ctx);
  });

  const jobs = startCommsJobs(rights, config.jobsIntervalSeconds);
  app.addHook("onClose", async () => {
    jobs.stop();
  });
}
