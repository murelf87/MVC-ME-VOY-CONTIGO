/**
 * Cabecera de un chat (`GET /v1/conversations/:id`) y el acceso que el servidor concede a esta persona. El contrato
 * distingue tres casos que NO son un error de red y tienen su propia pantalla (lámina 26, estados):
 *   · 403 CHAT_BLOCKED          una de las dos personas bloqueó a la otra.
 *   · 403 CHAT_FORBIDDEN        la reserva ya no está vigente (cancelada) o se salió del grupo.
 *   · 404 CONVERSATION_NOT_FOUND no existe o no es suya.
 */
import { describeError, isApiError, type ErrorDescription } from "@/api";
import type { ConversationDetail } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getConversation } from "../api";
import { conversationKey } from "./keys";

export type ChatAccess = "ok" | "blocked" | "closed" | "gone";

/** Código del servidor → acceso. `null` si el error no tiene que ver con permisos. */
export function accessFromErrorCode(code: string | null | undefined): Exclude<ChatAccess, "ok"> | null {
  if (code === "CHAT_BLOCKED") return "blocked";
  if (code === "CHAT_FORBIDDEN") return "closed";
  if (code === "CONVERSATION_NOT_FOUND") return "gone";
  return null;
}

export interface ConversationState {
  query: UseApiQueryResult<ConversationDetail>;
  detail: ConversationDetail | undefined;
  /** `ok` mientras no haya una negativa del servidor. */
  access: ChatAccess;
  /** Error de carga que NO es una negativa de acceso (red, servidor): la pantalla ofrece «Reintentar». */
  loadError: ErrorDescription | null;
}

export function useConversation(conversationId: string): ConversationState {
  const query = useApiQuery<ConversationDetail>(
    conversationKey(conversationId),
    ({ signal }) => getConversation(conversationId, { signal }),
    { staleTimeMs: 20_000 },
  );
  const refusal = isApiError(query.error) ? accessFromErrorCode(query.error.code) : null;
  const loadError = query.error !== null && refusal === null && query.data === undefined ? describeError(query.error) : null;
  return { query, detail: query.data, access: refusal ?? "ok", loadError };
}
