/**
 * Backend en memoria de la vista previa · slice `search` · paquete «solicitar plaza y pagar» (`search-request`).
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`). Contratos: `docs/contracts/trips.md` §5–§8 y `docs/contracts/money.md` §3–§4.
 *
 * Endpoints que registra este paquete:
 *   GET  /v1/trips/:tripId/pickup-points           puntos de recogida propuestos A/B (sesión obligatoria)
 *   GET  /v1/ride-requests/:id                     detalle de la solicitud (pasajero titular o conductor)
 *   POST /v1/ride-requests/:id/withdraw            retirar una solicitud aún sin responder
 *   POST /v1/trips/:tripId/weekly-requests/preview días y plazas ANTES de crear (sin efectos)
 *   POST /v1/trips/:tripId/weekly-requests         crear la reserva semanal (una solicitud por día y sentido)
 *   GET  /v1/weekly-reservations/:id               lectura
 *   POST /v1/weekly-reservations/:id/withdraw      retirada
 *   GET  /v1/ride-requests/:id/payment             contexto de pago (pantalla 16)
 *   POST /v1/ride-requests/:id/payment-intents     intento de pago (Idempotency-Key obligatoria)
 *   GET  /v1/payments/:id                          estado del pago (sondeo)
 * `POST /v1/trips/:tripId/requests` ya lo registra el núcleo (forma heredada 0.14); aquí se le engancha la forma ampliada.
 */
import type { CreatePaymentIntentRequest, WeeklyRequestBody } from "@/api/types";
import {
  SEED_IDS,
  registerSeedRef,
  reply,
  setExtendedRideRequestCreator,
  uuidParam,
  type JsonSchema,
  type PreviewDb,
  type PreviewProfileId,
  type PreviewRouter,
} from "@/preview";
import { createRequestWithPickup } from "./requestCreate";
import { getRideRequest, withdrawRideRequest } from "./requestDetail";
import { createPaymentIntent, getPayment, requestPaymentContext } from "./requestPayments";
import { proposePickupPoints } from "./requestPickup";
import { requestSeedVariants as variantTable, seedRequestVariant } from "./requestVariants";
import { createWeekly, getWeekly, previewWeekly, weeklyRequests, weeklyTable, withdrawWeekly } from "./requestWeekly";

const isoDate: JsonSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const weekday: JsonSchema = { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] };

const weeklyBody: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pickupPointId", "weekdays", "startDate"],
  properties: {
    pickupPointId: { type: "string", maxLength: 300 },
    dropoffStopSeq: { type: "integer", minimum: 1 },
    weekdays: { type: "array", items: weekday, minItems: 1, maxItems: 7 },
    legs: { type: "array", items: { type: "string", enum: ["outbound", "return"] }, minItems: 1, maxItems: 2 },
    startDate: isoDate,
    weeks: { type: "integer", minimum: 1, maximum: 4 },
    exceptionDates: { type: "array", items: isoDate, maxItems: 40 },
    cancellationPolicyVersion: { type: ["string", "null"], maxLength: 40 },
    allowPartial: { type: "boolean" },
    message: { type: "string", maxLength: 300 },
  },
};

const intentBody: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["method"],
  properties: {
    method: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { type: "string", enum: ["apple_pay", "google_pay", "card"] },
        paymentMethodId: { type: "string", format: "uuid" },
      },
    },
  },
};

export function registerRequestPreview(r: PreviewRouter, db: PreviewDb): void {
  // Referencias para los escenarios de diseño (lámina 16b): la reserva semanal de Miguel y su primera solicitud.
  registerSeedRef("weekly.miguel", (database) => weeklyTable(database).filter((w) => w.passenger_user_id === SEED_IDS.users.miguel).sort((a, b) => b.created_at - a.created_at)[0]?.id);
  registerSeedRef("weekly.miguelRequest", (database) => {
    const reservation = weeklyTable(database).filter((w) => w.passenger_user_id === SEED_IDS.users.miguel).sort((a, b) => b.created_at - a.created_at)[0];
    return reservation === undefined ? undefined : weeklyRequests(database, reservation.id)[0]?.id;
  });
  setExtendedRideRequestCreator((database, principal, tripId, body, requestId) => createRequestWithPickup(database, principal, tripId, body, requestId));

  r.get<{ Params: { tripId: string }; Query: { lat: number; lng: number; dropoffStopSeq?: number; limit?: number } }>(
    "/v1/trips/:tripId/pickup-points",
    {
      summary: "Puntos de recogida propuestos (pantalla 13)",
      tags: ["requests"],
      schema: {
        params: uuidParam("tripId"),
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["lat", "lng"],
          properties: {
            lat: { type: "number", minimum: -90, maximum: 90 },
            lng: { type: "number", minimum: -180, maximum: 180 },
            dropoffStopSeq: { type: "integer", minimum: 1 },
            limit: { type: "integer", minimum: 1, maximum: 4 },
          },
        },
      },
    },
    (req) => proposePickupPoints(db, req.auth().userId, req.params.tripId, req.query)
  );

  r.get<{ Params: { requestId: string } }>(
    "/v1/ride-requests/:requestId",
    { summary: "Detalle de una solicitud de plaza", tags: ["requests"], schema: { params: uuidParam("requestId") } },
    (req) => getRideRequest(db, req.params.requestId, req.auth().userId)
  );

  r.post<{ Params: { requestId: string } }>(
    "/v1/ride-requests/:requestId/withdraw",
    { summary: "Retirar una solicitud pendiente", tags: ["requests"], schema: { params: uuidParam("requestId") } },
    (req) => withdrawRideRequest(db, req.params.requestId, req.auth().userId)
  );

  r.post<{ Params: { tripId: string }; Body: WeeklyRequestBody }>(
    "/v1/trips/:tripId/weekly-requests/preview",
    { summary: "Vista previa de la reserva semanal (sin efectos)", tags: ["requests"], schema: { params: uuidParam("tripId"), body: weeklyBody } },
    (req) => previewWeekly(db, req.auth().userId, req.params.tripId, req.body)
  );

  r.post<{ Params: { tripId: string }; Body: WeeklyRequestBody }>(
    "/v1/trips/:tripId/weekly-requests",
    { summary: "Crear la reserva semanal", tags: ["requests"], idempotent: true, schema: { params: uuidParam("tripId"), body: weeklyBody } },
    (req) => reply.created(createWeekly(db, req.auth(), req.params.tripId, req.body, req.requestId))
  );

  r.get<{ Params: { id: string } }>(
    "/v1/weekly-reservations/:id",
    { summary: "Reserva semanal", tags: ["requests"], schema: { params: uuidParam("id") } },
    (req) => getWeekly(db, req.params.id, req.auth().userId)
  );

  r.post<{ Params: { id: string } }>(
    "/v1/weekly-reservations/:id/withdraw",
    { summary: "Retirar una reserva semanal pendiente", tags: ["requests"], schema: { params: uuidParam("id") } },
    (req) => withdrawWeekly(db, req.params.id, req.auth().userId)
  );

  r.get<{ Params: { requestId: string } }>(
    "/v1/ride-requests/:requestId/payment",
    { summary: "Contexto de pago de una solicitud (pantalla 16)", tags: ["money"], schema: { params: uuidParam("requestId") } },
    (req) => requestPaymentContext(db, req.auth().userId, req.params.requestId)
  );

  r.post<{ Params: { requestId: string }; Body: CreatePaymentIntentRequest }>(
    "/v1/ride-requests/:requestId/payment-intents",
    {
      summary: "Crear un intento de pago (Idempotency-Key obligatoria)",
      tags: ["money"],
      idempotent: "required",
      schema: { params: uuidParam("requestId"), body: intentBody },
    },
    (req) => reply.created(createPaymentIntent(db, req.auth().userId, req.params.requestId, req.body))
  );

  r.get<{ Params: { paymentId: string } }>(
    "/v1/payments/:paymentId",
    { summary: "Estado de un pago (sondeo)", tags: ["money"], schema: { params: uuidParam("paymentId") } },
    (req) => getPayment(db, req.auth().userId, req.params.paymentId)
  );
}

/** Siembra la variante `seed` si es de este paquete; cualquier otro nombre no hace nada. */
export function seedRequest(db: PreviewDb, profile: PreviewProfileId, seed: string): void {
  seedRequestVariant(db, profile, seed);
}

/** Variantes de datos propias del paquete: { "nombre-unico": "qué contiene, en una frase" }. */
export const requestSeedVariants: Readonly<Record<string, string>> = variantTable;
