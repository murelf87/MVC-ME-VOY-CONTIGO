import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { AdminSupportTicketRow } from "@/api/types";
import { formatRelative } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Avatar, EmptyState, Screen, StatusPill, Text, type StatusTone } from "@/ui";
import { AdminHeader } from "../../review/components/AdminHeader";
import { CheckingAccess, NoPermission, PanelError } from "../../review/components/AccessStates";
import { FilterSelect } from "../../review/components/FilterSelect";
import { CardListSkeleton, LoadMore, RefreshFailedStrip } from "../../review/components/ListStates";
import { PillTabs, type PillTab } from "../../review/components/PillTabs";
import { StaffAccessSheet } from "../../review/components/StaffAccessSheet";
import { useAdminGate } from "../../review/hooks/useAdminGate";
import { adminError } from "../../review/logic/errors";
import { staffInitial } from "../../review/logic/permissions";
import { backofficeStrings } from "../backofficeStrings";
import { useSupportQueue } from "../hooks/useSupport";
import {
  DEFAULT_SUPPORT_FILTER,
  isMine,
  ticketTone,
  type SupportAssignedFilter,
  type SupportCategoryFilter,
  type SupportFilter,
  type SupportStatusFilter,
} from "../model/support";

const s = backofficeStrings.support;
const TONE: Record<ReturnType<typeof ticketTone>, StatusTone> = { amber: "amber", blue: "blue", gray: "gray" };

function TicketCard({ ticket, myId, onOpen }: { ticket: AdminSupportTicketRow; myId: string | null; onOpen: (id: string) => void }): React.JSX.Element {
  const mine = isMine(ticket, myId);
  const assigned = ticket.assignedTo === null ? s.unassigned : mine ? s.assignedToMe : s.assignedTo(ticket.assignedTo.displayName ?? "—");
  const when = ticket.status === "open" ? s.waiting(formatRelative(ticket.lastUserMessageAt).toLocaleLowerCase("es-ES")) : ticket.lastStaffMessageAt !== null ? s.answeredAt(formatRelative(ticket.lastStaffMessageAt).toLocaleLowerCase("es-ES")) : formatRelative(ticket.createdAt);
  return (
    <Pressable
      testID={`AdminSupportQueue.ticket.${ticket.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${ticket.reference}. ${ticket.user.displayName}. ${ticket.categoryLabel}. ${s.status[ticket.status] ?? ticket.status}. ${assigned}.`}
      onPress={() => onOpen(ticket.id)}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={styles.head}>
        <Avatar source={ticket.user.photoUrl} name={ticket.user.displayName} size="md" />
        <View style={styles.flex}>
          <Text variant="titleSm" color="heading" size={17.5} numberOfLines={1}>{ticket.user.displayName}</Text>
          <Text variant="caption" color="subtle" size={13.5}>{`${ticket.reference} · ${ticket.categoryLabel}`}</Text>
        </View>
        <StatusPill label={s.status[ticket.status] ?? ticket.status} tone={TONE[ticketTone(ticket.status)]} size="sm" />
      </View>
      <Text variant="body" color="body" size={15.5} numberOfLines={3}>{ticket.preview}</Text>
      <View style={styles.meta}>
        <Text variant="caption" color={ticket.assignedTo === null ? colors.warning.textStrong : "muted"} size={13.5}>{assigned}</Text>
        <Text variant="caption" color="subtle" size={13.5}>{`${s.messages(ticket.messageCount)}${ticket.attachmentCount > 0 ? ` · ${s.attachments(ticket.attachmentCount)}` : ""}`}</Text>
      </View>
      <Text variant="caption" color="subtle" size={13.5}>{when}</Text>
    </Pressable>
  );
}

/**
 * Atención al cliente (sin lámina): la cola de consultas del centro de ayuda. Pestañas por estado con sus totales
 * globales, filtros por asignación y categoría, y una tarjeta por consulta. La cola se refresca sola cada 30 s.
 */
export function AdminSupportQueueScreen({ navigation }: AppScreenProps<"AdminSupportQueue">): React.JSX.Element {
  const gate = useAdminGate((access) => access.canRead("support"));
  const { access } = gate;
  const ready = gate.state === "ready";
  const myId = access.me?.userId ?? null;
  const [filter, setFilter] = useState<SupportFilter>(DEFAULT_SUPPORT_FILTER);
  const queue = useSupportQueue(filter, ready);

  const counts = queue.counts;
  const tabs = useMemo<Array<PillTab<SupportStatusFilter>>>(
    () => [
      { value: "open", label: s.statusTabs.open ?? "", badge: counts?.open ?? null },
      { value: "answered", label: s.statusTabs.answered ?? "", badge: counts?.answered ?? null },
      { value: "closed", label: s.statusTabs.closed ?? "", badge: counts?.closed ?? null },
    ],
    [counts],
  );
  const assignedOptions = useMemo(() => (["any", "me", "unassigned"] as const).map((value) => ({ value: value as SupportAssignedFilter, label: s.assignedOptions[value] ?? value })), []);
  const categoryOptions = useMemo(
    () => [{ value: "all" as SupportCategoryFilter, label: s.categoryAll }, ...(["trip_issue", "payment_issue", "account_profile"] as const).map((value) => ({ value: value as SupportCategoryFilter, label: s.categoryLabels[value] ?? value }))],
    [],
  );

  const listError = queue.isError ? adminError(queue.error) : null;
  const loading = queue.isIdle || queue.isLoading;
  const filtered = filter.assigned !== "any" || filter.category !== "all";

  let body: React.ReactNode;
  if (gate.state === "checking") body = <CheckingAccess />;
  else if (gate.state === "error" && gate.error !== null) body = <PanelError error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} testID="AdminSupportQueue.error" />;
  else if (gate.state === "denied") body = <NoPermission testID="AdminSupportQueue.denied" message={s.deniedMessage} onGoHome={gate.goHome} />;
  else if (listError !== null) body = <PanelError error={listError} onRetry={() => void queue.refresh()} onGoHome={gate.goHome} testID="AdminSupportQueue.listError" />;
  else if (loading) body = <CardListSkeleton testID="AdminSupportQueue.loading" />;
  else if (queue.isEmpty) {
    body = (
      <EmptyState
        testID="AdminSupportQueue.empty"
        icon={filtered ? "filter" : "opsHeadset"}
        title={filtered ? s.emptyFilteredTitle : (s.emptyTitle[filter.status] ?? "")}
        message={filtered ? s.emptyFilteredMessage : s.emptyMessage}
        actionLabel={filtered ? s.clearFilters : undefined}
        onAction={filtered ? () => setFilter((current) => ({ ...current, assigned: "any", category: "all" })) : undefined}
      />
    );
  } else {
    body = (
      <>
        {queue.failedToRefresh ? <RefreshFailedStrip offline={queue.isOffline} onRetry={() => void queue.refresh()} /> : null}
        {queue.items.map((ticket, index) => (
          <View key={ticket.id} style={index > 0 ? styles.gap : null}>
            <TicketCard ticket={ticket} myId={myId} onOpen={(ticketId) => navigation.navigate("AdminSupportTicket", { ticketId })} />
          </View>
        ))}
        <LoadMore hasMore={queue.hasMore} loading={queue.isFetchingMore} failed={queue.fetchMoreError !== null} onPress={() => void queue.fetchMore()} testID="AdminSupportQueue.more" />
        <Text variant="caption" color="subtle" size={13} align="center" style={styles.hint}>{s.refreshHint}</Text>
      </>
    );
  }

  const header = (
    <View>
      <AdminHeader subtitle={s.subtitle} initial={staffInitial(access.me)} staffName={access.me?.displayName ?? null} onAvatarPress={gate.openSheet} testID="AdminSupportQueue.header" />
      {ready ? (
        <View style={styles.controls}>
          <PillTabs tabs={tabs} value={filter.status} onChange={(status) => setFilter((current) => ({ ...current, status }))} accessibilityLabel={s.tabsA11y} testID="AdminSupportQueue.tab" />
          <View style={styles.filters}>
            <FilterSelect<SupportAssignedFilter>
              testID="AdminSupportQueue.filter.assigned"
              value={filter.assigned}
              displayText={filter.assigned === "any" ? s.assignedSheet : (s.assignedOptions[filter.assigned] ?? "")}
              options={assignedOptions}
              sheetTitle={s.assignedSheet}
              accessibilityLabel={s.filtersA11y}
              onChange={(assigned) => setFilter((current) => ({ ...current, assigned }))}
              style={styles.filterA}
            />
            <FilterSelect<SupportCategoryFilter>
              testID="AdminSupportQueue.filter.category"
              value={filter.category}
              displayText={filter.category === "all" ? s.categorySheet : (s.categoryLabels[filter.category] ?? "")}
              options={categoryOptions}
              sheetTitle={s.categorySheet}
              accessibilityLabel={s.filtersA11y}
              onChange={(category) => setFilter((current) => ({ ...current, category }))}
              style={styles.filterB}
            />
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <Screen testID="AdminSupportQueue" header={header} paddingX={11} refreshing={queue.isRefreshing} onRefresh={ready ? () => void queue.refresh() : undefined} contentContainerStyle={styles.list}>
        {body}
      </Screen>
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
  flex: { flex: 1 },
  controls: { paddingHorizontal: 11, paddingTop: 7 },
  filters: { flexDirection: "row", gap: 8, marginTop: 12 },
  filterA: { flex: 1 },
  filterB: { flex: 1 },
  list: { paddingTop: 12, paddingBottom: 16 },
  gap: { marginTop: 10 },
  hint: { marginTop: 14 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 6 },
  pressed: { opacity: 0.85 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  meta: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
});
