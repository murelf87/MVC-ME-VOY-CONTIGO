/**
 * Cliente tipado del slice `profile` (pantalla → hook → ESTE fichero → `apiRequest`). Ninguna pantalla ni componente
 * llama a la red directamente.
 *
 * Endpoints que registra el slice `profile` en el backend (docs/BUILD_BRIEF.md §10.6, contratos `trips` §11–§12 y `money` §9):
 *   GET    /v1/me/trips/overview                     → TripsOverview                (Mis viajes)
 *   GET    /v1/me/favorites                          → FavoritesResponse
 *   POST   /v1/me/favorites                          → FavoritePlace  (201)
 *   PATCH  /v1/me/favorites/{id}                     → FavoritePlace
 *   DELETE /v1/me/favorites/{id}                     → 204
 *   GET    /v1/me/routine                            → RoutineResponse
 *   POST   /v1/me/routine/entries                    → RoutineEntriesResponse (201, una fila por día)
 *   PATCH  /v1/me/routine/entries/{id}               → RoutineEntry
 *   DELETE /v1/me/routine/entries/{id}               → 204
 *   POST   /v1/me/routine/suspensions                → CreateRoutineSuspensionResponse (201 nueva · 200 existente)
 *   DELETE /v1/me/routine/suspensions/{weekStart}    → 204
 *   PUT    /v1/me/routine/weekly-offer               → WeeklySeatOffer
 *   GET    /v1/plans                                 → PlansResponse
 *   GET    /v1/me/plan                               → MyPlanResponse
 *
 * Endpoints que solo CONSUME (los registran otros paquetes):
 *   GET  /me · PATCH /v1/me/profile                  núcleo (perfil)
 *   GET  /v1/me/verification · PUT /v1/me/roles      trust (lo registra `auth`)
 *   GET  /v1/ride-requests/{id} · POST …/withdraw    trips (lo registra `search-request`)
 *   GET  /v1/weekly-reservations/{id} · POST …/withdraw
 *   POST /v1/conversations/direct                    comms (lo registra `messages`)
 */
import { apiRequest, getApiBaseUrl, listProvinces, registerErrorMessages, updateProfile, type CallOptions } from "@/api";
import type {
  ConversationDetail,
  CreateFavoriteBody,
  CreateRoutineEntryBody,
  CreateRoutineSuspensionBody,
  CreateRoutineSuspensionResponse,
  FavoritePlace,
  FavoritesResponse,
  MyPlanResponse,
  OpenDirectConversationRequest,
  OverviewQuery,
  PlansResponse,
  Province,
  RideRequestDetail,
  Role,
  RoutineEntriesResponse,
  RoutineEntry,
  RoutineResponse,
  TripsOverview,
  TrustRolesResponse,
  TrustVerificationOverview,
  UpdatedProfile,
  UpdateFavoriteBody,
  UpdateRoutineEntryBody,
  UpdateWeeklySeatOfferBody,
  WeeklyReservation,
  WeeklySeatOffer,
  WithdrawRideRequestResponse,
} from "@/api/types";
import { profileStrings } from "./strings";

registerErrorMessages(profileStrings.errors);

/** Acciones que crean o cambian cosas pueden llevar `Idempotency-Key` (la pone `useApiMutation`). */
export type WriteOptions = CallOptions & { idempotencyKey?: string };

const enc = encodeURIComponent;

// ── Mis viajes ────────────────────────────────────────────────────────────────────────────────────────────────────

export function getTripsOverview(query: OverviewQuery, options: CallOptions = {}): Promise<TripsOverview> {
  return apiRequest<TripsOverview>("/v1/me/trips/overview", {
    query: { role: query.role, section: query.section, cursor: query.cursor, limit: query.limit },
    ...options,
  });
}

// ── Destinos favoritos ────────────────────────────────────────────────────────────────────────────────────────────

export function listFavorites(options: CallOptions = {}): Promise<FavoritesResponse> {
  return apiRequest<FavoritesResponse>("/v1/me/favorites", options);
}

export function createFavorite(body: CreateFavoriteBody, options: WriteOptions = {}): Promise<FavoritePlace> {
  return apiRequest<FavoritePlace>("/v1/me/favorites", { method: "POST", body, ...options });
}

export function updateFavorite(favoriteId: string, body: UpdateFavoriteBody, options: WriteOptions = {}): Promise<FavoritePlace> {
  return apiRequest<FavoritePlace>(`/v1/me/favorites/${enc(favoriteId)}`, { method: "PATCH", body, ...options });
}

export function deleteFavorite(favoriteId: string, options: WriteOptions = {}): Promise<void> {
  return apiRequest<void>(`/v1/me/favorites/${enc(favoriteId)}`, { method: "DELETE", ...options });
}

// ── Rutina semanal ────────────────────────────────────────────────────────────────────────────────────────────────

export function getRoutine(options: CallOptions = {}): Promise<RoutineResponse> {
  return apiRequest<RoutineResponse>("/v1/me/routine", options);
}

export function createRoutineEntries(body: CreateRoutineEntryBody, options: WriteOptions = {}): Promise<RoutineEntriesResponse> {
  return apiRequest<RoutineEntriesResponse>("/v1/me/routine/entries", { method: "POST", body, ...options });
}

export function updateRoutineEntry(entryId: string, body: UpdateRoutineEntryBody, options: WriteOptions = {}): Promise<RoutineEntry> {
  return apiRequest<RoutineEntry>(`/v1/me/routine/entries/${enc(entryId)}`, { method: "PATCH", body, ...options });
}

export function deleteRoutineEntry(entryId: string, options: WriteOptions = {}): Promise<void> {
  return apiRequest<void>(`/v1/me/routine/entries/${enc(entryId)}`, { method: "DELETE", ...options });
}

export function suspendRoutineWeek(body: CreateRoutineSuspensionBody, options: WriteOptions = {}): Promise<CreateRoutineSuspensionResponse> {
  return apiRequest<CreateRoutineSuspensionResponse>("/v1/me/routine/suspensions", { method: "POST", body, ...options });
}

export function resumeRoutineWeek(weekStart: string, options: WriteOptions = {}): Promise<void> {
  return apiRequest<void>(`/v1/me/routine/suspensions/${enc(weekStart)}`, { method: "DELETE", ...options });
}

export function saveWeeklySeatOffer(body: UpdateWeeklySeatOfferBody, options: WriteOptions = {}): Promise<WeeklySeatOffer> {
  return apiRequest<WeeklySeatOffer>("/v1/me/routine/weekly-offer", { method: "PUT", body, ...options });
}

// ── Planes (solo lectura: no existe endpoint de compra) ───────────────────────────────────────────────────────────

export function listPlans(options: CallOptions = {}): Promise<PlansResponse> {
  return apiRequest<PlansResponse>("/v1/plans", options);
}

export function getMyPlan(options: CallOptions = {}): Promise<MyPlanResponse> {
  return apiRequest<MyPlanResponse>("/v1/me/plan", options);
}

// ── Perfil y provincias (núcleo) ─────────────────────────────────────────────────────────────────────────────────

/** Provincias en las que funciona MVC (`GET /v1/provinces`, sin sesión). */
export function fetchProvinces(options: CallOptions = {}): Promise<Province[]> {
  return listProvinces(options);
}

/** Cambia el nombre público (`PATCH /v1/me/profile`, 2–80 caracteres). */
export function saveDisplayName(displayName: string, options: CallOptions = {}): Promise<UpdatedProfile> {
  return updateProfile({ displayName }, options);
}

// ── Verificación y roles (los registra `auth`) ───────────────────────────────────────────────────────────────────

export function getVerification(options: CallOptions = {}): Promise<TrustVerificationOverview> {
  return apiRequest<TrustVerificationOverview>("/v1/me/verification", options);
}

export function saveRoles(roles: readonly Role[], options: WriteOptions = {}): Promise<TrustRolesResponse> {
  return apiRequest<TrustRolesResponse>("/v1/me/roles", { method: "PUT", body: { roles }, ...options });
}

// ── Solicitudes y reservas semanales (las registra `search-request`) ─────────────────────────────────────────────

export function getRideRequest(requestId: string, options: CallOptions = {}): Promise<RideRequestDetail> {
  return apiRequest<RideRequestDetail>(`/v1/ride-requests/${enc(requestId)}`, options);
}

export function withdrawRideRequest(requestId: string, options: WriteOptions = {}): Promise<WithdrawRideRequestResponse> {
  return apiRequest<WithdrawRideRequestResponse>(`/v1/ride-requests/${enc(requestId)}/withdraw`, { method: "POST", ...options });
}

export function getWeeklyReservation(reservationId: string, options: CallOptions = {}): Promise<WeeklyReservation> {
  return apiRequest<WeeklyReservation>(`/v1/weekly-reservations/${enc(reservationId)}`, options);
}

export function withdrawWeeklyReservation(reservationId: string, options: WriteOptions = {}): Promise<WeeklyReservation> {
  return apiRequest<WeeklyReservation>(`/v1/weekly-reservations/${enc(reservationId)}/withdraw`, { method: "POST", ...options });
}

// ── Chat de la reserva (lo registra `messages`) ──────────────────────────────────────────────────────────────────

export function openDirectConversation(body: OpenDirectConversationRequest, options: WriteOptions = {}): Promise<ConversationDetail> {
  return apiRequest<ConversationDetail>("/v1/conversations/direct", { method: "POST", body, ...options });
}

// ── Utilidades ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Las rutas de la API para las fotos aprobadas (`/v1/public/users/{id}/photo?v=…`) se resuelven contra la URL base;
 * las demás (URL absoluta del módulo `trips`, URL firmada, `data:`, `blob:`, recursos empaquetados) se dejan tal cual.
 */
export function resolvePhotoUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url === "") return null;
  if (url.startsWith("/v1/")) {
    const base = getApiBaseUrl();
    return base === "" ? null : `${base}${url}`;
  }
  return url;
}
