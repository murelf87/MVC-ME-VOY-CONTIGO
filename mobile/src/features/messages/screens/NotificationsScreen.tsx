/**
 * 27 · Notificaciones. Filtros «Todas · Viajes · Mensajes · Pagos», tarjetas de aviso (tocar abre lo que toca y lo marca
 * leído) y, bajo la lista, «Tipos de notificaciones»: «Avisos esenciales del viaje» (siempre activado y bloqueado, el
 * servidor lo rechaza si se intenta apagar) y «Avisos opcionales de llegada» (se guarda al momento; si falla, vuelve a su
 * valor real). Estados: cargando · error · vacío por filtro · sin conexión · cargar más · marcar todas como leídas.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { AppNotification, NotificationCategory } from "@/api/types";
import { useIsOnline } from "@/hooks";
import { Icon } from "@/icons";
import { IconTile } from "@/icons/IconTile";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { Banner, EmptyState, ErrorStateCard, ListRow, OfflineBanner, Screen, ScreenHeader, SkeletonList, Spinner, Switch, Text, showToast } from "@/ui";
import { NotificationCard } from "../components/NotificationCard";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotificationList, useNotificationPreferences, usePatchNotificationPreferences } from "../hooks/useNotifications";
import { useNow } from "../hooks/useNow";
import { emptyCopyFor, targetOf } from "../model/notifications";
import { messagesStrings } from "../strings";

const copy = messagesStrings.notifications;
const FILTERS: ReadonlyArray<{ value: NotificationCategory | null; label: string; icon: "car" | "chat" | "coins" | null }> = [
  { value: null, label: copy.filterAll, icon: null },
  { value: "trip", label: copy.filterTrip, icon: "car" },
  { value: "message", label: copy.filterMessage, icon: "chat" },
  { value: "payment", label: copy.filterPayment, icon: "coins" },
];

export function NotificationsScreen({ navigation, route }: AppScreenProps<"Notifications">): React.JSX.Element {
  const requested = route.params?.category ?? null;
  const [category, setCategory] = React.useState<NotificationCategory | null>(requested);
  React.useEffect(() => setCategory(requested), [requested]);

  const list = useNotificationList(category);
  const prefs = useNotificationPreferences();
  const patch = usePatchNotificationPreferences();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const now = useNow();
  const online = useIsOnline();

  const open = React.useCallback(
    (n: AppNotification) => {
      if (!n.read) void markRead.mutate(n.id);
      const target = targetOf(n);
      if (target === null) return;
      (navigation.navigate as (name: string, params?: object) => void)(target.name, target.params);
    },
    [navigation, markRead],
  );

  const readAll = async (): Promise<void> => {
    if (list.unreadCount === 0) {
      showToast({ kind: "info", message: copy.markAllReadNone });
      return;
    }
    const result = await markAll.mutate(category);
    if (result) showToast({ kind: "success", message: result.updated === 0 ? copy.markAllReadNone : copy.markAllReadDone(result.updated) });
    else showToast({ kind: "error", message: copy.markReadFailed });
  };

  const arrival = patch.isPending && patch.variables?.arrivalAlerts !== undefined ? patch.variables.arrivalAlerts : (prefs.data?.arrivalAlerts ?? true);
  const toggleArrival = async (next: boolean): Promise<void> => {
    const saved = await patch.mutate({ arrivalAlerts: next });
    if (!saved) showToast({ kind: "error", message: copy.preferencesSaveFailed });
  };

  const hasItems = list.items.length > 0;
  const showOffline = list.isOffline || !online;
  const empty = emptyCopyFor(category);

  const types = (
    <View style={styles.types} testID="Notifications.types">
      <Text variant="titleSm" color="heading" size={19} lineHeight={24} style={styles.typesTitle}>
        {copy.typesTitle}
      </Text>
      {prefs.isError && prefs.data === undefined ? (
        <ErrorStateCard testID="Notifications.prefsError" tone="red" icon="alertCircle" title={copy.preferencesErrorTitle} message={describeError(prefs.error).message} actionLabel={messagesStrings.common.retry} onAction={() => void prefs.refetch()} />
      ) : (
        <>
          <ListRow
            testID="Notifications.essential"
            title={copy.essentialTitle}
            subtitle={copy.essentialBody}
            titleSize={17}
            leading={<IconTile name="car" tone="white" size={46} iconSize={26} />}
            trailing={<Switch testID="Notifications.essentialSwitch" value disabled tone="blue" onValueChange={() => undefined} accessibilityLabel={`${copy.essentialTitle}. ${copy.essentialLocked}`} />}
            accessibilityHint={copy.essentialLocked}
          />
          <ListRow
            testID="Notifications.arrival"
            title={copy.optionalTitle}
            subtitle={copy.optionalBody}
            titleSize={17}
            leading={<IconTile name="bell" tone="white" size={46} iconSize={26} />}
            trailing={<Switch testID="Notifications.arrivalSwitch" value={arrival} disabled={prefs.data === undefined || patch.isPending} tone="blue" onValueChange={(v) => void toggleArrival(v)} accessibilityLabel={copy.optionalTitle} />}
            style={styles.typeGap}
          />
          {prefs.data !== undefined && !prefs.data.push.available ? (
            <Banner testID="Notifications.pushOff" kind="notice" size="sm" title={copy.pushUnavailableTitle} message={copy.pushUnavailableBody} style={styles.typeGap} />
          ) : null}
          <ListRow testID="Notifications.moreSettings" title={copy.moreSettings} tone="none" titleSize={16} onPress={() => navigation.navigate("NotificationSettings")} style={styles.typeGap} />
        </>
      )}
    </View>
  );

  let body: React.ReactNode;
  if (list.isLoading) {
    body = (
      <View testID="Notifications.loading">
        <SkeletonList count={4} variant="row" />
      </View>
    );
  } else if (list.isError && !hasItems) {
    body = <ErrorStateCard testID="Notifications.error" tone="red" icon="alertCircle" title={copy.loadErrorTitle} message={list.error ? describeError(list.error).message : copy.loadErrorMessage} actionLabel={messagesStrings.common.retry} onAction={() => void list.refetch()} />;
  } else if (!hasItems) {
    body = <EmptyState testID="Notifications.empty" icon="bell" title={empty.title} message={empty.message} variant="plain" />;
  } else {
    body = (
      <View style={styles.list}>
        {list.items.map((n) => (
          <NotificationCard key={n.id} notification={n} now={now} hasTarget={targetOf(n) !== null} onPress={open} />
        ))}
        {list.isFetchingMore ? <Spinner size="sm" /> : null}
        {list.hasMore && !list.isFetchingMore ? (
          <Text variant="rowTextStrong" color="link" underline align="center" accessibilityRole="button" testID="Notifications.loadMore" onPress={() => void list.fetchMore()}>
            {list.fetchMoreError ? messagesStrings.common.loadMoreError : messagesStrings.common.loadMore}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <Screen testID="Notifications" scroll padded={false} header={<ScreenHeader title={copy.title} testID="Notifications.header" />} refreshing={list.isRefreshing} onRefresh={() => void list.refresh()} contentContainerStyle={styles.content}>
      <View testID="Notifications.filters" accessibilityRole="tablist" accessibilityLabel={copy.filtersA11y} style={styles.filters}>
        {FILTERS.map((f) => {
          const selected = f.value === category;
          return (
            <Text
              key={f.label}
              testID={`Notifications.filter.${f.value ?? "all"}`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setCategory(f.value)}
              variant="subtitle"
              color={selected ? "inverse" : "heading"}
              size={16}
              numberOfLines={1}
              style={[styles.pill, selected ? styles.pillOn : styles.pillOff]}
            >
              {f.label}
            </Text>
          );
        })}
      </View>
      {showOffline ? <OfflineBanner testID="Notifications.offline" title={messagesStrings.common.offlineTitle} detail={messagesStrings.common.offlineDetail} retryLabel={messagesStrings.common.retry} onRetry={() => void list.refetch()} style={styles.offline} /> : null}
      {list.unreadCount > 0 ? (
        <Text testID="Notifications.markAll" variant="rowTextStrong" color="link" underline align="right" accessibilityRole="button" onPress={() => void readAll()} style={styles.markAll}>
          {copy.markAllRead}
        </Text>
      ) : null}
      <View style={styles.body}>{body}</View>
      {types}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 28 },
  filters: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingTop: 8 },
  pill: { flexGrow: 1, flexShrink: 1, textAlign: "center", paddingVertical: 10, paddingHorizontal: 10, borderRadius: 22, overflow: "hidden" },
  pillOn: { backgroundColor: colors.primary },
  pillOff: { backgroundColor: colors.bg.tintSoft, borderWidth: 1, borderColor: colors.border.soft },
  offline: { marginHorizontal: 14, marginTop: 10 },
  markAll: { paddingHorizontal: 18, paddingTop: 10 },
  body: { paddingHorizontal: 14, paddingTop: 12 },
  list: { gap: 12 },
  types: { paddingHorizontal: 14, paddingTop: 22 },
  typesTitle: { marginBottom: 10 },
  typeGap: { marginTop: 10 },
});
