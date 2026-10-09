import { createHash } from "node:crypto";

/**
 * UUID determinista (formato v5) derivado de un texto. Se usa para que un reintento con la misma `Idempotency-Key`
 * (p. ej. tras caerse el servidor entre la llamada al proveedor y la confirmación en base de datos) genere el MISMO
 * identificador propio y la MISMA clave idempotente hacia el proveedor: no se duplica el intento de pago.
 */
export function deterministicUuid(seed: string): string {
  const bytes = createHash("sha256").update(seed, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Clave idempotente hacia el proveedor: estable, sin datos personales y de longitud acotada. */
export function providerIdempotencyKey(namespace: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 40);
  return `mvc-${namespace}-${digest}`;
}
