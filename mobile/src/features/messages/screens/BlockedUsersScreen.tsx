/**
 * Personas bloqueadas (sin lámina; se diseña con la 25 y la 34 al lado). Lista paginada con «Desbloquear» y confirmación.
 * Estados: cargando · vacío · error · sin conexión · lista · desbloqueando.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { BlockedUser } from "@/api/types";
import { useIsOnline } from "@/hooks";
import { formatDateShort } from "@/i18n";
import type { AppScreenProps } from "@/navigation/types";
import { Avatar, Button, ConfirmDialog, EmptyState, ErrorStateCard, ListRow, OfflineBanner, Screen, ScreenHeader, SkeletonList, Spinner, Text, showToast } from "@/ui";
import { useBlockActions } from "../hooks/useBlockActions";
import { useBlockedUsers } from "../hooks/useBlockedUsers";
import { messagesStrings } from "../strings";

const copy = messagesStrings.blocked;
const SIDE = 14;

export function BlockedUsersScreen(_props: AppScreenProps<"BlockedUsers">): React.JSX.Element {
  const list = useBlockedUsers();
  const actions = useBlockActions();
  const online = useIsOnline();
  const [target, setTarget] = React.useState<BlockedUser | null>(null);

  const confirm = async (): Promise<void> => {
    if (target === null) return;
    const name = target.user.firstName;
    try {
      await actions.unblock.mutateAsync(target.user.id);
      setTarget(null);
      showToast({ kind: "success", message: copy.unblocked(name) });
      void list.refresh();
    } catch {
      setTarget(null);
      showToast({ kind: "error", message: copy.unblockFailed });
    }
  };

  let body: React.ReactNode;
  if (list.isLoading && list.items.length === 0) {
    body = <SkeletonList count={4} testID="BlockedUsers.loading" />;
  } else if (list.isError && list.items.length === 0) {
    body = <ErrorStateCard testID="BlockedUsers.error" tone="red" icon="alertCircle" title={copy.loadErrorTitle} message={describeError(list.error).message} actionLabel={messagesStrings.common.retry} onAction={() => void list.refetch()} />;
  } else if (list.items.length === 0) {
    body = <EmptyState testID="BlockedUsers.empty" icon="shield" title={copy.emptyTitle} message={copy.emptyMessage} variant="plain" />;
  } else {
    body = (
      <View testID="BlockedUsers.list">
        {list.items.map((item) => (
          <ListRow
            key={item.user.id}
            testID={`BlockedUsers.row.${item.user.id}`}
            title={item.user.displayName}
            subtitle={copy.blockedOn(formatDateShort(item.blockedAt))}
            titleSize={17}
            leading={<Avatar source={item.user.photoUrl} name={item.user.displayName} size={48} />}
            trailing={<Button testID={`BlockedUsers.unblock.${item.user.id}`} label={copy.unblock} variant="outline" size="sm" inline chevron={false} accessibilityLabel={copy.unblockA11y(item.user.firstName)} onPress={() => { actions.unblock.reset(); setTarget(item); }} />}
            style={styles.row}
          />
        ))}
        {list.hasMore ? (
          <View style={styles.more}>
            {list.isFetchingMore ? <Spinner size="sm" /> : <Text variant="rowTextStrong" color="link" underline align="center" accessibilityRole="button" testID="BlockedUsers.loadMore" onPress={() => void list.fetchMore()}>{messagesStrings.common.seeMore}</Text>}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <Screen testID="BlockedUsers" paddingX={SIDE} header={<ScreenHeader title={copy.title} testID="BlockedUsers.header" />} refreshing={list.isRefreshing} onRefresh={() => void list.refresh()}>
      <View style={styles.block}>
        <Text variant="body" color="body" size={16} lineHeight={22} testID="BlockedUsers.intro">{copy.intro}</Text>
        {list.isOffline || !online ? <OfflineBanner testID="BlockedUsers.offline" title={messagesStrings.common.offlineTitle} detail={messagesStrings.common.offlineDetail} retryLabel={messagesStrings.common.retry} onRetry={() => void list.refetch()} style={styles.row} /> : null}
        <View style={styles.row}>{body}</View>
      </View>
      <ConfirmDialog
        visible={target !== null}
        loading={actions.unblock.isPending}
        title={target ? copy.confirmTitle(target.user.firstName) : ""}
        message={copy.confirmMessage}
        confirmLabel={copy.confirmYes}
        cancelLabel={messagesStrings.common.cancel}
        onConfirm={() => void confirm()}
        onCancel={() => setTarget(null)}
        testID="BlockedUsers.dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { paddingTop: 8, paddingBottom: 24 },
  row: { marginTop: 10 },
  more: { paddingVertical: 14, alignItems: "center" },
});
