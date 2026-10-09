import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { PrivateObjectStorage } from "../storage/private-object-storage.js";
import type { GeocodingProvider, RouteProvider } from "../maps/types.js";
import { registerTripsModule } from "./trips/index.js";
import { registerMoneyModule } from "./money/index.js";
import { registerCommsModule } from "./comms/index.js";
import { registerTrustModule } from "./trust/index.js";

export type ModuleDeps = {
  pool: Pool;
  config: AppConfig;
  privateStorage: PrivateObjectStorage | null;
  routeProvider: RouteProvider | null;
  geocodingProvider: GeocodingProvider | null;
};

/**
 * Módulos añadidos para la versión 0.15+ (pantallas aprobadas 01–40). Cada módulo es propietario de sus
 * rutas, servicios y migraciones (rangos: trips 020–039, money 040–059, comms 060–079, trust 080–099).
 */
export async function registerModules(app: FastifyInstance, deps: ModuleDeps): Promise<void> {
  await registerTripsModule(app, deps);
  await registerMoneyModule(app, deps);
  await registerCommsModule(app, deps);
  await registerTrustModule(app, deps);
}
