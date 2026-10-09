/**
 * Contadores de las tarjetas del inicio del panel. Solo se piden si el rol puede ver la sección: un rol sin acceso no
 * genera una petición que el servidor tendría que denegar (y auditar como acceso denegado).
 */
import { useApiQuery } from "@/hooks";
import { listRefundProposals, listReviewUsers } from "../api";
import { HOME_OPEN_REFUNDS, HOME_PENDING_REVIEWS } from "../keys";

export interface HomeCounts {
  /** Revisiones pendientes; `null` si no se puede saber (sin permiso, cargando o error). */
  pendingReviews: number | null;
  /** Devoluciones abiertas (canceladas pendientes de resolver); `null` si no se puede saber. */
  openRefunds: number | null;
}

export function useHomeCounts(options: { reviews: boolean; refunds: boolean }): HomeCounts {
  const reviews = useApiQuery(
    HOME_PENDING_REVIEWS,
    async ({ signal }) => (await listReviewUsers({ tab: "pending", role: null, item: null, sort: "recent", limit: 1 }, { signal })).counts.pending,
    { enabled: options.reviews, staleTimeMs: 30_000 },
  );
  const refunds = useApiQuery(
    HOME_OPEN_REFUNDS,
    async ({ signal }) => (await listRefundProposals({ tab: "cancelled", period: "all", provinceCode: null, limit: 1 }, { signal })).counts.cancelled,
    { enabled: options.refunds, staleTimeMs: 30_000 },
  );
  return { pendingReviews: reviews.data ?? null, openRefunds: refunds.data ?? null };
}
