/**
 * Bloquear y desbloquear a una persona (`PUT|DELETE /v1/me/blocks/:userId`, endpoints del núcleo). Bloquear corta el chat
 * directo (403 `CHAT_BLOCKED`), expulsa del grupo de ruta y oculta los mensajes mutuos, así que tras cualquiera de las dos
 * acciones se refrescan la bandeja, los chats abiertos, los contadores y la lista de bloqueados.
 */
import { useApiMutation, type UseApiMutationResult, type QueryKey } from "@/hooks";
import { blockUser, unblockUser } from "../api";
import { BLOCKS_KEY, CONVERSATIONS, UNREAD_MESSAGES_KEY } from "./keys";

const CONVERSATION_DETAILS: QueryKey = ["conversation"];

const AFFECTED: readonly QueryKey[] = [CONVERSATIONS, CONVERSATION_DETAILS, BLOCKS_KEY, UNREAD_MESSAGES_KEY];

export interface BlockActions {
  block: UseApiMutationResult<void, string>;
  unblock: UseApiMutationResult<void, string>;
}

export function useBlockActions(): BlockActions {
  const block = useApiMutation<void, string>((userId, { signal }) => blockUser(userId, { signal }), { invalidates: AFFECTED });
  const unblock = useApiMutation<void, string>((userId, { signal }) => unblockUser(userId, { signal }), { invalidates: AFFECTED });
  return { block, unblock };
}
