/** Fragmentos de JSON Schema repetidos en varias rutas (copiados de los schemas Fastify del backend). */
import type { JsonSchema } from "../core/schema";

export const uuidParam = (name: string): JsonSchema => ({
  type: "object",
  required: [name],
  properties: { [name]: { type: "string", format: "uuid" } },
});

export const pointSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["latitude", "longitude"],
  properties: {
    latitude: { type: "number", minimum: -90, maximum: 90 },
    longitude: { type: "number", minimum: -180, maximum: 180 },
  },
};

export const vehicleBody: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["make", "model", "plate", "passengerSeats"],
  properties: {
    make: { type: "string", minLength: 1, maxLength: 80 },
    model: { type: "string", minLength: 1, maxLength: 80 },
    plate: { type: "string", minLength: 2, maxLength: 20 },
    passengerSeats: { type: "integer", minimum: 1, maximum: 8 },
    // Extensión del contrato `trips` (el backend 0.14 la descartaría en silencio).
    color: { type: "string", maxLength: 40 },
  },
};
