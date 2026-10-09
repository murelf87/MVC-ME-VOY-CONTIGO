/**
 * Schemas JSON de Fastify del módulo `live`. Producen EXACTAMENTE las formas de mobile/src/api/types/live.ts:
 * todos los objetos de respuesta son cerrados (`additionalProperties:false`) y con todas sus propiedades requeridas,
 * salvo las marcadas como opcionales. Un campo ausente del schema se perdería silenciosamente al serializar, por eso
 * tests/live-http.integration.test.ts compara las claves de cada respuesta con el contrato.
 */
export type Schema = Record<string, unknown>;

/* ───────────────────────────── Constructores ───────────────────────────── */

export function obj(properties: Record<string, Schema>, optional: readonly string[] = []): Schema {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties).filter(key => !optional.includes(key)),
    properties
  };
}

export function arr(items: Schema): Schema {
  return { type: "array", items };
}

/** Admite `null` además del tipo original (primitivos y objetos). */
export function nul(schema: Schema): Schema {
  const type = schema.type;
  const withNull = Array.isArray(schema.enum) ? { ...schema, enum: [...(schema.enum as unknown[]), null] } : schema;
  if (Array.isArray(type)) return { ...withNull, type: [...type, "null"] };
  if (typeof type === "string") return { ...withNull, type: [type, "null"] };
  return { anyOf: [{ type: "null" }, schema] };
}

export function enumOf(values: readonly string[]): Schema {
  return { type: "string", enum: [...values] };
}

const str: Schema = { type: "string" };
const int: Schema = { type: "integer" };
const num: Schema = { type: "number" };
const bool: Schema = { type: "boolean" };
const uuid: Schema = { type: "string", format: "uuid" };
const dt: Schema = { type: "string", format: "date-time" };

/* ───────────────────────────── Piezas comunes ───────────────────────────── */

export const publicUserSchema = obj({
  id: uuid, displayName: str, firstName: str, photoUrl: nul(str), ratingAverage: nul(num), ratingCount: int
});

export const moneySchema = obj({
  cents: nul(int), currency: enumOf(["EUR"]), status: enumOf(["defined", "pending_definition", "illustrative"])
});

export const geoPointSchema = obj({ lat: num, lng: num });
const geoPointInSchema = obj({
  lat: { type: "number", minimum: -90, maximum: 90 },
  lng: { type: "number", minimum: -180, maximum: 180 }
});

const tripStatusSchema = enumOf(["published", "active", "completed", "cancelled"]);
const bookingStatusSchema = enumOf(["confirmed", "completed", "no_show", "cancelled", "driver_cancelled"]);
const phaseSchema = enumOf(["scheduled", "driver_en_route", "arriving", "at_pickup", "in_vehicle", "completed", "cancelled"]);
const signalSchema = enumOf(["live", "stale", "none"]);

const vehicleSchema = obj({ make: str, model: str, color: nul(str), plate: str });
const stopSchema = obj({ seq: int, label: nul(str), location: geoPointSchema });
const stopWithSchema = (extra: string) => obj({ seq: int, label: nul(str), location: geoPointSchema, [extra]: nul(dt) });

const etaSchema = obj({
  at: dt, minutes: int, distanceM: nul(int), source: enumOf(["live_route", "schedule"]), approximate: bool
});
const positionSchema = obj({
  location: geoPointSchema, headingDegrees: nul(num), speedMps: nul(num), accuracyM: nul(num),
  recordedAt: dt, receivedAt: dt, ageSeconds: int, stale: bool, precision: enumOf(["precise", "approximate"])
});
const arrivalSchema = obj({ warning: bool, arrived: bool, warningThresholdSeconds: int });
const chatSchema = obj({ peerUserId: uuid, available: bool });
const pendingChangeSchema = obj({ proposalId: uuid, expiresAt: nul(dt), awaitingMyDecision: bool });

/* ───────────────────────────── 21 / 23 / 24 ───────────────────────────── */

export const bookingLiveSchema = obj({
  bookingId: uuid, tripId: uuid, phase: phaseSchema, tripStatus: tripStatusSchema, bookingStatus: bookingStatusSchema,
  serverTime: dt, driver: publicUserSchema, vehicle: vehicleSchema,
  pickup: stopWithSchema("plannedAt"), dropoff: stopWithSchema("plannedAt"),
  etaTarget: enumOf(["pickup", "dropoff"]), eta: nul(etaSchema), signal: signalSchema,
  lastUpdateAt: nul(dt), lastUpdateAgeSeconds: nul(int), staleAfterSeconds: int,
  position: nul(positionSchema), arrival: arrivalSchema, chat: chatSchema, pendingRouteChange: nul(pendingChangeSchema)
});

const pickupCodeSchema = obj({
  status: enumOf(["not_generated", "active", "verified", "locked"]), codeLength: int,
  generatedAt: nul(dt), verifiedAt: nul(dt), attemptsRemaining: nul(int)
});
const occupantSchema = obj({ role: enumOf(["driver", "passenger"]), isYou: bool, user: nul(publicUserSchema) });
const timelineStopSchema = obj({
  seq: int, label: nul(str), location: geoPointSchema,
  role: enumOf(["pickup", "stop", "dropoff"]), eta: dt, state: enumOf(["done", "current", "next"])
});

export const inCarSchema = obj({
  bookingId: uuid, tripId: uuid, phase: phaseSchema, tripStatus: tripStatusSchema, serverTime: dt,
  driver: publicUserSchema, vehicle: vehicleSchema, pickupCode: pickupCodeSchema,
  occupancy: obj({ occupied: int, capacity: int, members: arr(occupantSchema) }),
  timeline: arr(timelineStopSchema), etaAtDestination: nul(etaSchema),
  remaining: nul(obj({ minutes: int, distanceM: nul(int) })),
  signal: signalSchema, lastUpdateAt: nul(dt),
  share: obj({ active: bool, expiresAt: nul(dt) }),
  chat: chatSchema, pendingRouteChange: nul(pendingChangeSchema)
});

export const ratingSchema = obj({
  id: uuid, tripId: uuid, raterUserId: uuid, rateeUserId: uuid,
  stars: { type: "integer", minimum: 1, maximum: 5 }, comment: nul(str), createdAt: dt
});

export const summarySchema = obj({
  bookingId: uuid, tripId: uuid, tripStatus: tripStatusSchema, bookingStatus: bookingStatusSchema, arrived: bool,
  pickup: stopWithSchema("at"), dropoff: stopWithSchema("at"),
  path: arr(geoPointSchema),
  duration: obj({ seconds: int, source: enumOf(["actual", "planned"]) }),
  distance: obj({ meters: int, basis: enumOf(["planned_road_route"]) }),
  passengers: obj({ count: int, capacity: int }),
  driver: publicUserSchema, vehicle: vehicleSchema,
  payment: obj({ status: enumOf(["pending_definition", "confirmed"]), amount: moneySchema }),
  rating: obj({
    canRate: bool,
    reason: nul(enumOf(["trip_not_completed", "booking_not_completed", "already_rated", "window_closed"])),
    rateeUserId: uuid, windowEndsAt: nul(dt), mine: nul(ratingSchema)
  }),
  incidents: obj({ canReport: bool, mineCount: int })
});

/* ───────────────────────────── Cambio de ruta (22) ───────────────────────────── */

const scheduleImpactSchema = obj({ beforeAt: nul(dt), afterAt: nul(dt), deltaSeconds: int, material: bool });
const countsSchema = obj({ required: int, accepted: int, rejected: int, pending: int });
const decisionSchema = nul(enumOf(["accepted", "rejected"]));

export const routeChangeSchema = obj({
  id: uuid, tripId: uuid, kind: enumOf(["new_stop"]),
  status: enumOf(["pending", "accepted", "rejected", "expired", "cancelled"]),
  resolution: nul(enumOf([
    "auto_applied", "all_accepted", "rejected_by_passenger", "expired", "cancelled_by_driver", "capacity_lost", "superseded"
  ])),
  autoApplied: bool, role: enumOf(["driver", "passenger"]),
  createdAt: dt, expiresAt: nul(dt), resolvedAt: nul(dt),
  driver: publicUserSchema,
  newStop: obj({
    label: nul(str), location: geoPointSchema, afterStopSeq: int, plannedArrivalAt: nul(dt), seq: nul(int)
  }),
  detour: obj({ addedDistanceM: int, addedDurationSeconds: int, maxDetourM: int }),
  path: obj({ before: arr(geoPointSchema), after: arr(geoPointSchema) }),
  stops: obj({ pickup: nul(stopSchema), dropoff: nul(stopSchema) }),
  myImpact: nul(obj({
    pickup: scheduleImpactSchema, dropoff: scheduleImpactSchema,
    price: obj({ before: moneySchema, after: moneySchema, delta: moneySchema, changed: bool, material: bool }),
    requiresAcceptance: bool
  })),
  myDecision: decisionSchema,
  counts: countsSchema,
  participants: nul(arr(obj({
    bookingId: uuid, passenger: publicUserSchema, requiresAcceptance: bool, decision: decisionSchema,
    deltaSeconds: int, priceDelta: moneySchema
  }))),
  driverSignal: obj({ state: signalSchema, lastUpdateAt: nul(dt), ageSeconds: nul(int) }),
  surcharge: enumOf(["none"]),
  linkedRequestId: nul(uuid)
});

export const createRouteChangeBodySchema = obj({
  stop: obj({ location: geoPointInSchema, label: { type: "string", minLength: 1, maxLength: 120 } }, ["label"]),
  afterStopSeq: { type: "integer", minimum: 0, maximum: 1000 },
  requestId: uuid
}, ["afterStopSeq", "requestId"]);

export const respondRouteChangeBodySchema = obj({ decision: enumOf(["accept", "reject"]) });

/* ───────────────────────────── Valoraciones e incidencias ───────────────────────────── */

export const createRatingBodySchema = obj({
  rateeUserId: uuid,
  stars: { type: "integer", minimum: 1, maximum: 5 },
  comment: { type: "string", maxLength: 500 }
}, ["comment"]);

const INCIDENT_CATEGORIES = [
  "safety", "driver_behavior", "passenger_behavior", "vehicle", "route_or_schedule", "payment", "lost_item", "other"
] as const;

const incidentAttachmentSchema = obj({
  id: uuid, contentType: str, sizeBytes: int, status: enumOf(["pending", "uploaded"]), createdAt: dt
});

export const incidentSchema = obj({
  id: uuid, tripId: uuid, bookingId: nul(uuid), category: enumOf(INCIDENT_CATEGORIES), description: str,
  status: enumOf(["open", "in_review", "resolved", "dismissed"]), reporterRole: enumOf(["driver", "passenger"]),
  createdAt: dt, updatedAt: dt, attachments: arr(incidentAttachmentSchema)
});

export const incidentPageSchema = obj({ items: arr(incidentSchema), nextCursor: nul(str) });
export { incidentAttachmentSchema };

export const createIncidentBodySchema = obj({
  tripId: uuid,
  bookingId: uuid,
  category: enumOf(INCIDENT_CATEGORIES),
  description: { type: "string", minLength: 10, maxLength: 2000 }
}, ["bookingId"]);

export const attachmentIntentBodySchema = obj({
  contentType: enumOf(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
  sizeBytes: { type: "integer", minimum: 1, maximum: 10485760 }
});

export const attachmentIntentSchema = obj({
  attachmentId: uuid, uploadUrl: str, headers: { type: "object", additionalProperties: { type: "string" } }, expiresAt: dt
});

/* ───────────────────────────── Compartir viaje ───────────────────────────── */

export const shareCreateBodySchema = obj({
  includePlate: bool,
  expiresInMinutes: { type: "integer", minimum: 15, maximum: 1440 }
}, ["includePlate", "expiresInMinutes"]);

const shareProps: Record<string, Schema> = {
  id: uuid, bookingId: uuid, tripId: uuid, includePlate: bool, status: enumOf(["active", "expired", "revoked"]),
  createdAt: dt, expiresAt: dt, revokedAt: nul(dt), lastViewedAt: nul(dt), viewCount: int
};
export const shareSchema = obj(shareProps);
export const shareCreatedSchema = obj({ ...shareProps, token: str, url: nul(str) });
export const shareStateSchema = obj({ share: nul(shareSchema) });

export const sharedTripSchema = obj({
  phase: phaseSchema, serverTime: dt, expiresAt: dt, passengerFirstName: str, driverFirstName: str,
  vehicle: obj({ make: str, model: str, color: nul(str), plate: nul(str) }),
  route: obj({ originLabel: nul(str), destinationLabel: nul(str) }),
  plannedDepartureAt: nul(dt), eta: nul(etaSchema), signal: signalSchema,
  position: nul(obj({
    location: geoPointSchema, recordedAt: dt, ageSeconds: int, stale: bool, precision: enumOf(["approximate"])
  }))
});

/* ───────────────────────────── Consola del conductor y privacidad ───────────────────────────── */

const codeStateSchema = obj({
  status: enumOf(["not_generated", "active", "verified", "locked"]), attemptsRemaining: nul(int)
});

export const consoleSchema = obj({
  tripId: uuid, status: tripStatusSchema, serverTime: dt, departureAt: nul(dt), startedAt: nul(dt), completedAt: nul(dt),
  vehicle: vehicleSchema, seats: obj({ offered: int, occupied: int }), signal: signalSchema, position: nul(positionSchema),
  next: nul(obj({ bookingId: uuid, passenger: publicUserSchema, pickup: stopSchema, etaToPickup: nul(etaSchema) })),
  passengers: arr(obj({
    bookingId: uuid, passenger: publicUserSchema, bookingStatus: bookingStatusSchema, pickup: stopSchema, dropoff: stopSchema,
    pickedUp: bool, pickedUpAt: nul(dt), code: codeStateSchema, etaToPickup: nul(etaSchema), ratedByMe: bool
  })),
  counts: obj({ total: int, verified: int, pending: int }),
  pendingRouteChange: nul(obj({ id: uuid, createdAt: dt, expiresAt: nul(dt), counts: countsSchema })),
  actions: obj({ canStart: bool, canComplete: bool, canProposeRouteChange: bool, willMarkNoShow: int })
});

export const privacySchema = obj({ showProfileToCoPassengers: bool, updatedAt: nul(dt) });
export const privacyBodySchema = obj({ showProfileToCoPassengers: bool });

/* ───────────────────────────── Parámetros, cabeceras y errores ───────────────────────────── */

export function paramsOf(...names: string[]): Schema {
  return {
    type: "object",
    required: names,
    properties: Object.fromEntries(names.map(name => [name, uuid]))
  };
}

export const idempotencyHeaderSchema: Schema = {
  type: "object",
  properties: { "idempotency-key": { type: "string", pattern: "^[A-Za-z0-9_.:-]{8,80}$" } }
};

const errorSchema: Schema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" }, details: {} }
    },
    requestId: { type: "string" }
  }
};

export function errorResponses(...codes: number[]): Record<number, Schema> {
  return Object.fromEntries(codes.map(code => [code, errorSchema]));
}
