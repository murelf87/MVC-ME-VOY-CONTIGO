/**
 * 25 · Mensajes (bandeja). Búsqueda, pestañas «Todos · Mis reservas · Grupos», filas con foto, subtítulo azul, vista previa,
 * hora e insignia roja de no leídos, y al final de la lista la tarjeta «Aún no tienes más mensajes».
 *
 * Datos: `GET /v1/conversations` paginado por cursor (`useConversationList`), con sondeo suave cada 20 s mientras la pantalla
 * está a la vista. Estados: cargando (esqueleto), vacío (según pestaña y búsqueda), error con «Reintentar», sin conexión
 * (franja + se conserva lo ya cargado) y cargar más al llegar al final.
 */
import React from "react";
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from "react-native";
import type { ConversationFilter, ConversationSummary } from "@/api/types";
import { describeError } from "@/api";
import { useIsOnline } from "@/hooks";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { EmptyState, ErrorStateCard, OfflineBanner, Screen, ScreenHeader, SkeletonList, Spinner, Text } from "@/ui";
import { ConversationRow } from "../components/ConversationRow";
import { InboxSearchField } from "../components/InboxSearchField";
import { InboxTabs, type InboxTabOption } from "../components/InboxTabs";
import { useConversationList } from "../hooks/useConversationList";
import { useNow } from "../hooks/useNow";
import { useUnreadMessages } from "../hooks/useUnreadCounts";
import { INBOX_TABS, MAX_SEARCH_CHARS, emptyCopy, isConversationFilter } from "../model/inbox";
import { messagesStrings } from "../strings";

const copy = messagesStrings.inbox;

/** Anchos relativos de las tres pestañas en la lámina (pt): Todos 109 · Mis reservas 129 · Grupos 102. */
const TAB_WEIGHTS: Record<ConversationFilter, number> = { all: 109, bookings: 129, groups: 102 };

function keyOf(item: ConversationSummary): string {
  return item.id;
}

export function InboxScreen({ navigation, route }: AppScreenProps<"Inbox">): React.JSX.Element {
  const requested = route.params?.filter;
  const [filter, setFilter] = React.useState<ConversationFilter>(isConversationFilter(requested) ? requested : "all");
  const [search, setSearch] = React.useState("");

  // Si la pantalla se reabre con otro filtro (enlace o aviso), se respeta.
  React.useEffect(() => {
    if (isConversationFilter(requested)) setFilter(requested);
  }, [requested]);

  const list = useConversationList(filter, search);
  const unread = useUnreadMessages();
  const now = useNow();
  const online = useIsOnline();

  const openConversation = React.useCallback(
    (conversation: ConversationSummary) => {
      navigation.navigate("BookingChat", { conversationId: conversation.id });
    },
    [navigation],
  );

  const tabs = React.useMemo<InboxTabOption<ConversationFilter>[]>(
    () =>
      INBOX_TABS.map((tab) => {
        const count = tab.value === "all" ? unread.total : tab.value === "bookings" ? unread.direct : unread.groups;
        return {
          value: tab.value,
          label: tab.label,
          weight: TAB_WEIGHTS[tab.value],
          accessibilityLabel: count > 0 ? `${tab.label}, ${copy.unreadA11y(count)}` : tab.label,
        };
      }),
    [unread.total, unread.direct, unread.groups],
  );

  const renderItem = React.useCallback(
    ({ item }: ListRenderItemInfo<ConversationSummary>) => <ConversationRow conversation={item} now={now} onPress={openConversation} />,
    [now, openConversation],
  );

  const empty = emptyCopy(filter, list.query);
  const hasItems = list.items.length > 0;
  const showOffline = list.isOffline || !online;

  const footer = (() => {
    if (list.isFetchingMore) {
      return (
        <View style={styles.footerSpinner} accessible accessibilityLabel={messagesStrings.common.loadMore} testID="Inbox.loadingMore">
          <Spinner size="sm" />
        </View>
      );
    }
    if (list.fetchMoreError !== null && list.hasMore) {
      return (
        <View style={styles.footerSpinner}>
          <Text variant="rowText" color="muted" align="center">
            {messagesStrings.common.loadMoreError}
          </Text>
          <Text variant="rowTextStrong" color="link" underline align="center" onPress={() => void list.fetchMore()} accessibilityRole="button" testID="Inbox.loadMoreRetry" style={styles.footerRetry}>
            {messagesStrings.common.retry}
          </Text>
        </View>
      );
    }
    if (!list.hasMore && hasItems && list.query === null) {
      return <EmptyState testID="Inbox.end" icon="chatText" title={copy.endTitle} message={copy.endMessage} style={styles.endCard} />;
    }
    return null;
  })();

  let body: React.ReactNode;
  if (list.isLoading) {
    body = (
      <View style={styles.skeleton} testID="Inbox.loading">
        <SkeletonList count={5} variant="row" />
      </View>
    );
  } else if (list.isError && !hasItems) {
    const described = list.error !== null ? describeError(list.error) : null;
    body = (
      <View style={styles.state}>
        <ErrorStateCard
          testID="Inbox.error"
          tone="red"
          icon="alertCircle"
          title={copy.loadErrorTitle}
          message={described?.message ?? copy.loadErrorMessage}
          actionLabel={messagesStrings.common.retry}
          onAction={() => void list.refetch()}
        />
      </View>
    );
  } else if (!hasItems && !list.isFetching) {
    body = (
      <View style={styles.state}>
        {empty !== null ? (
          <EmptyState
            testID="Inbox.empty"
            icon={list.query !== null ? "search" : "chatText"}
            title={empty.title}
            message={empty.message}
            {...(list.query !== null
              ? { actionLabel: copy.searchClear, onAction: () => setSearch("") }
              : {})}
          />
        ) : (
          <EmptyState testID="Inbox.empty" icon="chatText" title={copy.endTitle} message={copy.endMessage} />
        )}
      </View>
    );
  } else {
    body = (
      <FlatList
        testID="Inbox.list"
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={list.items}
        keyExtractor={keyOf}
        renderItem={renderItem}
        ListFooterComponent={footer}
        onEndReached={() => void list.fetchMore()}
        onEndReachedThreshold={0.4}
        refreshing={list.isRefreshing}
        onRefresh={() => void list.refresh()}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        windowSize={7}
      />
    );
  }

  return (
    <Screen
      testID="Inbox"
      scroll={false}
      padded={false}
      header={<ScreenHeader title={copy.title} testID="Inbox.header" />}
    >
      <View style={styles.top}>
        <InboxSearchField
          value={search}
          onChangeText={setSearch}
          placeholder={copy.searchPlaceholder}
          accessibilityLabel={copy.searchA11y}
          clearLabel={copy.searchClear}
          maxLength={MAX_SEARCH_CHARS}
        />
        <InboxTabs options={tabs} value={filter} onChange={setFilter} accessibilityLabel={copy.tabsA11y} style={styles.tabs} />
        {list.searchTooShort ? (
          <Text variant="rowText" color="muted" size={15} lineHeight={20} style={styles.hint} testID="Inbox.searchHint">
            {copy.searchHint}
          </Text>
        ) : null}
        {showOffline ? (
          <OfflineBanner
            testID="Inbox.offline"
            title={messagesStrings.common.offlineTitle}
            detail={messagesStrings.common.offlineDetail}
            retryLabel={messagesStrings.common.retry}
            onRetry={() => void list.refetch()}
            style={styles.offline}
          />
        ) : null}
      </View>
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 15, paddingTop: 4 },
  tabs: { marginTop: 13 },
  hint: { marginTop: 8, paddingHorizontal: 8 },
  offline: { marginTop: 10 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 3, paddingTop: 12, paddingBottom: 24, backgroundColor: colors.bg.screen },
  skeleton: { paddingHorizontal: 15, paddingTop: 16 },
  state: { paddingHorizontal: 15, paddingTop: 16 },
  endCard: { marginTop: 14, marginHorizontal: 12 },
  footerSpinner: { paddingVertical: 16, alignItems: "center" },
  footerRetry: { marginTop: 6, paddingVertical: 10, paddingHorizontal: 12 },
});
