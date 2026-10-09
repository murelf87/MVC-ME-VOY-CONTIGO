import type { Pool, PoolClient } from "pg";
import type { PrivateObjectStorage } from "../../storage/private-object-storage.js";
import type { TrustConfig } from "./config.js";

/** Dependencias que reciben todos los servicios del módulo (sin globales: facilita las pruebas). */
export type TrustContext = {
  pool: Pool;
  /** null o proveedor `disabled` ⇒ todo lo que sube/lee archivos responde PRIVATE_STORAGE_DISABLED. */
  storage: PrivateObjectStorage | null;
  config: TrustConfig;
  /** Vida de la URL firmada de subida (PRIVATE_UPLOAD_TTL_SECONDS). */
  uploadTtlSeconds: number;
  now: () => Date;
};

export type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;
