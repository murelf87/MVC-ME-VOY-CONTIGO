/**
 * Cliente de red del paquete «admin-review» (slice `admin`): panel de personal.
 *
 *   trust (docs/contracts/trust.md §4.3)
 *   GET  /v1/admin/me                                        → AdminMe
 *   GET  /v1/admin/summary                                   → AdminSummary           (A F S)
 *   GET  /v1/admin/summary/vehicle-activity                  → AdminVehicleActivity   (A F S)
 *   GET  /v1/admin/review/users                              → AdminReviewQueuePage   (A V)
 *   GET  /v1/admin/review/users/{userId}                     → AdminDossier           (A V)
 *   POST /v1/admin/review/users/{userId}/decision            → AdminReviewDecisionResult (A V)
 *   POST /v1/admin/evidence/{kind}/{evidenceId}/access       → AdminEvidenceAccess    (A V; URL firmada de 120 s, auditada)
 *   GET  /v1/admin/bookings                                  → AdminBookingsPage      (A F S)
 *   POST /v1/admin/vehicles/{vehicleId}/review               → revisión de vehículo   (A V, endpoint existente)
 *
 *   money (docs/contracts/money.md §8.5) · solo finance_admin | admin
 *   GET  /v1/admin/refund-proposals                          → AdminRefundList
 *   GET  /v1/admin/refund-proposals/{refundId}               → AdminRefundDetail
 *   POST /v1/admin/refund-proposals/{refundId}/approve       → AdminRefundItem  (Idempotency-Key obligatoria)
 *   POST /v1/admin/refund-proposals/{refundId}/reject        → AdminRefundItem  (Idempotency-Key obligatoria)
 *   POST /v1/admin/refund-proposals/{refundId}/execute       → AdminRefundItem  (Idempotency-Key obligatoria)
 *
 * Las pantallas NO importan este fichero: pasan por los hooks de `./hooks`.
 */
import { apiRequest, listProvinces, type CallOptions } from "@/api";
import type {
  AdminBookingsPage,
  AdminDossier,
  AdminEvidenceAccess,
  AdminEvidenceAccessRequest,
  AdminEvidenceKind,
  AdminMe,
  AdminPeriod,
  AdminRefundDetail,
  AdminRefundItem,
  AdminRefundList,
  AdminRefundPeriod,
  AdminRefundTab,
  AdminReviewDecisionRequest,
  AdminReviewDecisionResult,
  AdminReviewItemKey,
  AdminReviewQueuePage,
  AdminReviewTab,
  AdminSummary,
  AdminVehicleActivity,
  ApproveRefundRequest,
  Province,
  RefundOrigin,
  RefundStatus,
  RejectRefundRequest,
} from "@/api/types";

/** Opciones de las llamadas que ESCRIBEN: llevan `Idempotency-Key` (la misma al reintentar un fallo indeterminado). */
export type WriteOptions = CallOptions & { idempotencyKey?: string };

const enc = encodeURIComponent;

// ── Acceso ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function getAdminMe(options: CallOptions = {}): Promise<AdminMe> {
  return apiRequest<AdminMe>("/v1/admin/me", { ...options });
}

export async function listAdminProvinces(options: CallOptions = {}): Promise<Province[]> {
  return listProvinces(options);
}

// ── 37 · Resumen ──────────────────────────────────────────────────────────────────────────────────────────────────

export function getAdminSummary(input: { provinceId: string | null; period: AdminPeriod }, options: CallOptions = {}): Promise<AdminSummary> {
  return apiRequest<AdminSummary>("/v1/admin/summary", {
    query: { provinceId: input.provinceId, period: input.period },
    ...options,
  });
}

export function getVehicleActivity(input: { provinceId: string | null }, options: CallOptions = {}): Promise<AdminVehicleActivity> {
  return apiRequest<AdminVehicleActivity>("/v1/admin/summary/vehicle-activity", {
    query: { provinceId: input.provinceId },
    ...options,
  });
}

// ── 38 · Usuarios y revisión ──────────────────────────────────────────────────────────────────────────────────────

export interface ReviewQueueQuery {
  tab: AdminReviewTab;
  role: "driver" | "passenger" | null;
  item: AdminReviewItemKey | null;
  sort: "recent" | "oldest";
  cursor?: string | null;
  limit?: number;
}

export function listReviewUsers(input: ReviewQueueQuery, options: CallOptions = {}): Promise<AdminReviewQueuePage> {
  return apiRequest<AdminReviewQueuePage>("/v1/admin/review/users", {
    query: {
      tab: input.tab,
      role: input.role,
      item: input.item,
      sort: input.sort,
      cursor: input.cursor ?? null,
      limit: input.limit,
    },
    ...options,
  });
}

export function getReviewDossier(userId: string, options: CallOptions = {}): Promise<AdminDossier> {
  return apiRequest<AdminDossier>(`/v1/admin/review/users/${enc(userId)}`, { ...options });
}

export function decideReview(userId: string, body: AdminReviewDecisionRequest, options: CallOptions = {}): Promise<AdminReviewDecisionResult> {
  return apiRequest<AdminReviewDecisionResult>(`/v1/admin/review/users/${enc(userId)}/decision`, {
    method: "POST",
    body,
    ...options,
  });
}

/** La URL que devuelve vive 120 s, se firma tras escribir la auditoría y NUNCA se guarda (ni en caché ni en disco). */
export function requestEvidenceAccess(
  kind: AdminEvidenceKind,
  evidenceId: string,
  body: AdminEvidenceAccessRequest,
  options: CallOptions = {},
): Promise<AdminEvidenceAccess> {
  return apiRequest<AdminEvidenceAccess>(`/v1/admin/evidence/${enc(kind)}/${enc(evidenceId)}/access`, {
    method: "POST",
    body,
    // Un acceso es un hecho auditado: no se reintenta solo.
    retries: 0,
    ...options,
  });
}

export interface VehicleReviewBody {
  area: "vehicle" | "documentation";
  decision: "approved" | "rejected";
  reason?: string;
}

/** Endpoint existente del núcleo (`profile-vehicle-routes`): revisa el vehículo o su documentación. */
export function reviewVehicle(vehicleId: string, body: VehicleReviewBody, options: CallOptions = {}): Promise<unknown> {
  return apiRequest<unknown>(`/v1/admin/vehicles/${enc(vehicleId)}/review`, { method: "POST", body, ...options });
}

// ── 39 · Reservas y devoluciones ──────────────────────────────────────────────────────────────────────────────────

export interface BookingsQuery {
  provinceId: string | null;
  period: AdminPeriod;
  status: "all" | "cancelled" | "refunded";
  cursor?: string | null;
  limit?: number;
}

/** Lista de reservas (trust · A F S): para soporte, que no tiene acceso al módulo de devoluciones. */
export function listBookings(input: BookingsQuery, options: CallOptions = {}): Promise<AdminBookingsPage> {
  return apiRequest<AdminBookingsPage>("/v1/admin/bookings", {
    query: {
      provinceId: input.provinceId,
      period: input.period,
      status: input.status,
      cursor: input.cursor ?? null,
      limit: input.limit,
    },
    ...options,
  });
}

export interface RefundListQuery {
  tab: AdminRefundTab;
  status?: RefundStatus | null;
  origin?: RefundOrigin | null;
  period: AdminRefundPeriod;
  provinceCode: string | null;
  cursor?: string | null;
  limit?: number;
}

/** Propuestas de devolución (money · finance_admin | admin). */
export function listRefundProposals(input: RefundListQuery, options: CallOptions = {}): Promise<AdminRefundList> {
  return apiRequest<AdminRefundList>("/v1/admin/refund-proposals", {
    query: {
      tab: input.tab,
      status: input.status ?? null,
      origin: input.origin ?? null,
      period: input.period,
      provinceCode: input.provinceCode,
      cursor: input.cursor ?? null,
      limit: input.limit,
    },
    ...options,
  });
}

export function getRefundDetail(refundId: string, options: CallOptions = {}): Promise<AdminRefundDetail> {
  return apiRequest<AdminRefundDetail>(`/v1/admin/refund-proposals/${enc(refundId)}`, { ...options });
}

export function approveRefund(refundId: string, body: ApproveRefundRequest, options: WriteOptions = {}): Promise<AdminRefundItem> {
  return apiRequest<AdminRefundItem>(`/v1/admin/refund-proposals/${enc(refundId)}/approve`, { method: "POST", body, ...options });
}

export function rejectRefund(refundId: string, body: RejectRefundRequest, options: WriteOptions = {}): Promise<AdminRefundItem> {
  return apiRequest<AdminRefundItem>(`/v1/admin/refund-proposals/${enc(refundId)}/reject`, { method: "POST", body, ...options });
}

export function executeRefund(refundId: string, options: WriteOptions = {}): Promise<AdminRefundItem> {
  return apiRequest<AdminRefundItem>(`/v1/admin/refund-proposals/${enc(refundId)}/execute`, { method: "POST", ...options });
}
