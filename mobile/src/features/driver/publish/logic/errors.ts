/**
 * Errores del paquete «publicar rutas» explicados en español para quien conduce. La capa de red ya traduce los errores
 * genéricos (`describeError`); aquí se añaden los códigos propios de vehículos, publicación y solicitudes SIN tocar el
 * catálogo global (códigos como `NO_CAPACITY_ON_SEGMENT` dicen otra cosa al pasajero que al conductor).
 */
import { describeError, isApiError } from "@/api";
import { formatDateShort } from "@/i18n";
import { publishStrings } from "../strings";

export interface PublishErrorView {
  title: string;
  message: string;
  /** Reintentar la misma acción puede funcionar (red, 5xx, 429). */
  retryable: boolean;
  /** Sin conexión: la pantalla enseña el aviso de red en lugar de un error. */
  offline: boolean;
  code: string | null;
  /** El vehículo o la solicitud ya no existen o cambiaron: conviene recargar. */
  stale: boolean;
}

const copy = publishStrings.errors;

const READINESS_NAMES = publishStrings.readiness.keys as Record<string, string>;

/** Lee `details.<key>` si es una lista de textos. */
function stringList(details: unknown, key: string): string[] {
  if (typeof details !== "object" || details === null) return [];
  const value = (details as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function listText(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** Códigos de bloqueo del servidor → texto («Foto pública, Identidad y Seguro (uso particular)»). */
export function blockersText(blockers: readonly string[]): string {
  return listText(blockers.map((key) => READINESS_NAMES[key] ?? key));
}

/** «3 oct y 10 oct» a partir de `details.dates` (fechas ISO). */
export function datesText(dates: readonly string[]): string {
  return listText(dates.slice(0, 4).map((date) => formatDateShort(date).replace(/ \d{4}$/, "")));
}

const KNOWN: Record<string, string> = {
  VEHICLE_PLATE_ALREADY_EXISTS: copy.plateTaken,
  INVALID_VEHICLE_FIELD: copy.vehicleInvalid,
  INVALID_VEHICLE_PLATE: copy.plateInvalid,
  INVALID_PASSENGER_SEATS: copy.seatsInvalid,
  VEHICLE_NOT_FOUND: copy.vehicleMissing,
  VEHICLE_NOT_OWNED: copy.vehicleMissing,
  DRIVER_ROLE_REQUIRED: copy.driverRole,
  TOO_MANY_STOPS: copy.tooManyStops,
  OFFERED_SEATS_EXCEED_VEHICLE: copy.seatsExceedVehicle,
  ROUTE_POINT_OUTSIDE_PROVINCE: copy.outsideProvince,
  STOP_OUTSIDE_PROVINCE: copy.outsideProvince,
  ROUTE_LEAVES_PROVINCE: copy.routeLeavesProvince,
  NO_ROUTE_WITHIN_PROVINCE: copy.noRouteWithinProvince,
  ROUTE_TOO_SHORT: copy.routeTooShort,
  PUBLISH_START_DATE_IN_PAST: copy.startInPast,
  ONE_OFF_DATE_REQUIRED: copy.oneOffDateRequired,
  INVALID_DATE_RANGE: copy.invalidDateRange,
  INVALID_TIME: copy.invalidTime,
  MAPS_PROVIDER_UNAVAILABLE: copy.mapsUnavailable,
  ROUTE_PROVIDER_ERROR: copy.mapsUnavailable,
  PROVINCE_NOT_FOUND: copy.provinceMissing,
  REQUEST_NOT_PENDING: copy.requestNotPending,
  REQUEST_NOT_FOUND: copy.requestMissing,
  WEEKLY_RESERVATION_NOT_FOUND: copy.requestMissing,
  TRIP_NOT_FOUND: copy.requestMissing,
  TRIP_NOT_OWNED: copy.requestMissing,
  REQUEST_IN_WEEKLY_RESERVATION: copy.inWeekly,
  TRIP_NOT_BOOKABLE: copy.tripNotBookable,
  UPLOAD_INTENT_EXPIRED: copy.uploadExpired,
  UPLOAD_INTENT_NOT_FOUND: copy.uploadExpired,
  UPLOAD_TYPE_NOT_ALLOWED: copy.uploadType,
  PRIVATE_UPLOAD_TYPE_NOT_ALLOWED: copy.uploadType,
  UPLOAD_SIZE_INVALID: copy.uploadSize,
  PRIVATE_UPLOAD_SIZE_INVALID: copy.uploadSize,
  UPLOADED_FILE_SIZE_MISMATCH: copy.uploadFailed,
  UPLOADED_FILE_TYPE_MISMATCH: copy.uploadFailed,
  UPLOAD_RATE_LIMITED: copy.uploadRate,
  PRIVATE_STORAGE_DISABLED: copy.storageOff,
  PRIVATE_UPLOAD_FAILED: copy.uploadFailed,
  LOCAL_FILE_TOO_LARGE: copy.uploadSize,
  DOCUMENT_IN_REVIEW: copy.documentInReview,
  IDENTITY_ALREADY_VERIFIED: copy.alreadyVerified,
  IDEMPOTENCY_KEY_REUSED: copy.idempotencyReused,
};

const STALE_CODES: ReadonlySet<string> = new Set([
  "REQUEST_NOT_PENDING",
  "REQUEST_NOT_FOUND",
  "WEEKLY_RESERVATION_NOT_FOUND",
  "TRIP_NOT_FOUND",
  "TRIP_NOT_OWNED",
  "TRIP_NOT_BOOKABLE",
  "NO_CAPACITY_ON_SEGMENT",
  "REQUEST_IN_WEEKLY_RESERVATION",
  "VEHICLE_NOT_FOUND",
  "VEHICLE_NOT_OWNED",
]);

/** Convierte cualquier error en un texto para el conductor. Nunca lanza. */
export function describePublishError(error: unknown): PublishErrorView {
  const base = describeError(error);
  const view: PublishErrorView = {
    title: base.title,
    message: base.message,
    retryable: base.retryable,
    offline: base.kind === "offline",
    code: base.code,
    stale: false,
  };
  if (!isApiError(error)) return view;
  const code = error.code;
  const known = KNOWN[code];
  if (known !== undefined) view.message = known;
  if (code === "DRIVER_NOT_READY") {
    const names = blockersText(stringList(error.details, "blockers"));
    view.title = copy.notReadyTitle;
    view.message = names === "" ? copy.notReady : copy.notReadyWith(names);
  }
  if (code === "NO_CAPACITY_ON_SEGMENT") {
    const dates = datesText(stringList(error.details, "dates"));
    view.title = copy.noCapacityTitle;
    view.message = dates === "" ? copy.noCapacity : copy.noCapacityOn(dates);
  }
  if (code === "VEHICLE_PLATE_ALREADY_EXISTS") view.title = copy.plateTakenTitle;
  if (code === "TRIP_NOT_BOOKABLE") view.title = copy.tripNotBookableTitle;
  view.stale = STALE_CODES.has(code);
  return view;
}
