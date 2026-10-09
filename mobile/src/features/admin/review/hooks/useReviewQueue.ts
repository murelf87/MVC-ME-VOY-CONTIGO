/**
 * Cola de revisión de usuarios (pantalla 38): lista paginada por cursor + contadores de las tres pestañas.
 * Los contadores vienen en cada página (`counts`) y respetan el filtro de rol y de elemento.
 */
import { useMemo } from "react";
import type { AdminReviewQueueItem, AdminReviewQueuePage } from "@/api/types";
import type { Page } from "@/api/types/common";
import { usePaginatedQuery, type UsePaginatedQueryResult } from "@/hooks";
import { listReviewUsers } from "../api";
import { reviewQueueKey } from "../keys";
import type { QueueFilters } from "../logic/reviewQueue";

const PAGE_SIZE = 20;

export type QueueCounts = AdminReviewQueuePage["counts"];

function hasCounts(page: Page<AdminReviewQueueItem>): page is AdminReviewQueuePage {
  return "counts" in page;
}

export interface ReviewQueue extends UsePaginatedQueryResult<AdminReviewQueueItem> {
  /** Contadores de las pestañas; `undefined` hasta la primera respuesta. */
  counts: QueueCounts | undefined;
}

export function useReviewQueue(filters: QueueFilters, enabled: boolean): ReviewQueue {
  const list = usePaginatedQuery<AdminReviewQueueItem>(
    reviewQueueKey(filters),
    ({ cursor, signal }) =>
      listReviewUsers({ tab: filters.tab, role: filters.role, item: filters.item, sort: filters.sort, cursor, limit: PAGE_SIZE }, { signal }),
    { enabled, staleTimeMs: 15_000, getItemId: (item) => item.userId },
  );
  const first = list.pages[0];
  const counts = first !== undefined && hasCounts(first) ? first.counts : undefined;
  return useMemo(() => ({ ...list, counts }), [list, counts]);
}
