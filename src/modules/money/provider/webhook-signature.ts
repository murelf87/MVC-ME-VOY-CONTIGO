import { createHmac, timingSafeEqual } from "node:crypto";
import { DomainError } from "../../../errors.js";

/**
 * Esqueleto genérico de verificación HMAC-SHA256 para webhooks (NO es el esquema de ningún proveedor concreto):
 *
 *   X-Webhook-Signature: t=<unix segundos>,v1=<hex>[,v1=<hex>]
 *   v1 = HMAC-SHA256(secreto, "<t>." + cuerpoCrudo)
 *
 * Varios `v1` permiten rotar el secreto. Un adaptador real puede reutilizarlo o sustituirlo.
 * Reglas de seguridad:
 *  - sin secreto configurado SIEMPRE se rechaza (una clave vacía permitiría a cualquiera firmar);
 *  - comparación en tiempo constante;
 *  - ventana de tolerancia de reloj (por defecto 300 s) contra reenvíos antiguos.
 */

export const WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export function computeHmacSha256Hex(secret: string, timestampSeconds: number, rawBody: Buffer): string {
  return createHmac("sha256", secret)
    .update(`${timestampSeconds}.`, "utf8")
    .update(rawBody)
    .digest("hex");
}

export type SignatureCheck = {
  secret: string | undefined;
  rawBody: Buffer;
  header: string | undefined;
  nowSeconds?: number;
  toleranceSeconds?: number;
};

const invalid = (message: string): DomainError => new DomainError("WEBHOOK_SIGNATURE_INVALID", message, 401);

export function verifyHmacSha256Signature(input: SignatureCheck): void {
  if (!input.secret) {
    throw new DomainError(
      "PAYMENTS_WEBHOOK_NOT_CONFIGURED",
      "El webhook de pagos no está configurado: no se acepta ningún evento.",
      503
    );
  }
  if (!input.header) throw invalid("Falta la firma del webhook.");

  let timestamp: number | null = null;
  const candidates: Buffer[] = [];
  for (const part of input.header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t" && /^[0-9]{1,12}$/.test(value)) timestamp = Number(value);
    if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) candidates.push(Buffer.from(value, "hex"));
  }
  if (timestamp === null || candidates.length === 0) throw invalid("Formato de firma inválido.");

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) throw invalid("La firma está fuera de la ventana de tolerancia.");

  const expected = Buffer.from(computeHmacSha256Hex(input.secret, timestamp, input.rawBody), "hex");
  const ok = candidates.some(candidate => candidate.length === expected.length && timingSafeEqual(candidate, expected));
  if (!ok) throw invalid("Firma incorrecta.");
}
