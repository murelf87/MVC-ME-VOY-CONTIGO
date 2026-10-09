/**
 * Pestaña «Alertas»: alertas de operación creadas por las reglas con datos reales (nunca inventadas). Filtros por estado y
 * por regla, «Evaluar ahora» y, por alerta, Reconocer y Resolver (confirmando). Lectura A F S · gestión A S.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { AdminAlert, AdminAlertKind, AdminAlertStatus } from "@/api/types";
import { colors } from "@/theme";
import { ConfirmDialog, EmptyState, OptionSheet, Text, showToast } from "@/ui";
import { AlertCard } from "../components/AlertCard";
import { FilterButton, FilterChips, type ChipOption } from "../components/FilterChips";
import { ListSkeleton, LoadMore } from "../components/ListBits";
import { NoPermissionState, QueryErrorState, StaleNotice } from "../components/StateViews";
import { TabScroll } from "../components/TabScroll";
import { useAlerts, useEvaluateAlerts, useSetAlertStatus } from "../hooks/useAlerts";
import { RULE_KINDS } from "../model/operations";
import type { OpsAccess } from "../model/permissions";
import { opsStrings } from "../strings";

const s = opsStrings.alerts;

const STATUS_OPTIONS: readonly ChipOption<AdminAlertStatus | "all">[] = [
  { value: "open", label: s.statusOptions.open },
  { value: "acknowledged", label: s.statusOptions.acknowledged },
  { value: "resolved", label: s.statusOptions.resolved },
  { value: "all", label: s.statusOptions.all },
];

export function AlertsTab({ access }: { access: OpsAccess }): React.JSX.Element {
  const [status, setStatus] = React.useState<AdminAlertStatus | "all">("open");
  const [kind, setKind] = React.useState<AdminAlertKind | null>(null);
  const [kindSheet, setKindSheet] = React.useState(false);
  const [resolving, setResolving] = React.useState<AdminAlert | null>(null);
  const [actingId, setActingId] = React.useState<string | null>(null);

  const list = useAlerts(status, kind, access.readAlerts);
  const evaluate = useEvaluateAlerts();
  const change = useSetAlertStatus();

  if (!access.readAlerts) {
    return (
      <TabScroll testID="OpsAlerts">
        <NoPermissionState section={opsStrings.tabs.alerts} testID="OpsAlerts.noPermission" />
      </TabScroll>
    );
  }

  const runEvaluation = async (): Promise<void> => {
    try {
      const result = await evaluate.mutateAsync();
      const skipped = result.rules.filter((rule) => rule.skippedReason !== null);
      const detail =
        skipped.length === 0
          ? ""
          : ` ${s.skippedPrefix} ${skipped.map((rule) => `${s.kindLabels[rule.kind] ?? rule.kind} (${s.skipped[rule.skippedReason ?? "disabled"]})`).join(", ")}.`;
      showToast({ kind: "success", message: `${s.evaluated(result.created, result.autoResolved)}${detail}`, id: "ops-alerts" });
    } catch (error) {
      const info = describeError(error);
      showToast({ kind: "error", title: info.title, message: info.message, id: "ops-alerts" });
    }
  };

  const setAlertStatus = async (alert: AdminAlert, next: "acknowledged" | "resolved"): Promise<void> => {
    setActingId(alert.id);
    try {
      await change.mutateAsync({ alertId: alert.id, status: next });
      showToast({ kind: "success", message: next === "resolved" ? s.resolvedToast : s.acknowledgedToast, id: "ops-alerts" });
    } catch (error) {
      const info = describeError(error);
      showToast({ kind: "error", title: info.title, message: info.message, id: "ops-alerts" });
    } finally {
      setActingId(null);
      setResolving(null);
    }
  };

  const kindOptions = [
    { value: "all", label: s.kindAll },
    ...RULE_KINDS.map((value) => ({ value, label: s.kindLabels[value] ?? value })),
  ];

  const loadingFirst = list.items.length === 0 && list.isLoading;
  const failedFirst = list.items.length === 0 && (list.isError || list.isOffline);
  const filtered = status !== "open" || kind !== null;

  let body: React.ReactNode;
  if (failedFirst) {
    body = <QueryErrorState error={list.error} onRetry={() => void list.refetch()} section={opsStrings.tabs.alerts} testID="OpsAlerts.error" />;
  } else if (loadingFirst) {
    body = <ListSkeleton testID="OpsAlerts.loading" height={150} />;
  } else if (list.isEmpty) {
    body = (
      <EmptyState
        testID="OpsAlerts.empty"
        icon="bell"
        title={filtered ? s.emptyOtherTitle : s.emptyOpenTitle}
        message={filtered ? s.emptyOtherMessage : s.emptyOpenMessage}
        actionLabel={!filtered && access.writeAlerts ? s.evaluate : undefined}
        onAction={!filtered && access.writeAlerts ? () => void runEvaluation() : undefined}
      />
    );
  } else {
    body = (
      <View>
        {list.items.map((alert, index) => (
          <View key={alert.id} style={index > 0 ? styles.gap : null}>
            <AlertCard
              alert={alert}
              canWrite={access.writeAlerts}
              busy={actingId === alert.id}
              onAcknowledge={(item) => {
                void setAlertStatus(item, "acknowledged");
              }}
              onResolve={setResolving}
              testID={`OpsAlerts.item.${alert.id}`}
            />
          </View>
        ))}
        <LoadMore hasMore={list.hasMore} loading={list.isFetchingMore} failed={list.fetchMoreError !== null} onPress={() => void list.fetchMore()} testID="OpsAlerts.more" />
      </View>
    );
  }

  return (
    <TabScroll
      testID="OpsAlerts"
      refreshing={list.isRefreshing}
      onRefresh={() => {
        void list.refresh();
      }}
    >
      {list.items.length > 0 ? <StaleNotice offline={list.isOffline} failedToRefresh={list.failedToRefresh} onRetry={() => void list.refetch()} testID="OpsAlerts.stale" /> : null}
      <FilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} accessibilityLabel={s.statusA11y} testID="OpsAlerts.status" />
      <View style={styles.toolbar}>
        <FilterButton
          testID="OpsAlerts.kind"
          label={kind === null ? s.kindAll : (s.kindLabels[kind] ?? kind)}
          accessibilityLabel={s.kindFilterA11y}
          onPress={() => setKindSheet(true)}
          style={styles.kindButton}
        />
        {access.writeAlerts ? (
          <FilterButton
            testID="OpsAlerts.evaluate"
            label={evaluate.isPending ? s.evaluating : s.evaluate}
            icon="refresh"
            accessibilityLabel={s.evaluateA11y}
            onPress={() => {
              if (!evaluate.isPending) void runEvaluation();
            }}
            style={styles.evaluate}
          />
        ) : null}
      </View>
      {!access.writeAlerts ? (
        <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} style={styles.hint} testID="OpsAlerts.readOnly">
          {s.readOnlyHint}
        </Text>
      ) : (
        <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} style={styles.hint}>
          {s.notificationHint}
        </Text>
      )}
      <View style={styles.list}>{body}</View>

      <OptionSheet
        visible={kindSheet}
        title={s.kindFilterTitle}
        options={kindOptions}
        selected={kind ?? "all"}
        onSelect={(value) => {
          setKind(value === "all" ? null : (value as AdminAlertKind));
          setKindSheet(false);
        }}
        onClose={() => setKindSheet(false)}
        testID="OpsAlerts.kindSheet"
      />
      <ConfirmDialog
        visible={resolving !== null}
        title={s.confirmResolveTitle}
        message={s.confirmResolveMessage}
        confirmLabel={s.resolve}
        loading={resolving !== null && actingId === resolving.id}
        onConfirm={() => {
          if (resolving !== null) void setAlertStatus(resolving, "resolved");
        }}
        onCancel={() => setResolving(null)}
        testID="OpsAlerts.confirmResolve"
      />
    </TabScroll>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", columnGap: 8, marginTop: 10 },
  kindButton: { flexShrink: 1 },
  evaluate: { flexShrink: 0 },
  hint: { marginTop: 10, paddingHorizontal: 4 },
  list: { marginTop: 12 },
  gap: { marginTop: 9 },
});
