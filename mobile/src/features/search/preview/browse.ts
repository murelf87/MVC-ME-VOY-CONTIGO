/**
 * Backend en memoria de la vista previa · slice `search` · paquete «buscar y ver viajes» (`search-browse`).
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`). API del núcleo: `mobile/src/preview/index.ts`; contrato de los endpoints
 * en `docs/contracts/trips.md` §2–§5 y §7.1; lógica en `browseTrips.ts` / `browseQuote.ts` (porte de `src/modules/trips`).
 *
 * Endpoints que registra este paquete (§10.6 del briefing):
 *   GET  /v1/trip-categories         catálogo de categorías (pública)
 *   GET  /v1/trips/map               coches de la provincia en el mapa de inicio (posición SIEMPRE aproximada)
 *   GET  /v1/search/trips            búsqueda por hora de llegada (cursor + sugerencias para ampliar)
 *   GET  /v1/trips/:tripId           detalle del viaje
 *   POST /v1/trips/:tripId/quote     aportación del tramo («Ver desglose»), sin efectos
 * Sesión OPCIONAL en todos: un invitado explora; con cabecera inválida responden 401 como el backend real.
 */
import type { TripQuoteRequest } from "@/api/types";
import type { JsonSchema, PreviewDb, PreviewProfileId, PreviewRouter } from "@/preview";
import { uuidParam } from "@/preview";
import { seedBrowseVariant, browseSeedVariants as variantTable } from "./browseVariants";
import { seedTripMeta } from "./browseMeta";
import { quoteTrip } from "./browseQuote";
import { TRIP_CATEGORIES, mapCars, searchInputFromQuery, searchTrips, tripDetail } from "./browseTrips";

const TRIP_CATEGORY_IDS = ["work", "university", "fp_academies", "hospital", "sport", "other"] as const;
type CategoryId = (typeof TRIP_CATEGORY_IDS)[number];

const tripCategory: JsonSchema = { type: "string", enum: TRIP_CATEGORY_IDS };
const uuid: JsonSchema = { type: "string", format: "uuid" };
const lat: JsonSchema = { type: "number", minimum: -90, maximum: 90 };
const lng: JsonSchema = { type: "number", minimum: -180, maximum: 180 };
const localTimePattern: JsonSchema = { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" };
const isoDatePattern: JsonSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };

const mapQuerySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["provinceId"],
  properties: {
    provinceId: uuid,
    category: tripCategory,
    onlyWithSeats: { type: "boolean", default: false },
    withinHours: { type: "integer", minimum: 1, maximum: 48, default: 12 },
    limit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
  },
};

const searchQuerySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["provinceId", "originLat", "originLng", "destLat", "destLng", "arriveBy", "mode"],
  properties: {
    provinceId: uuid,
    originLat: lat,
    originLng: lng,
    destLat: lat,
    destLng: lng,
    originLabel: { type: "string", maxLength: 120 },
    destLabel: { type: "string", maxLength: 120 },
    arriveBy: localTimePattern,
    returnAt: localTimePattern,
    mode: { type: "string", enum: ["weekly", "one_off"] },
    date: isoDatePattern,
    weekdays: { type: "string", maxLength: 40 },
    category: tripCategory,
    onlyWithSeats: { type: "boolean", default: true },
    toleranceMinutes: { type: "integer", minimum: 0, maximum: 90, default: 20 },
    radiusM: { type: "integer", minimum: 200, maximum: 10000, default: 2000 },
    cursor: { type: "string", maxLength: 200 },
    limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
  },
};

const detailQuerySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    pickupLat: lat,
    pickupLng: lng,
    dropoffStopSeq: { type: "integer", minimum: 1 },
  },
};

const quoteBodySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    pickupPointId: { type: "string", maxLength: 300 },
    fromSegmentSeq: { type: "integer", minimum: 0 },
    toSegmentSeq: { type: "integer", minimum: 1 },
    dropoffStopSeq: { type: "integer", minimum: 1 },
  },
};

interface SearchQueryParams {
  provinceId: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  originLabel?: string;
  destLabel?: string;
  arriveBy: string;
  returnAt?: string;
  mode: "weekly" | "one_off";
  date?: string;
  weekdays?: string;
  category?: CategoryId;
  onlyWithSeats?: boolean;
  toleranceMinutes?: number;
  radiusM?: number;
  cursor?: string;
  limit?: number;
}

export function registerBrowsePreview(r: PreviewRouter, db: PreviewDb): void {
  r.get("/v1/trip-categories", { summary: "Categorías de viaje", tags: ["trips"] }, () => ({ items: TRIP_CATEGORIES }));

  r.get<{ Query: { provinceId: string; category?: CategoryId; onlyWithSeats?: boolean; withinHours?: number; limit?: number } }>(
    "/v1/trips/map",
    { summary: "Coches de la provincia en el mapa de inicio (pantalla 09)", tags: ["trips"], schema: { querystring: mapQuerySchema } },
    (req) => {
      req.authOptional();
      const q = req.query;
      return mapCars(db, {
        provinceId: q.provinceId,
        category: q.category ?? null,
        onlyWithSeats: q.onlyWithSeats ?? false,
        withinHours: q.withinHours ?? 12,
        limit: q.limit ?? 100,
      });
    }
  );

  r.get<{ Query: SearchQueryParams }>(
    "/v1/search/trips",
    { summary: "Buscar viajes por hora de llegada (pantallas 10 y 11)", tags: ["trips"], schema: { querystring: searchQuerySchema } },
    (req) => {
      const viewer = req.authOptional();
      return searchTrips(db, searchInputFromQuery(req.query), viewer?.userId ?? null);
    }
  );

  r.get<{ Params: { tripId: string }; Query: { pickupLat?: number; pickupLng?: number; dropoffStopSeq?: number } }>(
    "/v1/trips/:tripId",
    { summary: "Detalle de un viaje (pantalla 12)", tags: ["trips"], schema: { params: uuidParam("tripId"), querystring: detailQuerySchema } },
    (req) => {
      const viewer = req.authOptional();
      return tripDetail(db, req.params.tripId, viewer?.userId ?? null, req.query);
    }
  );

  r.post<{ Params: { tripId: string }; Body: TripQuoteRequest }>(
    "/v1/trips/:tripId/quote",
    {
      summary: "Aportación del tramo («Ver desglose»), sin crear nada",
      tags: ["requests"],
      schema: { params: uuidParam("tripId"), body: quoteBodySchema },
    },
    (req) => {
      const viewer = req.authOptional();
      return quoteTrip(db, viewer?.userId ?? null, req.params.tripId, req.body ?? {});
    }
  );
}

/** Siembra los metadatos de los viajes de las láminas y, si `seed` es una variante de este paquete, su estado. */
export function seedBrowse(db: PreviewDb, _profile: PreviewProfileId, seed: string): void {
  seedTripMeta(db);
  seedBrowseVariant(db, seed);
}

/** Variantes de datos propias del paquete: { "nombre-unico": "qué contiene, en una frase" }. */
export const browseSeedVariants: Readonly<Record<string, string>> = variantTable;
