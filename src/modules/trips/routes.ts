import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { GeocodingProvider } from "../../maps/types.js";
import { TRIP_CATEGORIES } from "./catalog.js";
import { offsetFromCursor, optionalPrincipalOf, parseWeekdaysCsv, principalOf, requireRole } from "./common.js";
import { driverReadiness, driverRequests } from "./driver-service.js";
import { pickupPoints, quoteTrip } from "./endpoints.js";
import { tripDetail } from "./detail-service.js";
import {
  createFavorite, deleteFavorite, listFavorites, updateFavorite
} from "./favorites-service.js";
import { readIdempotencyKey, sendIdempotent } from "./idempotency.js";
import { tripsOverview } from "./overview-service.js";
import { publishRoute } from "./publish-service.js";
import { loadRequestDetail } from "./request-detail.js";
import { createRequestForTrip, decideRequest, withdrawRequest } from "./requests.js";
import {
  createRoutineEntries, createSuspension, deleteRoutineEntry, deleteSuspension, getRoutine, putWeeklyOffer, updateRoutineEntry
} from "./routine-service.js";
import { planRoute, type PlannerDeps } from "./route-planner.js";
import * as S from "./route-schemas.js";
import { bearer, errors, type Schema } from "./schemas.js";
import { mapCars, searchInputFromQuery, searchTrips } from "./search-service.js";
import { tripsSettings } from "./settings.js";
import type {
  CreateFavoriteBody, CreateRideRequestBody, CreateRoutineEntryBody, CreateRoutineSuspensionBody, DecideRequestBody,
  PublishRouteBody, RoutePlanBody, TripCategory, TripQuoteRequest, UpdateFavoriteBody, UpdateRoutineEntryBody,
  UpdateWeeklySeatOfferBody, WeeklyRequestBody
} from "./types.js";
import { loadWeeklyReservation, previewWeekly, createWeeklyReservation, decideWeekly, withdrawWeekly } from "./weekly.js";

export type TripsRouteDeps = {
  pool: Pool;
  routeProvider: PlannerDeps["routeProvider"];
  geocodingProvider: GeocodingProvider | null;
};

/** Auth opcional en OpenAPI: sesión Bearer o anónimo. */
const optionalBearer = [{ bearerAuth: [] as string[] }, {}];

const TAG = {
  catalog: "Viajes · catálogo, mapa y búsqueda",
  detail: "Viajes · detalle y punto de recogida",
  request: "Viajes · solicitudes",
  weekly: "Viajes · reservas semanales",
  driver: "Conductor · publicar ruta y solicitudes",
  mine: "Mis viajes",
  favorites: "Favoritos y rutina"
} as const;

const NO_CONTENT: Schema = { type: "null", description: "Sin contenido" };

export async function registerTripsRoutes(app: FastifyInstance, deps: TripsRouteDeps): Promise<void> {
  const { pool } = deps;
  const settings = tripsSettings();
  const limit = (max: number) => ({ rateLimit: { max, timeWindow: "1 minute" } });
  const planner: PlannerDeps = { routeProvider: deps.routeProvider, geocodingProvider: deps.geocodingProvider };

  /* ─────────────────────────── Catálogo, mapa y búsqueda ─────────────────────────── */

  app.get("/v1/trip-categories", {
    schema: {
      tags: [TAG.catalog],
      summary: "Categorías de viaje",
      description: "Trabajo, Universidad, FP, Hospital, Deporte y Otros. Pública (no requiere sesión).",
      response: { 200: S.tripCategoriesResponse, ...errors(429) }
    }
  }, async () => ({ items: TRIP_CATEGORIES }));

  app.get<{ Querystring: { provinceId: string; category?: TripCategory; onlyWithSeats: boolean; withinHours: number; limit: number } }>("/v1/trips/map", {
    config: limit(settings.rateMapPerMinute),
    schema: {
      tags: [TAG.catalog],
      summary: "Coches de la provincia en el mapa de inicio (pantalla 09)",
      description:
        "Viajes publicados que salen en las próximas horas y viajes en curso de la provincia, con posición SIEMPRE aproximada " +
        "(cuadrícula de 0,01° ≈ 1,1 km), plazas libres («2 plazas») y `full` para el pin gris «Completo». " +
        "Una posición en directo con más de 60 s se marca `stale` y no se presenta como «en directo». Autenticación opcional.",
      security: optionalBearer,
      querystring: S.mapQuery,
      response: { 200: S.mapCarsResponse, ...errors(400, 401, 404, 429) }
    }
  }, async request => {
    await optionalPrincipalOf(pool, request.headers.authorization);
    const q = request.query;
    return mapCars(pool, {
      provinceId: q.provinceId, category: q.category ?? null, onlyWithSeats: q.onlyWithSeats, withinHours: q.withinHours, limit: q.limit
    });
  });

  app.get<{ Querystring: Parameters<typeof searchInputFromQuery>[0] & { weekdays?: string } }>("/v1/search/trips", {
    config: limit(settings.rateSearchPerMinute),
    schema: {
      tags: [TAG.catalog],
      summary: "Buscar viajes por hora de llegada (pantallas 10 y 11)",
      description:
        "Búsqueda por coordenadas (resuelve etiquetas con `GET /v1/maps/geocode` en el cliente). Modo `weekly` (rutas periódicas, " +
        "`weekdays` CSV, por defecto lunes a viernes) o `one_off` (requiere `date`). Cada resultado indica conductor, vehículo " +
        "(sin matrícula completa), plazas libres en TODOS los tramos pedidos, hora de recogida, llegada aproximada, aportación " +
        "(`pending_definition` sin tarifa aprobada), disponibilidad de vuelta y, si hay pocos resultados, sugerencias para ampliar. " +
        "Las coordenadas de recogida/bajada de la lista son aproximadas; las precisas se piden con `pickup-points`. Autenticación opcional.",
      security: optionalBearer,
      querystring: S.searchQuery,
      response: { 200: S.tripSearchPage, ...errors(400, 401, 404, 422, 429) }
    }
  }, async request => {
    const viewer = await optionalPrincipalOf(pool, request.headers.authorization);
    const q = request.query;
    const input = searchInputFromQuery({ ...q, weekdays: parseWeekdaysCsv(q.weekdays) });
    return searchTrips(pool, deps.geocodingProvider, input, viewer?.userId ?? null);
  });

  /* ─────────────────────────── Detalle y punto de recogida ─────────────────────────── */

  app.get<{ Params: { tripId: string }; Querystring: { pickupLat?: number; pickupLng?: number; dropoffStopSeq?: number } }>("/v1/trips/:tripId", {
    schema: {
      tags: [TAG.detail],
      summary: "Detalle de un viaje (pantalla 12)",
      description:
        "Conductor, vehículo (matrícula completa solo para el conductor y pasajeros con reserva confirmada), ruta simplificada, " +
        "paradas con hora, plazas por tramo, totales y precio por persona. Con `pickupLat/pickupLng` marca «Tú te subes aquí». " +
        "Coordenadas aproximadas para quien no participa. Autenticación opcional.",
      security: optionalBearer,
      params: S.idParam("tripId"),
      querystring: S.detailQuery,
      response: { 200: S.tripDetail, ...errors(400, 401, 404, 429) }
    }
  }, async request => {
    const viewer = await optionalPrincipalOf(pool, request.headers.authorization);
    return tripDetail(pool, request.params.tripId, viewer?.userId ?? null, request.query);
  });

  app.get<{ Params: { tripId: string }; Querystring: { lat: number; lng: number; dropoffStopSeq?: number; limit: number } }>("/v1/trips/:tripId/pickup-points", {
    schema: {
      tags: [TAG.detail],
      summary: "Propuestas de punto de recogida A/B (pantalla 13)",
      description:
        "Hasta `limit` propuestas a menos de 2,5 km de la posición indicada, sobre paradas declaradas o sobre la ruta si el " +
        "conductor activó «Recoger en ruta». Minutos a pie (estimación: línea recta × 1,3 a 4,5 km/h) y desvío (parada declarada o " +
        "estimación). El `id` es OPACO: se envía tal cual al solicitar y el servidor lo revalida.",
      security: bearer,
      params: S.idParam("tripId"),
      querystring: S.pickupPointsQuery,
      response: { 200: S.pickupPointsResponse, ...errors(400, 401, 403, 404, 409, 422, 429) }
    }
  }, async request => {
    const principal = await principalOf(pool, request.headers.authorization);
    return pickupPoints(pool, deps.geocodingProvider, principal, request.params.tripId, request.query);
  });

  /* ─────────────────────────── Presupuesto y solicitudes ─────────────────────────── */

  app.post<{ Params: { tripId: string }; Body: TripQuoteRequest }>("/v1/trips/:tripId/quote", {
    schema: {
      tags: [TAG.request],
      summary: "Aportación del tramo («Ver desglose»), sin crear nada",
      description:
        "Calcula la aportación sobre los km de carretera del tramo con la tarifa APROBADA. Sin tarifa aprobada todos los importes " +
        "son `pending_definition` («Por definir»). Este módulo nunca aprueba ni activa una tarifa. Autenticación opcional.",
      security: optionalBearer,
      params: S.idParam("tripId"),
      body: S.quoteBody,
      response: { 200: S.tripQuoteResponse, ...errors(400, 401, 404, 409, 422, 429) }
    }
  }, async request => {
    const viewer = await optionalPrincipalOf(pool, request.headers.authorization);
    return quoteTrip(pool, viewer, request.params.tripId, request.body ?? {});
  });

  app.post<{ Params: { tripId: string }; Body: CreateRideRequestBody }>("/v1/trips/:tripId/requests", {
    schema: {
      tags: [TAG.request],
      summary: "Enviar solicitud de plaza (pantalla 15)",
      description:
        "Exactamente UNA forma de tramo: `pickupPointId` (+ `dropoffStopSeq`) o `fromSegmentSeq`+`toSegmentSeq` (heredado). " +
        "Comprueba capacidad por tramo con bloqueo del viaje; el punto se revalida (provincia, ruta, desvío). Una solicitud " +
        "pendiente NO reserva plaza: la capacidad se bloquea al aceptar el conductor. Acepta `Idempotency-Key`. " +
        "Avisa al conductor (`request_received`).",
      security: bearer,
      params: S.idParam("tripId"),
      headers: S.idempotencyHeader,
      body: S.createRequestBody,
      response: { 201: S.rideRequestDetail, 200: S.rideRequestDetail, ...errors(400, 401, 403, 404, 409, 422, 429) }
    }
  }, async (request, reply) => {
    const principal = await principalOf(pool, request.headers.authorization);
    const key = readIdempotencyKey(request.headers["idempotency-key"]);
    return sendIdempotent(reply, await createRequestForTrip(pool, principal, request.params.tripId, request.body, key));
  });

  app.get<{ Params: { requestId: string } }>("/v1/ride-requests/:requestId", {
    schema: {
      tags: [TAG.request],
      summary: "Estado de una solicitud (pantalla 16)",
      description:
        "Visible para el pasajero titular y para el conductor del viaje (cualquier otro usuario recibe 404). Incluye el stepper " +
        "Solicitud → Aceptada → Pago → Confirmada, la cuenta atrás del hold calculada por el servidor (`hold.remainingSeconds`) " +
        "y la próxima acción. Si el hold ha vencido, la lectura pasa la solicitud a `expired`.",
      security: bearer,
      params: S.idParam("requestId"),
      response: { 200: S.rideRequestDetail, ...errors(400, 401, 403, 404, 429) }
    }
  }, async request => {
    const principal = await principalOf(pool, request.headers.authorization);
    return loadRequestDetail(pool, request.params.requestId, principal.userId);
  });

  app.post<{ Params: { requestId: string } }>("/v1/ride-requests/:requestId/withdraw", {
    schema: {
      tags: [TAG.request],
      summary: "Retirar una solicitud pendiente",
      description: "Solo en estado `pending` (sin hold ni dinero de por medio) → `cancelled`. Avisa al conductor. Para solicitudes aceptadas o confirmadas la cancelación pertenece al módulo de pagos.",
      security: bearer,
      params: S.idParam("requestId"),
      response: { 200: S.rideRequestDetail, ...errors(400, 401, 403, 404, 409, 429) }
    }
  }, async request => {
    const principal = await principalOf(pool, request.headers.authorization);
    return withdrawRequest(pool, principal, request.params.requestId);
  });

  app.post<{ Params: { requestId: string }; Body: DecideRequestBody }>("/v1/ride-requests/:requestId/decision", {
    schema: {
      tags: [TAG.request],
      summary: "Aceptar o rechazar una solicitud (conductor, pantalla 20)",
      description:
        "Aceptar crea el hold de plaza en la misma transacción (`pending → payment_pending`): la aceptación NO es una reserva " +
        "confirmada y exige capacidad en todos los tramos. Rechazar → `rejected`. Avisa al pasajero.",
      security: bearer,
      params: S.idParam("requestId"),
      body: S.decisionBody,
      response: { 200: S.decideResponse, ...errors(400, 401, 403, 404, 409, 429) }
    }
  }, async request => {
    const principal = await principalOf(pool, request.headers.authorization);
    return decideRequest(pool, principal, request.params.requestId, request.body.decision);
  });

  /* ─────────────────────────── Reservas semanales ─────────────────────────── */

  app.post<{ Params: { tripId: string }; Body: WeeklyRequestBody }>("/v1/trips/:tripId/weekly-requests/preview", {
    schema: {
      tags: [TAG.weekly],
      summary: "Vista previa de la reserva semanal (pantallas 14 y 15)",
      description:
        "Ocurrencias solicitadas con estado por día (`available`, `skipped_full`, `skipped_exception`…), importe semanal y " +
        "`canSubmit`. No crea nada. `:tripId` es cualquier ocurrencia de ida de la serie.",
      security: bearer,
      params: S.idParam("tripId"),
      body: S.weeklyBody,
      response: { 200: S.weeklyPreview, ...errors(400, 401, 403, 404, 409, 422, 429) }
    }
  }, async request => {
    const principal = await principalOf(pool, request.headers.authorization);
    requireRole(principal, "passenger", "Necesitas el rol de pasajero para reservar plazas.");
    return previewWeekly(pool, principal, request.params.tripId, request.body);
  });

  app.post<{ Params: { tripId: string }; Body: WeeklyRequestBody }>("/v1/trips/:tripId/weekly-requests", {
    schema: {
      tags: [TAG.weekly],
      summary: "Crear la reserva semanal",
      description:
        "En una transacción y bloqueando cada ocurrencia en orden (sin interbloqueos): comprueba capacidad por ocurrencia y crea " +
        "UNA solicitud `pending` por ocurrencia. Sin plaza en alguna → 409 `WEEKLY_OCCURRENCE_UNAVAILABLE` salvo `allowPartial`. " +
        "Acepta `Idempotency-Key`. Avisa al conductor.",
      security: bearer,
      params: S.idParam("tripId"),
      headers: S.idempotencyHeader,
      body: S.weeklyBody,
      response: { 201: S.weeklyReservation, 200: S.weeklyReservation, ...errors(400, 401, 403, 404, 409, 422, 429) }
    }
  }, async (request, reply) => {
    const principal = await principalOf(pool, request.headers.authorization);
    const key = readIdempotencyKey(request.headers["idempotency-key"]);
    return sendIdempotent(reply, await createWeeklyReservation(pool, principal, request.params.tripId, request.body, key));
  });

  app.get<{ Params: { id: string } }>("/v1/weekly-reservations/:id", {
    schema: {
      tags: [TAG.weekly],
      summary: "Reserva semanal con su estado agregado",
      description: "Visible para el pasajero titular y el conductor de la serie (otros: 404). Estado agregado de las ocurrencias abiertas y cuenta atrás con la caducidad MENOR de los holds.",
      security: bearer,
      params: S.idParam("id"),
      response: { 200: S.weeklyReservation, ...errors(400, 401, 403, 404, 429) }
    }
  }, async request => {
    const principal = await principalOf(pool, request.headers.authorization);
    return loadWeeklyReservation(pool, request.params.id, principal.userId);
  });

  app.post<{ Params: { id: string }; Body: DecideRequestBody }>("/v1/weekly-reservations/:id/decision", {
    schema: {
      tags: [TAG.weekly],
      summary: "Aceptar o rechazar toda la reserva semanal (conductor)",
      description:
        "Aceptar es TODO O NADA: bloquea capacidad de todas las ocurrencias pendientes (un hold por ocurrencia, misma caducidad); " +
        "si alguna ya no tiene plaza → 409 `NO_CAPACITY_ON_SEGMENT` con `details.dates` y no cambia nada.",
      security: bearer,
      params: S.idParam("id"),
      body: S.decisionBody,
      response: { 200: S.decideResponse, ...errors(400, 401, 403, 404, 409, 429) }
    }
  }, async request => {
    const principal = await principalOf(pool, request.headers.authorization);
    return decideWeekly(pool, principal, request.params.id, request.body.decision);
  });

  app.post<{ Params: { id: string } }>("/v1/weekly-reservations/:id/withdraw", {
    schema: {
      tags: [TAG.weekly],
      summary: "Retirar las ocurrencias pendientes de una reserva semanal",
      description: "Retira solo las solicitudes aún `pending`; las aceptadas o confirmadas siguen el flujo de cancelación del módulo de pagos. 409 `REQUEST_NOT_WITHDRAWABLE` si no queda ninguna pendiente.",
      security: bearer,
      params: S.idParam("id"),
      response: { 200: S.weeklyReservation, ...errors(400, 401, 403, 404, 409, 429) }
    }
  }, async request => {
    const principal = await principalOf(pool, request.headers.authorization);
    return withdrawWeekly(pool, principal, request.params.id);
  });

  /* ─────────────────────────── Conductor ─────────────────────────── */

  app.get<{ Querystring: { status?: "pending" | "open" | "all"; tripId?: string; cursor?: string; limit: number } }>("/v1/me/driver/requests", {
    schema: {
      tags: [TAG.driver],
      summary: "Bandeja de solicitudes del conductor (pantalla 20)",
      description:
        "Solo solicitudes de SUS viajes. Ocupación por tramo («1 / 3 plazas», sin contar la propia solicitud), desvío estimado y " +
        "si se puede aceptar (`canAccept`/`blockedReason`). Las reservas semanales aparecen UNA vez (`kind: weekly`).",
      security: bearer,
      querystring: S.driverRequestsQuery,
      response: { 200: S.driverRequestsPage, ...errors(400, 401, 403, 429) }
    }
  }, async request => {
    const principal = await principalOf(pool, request.headers.authorization);
    const q = request.query;
    return driverRequests(pool, principal, {
      status: q.status ?? "pending", tripId: q.tripId ?? null, offset: offsetFromCursor(q.cursor), limit: q.limit
    });
  });

  app.get("/v1/me/driver/readiness", {
    schema: {
      tags: [TAG.driver],
      summary: "Requisitos para publicar rutas (pantalla 17)",
      description:
        "Foto pública, identidad, vehículo, documentación, foto del vehículo y seguro vigente (lo que exige hoy la puerta de publicación). " +
        "El permiso de conducir se informa pero no bloquea todavía. Se evalúa el vehículo más reciente del conductor.",
      security: bearer,
      response: { 200: S.driverReadiness, ...errors(401, 403, 429) }
    }
  }, async request => driverReadiness(pool, await principalOf(pool, request.headers.authorization)));

  app.post<{ Body: RoutePlanBody }>("/v1/me/routes/plan", {
    config: limit(settings.ratePlanPerMinute),
    schema: {
      tags: [TAG.driver],
      summary: "Calcular ruta y verificar provincia por parada (pantallas 18 y 19)",
      description:
        "Sin efectos. Cada punto se comprueba individualmente contra el polígono de la provincia («Huelva (sugerida) · Fuera de " +
        "provincia») y, si todos están dentro, se calcula la ruta real por carretera tramo a tramo y se comprueba la geometría completa. " +
        "Devuelve horas de paso, desvío de las paradas opcionales y `canSave`. Sin proveedor de rutas → 503.",
      security: bearer,
      body: S.planBody,
      response: { 200: S.routePlanResponse, ...errors(400, 401, 403, 404, 422, 429, 502, 503) }
    }
  }, async request => {
    const principal = await principalOf(pool, request.headers.authorization);
    requireRole(principal, "driver", "Necesitas el rol de conductor para planificar rutas.");
    return planRoute(pool, planner, request.body);
  });

  app.post<{ Body: PublishRouteBody }>("/v1/me/routes", {
    schema: {
      tags: [TAG.driver],
      summary: "Guardar y publicar la ruta (pantalla 19 «Guardar ruta»)",
      description:
        "RECALCULA todo en el servidor y aplica la puerta de publicación (foto pública aprobada, identidad verificada, vehículo propio " +
        "con documentación, foto y seguro aprobados y vigentes, plazas ≤ plazas del vehículo, paradas y geometría dentro de la provincia, " +
        "también la vuelta). `one_off` crea viajes sueltos; `daily_workdays` crea una serie y materializa ocurrencias (28 días vista). " +
        "No se publican ocurrencias pasadas. Acepta `Idempotency-Key`. Auditoría `route.published`.",
      security: bearer,
      headers: S.idempotencyHeader,
      body: S.publishBody,
      response: { 201: S.publishRouteResponse, 200: S.publishRouteResponse, ...errors(400, 401, 403, 404, 409, 422, 429, 502, 503) }
    }
  }, async (request, reply) => {
    const principal = await principalOf(pool, request.headers.authorization);
    const key = readIdempotencyKey(request.headers["idempotency-key"]);
    return sendIdempotent(reply, await publishRoute(pool, planner, principal, request.body, key));
  });

  /* ─────────────────────────── Mis viajes ─────────────────────────── */

  app.get<{ Querystring: { role: "passenger" | "driver"; section: "all" | "upcoming" | "in_progress" | "history"; cursor?: string; limit: number } }>("/v1/me/trips/overview", {
    schema: {
      tags: [TAG.mine],
      summary: "Mis viajes: próximos, en curso e historial (pantalla 30)",
      description:
        "Vista de pasajero o de conductor (`role`). Próximos incluye reservas semanales (una tarjeta por reserva o serie) y viajes " +
        "puntuales; en curso incluye la ETA en directo («El conductor llegará en unos 10 min») solo con posición fresca; el historial " +
        "se pagina con `cursor`. Los avatares de otros participantes son solo de confirmados y solo para quien participa.",
      security: bearer,
      querystring: S.overviewQuery,
      response: { 200: S.tripsOverview, ...errors(400, 401, 403, 429) }
    }
  }, async request => {
    const principal = await principalOf(pool, request.headers.authorization);
    const q = request.query;
    return tripsOverview(pool, principal, { role: q.role, section: q.section, offset: offsetFromCursor(q.cursor), limit: q.limit });
  });

  /* ─────────────────────────── Favoritos y rutina ─────────────────────────── */

  app.get<{ Querystring: { cursor?: string; limit: number } }>("/v1/me/favorites", {
    schema: {
      tags: [TAG.favorites],
      summary: "Mis destinos (pantalla 31)",
      security: bearer,
      querystring: S.pageQuery,
      response: { 200: S.favoritesResponse, ...errors(400, 401, 403, 429) }
    }
  }, async request => listFavorites(pool, await principalOf(pool, request.headers.authorization), request.query));

  app.post<{ Body: CreateFavoriteBody }>("/v1/me/favorites", {
    schema: {
      tags: [TAG.favorites],
      summary: "Añadir un destino",
      description: "Máximo 20 por usuario. El punto debe estar en una provincia conocida (`provinceId` se rellena).",
      security: bearer,
      body: S.createFavoriteBody,
      response: { 201: S.favoritePlace, ...errors(400, 401, 403, 409, 422, 429) }
    }
  }, async (request, reply) => {
    const principal = await principalOf(pool, request.headers.authorization);
    return reply.code(201).send(await createFavorite(pool, principal, request.body));
  });

  app.patch<{ Params: { favoriteId: string }; Body: UpdateFavoriteBody }>("/v1/me/favorites/:favoriteId", {
    schema: {
      tags: [TAG.favorites],
      summary: "Editar un destino",
      description: "Al menos un campo. Para mover el lugar hay que enviar `lat` y `lng`. Solo el propietario (otros: 404).",
      security: bearer,
      params: S.idParam("favoriteId"),
      body: S.updateFavoriteBody,
      response: { 200: S.favoritePlace, ...errors(400, 401, 403, 404, 422, 429) }
    }
  }, async request => {
    const principal = await principalOf(pool, request.headers.authorization);
    return updateFavorite(pool, principal, request.params.favoriteId, request.body);
  });

  app.delete<{ Params: { favoriteId: string } }>("/v1/me/favorites/:favoriteId", {
    schema: {
      tags: [TAG.favorites],
      summary: "Eliminar un destino",
      description: "409 `FAVORITE_IN_USE` (con `details.entryIds`) si lo usa una fila de la rutina semanal.",
      security: bearer,
      params: S.idParam("favoriteId"),
      response: { 204: NO_CONTENT, ...errors(400, 401, 403, 404, 409, 429) }
    }
  }, async (request, reply) => {
    const principal = await principalOf(pool, request.headers.authorization);
    await deleteFavorite(pool, principal, request.params.favoriteId);
    return reply.code(204).send();
  });

  app.get("/v1/me/routine", {
    schema: {
      tags: [TAG.favorites],
      summary: "Rutina semanal, suspensiones y plaza semanal ofrecida (pantalla 31)",
      description: "`places` son todos tus destinos (selector). `nextWeek` es la próxima semana lunes–domingo (Europe/Madrid) y si está suspendida.",
      security: bearer,
      response: { 200: S.routineResponse, ...errors(401, 403, 429) }
    }
  }, async request => getRoutine(pool, await principalOf(pool, request.headers.authorization)));

  app.post<{ Body: CreateRoutineEntryBody }>("/v1/me/routine/entries", {
    schema: {
      tags: [TAG.favorites],
      summary: "Añadir filas a la rutina (una por día)",
      description: "Máximo 40 filas. Un día solo admite un trayecto igual (misma hora, origen y destino): 409 `ROUTINE_ENTRY_EXISTS`. Origen y destino distintos.",
      security: bearer,
      body: S.createEntryBody,
      response: { 201: S.routineEntriesResponse, ...errors(400, 401, 403, 404, 409, 422, 429) }
    }
  }, async (request, reply) => {
    const principal = await principalOf(pool, request.headers.authorization);
    return reply.code(201).send({ items: await createRoutineEntries(pool, principal, request.body) });
  });

  app.patch<{ Params: { entryId: string }; Body: UpdateRoutineEntryBody }>("/v1/me/routine/entries/:entryId", {
    schema: {
      tags: [TAG.favorites],
      summary: "Editar o activar/desactivar una fila de la rutina",
      description: "La casilla ✓/☐ de la pantalla es `enabled`. Al menos un campo.",
      security: bearer,
      params: S.idParam("entryId"),
      body: S.updateEntryBody,
      response: { 200: S.routineEntryResponse, ...errors(400, 401, 403, 404, 409, 422, 429) }
    }
  }, async request => {
    const principal = await principalOf(pool, request.headers.authorization);
    return updateRoutineEntry(pool, principal, request.params.entryId, request.body);
  });

  app.delete<{ Params: { entryId: string } }>("/v1/me/routine/entries/:entryId", {
    schema: {
      tags: [TAG.favorites],
      summary: "Eliminar una fila de la rutina",
      security: bearer,
      params: S.idParam("entryId"),
      response: { 204: NO_CONTENT, ...errors(400, 401, 403, 404, 429) }
    }
  }, async (request, reply) => {
    const principal = await principalOf(pool, request.headers.authorization);
    await deleteRoutineEntry(pool, principal, request.params.entryId);
    return reply.code(204).send();
  });

  app.post<{ Body: CreateRoutineSuspensionBody }>("/v1/me/routine/suspensions", {
    schema: {
      tags: [TAG.favorites],
      summary: "Suspender una semana de la rutina («Suspender próxima semana»)",
      description:
        "Sin `weekStart` = lunes de la próxima semana; debe ser lunes y no pasado. Efecto REAL: se retiran las solicitudes semanales " +
        "aún `pending` de esa semana; las aceptadas o confirmadas no se tocan (`keptRequests`). Idempotente: repetir devuelve 200.",
      security: bearer,
      body: S.suspensionBody,
      response: { 201: S.suspensionResponse, 200: S.suspensionResponse, ...errors(400, 401, 403, 422, 429) }
    }
  }, async (request, reply) => {
    const principal = await principalOf(pool, request.headers.authorization);
    const result = await createSuspension(pool, principal, request.body?.weekStart);
    return reply.code(result.created ? 201 : 200).send({
      weekStart: result.suspension.weekStart,
      weekEnd: result.suspension.weekEnd,
      withdrawnRequests: result.withdrawnRequests,
      keptRequests: result.keptRequests
    });
  });

  app.delete<{ Params: { weekStart: string } }>("/v1/me/routine/suspensions/:weekStart", {
    schema: {
      tags: [TAG.favorites],
      summary: "Reanudar una semana suspendida",
      description: "No restaura las solicitudes ya retiradas. Idempotente (204 aunque no estuviera suspendida).",
      security: bearer,
      params: S.weekStartParam,
      response: { 204: NO_CONTENT, ...errors(400, 401, 403, 422, 429) }
    }
  }, async (request, reply) => {
    const principal = await principalOf(pool, request.headers.authorization);
    await deleteSuspension(pool, principal, request.params.weekStart);
    return reply.code(204).send();
  });

  app.put<{ Body: UpdateWeeklySeatOfferBody }>("/v1/me/routine/weekly-offer", {
    schema: {
      tags: [TAG.favorites],
      summary: "«Plaza disponible (semanal)»: preferencia del conductor",
      description:
        "Preferencia: no publica nada por sí misma. `prefill` entrega el cuerpo para abrir «Publica tu ruta» ya relleno desde la " +
        "rutina. El precio es «Propuesta» (`pending_definition`) mientras no exista tarifa aprobada. Rol conductor.",
      security: bearer,
      body: S.weeklyOfferBody,
      response: { 200: S.weeklySeatOffer, ...errors(400, 401, 403, 429) }
    }
  }, async request => {
    const principal = await principalOf(pool, request.headers.authorization);
    return putWeeklyOffer(pool, principal, request.body);
  });

}
