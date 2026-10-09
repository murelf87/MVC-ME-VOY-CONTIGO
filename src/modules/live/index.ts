import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../register.js";

/** Módulo «live». Registra aquí sus rutas (cada ruta con schema completo: params, query, body y response). */
export async function registerLiveModule(_app: FastifyInstance, _deps: ModuleDeps): Promise<void> {
  // pendiente de implementar por el propietario del módulo
}
