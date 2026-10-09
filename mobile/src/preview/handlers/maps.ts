/** Provincias y geocodificación (`province-routes`, `geocoding-routes`). El geocodificador es un gazetteer simulado. */
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import type { PreviewRouter } from "../core/router";
import { pointInRing } from "../core/geo";
import type { ProvinceRow } from "../core/rows";
import { geocodeAddress, reverseGeocode } from "../providers/geocoder";

function provinceWire(p: Readonly<ProvinceRow>) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    sourceName: p.source_name,
    sourceUrl: p.source_url,
    sourceDate: p.source_date,
    sourceLicense: p.source_license,
  };
}

export function registerMaps(r: PreviewRouter, db: PreviewDb): void {
  r.get("/v1/provinces", { summary: "Provincias disponibles", tags: ["maps"] }, () => ({
    provinces: db.provinces
      .all()
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map(provinceWire),
  }));

  r.get<{ Query: { latitude: number; longitude: number } }>(
    "/v1/provinces/resolve",
    {
      summary: "Provincia que contiene un punto",
      tags: ["maps"],
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["latitude", "longitude"],
          properties: {
            latitude: { type: "number", minimum: -90, maximum: 90 },
            longitude: { type: "number", minimum: -180, maximum: 180 },
          },
        },
      },
    },
    (req) => {
      const { latitude, longitude } = req.query;
      const match = db.provinces
        .filter((p) => pointInRing(latitude, longitude, p.ring))
        .sort((a, b) => a.name.localeCompare(b.name, "es"))[0];
      if (!match) {
        throw new ApiFailure("PROVINCE_NOT_FOUND", "No province boundary contains the supplied point", 404);
      }
      return { province: provinceWire(match) };
    }
  );

  r.get<{ Query: { query: string } }>(
    "/v1/maps/geocode",
    {
      summary: "Buscar una dirección o lugar (gazetteer simulado)",
      tags: ["maps"],
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: { query: { type: "string", minLength: 3, maxLength: 500 } },
        },
      },
    },
    (req) => {
      req.authOptional(); // un invitado puede buscar lugares (como el backend real: sesión opcional)
      return { results: geocodeAddress(req.query.query) };
    }
  );

  r.get<{ Query: { latitude: number; longitude: number } }>(
    "/v1/maps/reverse",
    {
      summary: "Dirección de unas coordenadas (gazetteer simulado)",
      tags: ["maps"],
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["latitude", "longitude"],
          properties: {
            latitude: { type: "number", minimum: -90, maximum: 90 },
            longitude: { type: "number", minimum: -180, maximum: 180 },
          },
        },
      },
    },
    (req) => {
      req.authOptional();
      return { results: reverseGeocode({ latitude: req.query.latitude, longitude: req.query.longitude }) };
    }
  );
}
