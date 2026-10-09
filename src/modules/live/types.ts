/**
 * Formas de cable del módulo «live» (espejo EXACTO de mobile/src/api/types/live.ts).
 * No editar el cuerpo a mano: cambia primero el contrato móvil y copia el cuerpo (tests/unit/live-contract-sync.test.ts lo vigila).
 */
import type { MoneyDto as Money, PublicUserDto as PublicUser } from "../../lib/dto.js";

export type Uuid = string;
export type IsoDateTime = string;
export interface GeoPoint {
  lat: number;
  lng: number;
}

// @@CONTRACT-BODY@@

/* ───────────────────────────── Piezas comunes ───────────────────────────── */

export type LiveTripStatus = "published" | "active" | "completed" | "cancelled";
export type LiveBookingStatus = "confirmed" | "completed" | "no_show" | "cancelled" | "driver_cancelled";

/**
 * Fase de la reserva desde el punto de vista del pasajero.
 *  scheduled        viaje publicado, aún no iniciado
 *  driver_en_route  viaje activo, conductor de camino (llegada > umbral de aviso)
 *  arriving         llegada en ≤ `arrival.warningThresholdSeconds` (≈ 5 min) con señal en vivo
 *  at_pickup        el coche está en el punto de recogida (≤ ~100 m) con señal en vivo, aún sin verificar el código
 *  in_vehicle       recogida verificada con el código; viaje activo
 *  completed        viaje terminado (reserva completed / no_show)
 *  cancelled        reserva o viaje cancelados
 */
export type LivePhase =
  | "scheduled"
  | "driver_en_route"
  | "arriving"
  | "at_pickup"
  | "in_vehicle"
  | "completed"
  | "cancelled";

/** live = posición reciente; stale = última posición conocida pero vieja («Sin señal · Última posición: hace 2 min»); none = nunca hubo posición. */
export type LiveSignal = "live" | "stale" | "none";

export interface LiveVehicle {
  make: string;
  model: string;
  /** Color en texto libre («Blanco»); null si el conductor no lo ha indicado. */
  color: string | null;
  /** Matrícula. SOLO se envía a participantes autorizados (nunca en el enlace compartido salvo opt-in). */
  plate: string;
}

export interface LiveStop {
  /** Posición de la parada dentro del viaje (0 = origen). Cambia si se aplica un cambio de ruta. */
  seq: number;
  /** Nombre legible («C. Luis Montoto»); null si la parada aún no tiene etiqueta (la app muestra «Parada n»). */
  label: string | null;
  location: GeoPoint;
}

export interface LiveEta {
  /** Instante estimado de llegada. */
  at: IsoDateTime;
  /** Minutos enteros desde `serverTime` hasta `at` (mínimo 0). «Llegada en unos 8 min». */
  minutes: number;
  /**
   * Distancia restante por la ruta por carretera (m); «2,4 km». null si no puede calcularse y SIEMPRE null cuando revelaría la posición exacta del coche:
   * conductor con «Compartir ubicación en viaje» desactivado (`position.precision:"approximate"`) y vista pública del enlace compartido.
   * La UI debe poder pintar el ETA solo con `minutes`.
   */
  distanceM: number | null;
  /**
   * live_route: posición viva proyectada sobre la ruta por carretera guardada.
   * schedule: hora prevista del viaje (sin posición viva). El tráfico real requiere proveedor de rutas (Bloqueado).
   */
  source: "live_route" | "schedule";
  /** true si la señal está obsoleta, el coche está fuera de ruta o la fuente es la planificación. */
  approximate: boolean;
}

export interface LivePosition {
  location: GeoPoint;
  /** null si la posición es aproximada. */
  headingDegrees: number | null;
  /** null si la posición es aproximada. */
  speedMps: number | null;
  /** Radio de incertidumbre en metros: el del GPS si `precision:"precise"`; 1000 si es aproximada. */
  accuracyM: number | null;
  /** Marca temporal del GPS del conductor. */
  recordedAt: IsoDateTime;
  receivedAt: IsoDateTime;
  /** Edad respecto a `serverTime`. «Última actualización: hace 5 s». */
  ageSeconds: number;
  /** true si `ageSeconds` supera `staleAfterSeconds`: la UI NO puede llamarla «en directo». */
  stale: boolean;
  /**
   * precise: GPS del conductor. approximate: el conductor tiene desactivado «Compartir ubicación en viaje» (Ajustes, `comms`):
   * `location` está en una cuadrícula de ~1 km y no hay rumbo ni velocidad. La UI dibuja una ZONA (círculo de radio `accuracyM`),
   * no un coche que se mueve, y no inventa trayectoria. El ETA y la distancia restante siguen siendo los de la ruta.
   */
  precision: "precise" | "approximate";
}

export interface LiveArrival {
  /** true si faltan ≤ `warningThresholdSeconds` para la recogida y la señal es viva. */
  warning: boolean;
  /** true si el coche está en el punto de recogida (≤ ~100 m) con señal viva. */
  arrived: boolean;
  warningThresholdSeconds: number;
}

export interface LiveChatRef {
  /** Con quién chatear: el conductor. El chat existente es POST/GET /v1/trips/{tripId}/chat/{peerUserId}/messages. */
  peerUserId: Uuid;
  /** false si hay bloqueo entre ambos o la reserva ya no está activa. */
  available: boolean;
}

export interface LivePendingRouteChange {
  proposalId: Uuid;
  expiresAt: IsoDateTime | null;
  /** true si la propuesta requiere MI aceptación y aún no he decidido. */
  awaitingMyDecision: boolean;
}

/* ─────────────── 21 · Esperando el coche — GET /v1/bookings/{bookingId}/live ─────────────── */

export interface LiveBookingStatusView {
  bookingId: Uuid;
  tripId: Uuid;
  phase: LivePhase;
  tripStatus: LiveTripStatus;
  bookingStatus: LiveBookingStatus;
  serverTime: IsoDateTime;
  driver: PublicUser;
  vehicle: LiveVehicle;
  /** Punto de recogida del pasajero («Tu recogida · C. Luis Montoto»). `plannedAt` = hora prevista por la planificación. */
  pickup: LiveStop & { plannedAt: IsoDateTime | null };
  dropoff: LiveStop & { plannedAt: IsoDateTime | null };
  /** A qué se refiere `eta`: la recogida antes de subir, el destino después. */
  etaTarget: "pickup" | "dropoff";
  eta: LiveEta | null;
  signal: LiveSignal;
  /** = position.recordedAt; null si no hay posición. */
  lastUpdateAt: IsoDateTime | null;
  lastUpdateAgeSeconds: number | null;
  /** Umbral de obsolescencia usado (por defecto 60 s). */
  staleAfterSeconds: number;
  /**
   * Posición del coche (solo aquí, por ser pasajero autorizado). null si el viaje no está activo o no hay GPS. Puede venir con stale=true.
   * Es precisa salvo que el conductor haya desactivado «Compartir ubicación en viaje»: entonces `position.precision` = "approximate".
   */
  position: LivePosition | null;
  arrival: LiveArrival;
  chat: LiveChatRef;
  /** Propuesta de cambio de ruta pendiente que me afecta (pantalla 22). */
  pendingRouteChange: LivePendingRouteChange | null;
}

/* ─────────────── 23 · En el coche — GET /v1/bookings/{bookingId}/in-car ─────────────── */

/**
 * not_generated: el pasajero aún no ha generado código; active: generado y sin verificar;
 * verified: el conductor lo verificó (recogida hecha); locked: intentos agotados (hay que generar uno nuevo).
 */
export type LivePickupCodeStatus = "not_generated" | "active" | "verified" | "locked";

export interface LivePickupCodeState {
  status: LivePickupCodeStatus;
  /** Nº de dígitos del código del servidor (hoy 6; la lámina muestra 4 casillas: la app dibuja `codeLength`). */
  codeLength: number;
  generatedAt: IsoDateTime | null;
  verifiedAt: IsoDateTime | null;
  attemptsRemaining: number | null;
}

export interface LiveOccupant {
  role: "driver" | "passenger";
  isYou: boolean;
  /** null = copasajero que NO comparte su perfil (se pinta «1 pasajero»). El conductor y tú siempre vienen con datos. */
  user: PublicUser | null;
}

export interface LiveOccupancy {
  /** Pasajeros (tú incluido) en el tramo más ocupado de TU trayecto: «2 de 3 plazas ocupadas». */
  occupied: number;
  capacity: number;
  members: LiveOccupant[];
}

export type LiveTimelineState = "done" | "current" | "next";
export type LiveTimelineRole = "pickup" | "stop" | "dropoff";

export interface LiveTimelineStop extends LiveStop {
  role: LiveTimelineRole;
  /** Hora estimada en la parada (en vivo si hay posición, si no la planificada). */
  eta: IsoDateTime;
  state: LiveTimelineState;
}

export interface LiveInCarState {
  bookingId: Uuid;
  tripId: Uuid;
  phase: LivePhase;
  tripStatus: LiveTripStatus;
  serverTime: IsoDateTime;
  driver: PublicUser;
  vehicle: LiveVehicle;
  /**
   * Estado del código de recogida. El código en claro NO se puede recuperar (solo se guarda su hash): se obtiene al
   * generarlo con POST /v1/bookings/{bookingId}/pickup-code (genera uno nuevo e invalida el anterior).
   */
  pickupCode: LivePickupCodeState;
  occupancy: LiveOccupancy;
  /** «Tu trayecto»: de TU recogida a TU destino, con paradas intermedias. */
  timeline: LiveTimelineStop[];
  /** ETA al destino del pasajero («Llegada estimada 08:20»). */
  etaAtDestination: LiveEta | null;
  /** «Faltan 15 min · 6,8 km» (hasta el destino). `distanceM` es null si el conductor no comparte su ubicación precisa (ver `LiveEta.distanceM`). */
  remaining: { minutes: number; distanceM: number | null } | null;
  signal: LiveSignal;
  lastUpdateAt: IsoDateTime | null;
  /** Estado del botón «Compartir viaje (privado)». */
  share: { active: boolean; expiresAt: IsoDateTime | null };
  chat: LiveChatRef;
  pendingRouteChange: LivePendingRouteChange | null;
}

/* ─────────────── 24 · Viaje terminado — GET /v1/bookings/{bookingId}/summary ─────────────── */

export interface LiveRating {
  id: Uuid;
  tripId: Uuid;
  raterUserId: Uuid;
  rateeUserId: Uuid;
  /** 1..5 */
  stars: number;
  comment: string | null;
  createdAt: IsoDateTime;
}

export type LiveRatingBlockReason =
  | "trip_not_completed"
  | "booking_not_completed"
  | "already_rated"
  | "window_closed";

export interface LiveBookingSummary {
  bookingId: Uuid;
  tripId: Uuid;
  tripStatus: LiveTripStatus;
  bookingStatus: LiveBookingStatus;
  /** «Has llegado»: true si el pasajero hizo el trayecto y el viaje terminó. */
  arrived: boolean;
  /** Origen/destino del TRAYECTO DEL PASAJERO con su hora (real si existe, si no la planificada). */
  pickup: LiveStop & { at: IsoDateTime | null };
  dropoff: LiveStop & { at: IsoDateTime | null };
  /** Polilínea simplificada del trayecto del pasajero para el mapa de la lámina. */
  path: GeoPoint[];
  /** «Duración del trayecto 55 min». actual = de la recogida verificada al fin de viaje; planned = suma de tramos de la ruta. */
  duration: { seconds: number; source: "actual" | "planned" };
  /** «Distancia 12,6 km»: distancia por carretera de los tramos planificados del pasajero (no es una traza GPS medida). */
  distance: { meters: number; basis: "planned_road_route" };
  /** «Pasajeros 2 de 3». */
  passengers: { count: number; capacity: number };
  driver: PublicUser;
  /** «Con Ana · Seat León · 1234 LBC» (la matrícula solo llega aquí por ser participante). */
  vehicle: LiveVehicle;
  /**
   * «Pago pendiente (por definir)». pending_definition mientras no haya pago confirmado por el servidor; confirmed si la reserva
   * tiene un pago del proveedor registrado (importe real). El estado de cobro detallado vive en `money`.
   */
  payment: { status: "pending_definition" | "confirmed"; amount: Money };
  /** «Valora tu viaje (opcional)». El pasajero valora al conductor. */
  rating: {
    canRate: boolean;
    reason: LiveRatingBlockReason | null;
    /** A quién se valora (el conductor). */
    rateeUserId: Uuid;
    windowEndsAt: IsoDateTime | null;
    mine: LiveRating | null;
  };
  /** «Reportar incidencia»: siempre disponible para un participante. */
  incidents: { canReport: boolean; mineCount: number };
}

/* ─────────────── Cambio de ruta (22) ─────────────── */

export type LiveRouteChangeStatus = "pending" | "accepted" | "rejected" | "expired" | "cancelled";
export type LiveRouteChangeResolution =
  | "auto_applied"
  | "all_accepted"
  | "rejected_by_passenger"
  | "expired"
  | "cancelled_by_driver"
  | "capacity_lost"
  | "superseded";
export type LiveDecision = "accepted" | "rejected";

export interface LiveRouteChangeScheduleImpact {
  /** Hora estimada ANTES de la propuesta («Antes · Llegada estimada 08:00»). */
  beforeAt: IsoDateTime | null;
  /** Hora estimada DESPUÉS («Ahora · Llegada estimada 08:05»). */
  afterAt: IsoDateTime | null;
  /** «+5 min de trayecto» = 300. */
  deltaSeconds: number;
  /** Cambio material de horario: exige aceptación. */
  material: boolean;
}

export interface LiveRouteChangePriceImpact {
  before: Money;
  after: Money;
  /** Diferencia objetiva por kilómetros; `pending_definition` mientras no haya tarifa aprobada. Nunca incluye recargos por molestias. */
  delta: Money;
  changed: boolean;
  /** Cambio material de precio: exige aceptación. */
  material: boolean;
}

export interface LiveRouteChangeImpact {
  pickup: LiveRouteChangeScheduleImpact;
  dropoff: LiveRouteChangeScheduleImpact;
  price: LiveRouteChangePriceImpact;
  /** true si el cambio es material para este pasajero (debe aceptar antes de aplicarse). */
  requiresAcceptance: boolean;
}

export interface LiveRouteChangeCounts {
  /** Pasajeros que deben aceptar. */
  required: number;
  accepted: number;
  rejected: number;
  pending: number;
}

export interface LiveRouteChangeParticipantRow {
  bookingId: Uuid;
  passenger: PublicUser;
  requiresAcceptance: boolean;
  decision: LiveDecision | null;
  deltaSeconds: number;
  priceDelta: Money;
}

export interface LiveRouteChange {
  id: Uuid;
  tripId: Uuid;
  kind: "new_stop";
  status: LiveRouteChangeStatus;
  resolution: LiveRouteChangeResolution | null;
  /** true si ningún pasajero requería aceptación y se aplicó al crearla (se avisó a los afectados). */
  autoApplied: boolean;
  /** Desde quién se mira: el conductor ve `participants`; el pasajero ve `myImpact`. */
  role: "driver" | "passenger";
  createdAt: IsoDateTime;
  /** Caducidad de la propuesta pendiente (los cambios materiales no se aplican sin respuesta a tiempo). */
  expiresAt: IsoDateTime | null;
  resolvedAt: IsoDateTime | null;
  driver: PublicUser;
  newStop: {
    label: string | null;
    location: GeoPoint;
    /** La parada nueva se inserta DESPUÉS de la parada con este `seq` (numeración previa al cambio). */
    afterStopSeq: number;
    /** Hora prevista de paso por la nueva parada («Nueva parada 08:05»). */
    plannedArrivalAt: IsoDateTime | null;
    /** `seq` definitivo de la parada una vez aplicado el cambio; null mientras esté pendiente. */
    seq: number | null;
  };
  detour: { addedDistanceM: number; addedDurationSeconds: number; maxDetourM: number };
  /** Polilíneas simplificadas del trayecto afectado: ruta anterior y ruta propuesta (para el mapa). */
  path: { before: GeoPoint[]; after: GeoPoint[] };
  /** Solo pasajero: su recogida y su destino («Tu recogida 07:25», «Tu destino»). */
  stops: { pickup: LiveStop | null; dropoff: LiveStop | null };
  myImpact: LiveRouteChangeImpact | null;
  myDecision: LiveDecision | null;
  counts: LiveRouteChangeCounts;
  /** Solo conductor. */
  participants: LiveRouteChangeParticipantRow[] | null;
  /** Estado de la señal del conductor (banner «Sin señal · Última posición: hace 2 min»). */
  driverSignal: { state: LiveSignal; lastUpdateAt: IsoDateTime | null; ageSeconds: number | null };
  /** Invariante: nunca hay recargo por molestias («Sin recargo por esta parada»). */
  surcharge: "none";
  /** Solo conductor: solicitud de plaza del nuevo pasajero que se recoge en la parada. */
  linkedRequestId: Uuid | null;
}

export interface LiveCreateRouteChangeBody {
  stop: { location: GeoPoint; label?: string };
  /** Insertar después de la parada con este seq. Si se omite, el servidor elige el tramo por proyección sobre la ruta. */
  afterStopSeq?: number;
  /** Solicitud de plaza (pending/accepted/payment_pending) del pasajero que subirá en la nueva parada. */
  requestId?: Uuid;
}

export interface LiveRespondRouteChangeBody {
  decision: "accept" | "reject";
}

/* ─────────────── Valoraciones ─────────────── */

export interface LiveCreateRatingBody {
  /** Persona valorada: el conductor (si valora un pasajero) o un pasajero con reserva completada (si valora el conductor). */
  rateeUserId: Uuid;
  /** 1..5 */
  stars: number;
  comment?: string;
}

/* ─────────────── Incidencias ─────────────── */

export type LiveIncidentCategory =
  | "safety"
  | "driver_behavior"
  | "passenger_behavior"
  | "vehicle"
  | "route_or_schedule"
  | "payment"
  | "lost_item"
  | "other";
export type LiveIncidentStatus = "open" | "in_review" | "resolved" | "dismissed";

export interface LiveIncidentAttachment {
  id: Uuid;
  contentType: string;
  sizeBytes: number;
  status: "pending" | "uploaded";
  createdAt: IsoDateTime;
}

export interface LiveIncidentReport {
  id: Uuid;
  tripId: Uuid;
  bookingId: Uuid | null;
  category: LiveIncidentCategory;
  description: string;
  status: LiveIncidentStatus;
  /** Rol del denunciante en ese viaje. */
  reporterRole: "driver" | "passenger";
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  attachments: LiveIncidentAttachment[];
}

export interface LiveCreateIncidentBody {
  tripId: Uuid;
  /** Si el denunciante es pasajero, su reserva; se deduce si se omite. */
  bookingId?: Uuid;
  category: LiveIncidentCategory;
  /** 10..2000 caracteres. */
  description: string;
}

export interface LiveIncidentAttachmentIntentBody {
  contentType: "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif";
  sizeBytes: number;
}

export interface LiveIncidentAttachmentIntent {
  attachmentId: Uuid;
  /** URL firmada de subida (almacenamiento privado). Subir con PUT y las cabeceras indicadas. */
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: IsoDateTime;
}

/* ─────────────── Compartir viaje (privado) ─────────────── */

/** El cuerpo entero es opcional (sin él: 6 h y sin matrícula). */
export interface LiveShareCreateBody {
  /** Incluir la matrícula en el enlace (por defecto false). */
  includePlate?: boolean;
  /** Vigencia del enlace en minutos: 15–1440, por defecto 360. */
  expiresInMinutes?: number;
}

export type LiveShareStatus = "active" | "expired" | "revoked";

export interface LiveShare {
  id: Uuid;
  bookingId: Uuid;
  tripId: Uuid;
  includePlate: boolean;
  status: LiveShareStatus;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
  revokedAt: IsoDateTime | null;
  lastViewedAt: IsoDateTime | null;
  viewCount: number;
}

export interface LiveShareCreated extends LiveShare {
  /** Se muestra UNA sola vez; el servidor solo guarda su hash. */
  token: string;
  /** Enlace para compartir (PUBLIC_SHARE_BASE_URL + token); null si el servidor no tiene base pública configurada. */
  url: string | null;
}

/** Vista pública del enlace (sin sesión). Sin teléfono, sin posición precisa, sin matrícula salvo opt-in. */
export interface LiveSharedTrip {
  phase: LivePhase;
  serverTime: IsoDateTime;
  expiresAt: IsoDateTime;
  passengerFirstName: string;
  driverFirstName: string;
  vehicle: { make: string; model: string; color: string | null; plate: string | null };
  route: { originLabel: string | null; destinationLabel: string | null };
  plannedDepartureAt: IsoDateTime | null;
  eta: LiveEta | null;
  signal: LiveSignal;
  /** Posición APROXIMADA (cuadrícula ~1 km); null si no hay viaje activo o GPS. */
  position: {
    location: GeoPoint;
    recordedAt: IsoDateTime;
    ageSeconds: number;
    stale: boolean;
    precision: "approximate";
  } | null;
}

/* ─────────────── Preferencias de privacidad del mapa en vivo ─────────────── */

export interface LivePrivacyPreferences {
  /** Si true, los copasajeros ven tu nombre y foto en «En el coche»; por defecto false («1 pasajero»). */
  showProfileToCoPassengers: boolean;
  updatedAt: IsoDateTime | null;
}

/* ─────────────── Consola del conductor — GET /v1/me/trips/{tripId}/console ─────────────── */

export interface LiveConsolePassenger {
  bookingId: Uuid;
  passenger: PublicUser;
  bookingStatus: LiveBookingStatus;
  pickup: LiveStop;
  dropoff: LiveStop;
  pickedUp: boolean;
  pickedUpAt: IsoDateTime | null;
  code: { status: LivePickupCodeStatus; attemptsRemaining: number | null };
  /** null si ya está recogido o el viaje no está activo. */
  etaToPickup: LiveEta | null;
  /** El conductor ya valoró a este pasajero (solo tras completar el viaje). */
  ratedByMe: boolean;
}

export interface LiveConsole {
  tripId: Uuid;
  status: LiveTripStatus;
  serverTime: IsoDateTime;
  departureAt: IsoDateTime | null;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  vehicle: LiveVehicle;
  seats: { offered: number; occupied: number };
  /** Estado de la señal GPS PROPIA del conductor. */
  signal: LiveSignal;
  position: LivePosition | null;
  /** Siguiente recogida pendiente (la de menor ETA). */
  next: {
    bookingId: Uuid;
    passenger: PublicUser;
    pickup: LiveStop;
    etaToPickup: LiveEta | null;
  } | null;
  passengers: LiveConsolePassenger[];
  counts: { total: number; verified: number; pending: number };
  pendingRouteChange: {
    id: Uuid;
    createdAt: IsoDateTime;
    expiresAt: IsoDateTime | null;
    counts: LiveRouteChangeCounts;
  } | null;
  actions: {
    /** POST /v1/me/trips/{tripId}/start */
    canStart: boolean;
    /** POST /v1/me/trips/{tripId}/complete */
    canComplete: boolean;
    /** POST /v1/trips/{tripId}/route-changes */
    canProposeRouteChange: boolean;
    /** Reservas confirmadas sin recogida verificada que `complete` marcará como «no presentado». */
    willMarkNoShow: number;
  };
}

/* ─────────────── Endpoints ya existentes que consumen estas pantallas (formas reales) ─────────────── */

/** POST /v1/bookings/{bookingId}/pickup-code (pasajero). Devuelve el código en claro UNA vez; cada llamada genera uno nuevo. */
export interface LivePickupCodeGenerated {
  bookingId: Uuid;
  code: string;
  generatedAt: IsoDateTime;
}

/** POST /v1/bookings/{bookingId}/pickup-verify (conductor). Errores: PICKUP_CODE_INVALID(401, details {attempts,maxAttempts}), PICKUP_ATTEMPTS_EXCEEDED(429), … */
export interface LivePickupVerified {
  bookingId: Uuid;
  pickedUpAt: IsoDateTime;
  alreadyVerified: boolean;
}

/** POST /v1/me/trips/{tripId}/start (conductor). Forma real del backend actual (fila SQL). */
export interface LiveTripStarted {
  id: Uuid;
  status: "active";
  started_at: IsoDateTime;
}

/** POST /v1/me/trips/{tripId}/complete (conductor). Forma real del backend actual (fila SQL). */
export interface LiveTripCompleted {
  id: Uuid;
  status: "completed";
  completed_at: IsoDateTime;
}

/** POST /v1/trips/{tripId}/location (conductor, ≈ cada 5–10 s). `eventId` hace el envío idempotente. */
export interface LivePostLocationBody {
  eventId: Uuid;
  recordedAt: IsoDateTime;
  latitude: number;
  longitude: number;
  accuracyM?: number;
  speedMps?: number;
  headingDegrees?: number;
}

export interface LivePostLocationResult {
  eventRowId: string;
  duplicate: boolean;
  acceptedAsCurrent: boolean;
}
