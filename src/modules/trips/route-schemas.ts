/**
 * JSON Schemas (Fastify) de entrada y salida de TODAS las rutas del módulo «trips». Reflejan EXACTAMENTE
 * mobile/src/api/types/trips.ts. Las respuestas son cerradas (`additionalProperties:false`): una propiedad no declarada
 * se descartaría al serializar y una obligatoria ausente produciría un error; los tests comprueban ambas cosas.
 */
import {
  arr, bool, enumOf, geoPoint, int, isoDate, isoDatePattern, isoDateTime, localTime, localTimePattern, money, nullable, num, obj,
  precisePoint, publicUser, requestStatus, str, tripCategory, tripLeg, tripQuote, tripStatus, uuid, vehicleSummary, weekday,
  type Schema
} from "./schemas.js";

/* ───────────────────────────── Piezas comunes ───────────────────────────── */

const pageOf = (item: Schema): Schema => obj({ items: arr(item), nextCursor: nullable(str()) });

export const requestPoint: Schema = obj({
  label: nullable(str()),
  address: nullable(str()),
  location: precisePoint,
  atLocal: localTime,
  at: isoDateTime,
  walkMinutes: nullable(int()),
  detourMinutes: nullable(int())
});

const coordinates: Schema = arr(arr(num(), { minItems: 2, maxItems: 2 }));
const lineString = (withPrecision: boolean): Schema =>
  obj({
    type: enumOf("LineString"),
    coordinates,
    ...(withPrecision ? { precision: enumOf("approximate", "precise") } : {})
  });

/* ───────────────────────────── Respuestas ───────────────────────────── */

export const tripCategoriesResponse: Schema = obj({ items: arr(obj({ id: tripCategory, label: str() })) });

export const mapCarsResponse: Schema = obj({
  provinceId: uuid,
  generatedAt: isoDateTime,
  cars: arr(obj({
    tripId: uuid,
    category: tripCategory,
    state: enumOf("scheduled", "live"),
    position: obj({
      lat: num(),
      lng: num(),
      precision: enumOf("approximate"),
      source: enumOf("live_gps", "origin"),
      recordedAt: nullable(isoDateTime),
      stale: bool,
      ageSeconds: nullable(int())
    }),
    seatsAvailable: int(),
    seatsOffered: int(),
    full: bool,
    departureAt: isoDateTime,
    originLabel: nullable(str()),
    destinationLabel: nullable(str())
  })),
  truncated: bool
});

const searchItem: Schema = obj({
  tripId: uuid,
  seriesId: nullable(uuid),
  leg: tripLeg,
  category: tripCategory,
  driver: publicUser,
  vehicle: vehicleSummary,
  recurrence: nullable(obj({ weekdays: arr(weekday), matchedWeekdays: arr(weekday), fullMatch: bool })),
  departureAt: isoDateTime,
  seatsAvailable: int(),
  seatsOffered: int(),
  pickup: obj({
    label: nullable(str()),
    location: precisePoint,
    pickupAt: isoDateTime,
    pickupAtLocal: localTime,
    minutesFromNow: nullable(int()),
    walkDistanceM: int(),
    walkMinutes: int(),
    onRoute: bool,
    stopSeq: nullable(int())
  }),
  dropoff: obj({
    label: nullable(str()),
    location: precisePoint,
    arriveAt: isoDateTime,
    arriveAtLocal: localTime,
    walkDistanceM: int(),
    walkMinutes: int(),
    stopSeq: int()
  }),
  fromSegmentSeq: int(),
  toSegmentSeq: int(),
  roadDistanceM: int(),
  durationMinutes: int(),
  price: money,
  return: nullable(obj({ available: bool, departsLocal: nullable(localTime), matchesRequested: nullable(bool) }))
});

export const tripSearchPage: Schema = obj({
  items: arr(searchItem),
  nextCursor: nullable(str()),
  suggestions: arr(obj({
    kind: enumOf("widen_time", "more_days", "wider_radius"),
    message: str(),
    wouldMatch: int(),
    apply: obj({ toleranceMinutes: int(), weekdays: str(), radiusM: int() }, ["toleranceMinutes", "weekdays", "radiusM"])
  })),
  criteria: obj({
    mode: enumOf("weekly", "one_off"),
    arriveBy: localTime,
    toleranceMinutes: int(),
    weekdays: nullable(arr(weekday)),
    date: nullable(isoDate),
    radiusM: int(),
    originLabel: nullable(str()),
    destLabel: nullable(str())
  })
});

export const tripDetail: Schema = obj({
  id: uuid,
  seriesId: nullable(uuid),
  status: tripStatus,
  kind: enumOf("single", "recurring"),
  leg: tripLeg,
  category: tripCategory,
  provinceId: uuid,
  provinceName: str(),
  driver: publicUser,
  vehicle: vehicleSummary,
  departureAt: isoDateTime,
  flexibilityMinutes: int(),
  recurrence: nullable(obj({ weekdays: arr(weekday), outboundLocal: localTime, returnLocal: nullable(localTime) })),
  pickupPolicy: obj({ onRoute: bool, maxDetourMinutes: int() }),
  seats: obj({
    offered: int(),
    available: int(),
    perSegment: arr(obj({
      seq: int(), fromStopSeq: int(), toStopSeq: int(), capacity: int(), occupied: int(), free: int(), distanceM: int(), durationMinutes: int()
    }))
  }),
  route: obj({ distanceM: int(), durationMinutes: int(), geometry: lineString(true) }),
  stops: arr(obj({
    seq: int(),
    kind: enumOf("origin", "pickup", "stop", "dropoff", "destination"),
    label: nullable(str()),
    location: precisePoint,
    etaAt: isoDateTime,
    etaLocal: localTime,
    optional: bool,
    detourMinutes: nullable(int()),
    isYourPickup: bool,
    isYourDropoff: bool,
    canBoard: bool,
    canAlight: bool
  })),
  totals: obj({ roadDistanceM: int(), durationMinutes: int(), detourMinutes: int() }),
  price: money,
  breakdownAvailable: bool,
  viewer: obj({
    relation: enumOf("public", "driver", "requester", "passenger"),
    precision: enumOf("approximate", "precise"),
    openRequest: nullable(obj({ id: uuid, status: requestStatus }))
  }),
  owner: nullable(obj({ pendingRequests: int(), confirmedPassengers: arr(publicUser) })),
  canRequest: bool,
  cannotRequestReason: nullable(str())
});

export const pickupPointsResponse: Schema = obj({
  tripId: uuid,
  origin: geoPoint,
  dropoff: obj({ stopSeq: int(), label: nullable(str()), location: precisePoint }),
  proposals: arr(obj({
    id: str(),
    code: str(),
    name: nullable(str()),
    address: nullable(str()),
    location: precisePoint,
    source: enumOf("driver_stop", "route_projection"),
    walk: obj({ minutes: int(), distanceM: int(), estimated: { type: "boolean", enum: [true] } }),
    detour: obj({ minutes: int(), source: enumOf("stop", "estimate", "routed") }),
    fromSegmentSeq: int(),
    boardsAt: isoDateTime,
    boardsAtLocal: localTime,
    distanceToDropoffM: int(),
    recommended: bool
  })),
  safetyNotice: str()
});

export const tripQuoteResponse: Schema = obj({
  tripId: uuid,
  quote: tripQuote,
  pickup: requestPoint,
  dropoff: requestPoint,
  seatsAvailable: int(),
  roadDistanceM: int(),
  canRequest: bool,
  cannotRequestReason: nullable(str())
});

const stepKeys = ["requested", "accepted", "payment", "confirmed"];
const nextAction: Schema = obj({
  kind: enumOf("wait_for_driver", "pay", "view_booking", "search_again", "none"),
  deadlineAt: nullable(isoDateTime)
});
const hold: Schema = nullable(obj({ expiresAt: isoDateTime, remainingSeconds: int(), active: bool }));

export const rideRequestDetail: Schema = obj({
  id: uuid,
  status: requestStatus,
  trip: obj({
    id: uuid,
    leg: tripLeg,
    category: tripCategory,
    departureAt: isoDateTime,
    originLabel: nullable(str()),
    destinationLabel: nullable(str()),
    driver: publicUser,
    vehicle: vehicleSummary
  }),
  passenger: publicUser,
  pickup: nullable(requestPoint),
  dropoff: nullable(requestPoint),
  fromSegmentSeq: int(),
  toSegmentSeq: int(),
  roadDistanceM: nullable(int()),
  message: nullable(str()),
  stepper: obj({
    steps: arr(obj({ key: enumOf(...stepKeys), state: enumOf("done", "current", "pending", "failed") })),
    current: enumOf(...stepKeys),
    terminal: nullable(enumOf("rejected", "expired", "cancelled", "payment_late"))
  }),
  hold,
  quote: tripQuote,
  nextAction,
  booking: nullable(obj({
    id: uuid,
    status: enumOf("confirmed", "completed", "no_show", "cancelled", "driver_cancelled"),
    amount: money
  })),
  weekly: nullable(obj({ reservationId: uuid, occurrenceDate: isoDate, leg: tripLeg })),
  requestedAt: isoDateTime,
  updatedAt: isoDateTime
});

export const decideResponse: Schema = obj({
  id: uuid,
  kind: enumOf("single", "weekly"),
  status: requestStatus,
  hold: nullable(obj({ id: nullable(uuid), expiresAt: isoDateTime })),
  requestIds: arr(uuid)
});

const weeklyOccurrence: Schema = obj({
  date: isoDate,
  weekday,
  leg: tripLeg,
  tripId: nullable(uuid),
  boardsAtLocal: nullable(localTime),
  arrivesAtLocal: nullable(localTime),
  state: enumOf("available", "requested", "skipped_exception", "skipped_full", "skipped_past", "skipped_no_occurrence"),
  seatsAvailable: nullable(int()),
  requestId: nullable(uuid),
  requestStatus: nullable(requestStatus)
});

const weeklyLeg: Schema = obj({
  leg: tripLeg,
  label: str(),
  fromLabel: nullable(str()),
  toLabel: nullable(str()),
  boardsAtLocal: localTime,
  arrivesAtLocal: localTime
});

export const weeklyPreview: Schema = obj({
  tripId: uuid,
  seriesId: uuid,
  legs: arr(weeklyLeg),
  occurrences: arr(weeklyOccurrence),
  quote: tripQuote,
  canSubmit: bool,
  issues: arr(obj({ code: str(), message: str(), date: nullable(isoDate) }))
});

export const weeklyReservation: Schema = obj({
  id: uuid,
  seriesId: uuid,
  status: enumOf("pending", "payment_pending", "confirmed", "partially_confirmed", "rejected", "cancelled", "expired"),
  passenger: publicUser,
  driver: publicUser,
  category: tripCategory,
  weekdays: arr(weekday),
  legs: arr(weeklyLeg),
  startDate: isoDate,
  weeks: int(),
  exceptionDates: arr(isoDate),
  cancellationPolicyVersion: nullable(str()),
  occurrences: arr(weeklyOccurrence),
  hold,
  quote: tripQuote,
  nextAction,
  createdAt: isoDateTime
});

export const driverRequestsPage: Schema = pageOf(obj({
  id: uuid,
  kind: enumOf("single", "weekly"),
  status: requestStatus,
  passenger: publicUser,
  tripId: uuid,
  leg: tripLeg,
  category: tripCategory,
  departureAt: isoDateTime,
  from: obj({ label: nullable(str()), at: isoDateTime, atLocal: localTime }),
  to: obj({ label: nullable(str()), at: isoDateTime, atLocal: localTime }),
  detourMinutes: nullable(int()),
  occupancy: obj({
    occupiedSeats: int(),
    totalSeats: int(),
    perSegment: arr(obj({
      seq: int(), fromLabel: nullable(str()), toLabel: nullable(str()), occupied: int(), capacity: int(), inRequestedRange: bool
    }))
  }),
  message: nullable(str()),
  weekly: nullable(obj({ weekdays: arr(weekday), legs: arr(tripLeg), occurrences: int(), startDate: isoDate })),
  canAccept: bool,
  blockedReason: nullable(str()),
  requestedAt: isoDateTime
}));

const readinessKeys = ["public_photo", "identity", "vehicle", "vehicle_documents", "vehicle_photo", "insurance", "driver_license"];

export const driverReadiness: Schema = obj({
  canPublish: bool,
  vehicle: nullable(obj({ id: uuid, displayName: str(), plate: str(), color: nullable(str()), passengerSeats: int() })),
  items: arr(obj({
    key: enumOf(...readinessKeys),
    label: str(),
    state: enumOf("approved", "in_review", "missing", "rejected", "expired"),
    blocking: bool,
    detail: nullable(str()),
    expiresOn: nullable(isoDate)
  })),
  blockers: arr(enumOf(...readinessKeys))
});

const plannedRoute: Schema = obj({
  distanceM: int(),
  durationMinutes: int(),
  geometry: lineString(false),
  provider: str(),
  providerRef: str()
});

export const routePlanResponse: Schema = obj({
  provinceId: uuid,
  provinceName: str(),
  canSave: bool,
  headline: nullable(str()),
  blockingMessage: nullable(str()),
  issues: arr(obj({
    code: enumOf("STOP_OUTSIDE_PROVINCE", "ROUTE_LEAVES_PROVINCE", "MAPS_PROVIDER_UNAVAILABLE", "ROUTE_PROVIDER_ERROR", "TOO_MANY_STOPS"),
    severity: enumOf("error", "warning"),
    stopIndex: nullable(int()),
    message: str()
  })),
  stops: arr(obj({
    index: int(),
    kind: enumOf("origin", "stop", "destination"),
    label: nullable(str()),
    location: geoPoint,
    optional: bool,
    inProvince: bool,
    verdict: enumOf("ok", "outside_province"),
    message: nullable(str()),
    etaLocal: nullable(localTime),
    offsetMinutes: nullable(int()),
    detourMinutes: nullable(int()),
    alternatives: arr(obj({ label: str(), location: geoPoint }))
  })),
  route: nullable(plannedRoute),
  computedAt: isoDateTime
});

export const publishRouteResponse: Schema = obj({
  seriesId: nullable(uuid),
  frequency: enumOf("daily_workdays", "one_off"),
  trips: arr(obj({ id: uuid, leg: tripLeg, departureAt: isoDateTime, status: tripStatus })),
  occurrencesCreated: int(),
  horizonUntil: nullable(isoDate),
  route: plannedRoute
});

const overviewStatus: Schema = obj({
  code: enumOf("confirmed", "pending", "payment_pending", "scheduled", "live", "completed", "cancelled", "no_show", "rejected", "expired"),
  label: str()
});
const overviewEndpoint: Schema = obj({ label: nullable(str()), timeLocal: localTime });
const overviewBase = {
  category: tripCategory,
  title: str(),
  from: overviewEndpoint,
  to: overviewEndpoint,
  riders: arr(publicUser),
  occupancy: nullable(obj({ occupied: int(), total: int() })),
  status: overviewStatus
};

const weeklyReservationCard: Schema = obj({
  kind: enumOf("weekly_reservation"),
  id: uuid,
  seriesId: uuid,
  reservationId: nullable(uuid),
  recurrence: obj({ weekdays: arr(weekday), recurring: { type: "boolean", enum: [true] }, label: str() }),
  ...overviewBase
});

const tripOverviewCard: Schema = obj({
  kind: enumOf("trip"),
  id: uuid,
  tripId: uuid,
  requestId: nullable(uuid),
  bookingId: nullable(uuid),
  role: enumOf("passenger", "driver"),
  leg: tripLeg,
  departureAt: isoDateTime,
  startsInMinutes: nullable(int()),
  phase: enumOf("scheduled", "live", "finished"),
  liveEta: nullable(obj({ minutes: int(), phrase: str(), stale: bool })),
  ...overviewBase
});

const overviewCard: Schema = { oneOf: [weeklyReservationCard, tripOverviewCard] };

export const tripsOverview: Schema = obj({
  role: enumOf("passenger", "driver"),
  generatedAt: isoDateTime,
  counts: obj({ upcoming: int(), inProgress: int(), history: int() }),
  upcoming: arr(overviewCard),
  inProgress: arr(overviewCard),
  history: pageOf(overviewCard)
});

const favoriteKind = enumOf("work", "campus", "home", "other");
export const favoritePlace: Schema = obj({
  id: uuid,
  kind: favoriteKind,
  name: str(),
  address: str(),
  location: geoPoint,
  provinceId: nullable(uuid),
  createdAt: isoDateTime
});
export const favoritesResponse: Schema = pageOf(favoritePlace);

const routineEntry: Schema = obj({
  id: uuid,
  weekday,
  time: localTime,
  fromPlace: obj({ id: uuid, kind: favoriteKind, name: str() }),
  toPlace: obj({ id: uuid, kind: favoriteKind, name: str() }),
  enabled: bool
});
export const routineEntryResponse: Schema = routineEntry;
export const routineEntriesResponse: Schema = obj({ items: arr(routineEntry) });

export const weeklySeatOffer: Schema = obj({
  enabled: bool,
  seats: int(),
  weekdays: arr(weekday),
  conditions: obj({ label: enumOf("Propuesta"), price: money }),
  prefill: nullable(obj({
    frequency: enumOf("daily_workdays", "one_off"),
    outboundLocal: localTime,
    weekdays: arr(weekday),
    seats: int(),
    origin: obj({ lat: num(), lng: num(), label: str() }),
    destination: obj({ lat: num(), lng: num(), label: str() })
  }))
});

export const routineResponse: Schema = obj({
  places: arr(favoritePlace),
  entries: arr(routineEntry),
  suspensions: arr(obj({ weekStart: isoDate, weekEnd: isoDate })),
  nextWeek: obj({ weekStart: isoDate, weekEnd: isoDate, suspended: bool }),
  weeklyOffer: weeklySeatOffer
});

export const suspensionResponse: Schema = obj({
  weekStart: isoDate,
  weekEnd: isoDate,
  withdrawnRequests: int(),
  keptRequests: int()
});

/* ───────────────────────────── Entradas ───────────────────────────── */

export const idParam = (name: string): Schema => obj({ [name]: uuid });

export const idempotencyHeader: Schema = {
  type: "object",
  properties: {
    "idempotency-key": { type: "string", minLength: 8, maxLength: 80, description: "Clave para repetir la respuesta original de forma segura (8–80: letras, números, . _ : -)" }
  }
};

const lat = num({ minimum: -90, maximum: 90 });
const lng = num({ minimum: -180, maximum: 180 });
const place = (optionalFlag: boolean): Schema =>
  obj({
    lat,
    lng,
    label: str({ minLength: 1, maxLength: 80, description: "Texto público (zona o municipio); no uses el domicilio exacto" }),
    ...(optionalFlag ? { optional: bool } : {})
  }, ["label", "optional"]);

export const mapQuery: Schema = obj({
  provinceId: uuid,
  category: tripCategory,
  onlyWithSeats: { type: "boolean", default: false },
  withinHours: int({ minimum: 1, maximum: 48, default: 12 }),
  limit: int({ minimum: 1, maximum: 200, default: 100 })
}, ["category", "onlyWithSeats", "withinHours", "limit"]);

export const searchQuery: Schema = obj({
  provinceId: uuid,
  originLat: lat,
  originLng: lng,
  destLat: lat,
  destLng: lng,
  originLabel: str({ maxLength: 120 }),
  destLabel: str({ maxLength: 120 }),
  arriveBy: localTimePattern,
  returnAt: localTimePattern,
  mode: enumOf("weekly", "one_off"),
  date: isoDatePattern,
  weekdays: str({ maxLength: 40, description: "CSV: mon,tue,wed,thu,fri" }),
  category: tripCategory,
  onlyWithSeats: { type: "boolean", default: true },
  toleranceMinutes: int({ minimum: 0, maximum: 90, default: 20 }),
  radiusM: int({ minimum: 200, maximum: 10000, default: 2000 }),
  cursor: str({ maxLength: 200 }),
  limit: int({ minimum: 1, maximum: 50, default: 20 })
}, ["originLabel", "destLabel", "returnAt", "date", "weekdays", "category", "onlyWithSeats", "toleranceMinutes", "radiusM", "cursor", "limit"]);

export const detailQuery: Schema = obj({
  pickupLat: lat,
  pickupLng: lng,
  dropoffStopSeq: int({ minimum: 1 })
}, ["pickupLat", "pickupLng", "dropoffStopSeq"]);

export const pickupPointsQuery: Schema = obj({
  lat,
  lng,
  dropoffStopSeq: int({ minimum: 1 }),
  limit: int({ minimum: 1, maximum: 4, default: 2 })
}, ["dropoffStopSeq", "limit"]);

export const quoteBody: Schema = obj({
  pickupPointId: str({ maxLength: 300 }),
  fromSegmentSeq: int({ minimum: 0 }),
  toSegmentSeq: int({ minimum: 1 }),
  dropoffStopSeq: int({ minimum: 1 })
}, ["pickupPointId", "fromSegmentSeq", "toSegmentSeq", "dropoffStopSeq"]);

export const createRequestBody: Schema = obj({
  pickupPointId: str({ maxLength: 300 }),
  dropoffStopSeq: int({ minimum: 1 }),
  fromSegmentSeq: int({ minimum: 0 }),
  toSegmentSeq: int({ minimum: 1 }),
  message: str({ maxLength: 300 })
}, ["pickupPointId", "dropoffStopSeq", "fromSegmentSeq", "toSegmentSeq", "message"]);

export const decisionBody: Schema = obj({ decision: enumOf("accept", "reject") });

export const weeklyBody: Schema = obj({
  pickupPointId: str({ maxLength: 300 }),
  dropoffStopSeq: int({ minimum: 1 }),
  weekdays: arr(weekday, { minItems: 1, maxItems: 7, uniqueItems: true }),
  legs: arr(tripLeg, { minItems: 1, maxItems: 2, uniqueItems: true }),
  startDate: isoDatePattern,
  weeks: int({ minimum: 1, maximum: 4 }),
  exceptionDates: arr(isoDatePattern, { maxItems: 60 }),
  cancellationPolicyVersion: nullable(str({ maxLength: 80 })),
  allowPartial: bool,
  message: str({ maxLength: 300 })
}, ["dropoffStopSeq", "legs", "weeks", "exceptionDates", "cancellationPolicyVersion", "allowPartial", "message"]);

export const driverRequestsQuery: Schema = obj({
  status: enumOf("pending", "open", "all"),
  tripId: uuid,
  cursor: str({ maxLength: 200 }),
  limit: int({ minimum: 1, maximum: 50, default: 20 })
}, ["status", "tripId", "cursor", "limit"]);

export const planBody: Schema = obj({
  provinceId: uuid,
  origin: place(false),
  destination: place(false),
  stops: arr(place(true), { maxItems: 30 }),
  departureLocal: localTimePattern
}, ["stops", "departureLocal"]);

export const publishBody: Schema = obj({
  vehicleId: uuid,
  provinceId: uuid,
  category: tripCategory,
  origin: place(false),
  destination: place(false),
  stops: arr(place(true), { maxItems: 30 }),
  frequency: enumOf("daily_workdays", "one_off"),
  outboundLocal: localTimePattern,
  returnLocal: nullable(localTimePattern),
  startDate: isoDatePattern,
  endDate: nullable(isoDatePattern),
  weekdays: arr(weekday, { minItems: 1, maxItems: 7, uniqueItems: true }),
  seats: int({ minimum: 1, maximum: 8 }),
  maxDetourMinutes: int({ minimum: 0, maximum: 60 }),
  pickupOnRoute: bool,
  flexibilityMinutes: int({ minimum: 0, maximum: 60 })
}, ["stops", "returnLocal", "startDate", "endDate", "weekdays", "flexibilityMinutes"]);

export const overviewQuery: Schema = obj({
  role: enumOf("passenger", "driver"),
  section: { type: "string", enum: ["all", "upcoming", "in_progress", "history"], default: "all" },
  cursor: str({ maxLength: 200 }),
  limit: int({ minimum: 1, maximum: 50, default: 10 })
}, ["section", "cursor", "limit"]);

export const pageQuery: Schema = obj({
  cursor: str({ maxLength: 200 }),
  limit: int({ minimum: 1, maximum: 50, default: 20 })
}, ["cursor", "limit"]);

export const createFavoriteBody: Schema = obj({
  kind: favoriteKind,
  name: str({ minLength: 1, maxLength: 60 }),
  address: str({ minLength: 1, maxLength: 200 }),
  lat,
  lng
});

export const updateFavoriteBody: Schema = obj({
  kind: favoriteKind,
  name: str({ minLength: 1, maxLength: 60 }),
  address: str({ minLength: 1, maxLength: 200 }),
  lat,
  lng
}, ["kind", "name", "address", "lat", "lng"], { minProperties: 1 });

export const createEntryBody: Schema = obj({
  weekdays: arr(weekday, { minItems: 1, maxItems: 7, uniqueItems: true }),
  time: localTimePattern,
  fromPlaceId: uuid,
  toPlaceId: uuid,
  enabled: bool
}, ["enabled"]);

export const updateEntryBody: Schema = obj({
  time: localTimePattern,
  fromPlaceId: uuid,
  toPlaceId: uuid,
  enabled: bool
}, ["time", "fromPlaceId", "toPlaceId", "enabled"], { minProperties: 1 });

export const suspensionBody: Schema = obj({ weekStart: isoDatePattern }, ["weekStart"]);
export const weekStartParam: Schema = obj({ weekStart: isoDatePattern });
export const weeklyOfferBody: Schema = obj({ enabled: bool, seats: int({ minimum: 1, maximum: 8 }) });
