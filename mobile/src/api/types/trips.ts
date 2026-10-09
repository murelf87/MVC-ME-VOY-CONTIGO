/**
 * Contrato del módulo «trips» (be-trips). Fuente de verdad del formato en el cable para las pantallas
 * 09 Inicio mapa · 10 Define tu recorrido · 11 Resultados · 12 Detalle de viaje · 13 Punto de recogida ·
 * 14 Tu plaza semanal · 15 Revisa tu solicitud · 16 Estado y pago (estado de la solicitud + cuenta atrás) ·
 * 17 Tu vehículo · 18 Publica tu ruta · 19 Paradas y recorrido · 20 Solicitudes · 30 Mis viajes ·
 * 31 Favoritos y rutina.
 *
 * Documento complementario con endpoints, errores, máquinas de estado y ejemplos JSON: docs/contracts/trips.md.
 * Los schemas Fastify de src/modules/trips/** producen exactamente estas formas (camelCase).
 *
 * Reglas transversales:
 *  - Instantes: IsoDateTime UTC. Horas de reloj para mostrar: LocalTime «HH:mm» en Europe/Madrid.
 *  - Dinero: siempre `Money`. Sin tarifa aprobada → { cents:null, status:"pending_definition" } («Por definir»).
 *    Este módulo NUNCA emite status "illustrative" (solo la vista previa).
 *  - Coordenadas: `precision:"approximate"` (3 decimales ≈ 110 m, o cuadrícula de 0,01° en el mapa) para quien no
 *    participa; `"precise"` solo para el conductor y para pasajeros con solicitud aceptada/confirmada del viaje.
 *  - Paginación: Page<T> con cursor opaco (`cursor`, `limit` en la query).
 *  - Idempotencia: las creaciones aceptan la cabecera `Idempotency-Key: <uuid>` (ver docs/contracts/trips.md §0).
 */
import type {
  GeoPoint,
  IsoDate,
  IsoDateTime,
  LocalTime,
  Money,
  Page,
  PublicUser,
  TripCategory,
  Uuid,
  Weekday
} from "./common";

/* ────────────────────────────────────────────────────────────────────────────
 * 0. Enumeraciones y formas pequeñas compartidas
 * ──────────────────────────────────────────────────────────────────────────── */

export type TripStatus = "draft" | "published" | "active" | "completed" | "cancelled";
export type TripLeg = "outbound" | "return";
export type TripKind = "single" | "recurring";
/** `accepted` es transitorio en backend (la aceptación crea el hold en la misma transacción): la API muestra `payment_pending`. */
export type RideRequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "payment_pending"
  | "confirmed"
  | "expired"
  | "cancelled"
  | "payment_late";
export type TripBookingStatus = "confirmed" | "completed" | "no_show" | "cancelled" | "driver_cancelled";
export type SearchMode = "weekly" | "one_off";
/** «Diaria (laborables)» | «Puntual» (pantalla 18). */
export type PublishFrequency = "daily_workdays" | "one_off";
export type CoordinatePrecision = "approximate" | "precise";

/** Punto con precisión explícita (nunca coordenada precisa a quien no participa). */
export interface PrecisePoint extends GeoPoint {
  precision: CoordinatePrecision;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Catálogo
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TripCategoryInfo {
  id: TripCategory;
  /** «Trabajo», «Universidad», «FP», «Hospital», «Deporte», «Otros». */
  label: string;
}
/** GET /v1/trip-categories */
export interface TripCategoriesResponse {
  items: TripCategoryInfo[];
}

/** Resumen público del vehículo. La matrícula completa SOLO para el conductor y pasajeros con reserva confirmada. */
export interface VehicleSummary {
  /** Solo el conductor propietario recibe el id. */
  id: Uuid | null;
  make: string;
  model: string;
  color: string | null;
  /** «Seat Arona». */
  displayName: string;
  /** Últimos 3 caracteres de la matrícula normalizada («LKM»). Mostrar como «···· LKM». */
  plateHint: string | null;
  /** Matrícula completa (null para quien no participa). */
  plate: string | null;
  /** Plazas de pasajeros del vehículo. */
  passengerSeats: number;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Mapa de inicio (pantalla 09) — GET /v1/trips/map
 * ──────────────────────────────────────────────────────────────────────────── */

export interface MapCarsQuery {
  provinceId: Uuid;
  category?: TripCategory;
  /** «Con plazas». Por defecto false: los coches completos también se devuelven con `full:true` (pin gris «Completo»). */
  onlyWithSeats?: boolean;
  /** Solo viajes que salen en las próximas N horas (por defecto 12, máx. 48). Los viajes en curso siempre se incluyen. */
  withinHours?: number;
  limit?: number;
}

export interface MapCarPosition {
  lat: number;
  lng: number;
  /** El mapa público NUNCA es preciso. */
  precision: "approximate";
  /** `live_gps`: última posición aproximada del coche en marcha; `origin`: origen aproximado (el coche aún no ha salido). */
  source: "live_gps" | "origin";
  recordedAt: IsoDateTime | null;
  /** true si la posición en directo es antigua (la UI NO la muestra como «en directo»). */
  stale: boolean;
  ageSeconds: number | null;
}

export interface MapCar {
  tripId: Uuid;
  category: TripCategory;
  /** `live` solo si el viaje está en curso. */
  state: "scheduled" | "live";
  position: MapCarPosition;
  /** Plazas libres máximas en cualquier tramo («2 plazas», «1 plaza»). */
  seatsAvailable: number;
  seatsOffered: number;
  /** true si no queda ninguna plaza en ningún tramo → pin gris «Completo». */
  full: boolean;
  departureAt: IsoDateTime;
  originLabel: string | null;
  destinationLabel: string | null;
}

export interface MapCarsResponse {
  provinceId: Uuid;
  generatedAt: IsoDateTime;
  cars: MapCar[];
  /** true si había más coches que `limit`. */
  truncated: boolean;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Búsqueda (pantallas 10 y 11) — GET /v1/search/trips
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TripSearchQuery {
  provinceId: Uuid;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  /** Etiquetas elegidas por el usuario, solo para eco en `criteria` (la búsqueda se hace por coordenadas). */
  originLabel?: string;
  destLabel?: string;
  /** «Llegada al destino» HH:mm (08:30). */
  arriveBy: LocalTime;
  /** «Regreso (opcional)» HH:mm (18:00). Solo informa la disponibilidad de vuelta. */
  returnAt?: LocalTime;
  mode: SearchMode;
  /** Obligatorio si mode = one_off. */
  date?: IsoDate;
  /** CSV de días para mode = weekly: «mon,tue,wed,thu,fri». Por defecto lunes a viernes. */
  weekdays?: string;
  category?: TripCategory;
  /** Por defecto true. */
  onlyWithSeats?: boolean;
  /** Tolerancia ± sobre la hora de llegada (por defecto 20, máx. 90). */
  toleranceMinutes?: number;
  /** Radio máximo origen/destino ↔ ruta/parada (por defecto 2000 m; 200–10000). */
  radiusM?: number;
  cursor?: string;
  limit?: number;
}

export interface SearchPickupInfo {
  /** Zona/municipio mostrable públicamente («Montequinto»). */
  label: string | null;
  location: PrecisePoint;
  /** Hora local prevista a la que el coche pasa por el punto. */
  pickupAt: IsoDateTime;
  pickupAtLocal: LocalTime;
  /** Minutos desde ahora hasta la recogida; null si faltan más de 3 horas (entonces mostrar `pickupAtLocal`). */
  minutesFromNow: number | null;
  /** Distancia en línea recta desde el origen buscado hasta el punto (aprox. «1,2 km»). */
  walkDistanceM: number;
  /** Estimación a pie (distancia × 1,3 a 4,5 km/h). */
  walkMinutes: number;
  /** true si no es una parada declarada sino un punto sobre la ruta (el conductor activó «Recoger en ruta»). */
  onRoute: boolean;
  stopSeq: number | null;
}

export interface SearchDropoffInfo {
  label: string | null;
  location: PrecisePoint;
  /** «Llegada aprox. 08:28». */
  arriveAt: IsoDateTime;
  arriveAtLocal: LocalTime;
  walkDistanceM: number;
  walkMinutes: number;
  stopSeq: number;
}

export interface SearchRecurrence {
  weekdays: Weekday[];
  /** Intersección con los días pedidos. */
  matchedWeekdays: Weekday[];
  /** true si el viaje cubre todos los días pedidos. */
  fullMatch: boolean;
}

export interface SearchReturnInfo {
  available: boolean;
  /** Hora de salida de la vuelta a la altura de tu parada («18:00»); null si el conductor no ofrece vuelta. */
  departsLocal: LocalTime | null;
  /** true/false si se envió `returnAt`; null si no. */
  matchesRequested: boolean | null;
}

export interface TripSearchItem {
  /** Viaje concreto (próxima ocurrencia coincidente en rutas semanales). */
  tripId: Uuid;
  seriesId: Uuid | null;
  leg: TripLeg;
  category: TripCategory;
  driver: PublicUser;
  vehicle: VehicleSummary;
  recurrence: SearchRecurrence | null;
  /** Salida del conductor del viaje mostrado. */
  departureAt: IsoDateTime;
  /** Plazas libres mínimas en TODOS los tramos pedidos (en semanales: mínimo de las ocurrencias de los próximos 7 días). */
  seatsAvailable: number;
  seatsOffered: number;
  pickup: SearchPickupInfo;
  dropoff: SearchDropoffInfo;
  /** Tramos para solicitar sin pedir propuestas de recogida. */
  fromSegmentSeq: number;
  toSegmentSeq: number;
  /** Km de carretera entre tu recogida y tu bajada (nunca línea recta). */
  roadDistanceM: number;
  durationMinutes: number;
  /** Aportación por persona y trayecto; «Por definir» sin tarifa aprobada. */
  price: Money;
  return: SearchReturnInfo | null;
}

export interface SearchSuggestion {
  /** `widen_time`: ampliar la franja horaria; `more_days`: más días; `wider_radius`: radio mayor. */
  kind: "widen_time" | "more_days" | "wider_radius";
  /** Texto en español para la tarjeta «Sin coincidencias · Prueba a ampliar el horario o más días.». */
  message: string;
  /** Resultados que aparecerían aplicando la sugerencia. */
  wouldMatch: number;
  /** Parámetros de búsqueda a cambiar para aplicarla. */
  apply: Partial<Pick<TripSearchQuery, "toleranceMinutes" | "weekdays" | "radiusM">>;
}

export interface TripSearchPage extends Page<TripSearchItem> {
  /** Vacío si hay resultados suficientes. Alimenta la tarjeta «Sin coincidencias». */
  suggestions: SearchSuggestion[];
  criteria: {
    mode: SearchMode;
    arriveBy: LocalTime;
    toleranceMinutes: number;
    weekdays: Weekday[] | null;
    date: IsoDate | null;
    radiusM: number;
    originLabel: string | null;
    destLabel: string | null;
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Detalle del viaje (pantalla 12) — GET /v1/trips/:tripId
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TripDetailQuery {
  /** Contexto de búsqueda para marcar «Tú te subes aquí» y calcular el tramo/precio. */
  pickupLat?: number;
  pickupLng?: number;
  dropoffStopSeq?: number;
}

export interface SegmentAvailability {
  seq: number;
  fromStopSeq: number;
  toStopSeq: number;
  capacity: number;
  occupied: number;
  free: number;
  distanceM: number;
  durationMinutes: number;
}

export interface TripDetailStop {
  seq: number;
  kind: "origin" | "pickup" | "stop" | "dropoff" | "destination";
  label: string | null;
  location: PrecisePoint;
  /** Hora prevista de paso. */
  etaAt: IsoDateTime;
  etaLocal: LocalTime;
  /** Parada opcional («Dos Hermanas (opcional)»): solo se usa si alguien la pide. */
  optional: boolean;
  /** «Desvío aprox. 5 min» (solo paradas opcionales; calculado con el proveedor de rutas). */
  detourMinutes: number | null;
  /** Marca «Tú te subes aquí». */
  isYourPickup: boolean;
  isYourDropoff: boolean;
  canBoard: boolean;
  canAlight: boolean;
}

export interface TripRouteGeometry {
  type: "LineString";
  /** [lng, lat]. Simplificada (≈50 m) para dibujar; nunca para facturar. */
  coordinates: [number, number][];
  precision: CoordinatePrecision;
}

export interface TripDetailTotals {
  /** Km de carretera del tramo mostrado (24). */
  roadDistanceM: number;
  /** «Tiempo estimado» (23). */
  durationMinutes: number;
  /** «Desvío total aprox.» (5): suma de desvíos de paradas opcionales incluidas. */
  detourMinutes: number;
}

export interface TripDetail {
  id: Uuid;
  seriesId: Uuid | null;
  status: TripStatus;
  kind: TripKind;
  leg: TripLeg;
  category: TripCategory;
  provinceId: Uuid;
  /** «Provincia de Sevilla». */
  provinceName: string;
  driver: PublicUser;
  vehicle: VehicleSummary;
  departureAt: IsoDateTime;
  flexibilityMinutes: number;
  recurrence: {
    weekdays: Weekday[];
    outboundLocal: LocalTime;
    returnLocal: LocalTime | null;
  } | null;
  pickupPolicy: {
    /** «Recoger en ruta». */
    onRoute: boolean;
    maxDetourMinutes: number;
  };
  seats: {
    offered: number;
    /** Mínimo libre en el tramo del contexto (si se envió pickup/dropoff) o máximo libre en cualquier tramo. */
    available: number;
    perSegment: SegmentAvailability[];
  };
  route: {
    distanceM: number;
    durationMinutes: number;
    geometry: TripRouteGeometry;
  };
  stops: TripDetailStop[];
  totals: TripDetailTotals;
  /** «Precio por persona · Propuesta: 3,50 €» → `pending_definition` mientras no exista tarifa aprobada. */
  price: Money;
  /** true → «Ver desglose» abre POST /v1/trips/:tripId/quote. */
  breakdownAvailable: boolean;
  viewer: {
    relation: "public" | "driver" | "requester" | "passenger";
    precision: CoordinatePrecision;
    /** Solicitud abierta del usuario en este viaje (para no duplicar). */
    openRequest: { id: Uuid; status: RideRequestStatus } | null;
  };
  /** Solo si `viewer.relation = "driver"`. */
  owner: {
    pendingRequests: number;
    confirmedPassengers: PublicUser[];
  } | null;
  canRequest: boolean;
  /** Código estable si `canRequest = false`: TRIP_NOT_BOOKABLE | DRIVER_CANNOT_REQUEST_OWN_TRIP | NO_CAPACITY | OPEN_REQUEST_EXISTS | AUTH_REQUIRED. */
  cannotRequestReason: string | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. Puntos de recogida (pantalla 13) — GET /v1/trips/:tripId/pickup-points
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PickupPointsQuery {
  /** Posición del pasajero (o del lugar de partida elegido). */
  lat: number;
  lng: number;
  /** Parada de bajada (por defecto el destino del viaje). */
  dropoffStopSeq?: number;
  /** Nº de propuestas (A, B…; por defecto 2, máx. 4). */
  limit?: number;
}

export interface PickupProposal {
  /** Identificador OPACO. Se envía tal cual en `pickupPointId` al solicitar; el servidor lo revalida. */
  id: string;
  /** «A», «B»… */
  code: string;
  /** «Aparcamiento público». null si no hay geocodificador/etiqueta. */
  name: string | null;
  /** «Av. Manuel Siurot». */
  address: string | null;
  location: PrecisePoint;
  source: "driver_stop" | "route_projection";
  walk: {
    minutes: number;
    distanceM: number;
    /** Siempre true: línea recta × 1,3; no hay enrutado peatonal. */
    estimated: true;
  };
  detour: {
    minutes: number;
    /** `stop`: parada declarada; `estimate`: estimación; `routed`: calculado con el proveedor. */
    source: "stop" | "estimate" | "routed";
  };
  /** Tramo en el que se sube (capacidad). */
  fromSegmentSeq: number;
  boardsAt: IsoDateTime;
  boardsAtLocal: LocalTime;
  /** «A 6 km de tu destino» (carretera). */
  distanceToDropoffM: number;
  recommended: boolean;
}

export interface PickupPointsResponse {
  tripId: Uuid;
  origin: GeoPoint;
  dropoff: { stopSeq: number; label: string | null; location: PrecisePoint };
  proposals: PickupProposal[];
  /** Aviso fijo del diseño: «Comprueba que el punto permite una parada segura y legal.». */
  safetyNotice: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 6. Presupuesto / aportación (pantallas 12 «Ver desglose», 15, 16)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TripQuote {
  /** `defined` solo si hay tarifa APROBADA y todos sus componentes están definidos; si no `pending_definition`. */
  state: "pending_definition" | "defined";
  tariff: { state: "none_approved" | "approved"; version: number | null };
  basis: {
    /** Km de carretera del tramo del pasajero. */
    roadDistanceM: number;
    rateMicrosPerKm: number | null;
  };
  /** «Aportación según recorrido» por trayecto (una pierna). */
  contribution: Money;
  /** «Gestión MVC» por trayecto (comisión de pasajero); «Por definir» si no está aprobada. */
  managementFee: Money;
  /** «Total antes de confirmar» por trayecto. */
  total: Money;
  /** Reserva semanal (pantallas 14/15/16b): «5 días, ida y vuelta · 18,00 €/semana». */
  weekly: {
    weekdays: Weekday[];
    legsPerDay: 1 | 2;
    tripsPerWeek: number;
    contributionPerWeek: Money;
    totalPerWeek: Money;
  } | null;
  /** Momento en que se fijó el importe a la solicitud (quote_snapshots); null si es un cálculo en vivo. */
  lockedAt: IsoDateTime | null;
}

/** POST /v1/trips/:tripId/quote — «Revisa tu solicitud» y «Ver desglose». No crea nada. */
export interface TripQuoteRequest {
  pickupPointId?: string;
  fromSegmentSeq?: number;
  toSegmentSeq?: number;
  dropoffStopSeq?: number;
}
export interface TripQuoteResponse {
  tripId: Uuid;
  quote: TripQuote;
  pickup: RequestPoint;
  dropoff: RequestPoint;
  seatsAvailable: number;
  /** «Distancia estimada (ida) 6 km». */
  roadDistanceM: number;
  canRequest: boolean;
  cannotRequestReason: string | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 7. Solicitudes (pantallas 15, 16, 20)
 * ──────────────────────────────────────────────────────────────────────────── */

/** POST /v1/trips/:tripId/requests  (cabecera Idempotency-Key). Exactamente UNA de: pickupPointId | fromSegmentSeq+toSegmentSeq. */
export interface CreateRideRequestBody {
  pickupPointId?: string;
  /** Parada de bajada (por defecto el destino). Solo con pickupPointId. */
  dropoffStopSeq?: number;
  /** Heredado (0.14). */
  fromSegmentSeq?: number;
  toSegmentSeq?: number;
  /** Mensaje opcional para el conductor (≤ 300). */
  message?: string;
}

export interface RequestPoint {
  label: string | null;
  address: string | null;
  location: PrecisePoint;
  atLocal: LocalTime;
  at: IsoDateTime;
  walkMinutes: number | null;
  detourMinutes: number | null;
}

export type RequestStepKey = "requested" | "accepted" | "payment" | "confirmed";
export interface RequestStepper {
  /** Solicitud → Aceptada → Pago → Confirmada. */
  steps: { key: RequestStepKey; state: "done" | "current" | "pending" | "failed" }[];
  current: RequestStepKey;
  /** Estado final no feliz (no hay más pasos). */
  terminal: "rejected" | "expired" | "cancelled" | "payment_late" | null;
}

export interface RequestNextAction {
  /** `pay` → abrir el flujo de pago (módulo money). */
  kind: "wait_for_driver" | "pay" | "view_booking" | "search_again" | "none";
  /** Límite de la acción (fin del hold para `pay`). */
  deadlineAt: IsoDateTime | null;
}

export interface RequestHold {
  expiresAt: IsoDateTime;
  /** Segundos restantes calculados por el servidor (cuenta atrás 14:52). 0 si expiró. */
  remainingSeconds: number;
  active: boolean;
}

export interface RideRequestDetail {
  id: Uuid;
  status: RideRequestStatus;
  trip: {
    id: Uuid;
    leg: TripLeg;
    category: TripCategory;
    departureAt: IsoDateTime;
    originLabel: string | null;
    destinationLabel: string | null;
    driver: PublicUser;
    vehicle: VehicleSummary;
  };
  /** Visible para el conductor y el propio pasajero. */
  passenger: PublicUser;
  pickup: RequestPoint | null;
  dropoff: RequestPoint | null;
  fromSegmentSeq: number;
  toSegmentSeq: number;
  roadDistanceM: number | null;
  message: string | null;
  stepper: RequestStepper;
  hold: RequestHold | null;
  quote: TripQuote;
  nextAction: RequestNextAction;
  booking: { id: Uuid; status: TripBookingStatus; amount: Money } | null;
  weekly: { reservationId: Uuid; occurrenceDate: IsoDate; leg: TripLeg } | null;
  requestedAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** POST /v1/ride-requests/:requestId/withdraw → RideRequestDetail con status = "cancelled". Solo estado `pending`. */
export type WithdrawRideRequestResponse = RideRequestDetail;

/** POST /v1/ride-requests/:requestId/decision  y  POST /v1/weekly-reservations/:id/decision */
export interface DecideRequestBody {
  decision: "accept" | "reject";
}
export interface DecideRequestResponse {
  id: Uuid;
  kind: "single" | "weekly";
  status: RideRequestStatus;
  /** Aceptación: hold creado (la aceptación NO es una reserva confirmada). */
  hold: { id: Uuid | null; expiresAt: IsoDateTime } | null;
  /** Solicitudes afectadas (1 en single; N ocurrencias en weekly). */
  requestIds: Uuid[];
}

export interface DriverRequestsQuery {
  status?: "pending" | "open" | "all";
  tripId?: Uuid;
  cursor?: string;
  limit?: number;
}

export interface DriverRequestOccupancy {
  /** «1 / 3 plazas» = plazas ocupadas (sin contar esta solicitud) en el tramo más cargado / capacidad. */
  occupiedSeats: number;
  totalSeats: number;
  /** Para dibujar los puntos del tramo (pantalla 20). */
  perSegment: { seq: number; fromLabel: string | null; toLabel: string | null; occupied: number; capacity: number; inRequestedRange: boolean }[];
}

export interface DriverRequestItem {
  /** single → id de la solicitud; weekly → id de la reserva semanal. */
  id: Uuid;
  kind: "single" | "weekly";
  status: RideRequestStatus;
  passenger: PublicUser;
  tripId: Uuid;
  leg: TripLeg;
  category: TripCategory;
  departureAt: IsoDateTime;
  /** «Mairena del Aljarafe · 07:17». */
  from: { label: string | null; at: IsoDateTime; atLocal: LocalTime };
  /** «Sevilla (Trabajo) · 07:25». */
  to: { label: string | null; at: IsoDateTime; atLocal: LocalTime };
  /** «Desvío estimado +2 min». */
  detourMinutes: number | null;
  occupancy: DriverRequestOccupancy;
  message: string | null;
  weekly: { weekdays: Weekday[]; legs: TripLeg[]; occurrences: number; startDate: IsoDate } | null;
  canAccept: boolean;
  /** NO_CAPACITY_ON_SEGMENT | TRIP_NOT_BOOKABLE | null. */
  blockedReason: string | null;
  requestedAt: IsoDateTime;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 8. Reserva semanal (pantalla 14)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Cuerpo común de POST /v1/trips/:tripId/weekly-requests/preview y POST /v1/trips/:tripId/weekly-requests. */
export interface WeeklyRequestBody {
  pickupPointId: string;
  /** Parada de bajada de la ida (por defecto destino). La vuelta usa el tramo simétrico. */
  dropoffStopSeq?: number;
  weekdays: Weekday[];
  /** Por defecto ["outbound"]. «return» exige que el conductor ofrezca vuelta. */
  legs?: TripLeg[];
  /** Lunes de inicio o primer día de servicio («Inicio de la reserva»). */
  startDate: IsoDate;
  /** Semanas a reservar (1–4, por defecto 1). */
  weeks?: number;
  /** «Fechas con excepciones»: vacaciones, festivos… */
  exceptionDates?: IsoDate[];
  /** Versión de política de cancelación aceptada (la publica el módulo money). null = no hay política aprobada. */
  cancellationPolicyVersion?: string | null;
  /** Si true, las ocurrencias sin plaza se omiten y se informan; si false (defecto) basta una sin plaza para rechazar todo. */
  allowPartial?: boolean;
  message?: string;
}

export type WeeklyOccurrenceState =
  | "available"
  | "requested"
  | "skipped_exception"
  | "skipped_full"
  | "skipped_past"
  | "skipped_no_occurrence";

export interface WeeklyOccurrence {
  date: IsoDate;
  weekday: Weekday;
  leg: TripLeg;
  tripId: Uuid | null;
  /** Hora local a la que te recoge / te deja. */
  boardsAtLocal: LocalTime | null;
  arrivesAtLocal: LocalTime | null;
  state: WeeklyOccurrenceState;
  seatsAvailable: number | null;
  /** Solicitud creada (solo tras POST). */
  requestId: Uuid | null;
  requestStatus: RideRequestStatus | null;
}

export interface WeeklyLegSummary {
  leg: TripLeg;
  /** «Ida (mañana)» / «Vuelta (tarde)». */
  label: string;
  fromLabel: string | null;
  toLabel: string | null;
  boardsAtLocal: LocalTime;
  arrivesAtLocal: LocalTime;
}

export interface WeeklyRequestPreview {
  tripId: Uuid;
  seriesId: Uuid;
  legs: WeeklyLegSummary[];
  occurrences: WeeklyOccurrence[];
  quote: TripQuote;
  /** Hay al menos una ocurrencia solicitable y (si !allowPartial) ninguna sin plaza. */
  canSubmit: boolean;
  issues: { code: string; message: string; date: IsoDate | null }[];
}

export interface WeeklyReservation {
  id: Uuid;
  seriesId: Uuid;
  /** Estado agregado de las ocurrencias abiertas. */
  status: "pending" | "payment_pending" | "confirmed" | "partially_confirmed" | "rejected" | "cancelled" | "expired";
  passenger: PublicUser;
  driver: PublicUser;
  category: TripCategory;
  weekdays: Weekday[];
  legs: WeeklyLegSummary[];
  startDate: IsoDate;
  weeks: number;
  exceptionDates: IsoDate[];
  cancellationPolicyVersion: string | null;
  /**
   * Una por solicitud creada. Solo en la respuesta del POST con `allowPartial` se añaden además los días omitidos por
   * falta de plaza (`state: "skipped_full"`); las lecturas posteriores solo listan las solicitudes.
   */
  occurrences: WeeklyOccurrence[];
  /** Menor expiración de los holds activos (cuenta atrás del pago semanal). */
  hold: RequestHold | null;
  quote: TripQuote;
  nextAction: RequestNextAction;
  createdAt: IsoDateTime;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 9. Lado conductor (pantallas 17, 18, 19)
 * ──────────────────────────────────────────────────────────────────────────── */

export type ReadinessKey =
  | "public_photo"
  | "identity"
  | "vehicle"
  | "vehicle_documents"
  | "vehicle_photo"
  | "insurance"
  | "driver_license";

export interface ReadinessItem {
  key: ReadinessKey;
  /** «Permiso de conducir», «Seguro (uso particular)»… */
  label: string;
  state: "approved" | "in_review" | "missing" | "rejected" | "expired";
  /** Si bloquea publicar. El permiso de conducir es informativo hasta que la política lo exija. */
  blocking: boolean;
  /** «Documento subido». */
  detail: string | null;
  /** Fecha de caducidad (seguro). */
  expiresOn: IsoDate | null;
}

/** GET /v1/me/driver/readiness */
export interface DriverReadiness {
  canPublish: boolean;
  vehicle: {
    id: Uuid;
    displayName: string;
    plate: string;
    color: string | null;
    passengerSeats: number;
  } | null;
  items: ReadinessItem[];
  /** Códigos de los elementos bloqueantes pendientes. */
  blockers: ReadinessKey[];
}

export interface RoutePlaceInput {
  lat: number;
  lng: number;
  /** Texto mostrado a los pasajeros («Palomares del Río»). Público: no usar el domicilio exacto. */
  label?: string;
  /** Solo paradas intermedias: «opcional» (solo se usa si alguien la pide). */
  optional?: boolean;
}

/** POST /v1/me/routes/plan — «Calcular ruta» y cada edición/reordenación de paradas (pantalla 19). Sin efectos. */
export interface RoutePlanBody {
  provinceId: Uuid;
  origin: RoutePlaceInput;
  destination: RoutePlaceInput;
  /** Paradas intermedias en orden. Reordenar = reenviar la lista. */
  stops?: RoutePlaceInput[];
  /** Hora de salida del origen (para estimar las horas de paso). */
  departureLocal?: LocalTime;
}

export interface RoutePlaceSuggestion {
  label: string;
  location: GeoPoint;
}

export interface PlannedStop {
  index: number;
  kind: "origin" | "stop" | "destination";
  label: string | null;
  location: GeoPoint;
  optional: boolean;
  inProvince: boolean;
  /** `ok` | `outside_province` («Huelva (sugerida) · Fuera de provincia»). */
  verdict: "ok" | "outside_province";
  /** «Esta parada no está en la provincia de Sevilla.» */
  message: string | null;
  etaLocal: LocalTime | null;
  /** Minutos desde la salida. */
  offsetMinutes: number | null;
  /** Desvío de paradas opcionales. */
  detourMinutes: number | null;
  /** Alternativas dentro de la provincia (vacío si no hay geocodificador configurado). */
  alternatives: RoutePlaceSuggestion[];
}

export interface PlanIssue {
  code:
    | "STOP_OUTSIDE_PROVINCE"
    | "ROUTE_LEAVES_PROVINCE"
    | "MAPS_PROVIDER_UNAVAILABLE"
    | "ROUTE_PROVIDER_ERROR"
    | "TOO_MANY_STOPS";
  severity: "error" | "warning";
  stopIndex: number | null;
  message: string;
}

export interface PlannedRoute {
  distanceM: number;
  durationMinutes: number;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  provider: string;
  providerRef: string;
}

export interface RoutePlanResponse {
  provinceId: Uuid;
  provinceName: string;
  /** Habilita «Guardar ruta». */
  canSave: boolean;
  /** «Toda la ruta está dentro de la provincia de Sevilla.»; null si hay problemas. */
  headline: string | null;
  /** «Corrige los puntos fuera de la provincia para guardar.»; null si se puede guardar. */
  blockingMessage: string | null;
  issues: PlanIssue[];
  stops: PlannedStop[];
  /** null si algún punto está fuera de provincia o falta proveedor de rutas. */
  route: PlannedRoute | null;
  computedAt: IsoDateTime;
}

/** POST /v1/me/routes — «Guardar ruta» (cabecera Idempotency-Key). Recalcula todo en el servidor. */
export interface PublishRouteBody {
  vehicleId: Uuid;
  provinceId: Uuid;
  category: TripCategory;
  origin: RoutePlaceInput;
  destination: RoutePlaceInput;
  stops?: RoutePlaceInput[];
  frequency: PublishFrequency;
  /** Salida del origen hacia el destino («Ida (hacia Sevilla) 07:00»). */
  outboundLocal: LocalTime;
  /** Salida desde el destino de vuelta («Vuelta (desde Sevilla) 15:00»). Opcional. */
  returnLocal?: LocalTime | null;
  /** one_off: día del viaje. daily_workdays: primer día (por defecto hoy o el siguiente laborable). */
  startDate?: IsoDate;
  /** daily_workdays: último día (opcional; sin fin = serie abierta). */
  endDate?: IsoDate | null;
  /** Por defecto lunes–viernes. */
  weekdays?: Weekday[];
  seats: number;
  /** «Máx. desvío por parada 5 min». */
  maxDetourMinutes: number;
  /** «Recoger en ruta». */
  pickupOnRoute: boolean;
  flexibilityMinutes?: number;
}

export interface PublishedTripRef {
  id: Uuid;
  leg: TripLeg;
  departureAt: IsoDateTime;
  status: TripStatus;
}

export interface PublishRouteResponse {
  /** null en viajes puntuales. */
  seriesId: Uuid | null;
  frequency: PublishFrequency;
  /** Viajes creados (primeras ocurrencias). */
  trips: PublishedTripRef[];
  occurrencesCreated: number;
  /** Último día materializado de una serie (el servidor lo amplía periódicamente). */
  horizonUntil: IsoDate | null;
  route: PlannedRoute;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 10. Mis viajes (pantalla 30) — GET /v1/me/trips/overview
 * ──────────────────────────────────────────────────────────────────────────── */

export interface OverviewQuery {
  role: "passenger" | "driver";
  /** `all` (por defecto) devuelve próximos + en curso + 1.ª página de historial. */
  section?: "all" | "upcoming" | "in_progress" | "history";
  cursor?: string;
  limit?: number;
}

export interface OverviewStatus {
  code: "confirmed" | "pending" | "payment_pending" | "scheduled" | "live" | "completed" | "cancelled" | "no_show" | "rejected" | "expired";
  /** «Confirmada». */
  label: string;
}

export interface OverviewEndpoint {
  label: string | null;
  timeLocal: LocalTime;
}

export interface OverviewCardBase {
  category: TripCategory;
  /** «Universidad», «Campus – U. Pablo de Olavide». */
  title: string;
  from: OverviewEndpoint;
  to: OverviewEndpoint;
  /** Otros participantes confirmados (avatares). Solo se muestran a quien participa. */
  riders: PublicUser[];
  /** «3/4 plazas». */
  occupancy: { occupied: number; total: number } | null;
  status: OverviewStatus;
}

export interface WeeklyReservationCard extends OverviewCardBase {
  kind: "weekly_reservation";
  /** reservationId (pasajero) o seriesId (conductor). */
  id: Uuid;
  seriesId: Uuid;
  reservationId: Uuid | null;
  recurrence: { weekdays: Weekday[]; recurring: true; label: string };
}

export interface TripOverviewCard extends OverviewCardBase {
  kind: "trip";
  /** requestId (pasajero) o tripId (conductor). */
  id: Uuid;
  tripId: Uuid;
  requestId: Uuid | null;
  bookingId: Uuid | null;
  role: "passenger" | "driver";
  leg: TripLeg;
  departureAt: IsoDateTime;
  /** «En 12 min» (null si faltan más de 3 h o ya salió). */
  startsInMinutes: number | null;
  phase: "scheduled" | "live" | "finished";
  /** «El conductor llegará en unos 10 min». Calculado desde la posición en directo; null si no hay posición fiable. */
  liveEta: {
    minutes: number;
    phrase: string;
    stale: boolean;
  } | null;
}

export type OverviewCard = WeeklyReservationCard | TripOverviewCard;

export interface TripsOverview {
  role: "passenger" | "driver";
  generatedAt: IsoDateTime;
  /** «Próximos (2) · En curso (1) · Historial». */
  counts: { upcoming: number; inProgress: number; history: number };
  upcoming: OverviewCard[];
  inProgress: OverviewCard[];
  history: Page<OverviewCard>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 11. Favoritos y rutina (pantalla 31)
 * ──────────────────────────────────────────────────────────────────────────── */

export type FavoriteKind = "work" | "campus" | "home" | "other";

export interface FavoritePlace {
  id: Uuid;
  kind: FavoriteKind;
  /** «Trabajo», «Campus», «Casa». */
  name: string;
  /** «Torre Sevilla, Sevilla». */
  address: string;
  location: GeoPoint;
  provinceId: Uuid | null;
  createdAt: IsoDateTime;
}

/** POST /v1/me/favorites */
export interface CreateFavoriteBody {
  kind: FavoriteKind;
  name: string;
  address: string;
  lat: number;
  lng: number;
}
/** PATCH /v1/me/favorites/:favoriteId (al menos un campo). */
export type UpdateFavoriteBody = Partial<CreateFavoriteBody>;

export interface FavoritesResponse extends Page<FavoritePlace> {}

export interface RoutineEntry {
  id: Uuid;
  weekday: Weekday;
  time: LocalTime;
  fromPlace: Pick<FavoritePlace, "id" | "kind" | "name">;
  toPlace: Pick<FavoritePlace, "id" | "kind" | "name">;
  enabled: boolean;
}

export interface CreateRoutineEntryBody {
  /** Crea una fila por día. */
  weekdays: Weekday[];
  time: LocalTime;
  fromPlaceId: Uuid;
  toPlaceId: Uuid;
  enabled?: boolean;
}
export interface UpdateRoutineEntryBody {
  time?: LocalTime;
  fromPlaceId?: Uuid;
  toPlaceId?: Uuid;
  enabled?: boolean;
}

export interface WeeklySeatOffer {
  enabled: boolean;
  /** «Ofrezco 1 plaza de lunes a viernes». */
  seats: number;
  weekdays: Weekday[];
  /** «Condiciones y precio: Propuesta» → sin tarifa aprobada el precio es `pending_definition`. */
  conditions: { label: "Propuesta"; price: Money };
  /** Cuerpo para abrir «Publica tu ruta» ya relleno desde la rutina (null si no hay rutina). */
  prefill: Pick<PublishRouteBody, "frequency" | "outboundLocal" | "weekdays" | "seats"> & {
    origin: { lat: number; lng: number; label: string };
    destination: { lat: number; lng: number; label: string };
  } | null;
}
/** PUT /v1/me/routine/weekly-offer */
export interface UpdateWeeklySeatOfferBody {
  enabled: boolean;
  seats: number;
}

export interface RoutineSuspension {
  /** Lunes de la semana suspendida. */
  weekStart: IsoDate;
  weekEnd: IsoDate;
}

/** GET /v1/me/routine */
export interface RoutineResponse {
  places: FavoritePlace[];
  entries: RoutineEntry[];
  suspensions: RoutineSuspension[];
  /** «Suspender próxima semana». */
  nextWeek: { weekStart: IsoDate; weekEnd: IsoDate; suspended: boolean };
  weeklyOffer: WeeklySeatOffer;
}

/** POST /v1/me/routine/suspensions — por defecto la próxima semana. */
export interface CreateRoutineSuspensionBody {
  weekStart?: IsoDate;
}

/**
 * Respuesta de POST /v1/me/routine/suspensions (201 al crearla, 200 si ya existía).
 * Efecto real: se retiran las solicitudes semanales aún `pending` de esa semana (`withdrawnRequests`); las aceptadas o
 * confirmadas no se tocan (`keptRequests`): su cancelación sigue la política del módulo money.
 */
export interface CreateRoutineSuspensionResponse extends RoutineSuspension {
  withdrawnRequests: number;
  keptRequests: number;
}

/** POST /v1/me/routine/entries → 201 */
export interface RoutineEntriesResponse {
  items: RoutineEntry[];
}
