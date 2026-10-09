/**
 * Atención al cliente (A S): cola con filtros, detalle del hilo, responder, asignarme, cerrar y ver un adjunto.
 * El adjunto solo se ve con una URL firmada de vida corta: el servidor audita el acceso ANTES de devolverla.
 */
import type {
  AdminSupportAttachmentAccess,
  AdminSupportTicketDetail,
  AdminSupportTicketRow,
  AdminSupportTicketsPage,
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
import { assignSupportTicket, closeSupportTicket, getSupportTicket, listSupportTickets, replySupportTicket, requestAttachmentAccess } from "../api";
import type { SupportFilter } from "../model/support";
import { ADMIN_AUDIT, ADMIN_SUPPORT, supportListKey, supportTicketKey } from "./keys";

/** La cola es trabajo en vivo: se refresca sola cada 30 s mientras se mira. */
export const SUPPORT_POLL_MS = 30_000;

export interface SupportQueue extends Omit<UsePaginatedQueryResult<AdminSupportTicketRow>, "pages"> {
  /** Totales globales por estado (no dependen del filtro). `null` hasta que llegue la primera página. */
  counts: AdminSupportTicketsPage["counts"] | null;
}

export function useSupportQueue(filter: SupportFilter, enabled: boolean): SupportQueue {
  const { pages, ...list } = usePaginatedQuery<AdminSupportTicketRow>(
    supportListKey(filter),
    ({ cursor, signal }) =>
      listSupportTickets(
        { status: filter.status, assigned: filter.assigned, category: filter.category === "all" ? null : filter.category, cursor, limit: 20 },
        { signal },
      ),
    { enabled, staleTimeMs: 10_000, refetchIntervalMs: SUPPORT_POLL_MS },
  );
  const first = pages[0] as Partial<AdminSupportTicketsPage> | undefined;
  return { ...list, counts: first?.counts ?? null };
}

export function useSupportTicket(ticketId: string, enabled: boolean): UseApiQueryResult<AdminSupportTicketDetail> {
  return useApiQuery<AdminSupportTicketDetail>(supportTicketKey(ticketId), ({ signal }) => getSupportTicket(ticketId, { signal }), {
    enabled,
    staleTimeMs: 10_000,
    refetchIntervalMs: SUPPORT_POLL_MS,
  });
}

function writeDetail(detail: AdminSupportTicketDetail): void {
  queryCache.setData<AdminSupportTicketDetail>(supportTicketKey(detail.id), detail);
}

export interface TicketReplyInput {
  ticketId: string;
  body: string;
}

export function useReplyTicket(): UseApiMutationResult<AdminSupportTicketDetail, TicketReplyInput> {
  return useApiMutation<AdminSupportTicketDetail, TicketReplyInput>((input, { signal }) => replySupportTicket(input.ticketId, { body: input.body }, { signal }), {
    onSuccess: writeDetail,
    invalidates: [ADMIN_SUPPORT, ADMIN_AUDIT],
  });
}

export interface TicketAssignInput {
  ticketId: string;
  assignee: "me" | "none";
}

export function useAssignTicket(): UseApiMutationResult<AdminSupportTicketDetail, TicketAssignInput> {
  return useApiMutation<AdminSupportTicketDetail, TicketAssignInput>(
    (input, { signal }) => assignSupportTicket(input.ticketId, { assignee: input.assignee }, { signal }),
    { onSuccess: writeDetail, invalidates: [ADMIN_SUPPORT, ADMIN_AUDIT] },
  );
}

export function useCloseTicket(): UseApiMutationResult<AdminSupportTicketDetail, string> {
  return useApiMutation<AdminSupportTicketDetail, string>((ticketId, { signal }) => closeSupportTicket(ticketId, { signal }), {
    onSuccess: writeDetail,
    invalidates: [ADMIN_SUPPORT, ADMIN_AUDIT],
  });
}

export interface AttachmentAccessInput {
  attachmentId: string;
  note: string | null;
}

/** Pide la URL firmada de un adjunto: el servidor escribe la auditoría antes de devolverla (vive 120 s). */
export function useAttachmentAccess(): UseApiMutationResult<AdminSupportAttachmentAccess, AttachmentAccessInput> {
  return useApiMutation<AdminSupportAttachmentAccess, AttachmentAccessInput>(
    (input, { signal }) => requestAttachmentAccess(input.attachmentId, input.note === null ? {} : { note: input.note }, { signal }),
    { invalidates: [ADMIN_AUDIT] },
  );
}
