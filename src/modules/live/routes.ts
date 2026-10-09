import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../register.js";
import {
  completeIncidentAttachment, createIncident, createIncidentAttachmentIntent, createRating, getMyIncident, listMyIncidents
} from "./feedback-service.js";
import { getDriverConsole } from "./console-service.js";
import { authenticate } from "./http.js";
import { getBookingLive, getBookingSummary, getInCarState } from "./passenger-service.js";
import { getLivePrivacy, setLivePrivacy } from "./privacy-service.js";
import { cancelRouteChange, createRouteChange, getRouteChangeView, respondRouteChange } from "./route-change-service.js";
import {
  attachmentIntentBodySchema, attachmentIntentSchema, bookingLiveSchema, consoleSchema, createIncidentBodySchema,
  createRatingBodySchema, createRouteChangeBodySchema, errorResponses, idempotencyHeaderSchema, inCarSchema,
  incidentAttachmentSchema, incidentPageSchema, incidentSchema, paramsOf, privacyBodySchema, privacySchema, ratingSchema,
  respondRouteChangeBodySchema, routeChangeSchema, shareCreateBodySchema, shareCreatedSchema, shareStateSchema,
  sharedTripSchema, summarySchema
} from "./schemas.js";
import { createShare, getShare, getSharedTrip, revokeShare } from "./share-service.js";
import type { LiveCreateIncidentBody, LiveCreateRatingBody, LiveCreateRouteChangeBody, LiveRespondRouteChangeBody } from "./types.js";

const BEARER = [{ bearerAuth: [] }];
const TAG_PASSENGER = ["Viaje en directo"];
const TAG_ROUTE = ["Cambio de ruta"];
const TAG_FEEDBACK = ["Fin de viaje"];
const TAG_SHARE = ["Compartir viaje"];
const TAG_DRIVER = ["Consola del conductor"];

/** Límite de tasa del enlace público (cualquiera puede probar tokens): 30 peticiones por minuto y dirección. */
export const SHARED_TRIP_RATE_LIMIT = { max: 30, timeWindow: "1 minute" } as const;

export function registerLiveRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  const { pool } = deps;

  // Datos de ubicación y de personas: nunca deben quedar en cachés intermedias.
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  /* ─────────────── Pasajero en directo (21 · 23 · 24) ─────────────── */

  app.get<{ Params: { bookingId: string } }>("/v1/bookings/:bookingId/live", {
    schema: {
      tags: TAG_PASSENGER, security: BEARER,
      summary: "Estado en directo de mi reserva (Esperando el coche)",
      description: "Fase, ETA por ruta, posición del coche (solo pasajero titular, viaje activo) y aviso de llegada. Una posición vieja se marca `stale`, nunca como directo. Sondeo recomendado cada 5–10 s.",
      params: paramsOf("bookingId"),
      response: { 200: bookingLiveSchema, ...errorResponses(401, 403, 404) }
    }
  }, async request => getBookingLive(pool, await authenticate(pool, request), request.params.bookingId));

  app.get<{ Params: { bookingId: string } }>("/v1/bookings/:bookingId/in-car", {
    schema: {
      tags: TAG_PASSENGER, security: BEARER,
      summary: "Estado dentro del coche (En el coche)",
      description: "Código de recogida (estado, nunca el código), ocupación, copasajeros respetando su privacidad, trayecto con paradas y ETA al destino.",
      params: paramsOf("bookingId"),
      response: { 200: inCarSchema, ...errorResponses(401, 403, 404) }
    }
  }, async request => getInCarState(pool, await authenticate(pool, request), request.params.bookingId));

  app.get<{ Params: { bookingId: string } }>("/v1/bookings/:bookingId/summary", {
    schema: {
      tags: TAG_PASSENGER, security: BEARER,
      summary: "Resumen del viaje (Viaje terminado)",
      description: "Trayecto del pasajero, duración, distancia por carretera planificada, pago, valoración e incidencias. También disponible con el viaje en curso.",
      params: paramsOf("bookingId"),
      response: { 200: summarySchema, ...errorResponses(401, 403, 404) }
    }
  }, async request => getBookingSummary(pool, await authenticate(pool, request), request.params.bookingId));

  /* ─────────────── Cambio de ruta con consentimiento (22) ─────────────── */

  app.post<{ Params: { tripId: string }; Body: LiveCreateRouteChangeBody; Headers: { "idempotency-key"?: string } }>(
    "/v1/trips/:tripId/route-changes",
    {
      schema: {
        tags: TAG_ROUTE, security: BEARER,
        summary: "Proponer una nueva parada (cambio de ruta)",
        description: "Solo el conductor propietario. Recalcula con rutas reales por carretera dentro de la provincia, calcula el impacto de horario y precio por pasajero y exige la aceptación de quien tenga un cambio material. Sin impactos materiales se aplica al instante. Cabecera opcional Idempotency-Key.",
        params: paramsOf("tripId"),
        headers: idempotencyHeaderSchema,
        body: createRouteChangeBodySchema,
        response: { 200: routeChangeSchema, 201: routeChangeSchema, ...errorResponses(400, 401, 403, 404, 409, 422, 503) }
      }
    },
    async (request, reply) => {
      const principal = await authenticate(pool, request);
      const body = request.body;
      const outcome = await createRouteChange(pool, principal, deps.routeProvider, {
        tripId: request.params.tripId,
        stop: { lat: body.stop.location.lat, lng: body.stop.location.lng, label: body.stop.label },
        afterStopSeq: body.afterStopSeq,
        requestId: body.requestId,
        idempotencyKey: request.headers["idempotency-key"]
      });
      return reply.code(outcome.created ? 201 : 200).send(outcome.view);
    }
  );

  app.get<{ Params: { proposalId: string } }>("/v1/route-changes/:proposalId", {
    schema: {
      tags: TAG_ROUTE, security: BEARER,
      summary: "Detalle de un cambio de ruta (Antes / Ahora)",
      description: "Lo ve el conductor que lo propuso y los pasajeros afectados. Una propuesta pendiente cuyo plazo venció se marca como caducada al leerla.",
      params: paramsOf("proposalId"),
      response: { 200: routeChangeSchema, ...errorResponses(401, 403, 404) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return getRouteChangeView(pool, principal.userId, request.params.proposalId);
  });

  app.post<{ Params: { proposalId: string }; Body: LiveRespondRouteChangeBody }>("/v1/route-changes/:proposalId/respond", {
    schema: {
      tags: TAG_ROUTE, security: BEARER,
      summary: "Aceptar o rechazar un cambio de ruta",
      description: "Solo un pasajero afectado que deba aceptar. Idempotente por decisión. Todas las aceptaciones aplican el cambio; un rechazo lo cancela; sin respuesta a tiempo caduca y no se aplica.",
      params: paramsOf("proposalId"),
      body: respondRouteChangeBodySchema,
      response: { 200: routeChangeSchema, ...errorResponses(400, 401, 403, 404, 409) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return respondRouteChange(pool, principal, request.params.proposalId, request.body.decision);
  });

  app.post<{ Params: { proposalId: string } }>("/v1/route-changes/:proposalId/cancel", {
    schema: {
      tags: TAG_ROUTE, security: BEARER,
      summary: "Retirar una propuesta de cambio de ruta",
      description: "Solo el conductor propietario, mientras la propuesta esté pendiente. Sin cuerpo.",
      params: paramsOf("proposalId"),
      response: { 200: routeChangeSchema, ...errorResponses(401, 403, 404, 409) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return cancelRouteChange(pool, principal, request.params.proposalId);
  });

  /* ─────────────── Fin de viaje: valoración e incidencias (24) ─────────────── */

  app.post<{ Params: { tripId: string }; Body: LiveCreateRatingBody }>("/v1/trips/:tripId/ratings", {
    schema: {
      tags: TAG_FEEDBACK, security: BEARER,
      summary: "Valorar a la otra parte del viaje",
      description: "Solo con el viaje terminado y dentro del plazo. El pasajero con reserva completada valora al conductor; el conductor valora a cada pasajero con reserva completada. Una valoración por (viaje, quien valora, valorado).",
      params: paramsOf("tripId"),
      body: createRatingBodySchema,
      response: { 201: ratingSchema, ...errorResponses(400, 401, 403, 404, 409, 422) }
    }
  }, async (request, reply) => {
    const principal = await authenticate(pool, request);
    const created = await createRating(pool, principal, request.params.tripId, request.body);
    return reply.code(201).send(created);
  });

  app.post<{ Body: LiveCreateIncidentBody; Headers: { "idempotency-key"?: string } }>("/v1/incident-reports", {
    schema: {
      tags: TAG_FEEDBACK, security: BEARER,
      summary: "Reportar una incidencia de un viaje",
      description: "Solo participantes del viaje (conductor o pasajero con reserva). Cabecera opcional Idempotency-Key: un reintento devuelve la misma incidencia con 200.",
      headers: idempotencyHeaderSchema,
      body: createIncidentBodySchema,
      response: { 200: incidentSchema, 201: incidentSchema, ...errorResponses(400, 401, 403, 404, 409, 422) }
    }
  }, async (request, reply) => {
    const principal = await authenticate(pool, request);
    const outcome = await createIncident(pool, principal, request.body, request.headers["idempotency-key"]);
    return reply.code(outcome.created ? 201 : 200).send(outcome.view);
  });

  app.get<{ Querystring: { cursor?: string; limit?: number } }>("/v1/me/incident-reports", {
    schema: {
      tags: TAG_FEEDBACK, security: BEARER,
      summary: "Mis incidencias (paginado)",
      description: "Más recientes primero. `nextCursor` es opaco; null cuando no hay más.",
      querystring: {
        type: "object", additionalProperties: false,
        properties: { cursor: { type: "string", maxLength: 300 }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } }
      },
      response: { 200: incidentPageSchema, ...errorResponses(400, 401, 403) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return listMyIncidents(pool, principal.userId, request.query);
  });

  app.get<{ Params: { reportId: string } }>("/v1/me/incident-reports/:reportId", {
    schema: {
      tags: TAG_FEEDBACK, security: BEARER,
      summary: "Detalle de una de mis incidencias",
      params: paramsOf("reportId"),
      response: { 200: incidentSchema, ...errorResponses(401, 403, 404) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return getMyIncident(pool, principal.userId, request.params.reportId);
  });

  app.post<{ Params: { reportId: string }; Body: { contentType: "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif"; sizeBytes: number } }>(
    "/v1/incident-reports/:reportId/attachments",
    {
      schema: {
        tags: TAG_FEEDBACK, security: BEARER,
        summary: "Pedir una subida privada de foto para una incidencia",
        description: "Devuelve una URL firmada de subida al almacenamiento privado (nunca público). Máximo 5 imágenes de hasta 10 MiB por incidencia.",
        params: paramsOf("reportId"),
        body: attachmentIntentBodySchema,
        response: { 201: attachmentIntentSchema, ...errorResponses(400, 401, 403, 404, 409, 422, 503) }
      }
    },
    async (request, reply) => {
      const principal = await authenticate(pool, request);
      const intent = await createIncidentAttachmentIntent(
        pool, principal, deps.privateStorage, deps.config.privateUploadTtlSeconds, request.params.reportId, request.body
      );
      return reply.code(201).send(intent);
    }
  );

  app.post<{ Params: { reportId: string; attachmentId: string } }>(
    "/v1/incident-reports/:reportId/attachments/:attachmentId/complete",
    {
      schema: {
        tags: TAG_FEEDBACK, security: BEARER,
        summary: "Confirmar la subida de una foto de incidencia",
        description: "Comprueba tamaño y tipo en el almacenamiento privado y calcula la huella. Idempotente. Sin cuerpo.",
        params: paramsOf("reportId", "attachmentId"),
        response: { 200: incidentAttachmentSchema, ...errorResponses(401, 403, 404, 410, 422, 503) }
      }
    },
    async request => {
      const principal = await authenticate(pool, request);
      return completeIncidentAttachment(pool, principal, deps.privateStorage, request.params.reportId, request.params.attachmentId);
    }
  );

  /* ─────────────── Compartir viaje (privado) ─────────────── */

  app.post<{ Params: { bookingId: string }; Body: { includePlate?: boolean; expiresInMinutes?: number } }>(
    "/v1/bookings/:bookingId/share",
    {
      // El cuerpo es opcional: sin él se aplican los valores por defecto (6 h, sin matrícula).
      preValidation: async request => {
        if (request.body === undefined || request.body === null) request.body = {};
      },
      schema: {
        tags: TAG_SHARE, security: BEARER,
        summary: "Crear el enlace «Compartir viaje (privado)»",
        description: "Crea un enlace revocable y revoca el anterior de la reserva. El token solo se devuelve aquí (el servidor guarda su hash). La matrícula solo se incluye si `includePlate` es true.",
        params: paramsOf("bookingId"),
        body: shareCreateBodySchema,
        response: { 201: shareCreatedSchema, ...errorResponses(400, 401, 403, 404, 409) }
      }
    },
    async (request, reply) => {
      const principal = await authenticate(pool, request);
      const created = await createShare(pool, principal, request.params.bookingId, request.body);
      return reply.code(201).send(created);
    }
  );

  app.get<{ Params: { bookingId: string } }>("/v1/bookings/:bookingId/share", {
    schema: {
      tags: TAG_SHARE, security: BEARER,
      summary: "Estado de mi enlace de viaje compartido",
      description: "Último enlace de la reserva (activo, caducado o revocado) sin el token, o null.",
      params: paramsOf("bookingId"),
      response: { 200: shareStateSchema, ...errorResponses(401, 403, 404) }
    }
  }, async request => getShare(pool, await authenticate(pool, request), request.params.bookingId));

  app.delete<{ Params: { bookingId: string } }>("/v1/bookings/:bookingId/share", {
    schema: {
      tags: TAG_SHARE, security: BEARER,
      summary: "Dejar de compartir el viaje (revocar el enlace)",
      description: "Idempotente: sin enlace activo también responde 204.",
      params: paramsOf("bookingId"),
      response: { 204: { type: "null", description: "Enlace revocado" }, ...errorResponses(401, 403, 404) }
    }
  }, async (request, reply) => {
    await revokeShare(pool, await authenticate(pool, request), request.params.bookingId);
    return reply.code(204).send();
  });

  app.get<{ Params: { token: string } }>("/v1/shared-trips/:token", {
    config: { rateLimit: SHARED_TRIP_RATE_LIMIT },
    schema: {
      tags: TAG_SHARE,
      summary: "Vista pública de un viaje compartido (sin sesión)",
      description: "Sin teléfono, sin posición exacta (cuadrícula de ~1 km) y sin matrícula salvo opt-in. Limitado a 30 peticiones por minuto.",
      params: { type: "object", required: ["token"], properties: { token: { type: "string", minLength: 1, maxLength: 200 } } },
      response: { 200: sharedTripSchema, ...errorResponses(404, 410, 429) }
    }
  }, async request => getSharedTrip(pool, request.params.token));

  /* ─────────────── Consola del conductor ─────────────── */

  app.get<{ Params: { tripId: string } }>("/v1/me/trips/:tripId/console", {
    schema: {
      tags: TAG_DRIVER, security: BEARER,
      summary: "Consola en directo del conductor",
      description: "Posición propia y señal, pasajeros con su estado de recogida y código, siguiente recogida, cambio de ruta pendiente y acciones disponibles. Sondeo recomendado cada 10 s.",
      params: paramsOf("tripId"),
      response: { 200: consoleSchema, ...errorResponses(401, 403, 404, 409) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return getDriverConsole(pool, principal, request.params.tripId, deps.routeProvider !== null);
  });

  /* ─────────────── Preferencia de privacidad ─────────────── */

  app.get("/v1/me/live-privacy", {
    schema: {
      tags: TAG_PASSENGER, security: BEARER,
      summary: "Mi preferencia de privacidad en el coche",
      description: "Por defecto los copasajeros ven «1 pasajero» en lugar de tu nombre y foto.",
      response: { 200: privacySchema, ...errorResponses(401, 403) }
    }
  }, async request => getLivePrivacy(pool, (await authenticate(pool, request)).userId));

  app.put<{ Body: { showProfileToCoPassengers: boolean } }>("/v1/me/live-privacy", {
    schema: {
      tags: TAG_PASSENGER, security: BEARER,
      summary: "Cambiar mi preferencia de privacidad en el coche",
      body: privacyBodySchema,
      response: { 200: privacySchema, ...errorResponses(400, 401, 403) }
    }
  }, async request => setLivePrivacy(pool, (await authenticate(pool, request)).userId, request.body.showProfileToCoPassengers));
}
