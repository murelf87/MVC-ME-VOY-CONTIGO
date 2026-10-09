/**
 * Denunciar a una persona (`POST /v1/me/reports`) o un mensaje (`POST /v1/conversations/:id/messages/:mid/report`),
 * siempre con `Idempotency-Key`: reintentar tras un corte no abre dos denuncias. Los mensajes elegibles como prueba
 * son los de esa persona en la conversación (últimos 100).
 */
import type { ChatMessage, CreateUserReportRequest, ReportMessageRequest, UserReport } from "@/api/types";
import { useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { createUserReport, listChatMessages, reportChatMessage } from "../api";
import { BLOCKS_KEY } from "./keys";

export function useReportPerson(): UseApiMutationResult<UserReport, CreateUserReportRequest> {
  return useApiMutation<UserReport, CreateUserReportRequest>((body, { idempotencyKey, signal }) => createUserReport(body, { idempotencyKey, signal }), { invalidates: [["my-reports"]] });
}

export function useReportMessage(conversationId: string, messageId: string): UseApiMutationResult<UserReport, ReportMessageRequest> {
  return useApiMutation<UserReport, ReportMessageRequest>(
    (body, { idempotencyKey, signal }) => reportChatMessage(conversationId, messageId, body, { idempotencyKey, signal }),
    { invalidates: [["my-reports"], ["conversation", conversationId], BLOCKS_KEY] },
  );
}

/** Mensajes recientes de la conversación (para mostrar el denunciado y elegir pruebas). Desactivado sin conversación. */
export function useReportableMessages(conversationId: string | undefined): UseApiQueryResult<ChatMessage[]> {
  return useApiQuery<ChatMessage[]>(
    ["report-messages", conversationId ?? "none"],
    async ({ signal }) => (conversationId === undefined ? [] : (await listChatMessages(conversationId, { limit: 100 }, { signal })).items),
    { enabled: conversationId !== undefined, staleTimeMs: 15_000 },
  );
}
