import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { parseIdempotencyKey } from "../lib/idempotency.js";
import { authenticate } from "../lib/http.js";
import { addPaymentMethod, listPaymentMethods, removePaymentMethod } from "../payments/methods-service.js";
import { createPaymentIntent, getPaymentForUser, getRequestPaymentContext } from "../payments/payment-service.js";
import type { PaymentProvider } from "../provider/types.js";
import type { ChargeMethodKind, PaymentMethodPurpose } from "../types.js";
import { BEARER, sendIdempotent } from "./helpers.js";
import {
  addPaymentMethodBodySchema,
  createPaymentIntentBodySchema,
  createPaymentIntentResponseSchema,
  errorResponses,
  idempotencyHeaderSchema,
  paramsOf,
  paymentMethodSchema,
  paymentMethodsResponseSchema,
  paymentViewSchema,
  queryOf,
  requestPaymentContextSchema,
  enumOf,
  bool
} from "./schemas.js";

const TAG_PAY = ["Pagos"];
const TAG_METHODS = ["Métodos de pago"];

export function registerPaymentRoutes(app: FastifyInstance, pool: Pool, provider: PaymentProvider): void {
  app.get<{ Params: { requestId: string } }>("/v1/ride-requests/:requestId/payment", {
    schema: {
      tags: TAG_PAY,
      security: BEARER,
      summary: "Estado y pago de una solicitud aceptada",
      description:
        "Datos de la pantalla «Estado y pago»: reserva provisional con cuenta atrás (reloj del servidor), resumen del pago, métodos ofrecidos y si se puede pagar ahora (`canPay`/`cannotPayReason`). Con el proveedor de pagos desactivado: `availability.enabled=false`, importes «Por definir» si no hay tarifa aprobada y `cannotPayReason.code=PAYMENTS_PROVIDER_DISABLED`. Solo el pasajero de la solicitud.",
      params: paramsOf("requestId"),
      response: { 200: requestPaymentContextSchema, ...errorResponses(400, 401, 404) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return getRequestPaymentContext(pool, provider, principal, request.params.requestId);
  });

  app.post<{
    Params: { requestId: string };
    Body: { method: { kind: ChargeMethodKind; paymentMethodId?: string } };
    Headers: { "idempotency-key"?: string };
  }>("/v1/ride-requests/:requestId/payment-intents", {
    schema: {
      tags: TAG_PAY,
      security: BEARER,
      summary: "Pagar la reserva (crear intento de pago)",
      description:
        "Crea el intento de pago de la solicitud. El importe sale SIEMPRE de la cotización congelada del servidor (el cuerpo no lleva importes). Requiere `Idempotency-Key`. Con el proveedor desactivado responde 409 `PAYMENTS_PROVIDER_DISABLED`. El resultado del SDK del móvil NO confirma nada: la app sondea `GET /v1/payments/{paymentId}` hasta un estado final decidido por el servidor.",
      params: paramsOf("requestId"),
      headers: idempotencyHeaderSchema,
      body: createPaymentIntentBodySchema,
      response: { 201: createPaymentIntentResponseSchema, ...errorResponses(400, 401, 404, 409, 422, 502) }
    }
  }, async (request, reply) => {
    const principal = await authenticate(pool, request);
    const key = parseIdempotencyKey(request.headers["idempotency-key"]);
    const outcome = await createPaymentIntent(pool, provider, principal, key, request.params.requestId, request.body);
    return sendIdempotent(reply, outcome);
  });

  app.get<{ Params: { paymentId: string } }>("/v1/payments/:paymentId", {
    schema: {
      tags: TAG_PAY,
      security: BEARER,
      summary: "Estado de un pago",
      description:
        "Estado del pago decidido solo por el servidor a partir de eventos firmados del proveedor. Solo el pagador. Sondeo recomendado cada 1–2 s (máx. ~60 s) tras abrir el SDK del proveedor.",
      params: paramsOf("paymentId"),
      response: { 200: paymentViewSchema, ...errorResponses(400, 401, 404) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return getPaymentForUser(pool, principal, request.params.paymentId);
  });

  app.get<{ Querystring: { purpose?: PaymentMethodPurpose } }>("/v1/me/payment-methods", {
    schema: {
      tags: TAG_METHODS,
      security: BEARER,
      summary: "Mis métodos de pago",
      description:
        "Métodos tokenizados (nunca PAN/CVV/IBAN completo). `purpose=charge` (pasajero, por defecto) o `payout` (cuenta de cobro del conductor). Con el proveedor desactivado la lista es vacía y `availability.enabled=false`.",
      querystring: queryOf({ purpose: enumOf(["charge", "payout"]) }),
      response: { 200: paymentMethodsResponseSchema, ...errorResponses(400, 401) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return listPaymentMethods(pool, provider, principal, request.query.purpose ?? "charge");
  });

  app.post<{
    Body: { purpose: PaymentMethodPurpose; providerToken: string; setAsDefault?: boolean };
    Headers: { "idempotency-key"?: string };
  }>("/v1/me/payment-methods", {
    schema: {
      tags: TAG_METHODS,
      security: BEARER,
      summary: "Añadir un método de pago (token del proveedor)",
      description:
        "Registra un método a partir del token que entrega el SDK del proveedor. Un valor con aspecto de número de tarjeta se rechaza (400 `RAW_CARD_DATA_REJECTED`) y no se almacena. Con el proveedor desactivado: 409 `PAYMENTS_PROVIDER_DISABLED`. Requiere `Idempotency-Key`.",
      headers: idempotencyHeaderSchema,
      body: addPaymentMethodBodySchema,
      response: { 201: paymentMethodSchema, ...errorResponses(400, 401, 409, 422, 502) }
    }
  }, async (request, reply) => {
    const principal = await authenticate(pool, request);
    const key = parseIdempotencyKey(request.headers["idempotency-key"]);
    const outcome = await addPaymentMethod(pool, provider, principal, key, request.body);
    return sendIdempotent(reply, outcome);
  });

  app.delete<{ Params: { methodId: string } }>("/v1/me/payment-methods/:methodId", {
    schema: {
      tags: TAG_METHODS,
      security: BEARER,
      summary: "Quitar un método de pago",
      description:
        "Solo el propietario. Marca el método como retirado (se desvincula en el proveedor si está activo). Si era el predeterminado, el más reciente restante pasa a serlo. No se puede quitar un método usado por un pago en curso (409 `PAYMENT_ALREADY_OPEN`).",
      params: paramsOf("methodId"),
      response: { 200: { type: "object", additionalProperties: false, required: ["removed"], properties: { removed: bool } }, ...errorResponses(400, 401, 404, 409, 502) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return removePaymentMethod(pool, provider, principal, request.params.methodId);
  });
}
