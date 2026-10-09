import type {
  CreateSupportTicketRequest,
  Page,
  SupportReplyRequest,
  SupportTicketDetail,
  SupportTicketSummary,
  SupportTripOption,
} from "@/api/types";
import {
  queryCache,
  useApiMutation,
  useApiQuery,
  usePaginatedQuery,
  type UseApiMutationResult,
  type UseApiQueryResult,
  type UsePaginatedQueryResult,
} from "@/hooks";
import {
  closeSupportTicket,
  createSupportTicket,
  getSupportTicket,
  listSupportTickets,
  listSupportTrips,
  replySupportTicket,
} from "../api";
import type { TicketFilter } from "../logic/support";
import { helpKeys } from "./keys";

/** Viajes del selector «Selecciona un viaje (opcional)» (los 50 más recientes). */
export function useSupportTrips(enabled: boolean): UseApiQueryResult<Page<SupportTripOption>> {
  return useApiQuery<Page<SupportTripOption>>(helpKeys.supportTrips, ({ signal }) => listSupportTrips({ limit: 50 }, { signal }), {
    enabled,
    staleTimeMs: 60_000,
  });
}

/** Historial de consultas, con filtro por estado y «cargar más». */
export function useSupportTickets(filter: TicketFilter, enabled: boolean): UsePaginatedQueryResult<SupportTicketSummary> {
  return usePaginatedQuery<SupportTicketSummary>(
    helpKeys.ticketsByStatus(filter),
    ({ cursor, signal }) => listSupportTickets({ status: filter === "all" ? null : filter, limit: 20, cursor }, { signal }),
    { enabled, staleTimeMs: 15_000 },
  );
}

/** Hilo de una consulta. Se actualiza solo cada 30 s mientras está abierta (el equipo puede responder en cualquier momento). */
export function useSupportTicket(ticketId: string, enabled: boolean): UseApiQueryResult<SupportTicketDetail> {
  return useApiQuery<SupportTicketDetail>(helpKeys.ticket(ticketId), ({ signal }) => getSupportTicket(ticketId, { signal }), {
    enabled,
    staleTimeMs: 15_000,
    refetchIntervalMs: 30_000,
  });
}

/** Deja el detalle en la caché del hilo y marca el historial como obsoleto. */
function storeTicket(detail: SupportTicketDetail): void {
  queryCache.setData<SupportTicketDetail>(helpKeys.ticket(detail.id), detail);
}

/** «Enviar consulta»: con `Idempotency-Key` (reintentar tras un corte de red no duplica la consulta). */
export function useCreateTicket(): UseApiMutationResult<SupportTicketDetail, CreateSupportTicketRequest> {
  return useApiMutation<SupportTicketDetail, CreateSupportTicketRequest>(
    (body, { idempotencyKey, signal }) => createSupportTicket(body, { idempotencyKey, signal }),
    { onSuccess: storeTicket, invalidates: [helpKeys.tickets] },
  );
}

export interface ReplyVariables extends SupportReplyRequest {
  ticketId: string;
}

export function useReplyTicket(): UseApiMutationResult<SupportTicketDetail, ReplyVariables> {
  return useApiMutation<SupportTicketDetail, ReplyVariables>(
    ({ ticketId, ...body }, { signal }) => replySupportTicket(ticketId, body, { signal }),
    { onSuccess: storeTicket, invalidates: [helpKeys.tickets] },
  );
}

export function useCloseTicket(): UseApiMutationResult<SupportTicketDetail, { ticketId: string }> {
  return useApiMutation<SupportTicketDetail, { ticketId: string }>(
    ({ ticketId }, { signal }) => closeSupportTicket(ticketId, { signal }),
    { onSuccess: storeTicket, invalidates: [helpKeys.tickets] },
  );
}
