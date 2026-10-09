/**
 * Traduce los errores del backend a lo que pinta la consola del conductor (lógica PURA y testeable).
 *
 * El catálogo global de `@/api` es genérico y compartido entre equipos; aquí cada código dice lo que le toca al
 * CONDUCTOR (qué falta, qué puede hacer, qué botón ofrecer). Lo que no conocemos cae al texto genérico (`base`).
 * `opsErrorView` no importa `@/api` para poder probarse sin la capa de red: el error se reconoce por su forma
 * (`kind: "api"`, `code`, `status`, `details`), que es la de `ApiError`.
 */
import { formatDateShort, formatDistance } from "@/i18n";
import { opsStrings } from "../strings";
import { attemptsFromDetails, type AttemptsView } from "./pickup";

const E = opsStrings.errors;
const R = E.routeChange;

/** Forma de `describeError(error)` de `@/api` (se pasa desde fuera). */
export interface GenericErrorDescription {
  kind: "api" | "offline" | "timeout" | "auth_expired" | "unknown";
  title: string;
  message: string;
  code: string | null;
  status: number | null;
  requestId: string | null;
  retryable: boolean;
}

export type OpsErrorKind = "offline" | "timeout" | "forbidden" | "notFound" | "conflict" | "validation" | "locked" | "server" | "unknown";
/** Qué botón ofrecer además de «Volver». */
export type OpsErrorAction = "none" | "retry" | "refresh" | "fixVehicle" | "openConsole";
export type VehicleIssue = "photo" | "insurance" | "insuranceExpiry" | "insuranceExpired";

export interface OpsErrorView {
  kind: OpsErrorKind;
  code: string | null;
  title: string;
  message: string;
  /** Repetir la misma acción puede funcionar (sin red, tiempo agotado, fallo del servidor). */
  retryable: boolean;
  action: OpsErrorAction;
  actionLabel: string | null;
  /** Solo `PICKUP_CODE_INVALID`: intentos gastados y que quedan. */
  attempts: AttemptsView | null;
  /** Solo `ROUTE_CHANGE_DETOUR_TOO_LARGE`. */
  detour: { addedDistanceM: number; maxDetourM: number } | null;
  /** Solo los códigos de vehículo en regla al iniciar el viaje. */
  vehicleIssue: VehicleIssue | null;
  requestId: string | null;
}

interface ApiLike {
  kind: "api";
  code: string;
  status: number;
  details?: unknown;
}

function asApi(error: unknown): ApiLike | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { kind?: unknown; code?: unknown; status?: unknown };
  if (candidate.kind !== "api" || typeof candidate.code !== "string" || typeof candidate.status !== "number") return null;
  return error as ApiLike;
}

type Override = Partial<Omit<OpsErrorView, "code" | "requestId">> & { title: string; message: string };
type Resolver = (details: unknown) => Override;

function numberAt(details: unknown, key: string): number | null {
  if (typeof details !== "object" || details === null) return null;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringAt(details: unknown, key: string): string | null {
  if (typeof details !== "object" || details === null) return null;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "" ? value : null;
}

const REFRESH: Pick<Override, "action" | "actionLabel"> = { action: "refresh", actionLabel: opsStrings.common.refresh };

const BY_CODE: Record<string, Resolver> = {
  // Propiedad y estado del viaje
  TRIP_NOT_OWNED: () => ({ ...E.notOwner, kind: "forbidden", retryable: false }),
  AUTH_FORBIDDEN: () => ({ ...E.notOwner, kind: "forbidden", retryable: false }),
  TRIP_NOT_FOUND: () => ({ ...E.tripNotFound, kind: "notFound", retryable: false }),
  CONSOLE_TRIP_NOT_PUBLISHED: () => ({ ...E.tripDraft, kind: "conflict", retryable: false }),
  TRIP_NOT_STARTABLE: () => ({ ...E.notStartable, ...REFRESH }),
  TRIP_NOT_COMPLETABLE: () => ({ ...E.notCompletable, ...REFRESH }),
  TRIP_NOT_LIVE: () => ({ ...E.tripNotLive, action: "openConsole", actionLabel: opsStrings.pickup.blocked.notLiveAction, retryable: false }),
  TRIP_ALREADY_STARTED: () => ({ ...E.tripAlreadyStarted, retryable: false }),
  // Vehículo en regla (al iniciar)
  VEHICLE_PHOTO_REQUIRED: () => ({
    title: E.vehiclePhotoRequired.title,
    message: E.vehiclePhotoRequired.message,
    action: "fixVehicle",
    actionLabel: E.vehiclePhotoRequired.action,
    vehicleIssue: "photo",
    retryable: false,
  }),
  VEHICLE_INSURANCE_REQUIRED: () => ({
    title: E.vehicleInsuranceRequired.title,
    message: E.vehicleInsuranceRequired.message,
    action: "fixVehicle",
    actionLabel: E.vehicleInsuranceRequired.action,
    vehicleIssue: "insurance",
    retryable: false,
  }),
  VEHICLE_INSURANCE_EXPIRY_REQUIRED: () => ({
    title: E.vehicleInsuranceExpiryRequired.title,
    message: E.vehicleInsuranceExpiryRequired.message,
    action: "fixVehicle",
    actionLabel: E.vehicleInsuranceExpiryRequired.action,
    vehicleIssue: "insuranceExpiry",
    retryable: false,
  }),
  VEHICLE_INSURANCE_EXPIRED: (details) => {
    const on = stringAt(details, "expiresOn");
    return {
      title: E.vehicleInsuranceExpired.title,
      message: on ? E.vehicleInsuranceExpired.messageOn(formatDateShort(on)) : E.vehicleInsuranceExpired.message,
      action: "fixVehicle",
      actionLabel: E.vehicleInsuranceExpired.action,
      vehicleIssue: "insuranceExpired",
      retryable: false,
    };
  },
  // Código de recogida
  INVALID_PICKUP_CODE: () => ({ ...E.invalidPickupCode, kind: "validation", retryable: false }),
  PICKUP_CODE_INVALID: (details) => ({ ...E.pickupCodeWrong, kind: "validation", retryable: false, attempts: attemptsFromDetails(details) }),
  PICKUP_ATTEMPTS_EXCEEDED: () => ({ ...E.pickupAttemptsExceeded, kind: "locked", retryable: false }),
  PICKUP_CODE_NOT_GENERATED: () => ({ ...E.pickupNotGenerated, kind: "conflict", retryable: false, ...REFRESH }),
  BOOKING_NOT_PICKUP_ELIGIBLE: () => ({ ...E.bookingNotEligible, kind: "conflict", retryable: false }),
  BOOKING_NOT_FOUND: () => ({ ...E.bookingNotFound, kind: "notFound", retryable: false }),
  BOOKING_NOT_CANCELLABLE: () => ({ ...E.bookingNotCancellable, kind: "conflict", retryable: false }),
  IDEMPOTENCY_KEY_REUSED: () => ({ ...E.idempotencyReused, retryable: false }),
  // Ubicación
  LOCATION_FORBIDDEN: () => ({ ...E.locationForbidden, kind: "forbidden", retryable: false }),
  LOCATION_EVENT_TOO_OLD: () => ({ ...E.locationTooOld, retryable: false }),
  LOCATION_EVENT_FROM_FUTURE: () => ({ ...E.locationTooOld, retryable: false }),
  // Cambio de ruta
  INVALID_ROUTE_CHANGE_STOP: () => ({ ...R.invalidStop, kind: "validation", retryable: false }),
  ROUTE_CHANGE_ALREADY_PENDING: () => ({ ...R.alreadyPending, kind: "conflict", retryable: false }),
  ROUTE_CHANGE_TRIP_NOT_CHANGEABLE: () => ({ ...R.notChangeable, kind: "conflict", retryable: false }),
  TRIP_ROUTE_DATA_MISSING: () => ({ ...R.routeDataMissing, kind: "conflict", retryable: false }),
  DRIVER_POSITION_UNAVAILABLE: () => ({ ...R.driverPositionUnavailable, kind: "conflict", retryable: false }),
  ROUTE_CHANGE_ROUTE_STALE: () => ({ ...R.routeStale, kind: "conflict", retryable: true }),
  NO_CAPACITY_ON_SEGMENT: () => ({ ...R.noCapacity, kind: "conflict", retryable: false }),
  ROUTE_CHANGE_STOP_OUTSIDE_PROVINCE: () => ({ ...R.outsideProvince, kind: "validation", retryable: false }),
  NO_ROUTE_WITHIN_PROVINCE: () => ({ ...R.noRouteInProvince, kind: "validation", retryable: false }),
  ROUTE_CHANGE_DETOUR_TOO_LARGE: (details) => {
    const added = numberAt(details, "addedDistanceM");
    const max = numberAt(details, "maxDetourM");
    const known = added !== null && max !== null;
    return {
      title: R.detourTooLarge.title,
      message: known ? R.detourTooLargeWith(formatDistance(added), formatDistance(max)) : R.detourTooLarge.message,
      kind: "validation",
      retryable: false,
      detour: known ? { addedDistanceM: added, maxDetourM: max } : null,
    };
  },
  ROUTE_CHANGE_STOP_BEHIND_VEHICLE: () => ({ ...R.behindVehicle, kind: "validation", retryable: false }),
  ROUTE_CHANGE_INVALID_STOP_INDEX: () => ({ ...R.invalidIndex, kind: "validation", retryable: false }),
  ROUTE_CHANGE_REQUEST_INVALID: () => ({ ...R.requestInvalid, kind: "validation", retryable: false }),
  ROUTE_CHANGE_STOP_TOO_CLOSE: () => ({ ...R.stopTooClose, kind: "validation", retryable: false }),
  MAPS_PROVIDER_UNAVAILABLE: () => ({ ...R.providerUnavailable, kind: "server", retryable: true, action: "retry", actionLabel: opsStrings.common.retry }),
  ROUTE_CHANGE_NOT_FOUND: () => ({ ...R.notFound, kind: "notFound", retryable: false }),
  ROUTE_CHANGE_NOT_PENDING: () => ({ ...R.notPending, kind: "conflict", retryable: false, ...REFRESH }),
  // Chat
  CHAT_FORBIDDEN: () => ({ ...E.chat.forbidden, kind: "forbidden", retryable: false }),
  CHAT_BLOCKED: () => ({ ...E.chat.blocked, kind: "forbidden", retryable: false }),
};

function kindFromStatus(status: number): OpsErrorKind {
  if (status === 400 || status === 422) return "validation";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 409) return "conflict";
  if (status === 429) return "locked";
  if (status >= 500) return "server";
  return "unknown";
}

/** `base` = `describeError(error)` de `@/api`. */
export function opsErrorView(error: unknown, base: GenericErrorDescription): OpsErrorView {
  const plain = {
    code: base.code,
    requestId: base.requestId,
    attempts: null,
    detour: null,
    vehicleIssue: null,
  } as const;

  if (base.kind === "offline") {
    return { ...plain, kind: "offline", title: base.title, message: base.message, retryable: true, action: "retry", actionLabel: opsStrings.common.retry };
  }
  if (base.kind === "timeout") {
    return { ...plain, kind: "timeout", title: base.title, message: base.message, retryable: true, action: "retry", actionLabel: opsStrings.common.retry };
  }

  const api = asApi(error);
  const resolver = api ? BY_CODE[api.code] : undefined;
  if (api && resolver) {
    const override = resolver(api.details);
    return {
      code: api.code,
      requestId: base.requestId,
      kind: override.kind ?? kindFromStatus(api.status),
      title: override.title,
      message: override.message,
      retryable: override.retryable ?? base.retryable,
      action: override.action ?? "none",
      actionLabel: override.actionLabel ?? null,
      attempts: override.attempts ?? null,
      detour: override.detour ?? null,
      vehicleIssue: override.vehicleIssue ?? null,
    };
  }

  const kind: OpsErrorKind = api ? kindFromStatus(api.status) : "unknown";
  const retryable = base.retryable;
  return {
    ...plain,
    kind,
    title: base.title,
    message: base.message,
    retryable,
    action: retryable ? "retry" : "none",
    actionLabel: retryable ? opsStrings.common.retry : null,
  };
}
