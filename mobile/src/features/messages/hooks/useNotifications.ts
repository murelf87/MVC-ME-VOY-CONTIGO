/**
 * Avisos (pantalla 27): lista paginada por cursor con filtro de categoría, marcar leído (uno o todos) y preferencias de
 * avisos. Tras marcar, se refrescan la lista y la insignia de la campana.
 */
import type { AppNotification, NotificationCategory, NotificationPreferences, NotificationPreferencesPatch, NotificationReadAllResponse } from "@/api/types";
import { useApiMutation, useApiQuery, usePaginatedQuery, type UseApiMutationResult, type UseApiQueryResult, type UsePaginatedQueryResult } from "@/hooks";
import { getNotificationPreferences, listNotifications, markAllNotificationsRead, markNotificationRead, patchNotificationPreferences } from "../api";
import { NOTIFICATIONS, PREFERENCES_KEY, UNREAD_NOTIFICATIONS_KEY, notificationsKey } from "./keys";

const PAGE_SIZE = 20;
export const NOTIFICATIONS_POLL_MS = 30_000;

export type NotificationListState = Omit<UsePaginatedQueryResult<AppNotification>, "pages"> & { unreadCount: number };

export function useNotificationList(category: NotificationCategory | null): NotificationListState {
  const { pages, ...list } = usePaginatedQuery<AppNotification>(
    notificationsKey(category),
    ({ cursor, signal }) => listNotifications({ ...(category !== null ? { category } : {}), cursor, limit: PAGE_SIZE }, { signal }),
    { refetchIntervalMs: NOTIFICATIONS_POLL_MS, staleTimeMs: 10_000 },
  );
  const first = pages[0] as { unreadCount?: unknown } | undefined;
  return { ...list, unreadCount: typeof first?.unreadCount === "number" ? first.unreadCount : list.items.filter((n) => !n.read).length };
}

const AFFECTED = [NOTIFICATIONS, UNREAD_NOTIFICATIONS_KEY] as const;

export function useMarkNotificationRead(): UseApiMutationResult<AppNotification, string> {
  return useApiMutation<AppNotification, string>((id, { signal }) => markNotificationRead(id, { signal }), { invalidates: AFFECTED });
}

export function useMarkAllNotificationsRead(): UseApiMutationResult<NotificationReadAllResponse, NotificationCategory | null> {
  return useApiMutation<NotificationReadAllResponse, NotificationCategory | null>(
    (category, { signal }) => markAllNotificationsRead(category === null ? {} : { category }, { signal }),
    { invalidates: AFFECTED },
  );
}

export function useNotificationPreferences(): UseApiQueryResult<NotificationPreferences> {
  return useApiQuery<NotificationPreferences>(PREFERENCES_KEY, ({ signal }) => getNotificationPreferences({ signal }), { staleTimeMs: 30_000 });
}

/** Tras cambiar un tipo opcional, la lista y la insignia cambian (los avisos de ese tipo se ocultan o reaparecen). */
export function usePatchNotificationPreferences(): UseApiMutationResult<NotificationPreferences, NotificationPreferencesPatch> {
  return useApiMutation<NotificationPreferences, NotificationPreferencesPatch>((patch, { signal }) => patchNotificationPreferences(patch, { signal }), {
    invalidates: [PREFERENCES_KEY, ...AFFECTED],
  });
}
