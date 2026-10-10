import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { AdminPayoutRun, PayoutStatus } from "@/api/types";
import { formatDateTime, formatRelative, moneyParts } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Avatar, Banner, BottomSheet, Button, ConfirmDialog, EmptyState, Screen, StatusPill, Text, TextField, showToast, type StatusTone } from "@/ui";
import { AdminHeader } from "../../review/components/AdminHeader";
import { CheckingAccess, NoPermission, PanelError } from "../../review/components/AccessStates";
import { FilterSelect } from "../../review/components/FilterSelect";
import { CardListSkeleton, LoadMore, RefreshFailedStrip } from "../../review/components/ListStates";
import { StaffAccessSheet } from "../../review/components/StaffAccessSheet";
import { useAdminGate } from "../../review/hooks/useAdminGate";
import { adminError } from "../../review/logic/errors";
import { staffInitial } from "../../review/logic/permissions";
import { useExecutePayoutRun, useGeneratePayoutRuns, usePayoutAvailability, usePayoutRuns } from "../hooks/usePayouts";
import { canExecute, countByStatus, payoutTone, periodLabel, recentPeriods, validatePeriod } from "../model/payouts";
import { backofficeStrings } from "../backofficeStrings";

const s = backofficeStrings.payouts;
const STATUSES: readonly PayoutStatus[] = ["draft", "processing", "paid", "failed", "cancelled"];
const TONE: Record<ReturnType<typeof payoutTone>, StatusTone> = { gray: "gray", amber: "amber", green: "green", red: "red" };

type PeriodValue = string;
type StatusValue = PayoutStatus | "all";

function RunCard({
  run,
  providerReady,
  busy,
  onExecute,
}: {
  run: AdminPayoutRun;
  providerReady: boolean;
  busy: boolean;
  onExecute: (run: AdminPayoutRun) => void;
}): React.JSX.Element {
  const net = moneyParts(run.net);
  const reason = run.failureCode === null ? null : s.failure(s.failureReasons[run.failureCode] ?? s.failureFallback);
  const executable = canExecute(run);
  return (
    <View style={styles.card} testID={`AdminPayoutRuns.run.${run.id}`}>
      <View style={styles.head}>
        <Avatar source={run.driver.photoUrl} name={run.driver.displayName} size="md" />
        <View style={styles.flex}>
          <Text variant="titleSm" color="heading" size={18} numberOfLines={1}>{run.driver.displayName}</Text>
          <Text variant="body" color="muted" size={15}>{`${periodLabel(run.period)} · ${s.bookings(run.bookingsCount)}`}</Text>
        </View>
        <StatusPill label={s.statusLabels[run.status] ?? run.status} tone={TONE[payoutTone(run.status)]} size="sm" />
      </View>
      <View style={styles.amountRow} accessible accessibilityLabel={`${s.amountNote} ${net.text}`}>
        <Text variant="body" color="muted" size={15.5} style={styles.flex}>{s.amountNote}</Text>
        {net.illustrative ? <Text variant="caption" color="subtle" size={12.5}>ilustrativo</Text> : null}
        <Text variant="titleSm" color={net.pending ? colors.warning.textStrong : "heading"} size={19}>{net.text}</Text>
      </View>
      {run.status === "paid" && run.paidAt !== null ? <Text variant="body" color="success" size={15} testID={`AdminPayoutRuns.run.${run.id}.paid`}>{s.paidAt(formatDateTime(run.paidAt))}</Text> : null}
      {run.status === "processing" ? <Text variant="body" color="warning" size={15} testID={`AdminPayoutRuns.run.${run.id}.processing`}>{s.processingNote}</Text> : null}
      {reason !== null ? <Text variant="body" color="error" size={15}>{reason}</Text> : null}
      <Text variant="caption" color="subtle" size={13}>{s.createdAt(formatRelative(run.createdAt))}</Text>
      {executable ? (
        <View style={styles.actions}>
          <Button
            testID={`AdminPayoutRuns.run.${run.id}.execute`}
            label={run.status === "failed" ? s.executeRetry : s.execute}
            size="sm"
            chevron={false}
            disabled={!providerReady}
            loading={busy}
            onPress={() => onExecute(run)}
          />
          {!providerReady ? <Text variant="caption" color="warning" size={13.5} style={styles.blocked} testID={`AdminPayoutRuns.run.${run.id}.blocked`}>{s.executeBlocked}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Liquidaciones (sin lámina; mismo lenguaje que 39): una por persona conductora y mes. Finanzas y Administración
 * generan las del mes y piden el abono al proveedor. NADA figura «Abonada» hasta que el servidor lo confirma.
 */
export function AdminPayoutRunsScreen({ navigation }: AppScreenProps<"AdminPayoutRuns">): React.JSX.Element {
  const gate = useAdminGate((access) => access.hasFinance);
  const { access } = gate;
  const ready = gate.state === "ready";
  const now = useMemo(() => Date.now(), []);
  const periods = useMemo(() => recentPeriods(now, 6), [now]);

  const [period, setPeriod] = useState<PeriodValue>("all");
  const [status, setStatus] = useState<StatusValue>("all");
  const runs = usePayoutRuns(period === "all" ? null : period, status === "all" ? null : status, ready);
  const availability = usePayoutAvailability(ready);
  const generate = useGeneratePayoutRuns();
  const execute = useExecutePayoutRun();

  const [generateOpen, setGenerateOpen] = useState(false);
  const [periodText, setPeriodText] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminPayoutRun | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const providerKnown = availability.data !== undefined;
  const providerReady = availability.data?.availability.payoutsEnabled === true;

  const openGenerate = useCallback(() => {
    const previous = periods[1] ?? periods[0] ?? "";
    setPeriodText(`${previous.slice(5, 7)}/${previous.slice(0, 4)}`);
    setAttempted(false);
    setSheetError(null);
    setGenerateOpen(true);
  }, [periods]);

  const parsed = validatePeriod(periodText);
  const periodError = attempted && !parsed.ok ? parsed.message : undefined;

  const submitGenerate = async (): Promise<void> => {
    setAttempted(true);
    if (!parsed.ok) return;
    setSheetError(null);
    try {
      const result = await generate.mutateAsync(parsed.period);
      setGenerateOpen(false);
      setPeriod(parsed.period);
      showToast({ kind: result.created.length > 0 ? "success" : "info", message: s.generated(result.created.length, result.skipped), id: "payouts.generate" });
    } catch (error) {
      setSheetError(adminError(error).message);
    }
  };

  const confirmExecute = async (): Promise<void> => {
    const run = confirming;
    if (run === null) return;
    setBusyId(run.id);
    try {
      await execute.mutateAsync(run.id);
      setConfirming(null);
      showToast({ kind: "success", message: s.executed, id: "payouts.execute" });
    } catch (error) {
      setConfirming(null);
      const view = adminError(error);
      showToast({ kind: "error", title: view.title, message: view.message, id: "payouts.execute" });
      void availability.refetch();
    } finally {
      setBusyId(null);
    }
  };

  const periodOptions = useMemo(
    () => [{ value: "all" as PeriodValue, label: s.periodAll }, ...periods.map((p) => ({ value: p as PeriodValue, label: periodLabel(p) }))],
    [periods],
  );
  const statusOptions = useMemo(
    () => [{ value: "all" as StatusValue, label: s.statusAll }, ...STATUSES.map((value) => ({ value: value as StatusValue, label: s.statusLabels[value] ?? value }))],
    [],
  );

  const counts = countByStatus(runs.items);
  const countsText = STATUSES.filter((value) => counts[value] > 0)
    .map((value) => `${counts[value]} ${(s.statusLabels[value] ?? value).toLocaleLowerCase("es-ES")}`)
    .join(" · ");

  const listError = runs.isError ? adminError(runs.error) : null;
  const loading = runs.isIdle || runs.isLoading;
  const filtered = period !== "all" || status !== "all";

  let body: React.ReactNode;
  if (gate.state === "checking") {
    body = <CheckingAccess />;
  } else if (gate.state === "error" && gate.error !== null) {
    body = <PanelError error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} testID="AdminPayoutRuns.error" />;
  } else if (gate.state === "denied") {
    body = <NoPermission testID="AdminPayoutRuns.denied" message={s.deniedMessage} onGoHome={gate.goHome} />;
  } else if (listError !== null) {
    body = <PanelError error={listError} onRetry={() => void runs.refresh()} onGoHome={gate.goHome} testID="AdminPayoutRuns.listError" />;
  } else if (loading) {
    body = <CardListSkeleton testID="AdminPayoutRuns.loading" />;
  } else if (runs.isEmpty) {
    body = (
      <EmptyState
        testID="AdminPayoutRuns.empty"
        icon={filtered ? "filter" : "coins"}
        title={filtered ? s.emptyFilteredTitle : s.emptyTitle}
        message={filtered ? s.emptyFilteredMessage : s.emptyMessage}
        actionLabel={filtered ? s.clearFilters : undefined}
        onAction={
          filtered
            ? () => {
                setPeriod("all");
                setStatus("all");
              }
            : undefined
        }
      />
    );
  } else {
    body = (
      <>
        {runs.failedToRefresh ? <RefreshFailedStrip offline={runs.isOffline} onRetry={() => void runs.refresh()} /> : null}
        {countsText !== "" ? <Text variant="body" color="muted" size={14.5} style={styles.counts} testID="AdminPayoutRuns.counts">{countsText}</Text> : null}
        {runs.items.map((run, index) => (
          <View key={run.id} style={index > 0 ? styles.gap : null}>
            <RunCard run={run} providerReady={providerReady} busy={busyId === run.id} onExecute={setConfirming} />
          </View>
        ))}
        <LoadMore hasMore={runs.hasMore} loading={runs.isFetchingMore} failed={runs.fetchMoreError !== null} onPress={() => void runs.fetchMore()} testID="AdminPayoutRuns.more" />
      </>
    );
  }

  const header = (
    <View>
      <AdminHeader subtitle={s.subtitle} initial={staffInitial(access.me)} staffName={access.me?.displayName ?? null} onAvatarPress={gate.openSheet} testID="AdminPayoutRuns.header" />
      {ready ? (
        <View style={styles.controls}>
          <Text variant="body" color="body" size={15.5} style={styles.intro}>{s.intro}</Text>
          {providerKnown ? (
            providerReady ? (
              <Banner kind="info" size="sm" title={s.providerOnTitle} message={s.providerOnMessage} testID="AdminPayoutRuns.providerOn" style={styles.banner} />
            ) : (
              <Banner kind="warning" size="sm" title={s.providerOffTitle} message={s.providerOffMessage} testID="AdminPayoutRuns.providerOff" style={styles.banner} />
            )
          ) : null}
          <View style={styles.filters}>
            <FilterSelect<PeriodValue>
              testID="AdminPayoutRuns.filter.period"
              value={period}
              displayText={period === "all" ? s.periodFilter : periodLabel(period)}
              options={periodOptions}
              sheetTitle={s.periodFilter}
              accessibilityLabel={s.periodFilterA11y}
              onChange={setPeriod}
              style={styles.filterPeriod}
            />
            <FilterSelect<StatusValue>
              testID="AdminPayoutRuns.filter.status"
              value={status}
              displayText={status === "all" ? s.statusFilterAll : (s.statusLabels[status] ?? status)}
              options={statusOptions}
              sheetTitle={s.statusAll}
              accessibilityLabel={s.statusFilterA11y}
              onChange={setStatus}
              style={styles.filterStatus}
            />
          </View>
          <Button testID="AdminPayoutRuns.generate" label={s.generate} chevron={false} onPress={openGenerate} style={styles.generate} accessibilityLabel={s.generateA11y} />
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <Screen testID="AdminPayoutRuns" header={header} paddingX={11} refreshing={runs.isRefreshing} onRefresh={ready ? () => void runs.refresh() : undefined} contentContainerStyle={styles.list}>
        {body}
      </Screen>

      <BottomSheet
        visible={generateOpen}
        onClose={() => (generate.isPending ? undefined : setGenerateOpen(false))}
        title={s.generateTitle}
        subtitle={s.generateSubtitle}
        testID="AdminPayoutRuns.generateSheet"
        footer={
          <View style={styles.sheetActions}>
            <Button testID="AdminPayoutRuns.generateSheet.confirm" label={s.generateConfirm} chevron={false} loading={generate.isPending} onPress={() => void submitGenerate()} />
            <Button testID="AdminPayoutRuns.generateSheet.cancel" label={backofficeStrings.common.cancel} variant="outline" chevron={false} disabled={generate.isPending} onPress={() => setGenerateOpen(false)} />
          </View>
        }
      >
        {sheetError !== null ? <Banner kind="error" size="sm" title={backofficeStrings.common.errorTitle} message={sheetError} style={styles.gapBottom} testID="AdminPayoutRuns.generateSheet.error" /> : null}
        <TextField
          testID="AdminPayoutRuns.generateSheet.period"
          label={s.periodLabel}
          value={periodText}
          onChangeText={setPeriodText}
          placeholder={s.periodPlaceholder}
          keyboardType="numbers-and-punctuation"
          error={periodError}
          helper={periodError === undefined && parsed.ok ? s.periodHelper(periodLabel(parsed.period)) : undefined}
        />
      </BottomSheet>

      <ConfirmDialog
        visible={confirming !== null}
        title={s.executeTitle}
        message={confirming !== null ? s.executeMessage(confirming.driver.displayName, moneyParts(confirming.net).text) : undefined}
        confirmLabel={s.executeConfirm}
        icon="coins"
        loading={busyId !== null}
        onConfirm={() => void confirmExecute()}
        onCancel={() => setConfirming(null)}
        testID="AdminPayoutRuns.executeDialog"
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
  flex: { flex: 1 },
  controls: { paddingHorizontal: 11, paddingTop: 7 },
  intro: { marginBottom: 10 },
  banner: { marginBottom: 10 },
  filters: { flexDirection: "row", gap: 8 },
  filterPeriod: { flex: 1 },
  filterStatus: { flex: 1 },
  generate: { marginTop: 12 },
  list: { paddingTop: 12, paddingBottom: 16 },
  counts: { marginBottom: 8, paddingHorizontal: 2 },
  gap: { marginTop: 10 },
  gapBottom: { marginBottom: 12 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  actions: { marginTop: 8, gap: 6 },
  blocked: { marginTop: 2 },
  sheetActions: { gap: 10 },
});
