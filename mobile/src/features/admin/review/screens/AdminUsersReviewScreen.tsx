import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AdminReviewTab } from "@/api/types";
import type { AppScreenProps } from "@/navigation";
import { ConfirmDialog, EmptyState, Screen } from "@/ui";
import { AdminHeader } from "../components/AdminHeader";
import { CheckingAccess, NoPermission, PanelError } from "../components/AccessStates";
import { FilterSelect } from "../components/FilterSelect";
import { CardListSkeleton, LoadMore, PrivateAccessNote, RefreshFailedStrip } from "../components/ListStates";
import { PillTabs, type PillTab } from "../components/PillTabs";
import { ReasonSheet } from "../components/ReasonSheet";
import { ReviewQueueCard } from "../components/ReviewQueueCard";
import { StaffAccessSheet } from "../components/StaffAccessSheet";
import { useAdminGate } from "../hooks/useAdminGate";
import { useQueueDecisions } from "../hooks/useQueueDecisions";
import { useRetained } from "../hooks/useRetained";
import { useReviewQueue } from "../hooks/useReviewQueue";
import { adminError } from "../logic/errors";
import { staffFirstName, staffInitial } from "../logic/permissions";
import {
  fromItemFilter,
  fromRoleFilter,
  itemFilterOptions,
  itemFilterValue,
  roleFilterOptions,
  roleFilterValue,
  sortOptions,
  type ItemFilterValue,
  type RoleFilterValue,
  type SortValue,
} from "../logic/queueOptions";
import { DEFAULT_QUEUE_FILTERS, hasActiveFilters, itemFilterText, roleFilterText, sortText, tabOptions, type QueueFilters } from "../logic/reviewQueue";
import { reviewStrings } from "../strings";

const s = reviewStrings.users;

/**
 * Lámina 38a/38b · «Usuarios y revisión»: la cola de trabajo del personal de verificación. Pestañas Pendientes / Aprobados /
 * Rechazados, filtros por elemento, rol y orden, y una tarjeta por persona con sus elementos entregados. Decide desde la
 * propia tarjeta («Aprobar» / «Rechazar» con motivo) o abre el expediente completo.
 *
 * RBAC: solo Administración y Verificación (`review`). Otro rol ve «Sin permiso». Las decisiones las audita el servidor.
 */
export function AdminUsersReviewScreen({ navigation, route }: AppScreenProps<"AdminUsersReview">): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const gate = useAdminGate((access) => access.canRead("review"));
  const { access } = gate;
  const ready = gate.state === "ready";
  const canWrite = access.canWrite("review");
  const myId = access.me?.userId ?? null;

  const [filters, setFilters] = useState<QueueFilters>(DEFAULT_QUEUE_FILTERS);
  const queue = useReviewQueue(filters, ready);
  const decisions = useQueueDecisions(
    useCallback(() => {
      void queue.refresh();
    }, [queue]),
  );
  const approving = useRetained(decisions.approving);
  const rejecting = useRetained(decisions.rejecting);

  // `userId` en los parámetros: abre directamente el expediente de esa persona (una sola vez).
  const requestedUser = route.params?.userId;
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (requestedUser !== undefined && ready && opened.current !== requestedUser) {
      opened.current = requestedUser;
      navigation.navigate("AdminUserFile", { userId: requestedUser });
    }
  }, [requestedUser, ready, navigation]);

  const openDossier = useCallback((userId: string) => navigation.navigate("AdminUserFile", { userId }), [navigation]);
  const changeTab = useCallback((tab: AdminReviewTab) => setFilters((current) => ({ ...current, tab })), []);
  const changeItem = useCallback((value: ItemFilterValue) => setFilters((current) => ({ ...current, item: fromItemFilter(value) })), []);
  const changeRole = useCallback((value: RoleFilterValue) => setFilters((current) => ({ ...current, role: fromRoleFilter(value) })), []);
  const changeSort = useCallback((sort: SortValue) => setFilters((current) => ({ ...current, sort })), []);
  const clearFilters = useCallback(() => setFilters((current) => ({ ...current, role: null, item: null })), []);

  const tabs = useMemo<Array<PillTab<AdminReviewTab>>>(() => tabOptions(queue.counts), [queue.counts]);
  const itemOptions = useMemo(itemFilterOptions, []);
  const roleOptions = useMemo(roleFilterOptions, []);
  const orderOptions = useMemo(sortOptions, []);

  const listError = queue.isError ? adminError(queue.error) : null;
  const loading = queue.isIdle || queue.isLoading;

  let body: React.ReactNode;
  if (gate.state === "checking") {
    body = <CheckingAccess />;
  } else if (gate.state === "error" && gate.error !== null) {
    body = <PanelError error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} testID="AdminUsersReview.error" />;
  } else if (gate.state === "denied") {
    body = (
      <NoPermission
        testID="AdminUsersReview.denied"
        message={reviewStrings.access.deniedMessage(reviewStrings.access.areaLabels.review)}
        onGoHome={gate.goHome}
      />
    );
  } else if (listError !== null) {
    body = <PanelError error={listError} onRetry={() => void queue.refresh()} onGoHome={gate.goHome} testID="AdminUsersReview.listError" />;
  } else if (loading) {
    body = <CardListSkeleton testID="AdminUsersReview.loading" />;
  } else if (queue.isEmpty) {
    const filtered = hasActiveFilters(filters);
    body = (
      <EmptyState
        testID="AdminUsersReview.empty"
        icon={filtered ? "filter" : "shield"}
        title={filtered ? s.emptyFilteredTitle : s.emptyTitle[filters.tab]}
        message={filtered ? s.emptyFilteredMessage : s.emptyMessage[filters.tab]}
        actionLabel={filtered ? s.filters.clear : undefined}
        onAction={filtered ? clearFilters : undefined}
      />
    );
  } else {
    body = (
      <>
        {queue.failedToRefresh ? <RefreshFailedStrip offline={queue.isOffline} onRetry={() => void queue.refresh()} /> : null}
        {queue.items.map((item, index) => (
          <View key={item.userId} style={index > 0 ? styles.cardGap : null}>
            <ReviewQueueCard
              item={item}
              canWrite={canWrite}
              isOwn={myId !== null && item.userId === myId}
              busy={decisions.busy?.userId === item.userId ? decisions.busy.kind : null}
              onOpenDossier={openDossier}
              onApprove={decisions.askApprove}
              onReject={decisions.askReject}
              testID={`AdminUsersReview.card.${item.userId}`}
            />
          </View>
        ))}
        <LoadMore hasMore={queue.hasMore} loading={queue.isFetchingMore} failed={queue.fetchMoreError !== null} onPress={() => void queue.fetchMore()} />
      </>
    );
  }

  const header = (
    <View>
      <AdminHeader
        subtitle={s.subtitle}
        initial={staffInitial(access.me)}
        staffName={access.me?.displayName ?? null}
        onAvatarPress={gate.openSheet}
        testID="AdminUsersReview.header"
      />
      {ready ? (
        <View style={styles.controls}>
          <PillTabs tabs={tabs} value={filters.tab} onChange={changeTab} accessibilityLabel={s.tabsA11y} testID="AdminUsersReview.tab" />
          <View style={styles.filters}>
            <FilterSelect<ItemFilterValue>
              testID="AdminUsersReview.filter.item"
              value={itemFilterValue(filters.item)}
              displayText={itemFilterText(filters.item)}
              options={itemOptions}
              sheetTitle={s.filters.itemSheetTitle}
              accessibilityLabel={s.filters.itemA11y}
              onChange={changeItem}
              style={styles.filterItem}
            />
            <FilterSelect<RoleFilterValue>
              testID="AdminUsersReview.filter.role"
              value={roleFilterValue(filters.role)}
              displayText={roleFilterText(filters.role)}
              options={roleOptions}
              sheetTitle={s.filters.roleSheetTitle}
              accessibilityLabel={s.filters.roleA11y}
              onChange={changeRole}
              style={[styles.filterGap, styles.filterRole]}
            />
            <FilterSelect<SortValue>
              testID="AdminUsersReview.filter.sort"
              value={filters.sort}
              displayText={sortText(filters.sort)}
              options={orderOptions}
              sheetTitle={s.filters.sortSheetTitle}
              accessibilityLabel={s.filters.sortA11y}
              onChange={changeSort}
              style={[styles.filterGap, styles.filterSort]}
            />
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <Screen
        testID="AdminUsersReview"
        header={header}
        paddingX={11}
        refreshing={queue.isRefreshing}
        onRefresh={ready ? () => void queue.refresh() : undefined}
        contentContainerStyle={styles.list}
        bottomBar={
          ready ? (
            <View style={[styles.noteBar, { paddingBottom: Math.max(insets.bottom - 14.5, 8) }]}>
              <PrivateAccessNote />
            </View>
          ) : undefined
        }
      >
        {body}
      </Screen>

      <ConfirmDialog
        visible={decisions.approving !== null}
        title={approving !== null ? s.approveConfirmTitle(approving.displayName) : ""}
        message={approving !== null ? s.approveConfirmMessage(decisions.itemNames(approving)) : undefined}
        confirmLabel={s.approveConfirmLabel}
        icon="checkBold"
        loading={decisions.busy?.kind === "approve"}
        onConfirm={() => void decisions.confirmApprove()}
        onCancel={decisions.cancelApprove}
        testID="AdminUsersReview.approveDialog"
      />
      <ReasonSheet
        visible={decisions.rejecting !== null}
        title={rejecting !== null ? s.rejectSheetTitle(rejecting.displayName) : ""}
        subtitle={rejecting !== null ? s.rejectSheetSubtitle(decisions.itemNames(rejecting)) : undefined}
        confirmLabel={s.rejectConfirmLabel}
        tone="danger"
        busy={decisions.busy?.kind === "reject"}
        errorMessage={decisions.rejectError}
        textRequired
        textLabel={s.rejectReasonLabel}
        textPlaceholder={s.rejectReasonPlaceholder}
        textHelper={s.rejectReasonHelper}
        onConfirm={(input) => void decisions.confirmReject(input.reason)}
        onClose={decisions.cancelReject}
        testID="AdminUsersReview.rejectSheet"
      />
      <StaffAccessSheet
        visible={gate.sheetOpen}
        onClose={gate.closeSheet}
        me={access.me}
        loading={access.query.isLoading || access.query.isIdle}
        error={gate.error}
        onRetry={gate.retry}
        onGoHome={gate.goHome}
      />
    </>
  );
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: 11, paddingTop: 7 },
  filters: { flexDirection: "row", marginTop: 12.5 },
  filterItem: { flex: 108 },
  filterRole: { flex: 97.5 },
  filterSort: { flex: 149.5 },
  filterGap: { marginLeft: 8 },
  list: { paddingTop: 12.5, paddingBottom: 8 },
  cardGap: { marginTop: 8.5 },
  noteBar: { paddingHorizontal: 11, paddingTop: 8 },
});
