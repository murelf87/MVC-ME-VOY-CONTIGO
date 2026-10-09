import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { ingestProviderEvents } from "../payments/event-service.js";
import type { PaymentProvider } from "../provider/types.js";
import { errorResponses, webhookResponseSchema } from "./schemas.js";

export const WEBHOOK_BODY_LIMIT_BYTES = 256 * 1024;
/** Límite de tasa propio de la ruta (el resto de rutas usa el global). Los proveedores reintentan con retroceso. */
export const WEBHOOK_RATE_LIMIT = { max: 300, timeWindow: "1 minute" } as const;

/**
 * Webhook de pagos (servidor a servidor, sin Bearer). Contexto Fastify propio para conservar el cuerpo CRUDO:
 * la firma se calcula sobre los bytes recibidos y un re-serializado la invalidaría.
 */
export function registerWebhookRoutes(scope: FastifyInstance, pool: Pool, provider: PaymentProvider): void {
  // Cualquier tipo de contenido llega como Buffer; el adaptador del proveedor decide cómo interpretarlo tras verificar la firma.
  scope.removeAllContentTypeParsers();
  scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: WEBHOOK_BODY_LIMIT_BYTES }, (_request, body, done) => {
    done(null, body);
  });

  scope.post("/v1/webhooks/payments", {
    bodyLimit: WEBHOOK_BODY_LIMIT_BYTES,
    config: { rateLimit: WEBHOOK_RATE_LIMIT },
    schema: {
      tags: ["Webhooks"],
      summary: "Webhook del proveedor de pagos",
      description:
        "Servidor a servidor. Verifica la firma HMAC (`X-Webhook-Signature: t=<unix>,v1=<hex>`) sobre el cuerpo crudo; sin `PAYMENTS_WEBHOOK_SECRET` o con el proveedor desactivado se rechaza SIEMPRE (503). Idempotente por `(provider, eventId)`: un duplicado devuelve 200 `duplicate` sin repetir efectos. Un objeto desconocido devuelve 409 `PAYMENT_UNKNOWN` para que el proveedor reintente. La app NO llama a este endpoint.",
      response: { 200: webhookResponseSchema, ...errorResponses(400, 401, 409, 503) }
    }
  }, async request => {
    const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    const events = provider.verifyAndParseWebhook(rawBody, request.headers);
    const results = await ingestProviderEvents(pool, provider.name, events);
    return { received: true as const, results };
  });
}
