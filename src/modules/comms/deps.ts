import type { Pool } from "pg";
import type { PrivateObjectStorage } from "../../storage/private-object-storage.js";
import type { CommsConfig } from "./config.js";
import type { ObjectEraser } from "./object-eraser.js";

export type JobLogger = {
  info(meta: object, message: string): void;
  warn(meta: object, message: string): void;
  error(meta: object, message: string): void;
};

export const silentLogger: JobLogger = { info() {}, warn() {}, error() {} };

/** Dependencias de los trabajos de derechos sobre los datos (exportación y eliminación) y de la limpieza de subidas. */
export type DataRightsDeps = {
  pool: Pool;
  config: CommsConfig;
  /** null o proveedor «disabled» = sin almacenamiento privado (nada se genera ni se entrega). */
  storage: PrivateObjectStorage | null;
  /** null = no se pueden borrar objetos (sin almacenamiento privado configurado). */
  eraser: ObjectEraser | null;
  /** Inyectable en pruebas; por defecto `fetch` global. */
  fetchImpl?: typeof fetch;
  log?: JobLogger;
};

export function storageEnabled(storage: PrivateObjectStorage | null): storage is PrivateObjectStorage {
  return storage !== null && storage.providerName !== "disabled";
}

/** Contexto común de las rutas del módulo. */
export type CommsRouteContext = {
  pool: Pool;
  config: CommsConfig;
  rights: DataRightsDeps;
  /** Almacenamiento privado tal como lo entrega el arranque (puede ser el proveedor «disabled» o null). */
  storage: PrivateObjectStorage | null;
  uploadTtlSeconds: number;
};
