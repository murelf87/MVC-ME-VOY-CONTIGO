/**
 * API pública del backend en memoria de la vista previa para los slices (`import type … from "@/preview"` en
 * `features/<slice>/preview/handlers.ts`; si necesitas valores —`reply`, `fail`, `SEED_IDS`…— impórtalos del barrel
 * también: este fichero NO importa el agregador `register.ts` ni `install.ts`, así que no hay ciclos).
 *
 * SIMULACIÓN: nada de lo que hay bajo `src/preview/**` existe en producción (solo con `EXPO_PUBLIC_PREVIEW=1`).
 * Referencia completa: `docs/PREVIEW_BACKEND.md`.
 */

// ---- router ----
export {
  PreviewReply,
  PreviewRouter,
  createRouter,
  isPreviewReply,
  reply,
  type PreviewRequest,
  type RawBody,
  type RouteHandler,
  type RouteInfo,
  type RouteOptions,
  type RouteSchema,
  type RouteTypes,
} from "./core/router";
export type { JsonSchema } from "./core/schema";
export { uuidParam, pointSchema } from "./handlers/schemas";

// ---- base de datos en memoria ----
export {
  Collection,
  PreviewDb,
  UniqueViolation,
  createPreviewDb,
  isUniqueViolation,
  type CollectionOptions,
  type DbSnapshot,
} from "./core/db";
export type * from "./core/rows";
export { PreviewEvents, PreviewJobs, type CoreEventName, type EventHandler, type EventName, type JobFn } from "./core/events";

// ---- errores ----
export { ApiFailure, errorBody, fail, isApiFailure } from "./core/errors";

// ---- tipos, tiempo, ids, geometría, dinero ----
export {
  PREVIEW_PROFILES,
  PREVIEW_PROFILE_IDS,
  USER_ROLES,
  isPreviewProfileId,
  type GeoLatLng,
  type HttpMethod,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
  type Principal,
  type PreviewProfile,
  type PreviewProfileId,
  type SelfServiceRole,
  type UserRole,
} from "./core/types";
export { DEFAULT_PREVIEW_NOW, DEFAULT_PREVIEW_NOW_MS, PreviewClock, type ClockInput, type ClockMode } from "./core/clock";
export { TIME, addDaysToDate, isoWeekdayOf, madridDate, madridDateTimeMs, madridHHmm, madridLocalToMs, madridOffsetMinutes, madridParts, parseDateParts, type MadridParts } from "./core/time";
export { PreviewIds, STRICT_UUID_RE, UUID_RE, hashSeed, stableUuid } from "./core/ids";
export { bearingDeg, distanceM, haversineM, lerpPoint, pointAlong, pointInRing, polylineLengthM, toLngLat, type LngLat } from "./core/geo";
export { formatEuros, moneyDefined, moneyIllustrative, moneyPending, type MoneyDto, type MoneyStatus } from "./core/money";
export { bigintText, iso, isoReq, numericText, round, snapToGrid } from "./core/wire";
export { sha256Hex } from "./core/sha256";
export { AVATAR_SLUGS, avatarKey, resolvePreviewAsset, type AvatarSlug } from "./core/assets";
export { createSession, deterministicSessionToken, hashSessionToken, resolveSession, revokeSession, rolesOf } from "./core/auth";
export { signedUrl, STORAGE_HOST, STORAGE_PROVIDER_NAME } from "./core/storage";

// ---- visor de la vista previa (todo degrada si no hay visor) ----
export { deliverSmsToShell, hasShell, isShellOffline, notifyShell, readShell, type ShellView } from "./core/shell";

// ---- datos y proveedores simulados ----
export { PLACES, fold, placeById, placeByName, type Place } from "./data/places";
export { SEVILLA_PROVINCE_ID, SEVILLA_RING, provinceIdFor, sevillaProvince } from "./data/provinces";
export { geocodeAddress, labelForPoint, nearestPlace, reverseGeocode } from "./providers/geocoder";
export { ROUTE_PROVIDER_NAME, computeRoutes, segmentsRef, type RouteCandidate } from "./providers/routing";

// ---- servicios de dominio reutilizables (los mismos que usan los endpoints del núcleo) ----
export { writeAudit } from "./domain/audit";
export { addRole, createUser, ensureProfile, firstNameOf, normalizeE164, photoUrlFor, publicUser, requireUser, userStats, type PublicUserDto } from "./domain/users";
export { assertVehicleCanDrive, readVehicleCompliance, utcToday } from "./domain/vehicles";
export { availableSeatsForRange, occupiedOnSegment, requestedSegments, segmentsOf, assertCapacity } from "./domain/seats";
export {
  computeProvinceCompliantSegmentPlan,
  insertTripWithPlan,
  pointCoveredByProvince,
  publishTrip,
  requireProvince,
  routeCoveredByProvince,
} from "./domain/trips";
export { searchPublishedTrips, type TripSearchInput, type TripSearchResult } from "./domain/search";
export {
  DEFAULT_HOLD_TTL_SECONDS,
  acceptRequest,
  confirmProviderPayment,
  createRideRequestForTrip,
  createSeatHold,
  decideRideRequest,
  expireStaleHolds,
  getExtendedRideRequestCreator,
  insertRideRequest,
  paymentCompensations,
  rejectRequest,
  setExtendedRideRequestCreator,
  type DecisionOutcome,
  type ExtendedRideRequestCreator,
  type PaymentConfirmation,
  type RideRequestExtras,
} from "./domain/requests";
export { recordDriverLocation, getTripLocationForViewer, listApproximateLiveTrips } from "./domain/live";
export {
  LIVE_SETTINGS,
  approximateCoordinate,
  computeEta,
  currentProgress,
  journeySums,
  loadLiveFix,
  loadRouteModel,
  minutesUntil,
  normalizeFractions,
  plannedArrival,
  progressOf,
  projectOnRoute,
  remainingBetween,
  signalOf,
  stopAt,
  type EtaCalc,
  type LiveFix,
  type LiveSettings,
  type LiveSignalKind,
  type RouteModel,
  type RouteProjection,
  type RouteSegment,
  type RouteStop,
} from "./domain/liveEta";
export {
  ROUTE_CHANGE_ACCEPTANCES,
  ROUTE_CHANGE_IMPACTS,
  ROUTE_CHANGE_NOTICE_EVENT,
  ROUTE_CHANGE_PROPOSALS,
  arrivalChangeText,
  cancelRouteChange,
  createRouteChange,
  expireDueRouteChanges,
  getRouteChangeView,
  pendingProposalOf,
  pendingRouteChangeForDriver,
  pendingRouteChangeForPassenger,
  respondToRouteChange,
  routeChangeCounts,
  routeChangeTables,
  sliceByFraction,
  type CreateRouteChangeInput,
  type RouteChangeAcceptanceRow,
  type RouteChangeImpactRow,
  type RouteChangeLeg,
  type RouteChangeNotice,
  type RouteChangeNoticeKind,
  type RouteChangeProposalRow,
} from "./domain/routeChanges";
export { completeOwnedTrip, generateOwnPickupCode, startOwnedTrip, verifyPickupCode } from "./domain/execution";
export { blockUser, hasConfirmedBooking, isBlockedEitherWay, listTripDirectMessages, sendTripDirectMessage, unblockUser } from "./domain/chat";

// ---- sembrado ----
export * from "./seeds";

/** `true` si el código corre dentro de la vista previa (siempre; existe para documentar la intención en los slices). */
export const IS_PREVIEW_BACKEND = true as const;
