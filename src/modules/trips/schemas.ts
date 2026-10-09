/**
 * Combinadores de JSON Schema para las rutas del módulo «trips». Las respuestas se describen COMPLETAS (Fastify
 * serializa solo lo que declara el schema): todo campo del contrato aparece y es `required` salvo que se indique.
 * Los campos opcionales del contrato (`?`) se pasan en `optional`.
 */
export type Schema = Record<string, unknown>;

export const uuid: Schema = { type: "string", format: "uuid" };
export const str = (extra: Schema = {}): Schema => ({ type: "string", ...extra });
export const int = (extra: Schema = {}): Schema => ({ type: "integer", ...extra });
export const num = (extra: Schema = {}): Schema => ({ type: "number", ...extra });
export const bool: Schema = { type: "boolean" };
export const enumOf = (...values: string[]): Schema => ({ type: "string", enum: values });
export const arr = (items: Schema, extra: Schema = {}): Schema => ({ type: "array", items, ...extra });

/** Valor que puede ser null (`type: [..., "null"]`). */
export function nullable(schema: Schema): Schema {
  const type = schema.type;
  if (Array.isArray(type)) return { ...schema, type: [...new Set([...(type as string[]), "null"])] };
  return { ...schema, type: [type as string, "null"] };
}

/** Objeto cerrado. Todas las propiedades son obligatorias salvo las de `optional`. */
export function obj(properties: Record<string, Schema>, optional: readonly string[] = [], extra: Schema = {}): Schema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties).filter(key => !optional.includes(key)),
    additionalProperties: false,
    ...extra
  };
}

/** Objeto abierto (campos libres) para cuerpos de error con `details`. */
export const anyValue: Schema = {};

export const isoDateTime = str({ description: "Instante UTC ISO-8601 con milisegundos" });
export const isoDate = str({ description: "Fecha de calendario YYYY-MM-DD (Europe/Madrid)" });
export const localTime = str({ description: "Hora de reloj HH:mm (Europe/Madrid)" });
export const localTimePattern = str({ pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description: "Hora local HH:mm" });
export const isoDatePattern = str({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Fecha YYYY-MM-DD" });

export const tripCategory: Schema = enumOf("work", "university", "fp_academies", "hospital", "sport", "other");
export const weekday: Schema = enumOf("mon", "tue", "wed", "thu", "fri", "sat", "sun");
export const tripLeg: Schema = enumOf("outbound", "return");
export const tripStatus: Schema = enumOf("draft", "published", "active", "completed", "cancelled");
export const requestStatus: Schema = enumOf(
  "pending", "accepted", "rejected", "payment_pending", "confirmed", "expired", "cancelled", "payment_late"
);

export const money: Schema = obj({
  cents: nullable(int({ minimum: 0 })),
  currency: enumOf("EUR"),
  status: enumOf("defined", "pending_definition", "illustrative")
});

export const publicUser: Schema = obj({
  id: uuid,
  displayName: str(),
  firstName: str(),
  photoUrl: nullable(str()),
  ratingAverage: nullable(num()),
  ratingCount: int()
});

export const geoPoint: Schema = obj({ lat: num(), lng: num() });
export const precisePoint: Schema = obj({ lat: num(), lng: num(), precision: enumOf("approximate", "precise") });

export const vehicleSummary: Schema = obj({
  id: nullable(uuid),
  make: str(),
  model: str(),
  color: nullable(str()),
  displayName: str(),
  plateHint: nullable(str()),
  plate: nullable(str()),
  passengerSeats: int()
});

/** Presupuesto (TripQuote): ver mobile/src/api/types/trips.ts. */
export const tripQuote: Schema = obj({
  state: enumOf("defined", "pending_definition"),
  tariff: obj({ state: enumOf("approved", "none_approved"), version: nullable(int()) }),
  basis: obj({ roadDistanceM: int(), rateMicrosPerKm: nullable(int()) }),
  contribution: money,
  managementFee: money,
  total: money,
  weekly: nullable(obj({
    weekdays: arr(weekday),
    legsPerDay: int(),
    tripsPerWeek: int(),
    contributionPerWeek: money,
    totalPerWeek: money
  })),
  lockedAt: nullable(isoDateTime)
});

/** Cuerpo de error estándar `{ error:{ code, message, details? }, requestId }`. */
export const errorBody: Schema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: { code: { type: "string" }, message: { type: "string" }, details: {} },
      required: ["code", "message"]
    },
    requestId: { type: "string" }
  },
  required: ["error"]
};

/** Texto OpenAPI de cada código de estado de error (en español, como el resto de la documentación del módulo). */
export const ERROR_DESCRIPTIONS: Readonly<Record<number, string>> = {
  400: "Datos de entrada no válidos (VALIDATION_ERROR, INVALID_CURSOR…).",
  401: "Falta la sesión o ha caducado (AUTH_REQUIRED, AUTH_INVALID_OR_EXPIRED).",
  403: "Sin permiso: rol insuficiente (AUTH_FORBIDDEN), cuenta no activa o requisitos de publicación sin cumplir.",
  404: "El recurso no existe o no es tuyo (no se revela su existencia).",
  409: "Conflicto con el estado actual: plaza ocupada, solicitud ya decidida, destino en uso…",
  422: "Datos válidos pero no aceptables por las reglas de negocio (fuera de provincia, límites, clave de idempotencia reutilizada…).",
  429: "Demasiadas peticiones (RATE_LIMITED).",
  502: "El proveedor de rutas o mapas devolvió una respuesta inválida o límite de uso.",
  503: "Proveedor de rutas o mapas no disponible (MAPS_PROVIDER_UNAVAILABLE)."
};

/** Respuestas de error comunes (documentación OpenAPI y serialización consistente). */
export function errors(...codes: number[]): Record<number, Schema> {
  const out: Record<number, Schema> = {};
  for (const code of codes) out[code] = { ...errorBody, description: ERROR_DESCRIPTIONS[code] ?? "Error" };
  return out;
}

export const bearer = [{ bearerAuth: [] as string[] }];
