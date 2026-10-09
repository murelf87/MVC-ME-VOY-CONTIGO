/**
 * Claves de la caché de consultas del slice `messages`. Un prefijo invalida todo lo que cuelga de él:
 * `queryCache.invalidate(CONVERSATIONS)` refresca la bandeja en todas sus pestañas y búsquedas.
 */
import type { ConversationFilter, NotificationCategory } from "@/api/types";

/** Prefijo de todas las listas de la bandeja. */
export const CONVERSATIONS = ["conversations"] as const;
export const NOTIFICATIONS = ["notifications"] as const;

export function conversationsKey(filter: ConversationFilter, query: string | null): readonly unknown[] {
  return ["conversations", filter, query ?? ""];
}

export function conversationKey(conversationId: string): readonly unknown[] {
  return ["conversation", conversationId];
}

export function threadKey(conversationId: string): readonly unknown[] {
  return ["chat-thread", conversationId];
}

export function callContactKey(conversationId: string): readonly unknown[] {
  return ["call-contact", conversationId];
}

export const UNREAD_MESSAGES_KEY = ["conversations-unread"] as const;
export const UNREAD_NOTIFICATIONS_KEY = ["notifications-unread"] as const;

export function notificationsKey(category: NotificationCategory | null): readonly unknown[] {
  return ["notifications", category ?? "all"];
}

export const PREFERENCES_KEY = ["notification-preferences"] as const;
export const BLOCKS_KEY = ["blocks"] as const;
export const BLOCKED_IDS_KEY = ["blocks", "ids"] as const;

export function cancellationPreviewKey(bookingId: string): readonly unknown[] {
  return ["cancellation-preview", bookingId];
}

export function cancelResultKey(bookingId: string): readonly unknown[] {
  return ["cancel-result", bookingId];
}

export function myRefundsKey(): readonly unknown[] {
  return ["my-refunds"];
}
