/**
 * Claves de la caché de consultas del paquete «admin-review». Un prefijo invalida todo lo que cuelga de él:
 * `queryCache.invalidate(ADMIN_REVIEW_QUEUE)` refresca la cola en todas sus pestañas y filtros.
 */
import type { AdminPeriod, AdminReviewItemKey, AdminReviewTab } from "@/api/types";

export const ADMIN_ME = ["admin", "me"] as const;
export const ADMIN_PROVINCES = ["admin", "provinces"] as const;

export const ADMIN_REVIEW_QUEUE = ["admin", "review", "queue"] as const;
export const ADMIN_REVIEW_DOSSIER = ["admin", "review", "dossier"] as const;

export interface QueueFilterKey {
  tab: AdminReviewTab;
  role: "driver" | "passenger" | null;
  item: AdminReviewItemKey | null;
  sort: "recent" | "oldest";
}

export function reviewQueueKey(filter: QueueFilterKey): readonly unknown[] {
  return [...ADMIN_REVIEW_QUEUE, filter.tab, filter.role ?? "all", filter.item ?? "all", filter.sort];
}

export function reviewDossierKey(userId: string): readonly unknown[] {
  return [...ADMIN_REVIEW_DOSSIER, userId];
}

export const ADMIN_BOOKINGS = ["admin", "bookings"] as const;
export const ADMIN_REFUNDS = ["admin", "refunds"] as const;
export const ADMIN_REFUND_DETAIL = ["admin", "refunds", "detail"] as const;

export function bookingsKey(provinceId: string | null, period: AdminPeriod, status: string): readonly unknown[] {
  return [...ADMIN_BOOKINGS, provinceId ?? "all", period, status];
}

export function refundListKey(provinceCode: string | null, period: string, tab: string): readonly unknown[] {
  return [...ADMIN_REFUNDS, "list", provinceCode ?? "all", period, tab];
}

export function refundDetailKey(refundId: string): readonly unknown[] {
  return [...ADMIN_REFUND_DETAIL, refundId];
}

export const ADMIN_SUMMARY = ["admin", "summary"] as const;

export function summaryKey(provinceId: string | null, period: AdminPeriod): readonly unknown[] {
  return [...ADMIN_SUMMARY, "kpis", provinceId ?? "all", period];
}

export function vehicleActivityKey(provinceId: string | null): readonly unknown[] {
  return [...ADMIN_SUMMARY, "vehicles", provinceId ?? "all"];
}

export const HOME_PENDING_REVIEWS = ["admin", "home", "pending-reviews"] as const;
export const HOME_OPEN_REFUNDS = ["admin", "home", "open-refunds"] as const;
