import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { AppConfig } from "../../config.js";

/**
 * Borrado de objetos del almacenamiento privado. `PrivateObjectStorage` (src/storage) solo sabe firmar subidas/descargas
 * y leer, así que el borrado de datos personales (eliminación de cuenta, caducidad de exportaciones) usa este contrato propio.
 * Borrar una clave que no existe NO es un error (S3 responde 204).
 */
export interface ObjectEraser {
  deleteObjects(keys: string[]): Promise<void>;
}

export class S3ObjectEraser implements ObjectEraser {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    input: { region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean }
  ) {
    this.client = new S3Client({
      region: input.region,
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
      forcePathStyle: input.forcePathStyle,
      credentials: { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey }
    });
  }

  async deleteObjects(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }
  }
}

/** null si el almacenamiento privado está desactivado o incompleto (la configuración válida la valida `buildPrivateObjectStorage`). */
export function buildObjectEraser(config: AppConfig): ObjectEraser | null {
  if (config.privateStorageProvider !== "s3") return null;
  if (!config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey) return null;
  return new S3ObjectEraser(config.s3Bucket, {
    region: config.s3Region,
    ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : {}),
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
    forcePathStyle: config.s3ForcePathStyle
  });
}
