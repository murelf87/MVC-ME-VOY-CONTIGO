/**
 * Pestaña «Auditoría» (solo Administración): registro privado de lo que hace el personal. Filtros por tipo de acción
 * (preajustes) y avanzados (acción, persona, entidad y fechas). Los metadatos ya llegan sin datos personales («[oculto]»).
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "@/theme";
import { Button, EmptyState, Text } from "@/ui";
import { AuditFilterSheet } from "../components/AuditFilterSheet";
import { AuditRow } from "../components/AuditRow";
import { FilterButton, FilterChips, type ChipOption } from "../components/FilterChips";
import { ListSkeleton, LoadMore } from "../components/ListBits";
import { NoPermissionState, QueryErrorState, StaleNotice } from "../components/StateViews";
import { TabScroll } from "../components/TabScroll";
import { useAuditEvents } from "../hooks/useAuditLog";
import {
  AUDIT_PRESETS,
  EMPTY_AUDIT_FILTER,
  advancedFilterCount,
  hasAnyFilter,
  validateAuditFilter,
  type AuditFilter,
  type AuditPresetKey,
  type AuditQuery,
} from "../model/audit";
import type { OpsAccess } from "../model/permissions";
import { opsStrings } from "../strings";

const s = opsStrings.audit;

const PRESET_OPTIONS: readonly ChipOption<AuditPresetKey>[] = AUDIT_PRESETS.map((preset) => ({ value: preset.key, label: s.presets[preset.key] }));

const NO_FILTER_QUERY: AuditQuery = { actorUserId: null, action: null, entityType: null, entityId: null, from: null, to: null };

export function AuditTab({ access }: { access: OpsAccess }): React.JSX.Element {
  const [filter, setFilter] = React.useState<AuditFilter>(EMPTY_AUDIT_FILTER);
  const [sheet, setSheet] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const validation = React.useMemo(() => validateAuditFilter(filter), [filter]);
  const query = validation.ok ? validation.query : NO_FILTER_QUERY;
  const list = useAuditEvents(query, access.readAudit);

  if (!access.readAudit) {
    return (
      <TabScroll testID="OpsAudit">
        <NoPermissionState message={s.onlyAdmin} testID="OpsAudit.noPermission" />
      </TabScroll>
    );
  }

  const advanced = advancedFilterCount(filter);
  const anyFilter = hasAnyFilter(filter);
  const loadingFirst = list.items.length === 0 && list.isLoading;
  const failedFirst = list.items.length === 0 && (list.isError || list.isOffline);

  let body: React.ReactNode;
  if (failedFirst) {
    body = <QueryErrorState error={list.error} onRetry={() => void list.refetch()} section={opsStrings.tabs.audit} testID="OpsAudit.error" />;
  } else if (loadingFirst) {
    body = <ListSkeleton testID="OpsAudit.loading" height={112} rows={4} />;
  } else if (list.isEmpty) {
    body = (
      <EmptyState
        testID="OpsAudit.empty"
        icon="opsHistory"
        title={anyFilter ? s.emptyTitle : s.emptyNoFilterTitle}
        message={anyFilter ? s.emptyMessage : s.emptyNoFilterMessage}
        actionLabel={anyFilter ? s.clear : undefined}
        onAction={anyFilter ? () => setFilter(EMPTY_AUDIT_FILTER) : undefined}
      />
    );
  } else {
    body = (
      <View>
        {list.items.map((event, index) => (
          <View key={event.id} style={index > 0 ? styles.gap : null}>
            <AuditRow
              event={event}
              expanded={expanded === event.id}
              onToggle={() => setExpanded((current) => (current === event.id ? null : event.id))}
              onFilterActor={(actorId) => setFilter((current) => ({ ...current, actorUserId: actorId }))}
              onFilterEntity={(entityType, entityId) => setFilter((current) => ({ ...current, entityType, entityId }))}
              testID={`OpsAudit.item.${event.id}`}
            />
          </View>
        ))}
        <LoadMore hasMore={list.hasMore} loading={list.isFetchingMore} failed={list.fetchMoreError !== null} onPress={() => void list.fetchMore()} testID="OpsAudit.more" />
      </View>
    );
  }

  return (
    <TabScroll
      testID="OpsAudit"
      refreshing={list.isRefreshing}
      onRefresh={() => {
        void list.refresh();
      }}
    >
      {list.items.length > 0 ? <StaleNotice offline={list.isOffline} failedToRefresh={list.failedToRefresh} onRetry={() => void list.refetch()} testID="OpsAudit.stale" /> : null}
      <FilterChips
        options={PRESET_OPTIONS}
        value={filter.preset}
        onChange={(preset) => setFilter((current) => ({ ...current, preset }))}
        accessibilityLabel={s.presetsA11y}
        testID="OpsAudit.preset"
      />
      <View style={styles.toolbar}>
        <FilterButton testID="OpsAudit.filters" label={s.filters} icon="tune" badge={advanced} accessibilityLabel={s.filtersA11y} onPress={() => setSheet(true)} />
        {anyFilter ? (
          <Button testID="OpsAudit.clear" label={s.clear} variant="ghost" size="sm" chevron={false} inline onPress={() => setFilter(EMPTY_AUDIT_FILTER)} />
        ) : null}
        {anyFilter ? (
          <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} style={styles.active} testID="OpsAudit.activeCount">
            {s.activeFilters(advanced + (filter.preset !== "all" ? 1 : 0))}
          </Text>
        ) : null}
      </View>
      <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} style={styles.privacy} testID="OpsAudit.privacy">
        {s.privacyNote}
      </Text>
      <View style={styles.list}>{body}</View>

      <AuditFilterSheet
        visible={sheet}
        filter={filter}
        onApply={(next) => {
          setFilter(next);
          setSheet(false);
        }}
        onClear={() => {
          setFilter(EMPTY_AUDIT_FILTER);
          setSheet(false);
        }}
        onClose={() => setSheet(false)}
      />
    </TabScroll>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", columnGap: 8, marginTop: 10 },
  active: { flexShrink: 1 },
  privacy: { marginTop: 10, paddingHorizontal: 4 },
  list: { marginTop: 12 },
  gap: { marginTop: 9 },
});
