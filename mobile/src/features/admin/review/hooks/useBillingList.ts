/**
 * Lista de la pantalla 39 «Reservas y devoluciones». Según el rol sale de dos sitios:
 *  - Finanzas / Administración: propuestas de devolución (`GET /v1/admin/refund-proposals`, módulo money), con acciones;
 *  - Atención al cliente: reservas (`GET /v1/admin/bookings`, módulo trust), solo lectura.
 * Las dos se reducen al mismo modelo de tarjeta (`BillingCardView`) para que la pantalla sea una sola.
 */
import { useMemo } from "react";
import type { AdminBookingRow, AdminBookingsPage, AdminPeriod, AdminRefundItem, AdminRefundList, AdminRefundPeriod, AdminRefundTab } from "@/api/types";
import type { Page } from "@/api/types/common";
import { usePaginatedQuery } from "@/hooks";
import { listBookings, listRefundProposals } from "../api";
import { bookingsKey, refundListKey } from "../keys";
import type { BookingsSource } from "../logic/permissions";
import { bookingCardView, refundCardView, type BillingCardView } from "../logic/refunds";

const PAGE_SIZE = 20;

export interface BillingCounts {
  all: number;
  cancelled: number;
  /** `null` mientras no exista la tabla de devoluciones del módulo money (contrato de trust). */
  refunded: number | null;
}

export interface BillingInput {
  source: BookingsSource;
  tab: AdminRefundTab;
  refundPeriod: AdminRefundPeriod;
  bookingPeriod: AdminPeriod;
  provinceId: string | null;
  provinceCode: string | null;
  /** `false` aplaza las peticiones (rol aún no conocido, provincia aún no resuelta). */
  enabled: boolean;
}

export interface BillingList {
  cards: BillingCardView[];
  counts: BillingCounts | undefined;
  /** Aún no se ha pedido nada (rol o provincia sin resolver): la pantalla lo trata como «cargando». */
  isIdle: boolean;
  isLoading: boolean;
  isError: boolean;
  isOffline: boolean;
  failedToRefresh: boolean;
  isRefreshing: boolean;
  isEmpty: boolean;
  hasMore: boolean;
  isFetchingMore: boolean;
  fetchMoreError: Error | null;
  error: Error | null;
  fetchMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

function refundCounts(page: Page<AdminRefundItem> | undefined): BillingCounts | undefined {
  if (page === undefined || !("counts" in page)) return undefined;
  const counts = (page as AdminRefundList).counts;
  return { all: counts.all, cancelled: counts.cancelled, refunded: counts.refunded };
}

function bookingCounts(page: Page<AdminBookingRow> | undefined): BillingCounts | undefined {
  if (page === undefined || !("counts" in page)) return undefined;
  const counts = (page as AdminBookingsPage).counts;
  return { all: counts.all, cancelled: counts.cancelled, refunded: counts.refunded };
}

export function useBillingList(input: BillingInput): BillingList {
  const refunds = usePaginatedQuery<AdminRefundItem>(
    refundListKey(input.provinceCode, input.refundPeriod, input.tab),
    ({ cursor, signal }) =>
      listRefundProposals({ tab: input.tab, period: input.refundPeriod, provinceCode: input.provinceCode, cursor, limit: PAGE_SIZE }, { signal }),
    { enabled: input.enabled && input.source === "refunds", staleTimeMs: 15_000, getItemId: (item) => item.id },
  );
  const bookings = usePaginatedQuery<AdminBookingRow>(
    bookingsKey(input.provinceId, input.bookingPeriod, input.tab),
    ({ cursor, signal }) =>
      listBookings({ provinceId: input.provinceId, period: input.bookingPeriod, status: input.tab, cursor, limit: PAGE_SIZE }, { signal }),
    { enabled: input.enabled && input.source === "bookings", staleTimeMs: 15_000, getItemId: (row) => row.bookingId },
  );

  const active = input.source === "bookings" ? bookings : refunds;
  const cards = useMemo(
    () => (input.source === "bookings" ? bookings.items.map(bookingCardView) : refunds.items.map(refundCardView)),
    [input.source, bookings.items, refunds.items],
  );
  const counts = input.source === "bookings" ? bookingCounts(bookings.pages[0]) : refundCounts(refunds.pages[0]);

  return {
    cards,
    counts,
    isIdle: active.isIdle,
    isLoading: active.isLoading,
    isError: active.isError,
    isOffline: active.isOffline,
    failedToRefresh: active.failedToRefresh,
    isRefreshing: active.isRefreshing,
    isEmpty: active.isEmpty,
    hasMore: active.hasMore,
    isFetchingMore: active.isFetchingMore,
    fetchMoreError: active.fetchMoreError,
    error: active.error,
    fetchMore: active.fetchMore,
    refresh: active.refresh,
  };
}
