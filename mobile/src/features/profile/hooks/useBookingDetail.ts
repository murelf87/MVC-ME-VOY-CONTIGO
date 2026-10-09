/**
 * Detalle de una solicitud o reserva de plaza: lectura, retirada de la solicitud pendiente, apertura del chat con el
 * conductor y búsqueda de la solicitud a partir del id de la reserva (que es lo que traen los avisos y el chat).
 */
import { useEffect, useMemo } from "react";
import type {
  ConversationDetail,
  OpenDirectConversationRequest,
  OverviewCard,
  RideRequestDetail,
  WithdrawRideRequestResponse,
} from "@/api/types";
import { queryCache, useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { getRideRequest, openDirectConversation, withdrawRideRequest } from "../api";
import { REQUEST_DETAILS, TRIPS_OVERVIEW, WEEKLY_RESERVATIONS, requestDetailKey } from "./keys";
import { useTripsHistory, useTripsOverview } from "./useTripsOverview";

/** Se refresca cada 20 s: la respuesta del conductor y la cuenta atrás de la plaza cambian mientras se mira. */
export function useRequestDetail(requestId: string | undefined): UseApiQueryResult<RideRequestDetail> {
  const id = requestId ?? "";
  return useApiQuery<RideRequestDetail>(requestDetailKey(id), ({ signal }) => getRideRequest(id, { signal }), {
    enabled: id !== "",
    staleTimeMs: 10_000,
    refetchIntervalMs: 20_000,
  });
}

/** Retira una solicitud pendiente. Deja el detalle ya actualizado en la caché y refresca «Mis viajes». */
export function useWithdrawRequest(): UseApiMutationResult<WithdrawRideRequestResponse, string> {
  return useApiMutation<WithdrawRideRequestResponse, string>(
    (requestId, { idempotencyKey, signal }) => withdrawRideRequest(requestId, { idempotencyKey, signal }),
    {
      onSuccess: (detail) => {
        queryCache.setData<RideRequestDetail>(requestDetailKey(detail.id), detail);
      },
      invalidates: [TRIPS_OVERVIEW, REQUEST_DETAILS, WEEKLY_RESERVATIONS],
    },
  );
}

/** Abre (o recupera) el chat privado del viaje con la otra persona. */
export function useOpenChat(): UseApiMutationResult<ConversationDetail, OpenDirectConversationRequest> {
  return useApiMutation<ConversationDetail, OpenDirectConversationRequest>((body, { idempotencyKey, signal }) =>
    openDirectConversation(body, { idempotencyKey, signal }),
  );
}

// ── De la reserva (bookingId) a la solicitud (requestId) ──────────────────────────────────────────────────────────────

/** Páginas del historial que se recorren, como máximo, buscando una reserva antigua (20 viajes por página). */
const MAX_HISTORY_PAGES = 5;

function requestIdOf(cards: readonly OverviewCard[], bookingId: string): string | null {
  for (const card of cards) {
    if (card.kind === "trip" && card.bookingId === bookingId && card.requestId !== null) return card.requestId;
  }
  return null;
}

export interface BookingLookup {
  /** Solicitud a la que pertenece la reserva, cuando se ha encontrado. */
  requestId: string | null;
  /** Aún se está buscando (cargando «Mis viajes» o recorriendo el historial). */
  resolving: boolean;
  /** Se buscó en todo lo cargado y no está. */
  notFound: boolean;
  /** No se pudo cargar «Mis viajes» (con motivo). */
  error: Error | null;
  isOffline: boolean;
  retry(): void;
}

/**
 * El detalle de una reserva se pide por solicitud. Los avisos y el chat solo conocen el id de la RESERVA: la solicitud se
 * busca entre los viajes de la persona (próximos, en curso y las primeras páginas del historial). Sin `bookingId`, no hace nada.
 */
export function useBookingLookup(bookingId: string | undefined): BookingLookup {
  const wanted = bookingId !== undefined && bookingId !== "";
  const overview = useTripsOverview("passenger", wanted);

  const fromOverview = useMemo(() => {
    if (!wanted || overview.data === undefined) return null;
    const cards = [...overview.data.upcoming, ...overview.data.inProgress, ...overview.data.history.items];
    return requestIdOf(cards, bookingId);
  }, [wanted, overview.data, bookingId]);

  const needHistory = wanted && overview.data !== undefined && fromOverview === null;
  const history = useTripsHistory("passenger", needHistory);
  const fromHistory = useMemo(() => (needHistory && wanted ? requestIdOf(history.items, bookingId) : null), [needHistory, wanted, history.items, bookingId]);
  const found = fromOverview ?? fromHistory;

  const canLoadMore = history.hasMore && history.pages.length < MAX_HISTORY_PAGES && history.fetchMoreError === null;
  const { fetchMore } = history;
  useEffect(() => {
    if (!needHistory || found !== null || history.isLoading || history.isFetching || history.isFetchingMore || !canLoadMore) return;
    void fetchMore();
  }, [needHistory, found, history.isLoading, history.isFetching, history.isFetchingMore, canLoadMore, fetchMore]);

  const searching = needHistory && found === null && (history.isLoading || history.isFetching || history.isFetchingMore || canLoadMore);
  const loadingOverview = wanted && overview.data === undefined && !overview.isError && !overview.isOffline;
  const failed = wanted && overview.data === undefined && (overview.isError || overview.isOffline);

  return {
    requestId: found,
    resolving: wanted && found === null && (loadingOverview || searching),
    notFound: wanted && found === null && needHistory && !searching && !failed,
    error: failed ? overview.error : null,
    isOffline: failed && overview.isOffline,
    retry: () => {
      void overview.refetch();
    },
  };
}
