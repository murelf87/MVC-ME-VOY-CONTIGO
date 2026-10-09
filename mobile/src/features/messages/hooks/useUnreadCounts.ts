/**
 * Contadores de «no leído» para las insignias de otras pantallas (barra inferior, campana del mapa). Se sondean cada 30 s
 * mientras la pantalla que los usa está a la vista; sin sesión no se pide nada.
 *
 * `GET /v1/conversations/unread-count` es ligero a propósito y, además, marca como ENTREGADOS los mensajes recibidos
 * (los dos ticks grises de la otra persona), por eso conviene que el sondeo siga vivo aunque no se abra la bandeja.
 */
import { useAuth } from "@/session";
import { useApiQuery } from "@/hooks";
import { getConversationUnreadCount, getNotificationUnreadCount } from "../api";
import { UNREAD_MESSAGES_KEY, UNREAD_NOTIFICATIONS_KEY } from "./keys";

export const UNREAD_POLL_MS = 30_000;

export interface UnreadMessages {
  total: number;
  direct: number;
  groups: number;
  conversationsWithUnread: number;
}

const NONE: UnreadMessages = { total: 0, direct: 0, groups: 0, conversationsWithUnread: 0 };

export function useUnreadMessages(): UnreadMessages {
  const { isSignedIn } = useAuth();
  const query = useApiQuery(UNREAD_MESSAGES_KEY, ({ signal }) => getConversationUnreadCount({ signal }), {
    enabled: isSignedIn,
    staleTimeMs: 15_000,
    refetchIntervalMs: UNREAD_POLL_MS,
  });
  return query.data ?? NONE;
}

/** Total de mensajes sin leer (cifra de la insignia de «Mensajes»). */
export function useUnreadMessageCount(): number {
  return useUnreadMessages().total;
}

/** Total de notificaciones sin leer (cifra de la campana). */
export function useUnreadNotificationCount(): number {
  const { isSignedIn } = useAuth();
  const query = useApiQuery(UNREAD_NOTIFICATIONS_KEY, ({ signal }) => getNotificationUnreadCount({ signal }), {
    enabled: isSignedIn,
    staleTimeMs: 15_000,
    refetchIntervalMs: UNREAD_POLL_MS,
  });
  return query.data?.total ?? 0;
}
