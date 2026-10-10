import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { AdminRefundDetail, Money } from "@/api/types";
import { formatDateTime, moneyParts } from "@/i18n";
import { useAppNavigation, type AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Avatar, Banner, BottomSheet, Button, ConfirmDialog, Screen, StatusPill, Text, TextArea, TextField, showToast, type StatusTone } from "@/ui";
import { PanelCard } from "../../ops/components/PanelCard";
import { AdminHeader } from "../components/AdminHeader";
import { CheckingAccess, NoPermission, PanelError } from "../components/AccessStates";
import { CardListSkeleton } from "../components/ListStates";
import { ReasonSheet } from "../components/ReasonSheet";
import { StaffAccessSheet } from "../components/StaffAccessSheet";
import { useAdminGate } from "../hooks/useAdminGate";
import { useRefundActions, useRefundDetail } from "../hooks/useRefund";
import { adminError, maxRefundableFromError } from "../logic/errors";
import { approvalNoteRequired, centsText, centsToInput, centsOf, checkApprovedAmount, checkNote } from "../logic/money";
import { staffInitial } from "../logic/permissions";
import { refundActions, refundBanner, refundSteps, type StepState } from "../logic/refunds";
import { reviewStrings } from "../strings";

const r = reviewStrings.refund;

const STATUS_TONE: Record<AdminRefundDetail["status"], StatusTone> = {
  pending_review: "amber",
  approved: "blue",
  executing: "blue",
  refunded: "green",
  rejected: "red",
  failed: "red",
  not_applicable: "gray",
};
const STEP_TONE: Record<StepState, StatusTone> = { done: "green", current: "amber", pending: "gray", blocked: "orange", failed: "red", rejected: "red" };
const STEP_MARK: Record<StepState, string> = { done: "✓", current: "●", pending: "○", blocked: "!", failed: "✕", rejected: "✕" };

const LEDGER_KINDS: Record<string, string> = {
  payment_captured: "Pago recibido",
  payment: "Pago recibido",
  refund_approved: "Devolución aprobada",
  refund_executed: "Devolución ejecutada",
  payment_confirmed: "Pago confirmado",
};

const LEDGER_ACCOUNTS: Record<string, string> = {
  passenger: "Pasajero",
  driver_payable: "A pagar al conductor",
  refund_payable: "Devolución por pagar",
  suspense: "Cuenta transitoria",
  platform_revenue: "Ingresos de MVC",
};

function Fact({ label, money, text, strong }: { label: string; money?: Money; text?: string; strong?: boolean }): React.JSX.Element {
  const parts = money !== undefined ? moneyParts(money) : null;
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}: ${parts?.text ?? text ?? ""}`}>
      <Text variant="body" color="muted" size={15.5} style={styles.flex}>{label}</Text>
      {parts?.illustrative ? <Text variant="caption" color="subtle" size={12.5} style={styles.tag}>ilustrativo</Text> : null}
      <Text variant={strong ? "titleSm" : "body"} color={parts?.pending ? colors.warning.textStrong : "deep"} size={strong ? 18 : 16}>{parts?.text ?? text ?? ""}</Text>
    </View>
  );
}

function Person({ label, name, photoUrl }: { label: string; name: string; photoUrl: string | null }): React.JSX.Element {
  return (
    <View style={styles.person}>
      <Avatar source={photoUrl} name={name} size={44} />
      <View style={styles.flex}>
        <Text variant="caption" color="muted" size={13}>{label}</Text>
        <Text variant="titleSm" color="heading" size={17} numberOfLines={1}>{name}</Text>
      </View>
    </View>
  );
}

/**
 * Detalle de una propuesta de devolución (sin lámina; se abre desde «Revisar devolución» de la 39). Muestra el origen, los
 * importes, la política, el pago, la línea de estados y los movimientos contables. Finanzas aprueba (con importe y nota),
 * rechaza (con motivo) o pide la devolución al proveedor. Nada consta como «devuelto» hasta que el proveedor lo confirma.
 */
export function AdminRefundDetailScreen({ route }: AppScreenProps<"AdminRefundDetail">): React.JSX.Element {
  const { refundId } = route.params;
  const navigation = useAppNavigation();
  const gate = useAdminGate((access) => access.hasFinance);
  const { access } = gate;
  const ready = gate.state === "ready";
  const query = useRefundDetail(refundId, ready);
  const actions = useRefundActions();
  const data = query.data;

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [executeOpen, setExecuteOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [maxFromServer, setMaxFromServer] = useState<number | null>(null);

  useEffect(() => {
    if (!approveOpen || data === undefined) return;
    setAttempted(false);
    setSheetError(null);
    setNote("");
    const proposed = centsOf(data.proposedRefund);
    setAmount(proposed !== null ? centsToInput(proposed) : "");
  }, [approveOpen, data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <AdminHeader subtitle={r.subtitle} initial={staffInitial(access.me)} staffName={access.me?.displayName ?? null} onAvatarPress={gate.openSheet} testID="AdminRefundDetail.header" />
  );

  let body: React.ReactNode;
  if (gate.state === "checking") body = <CheckingAccess />;
  else if (gate.state === "error" && gate.error !== null) body = <PanelError error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} testID="AdminRefundDetail.error" />;
  else if (gate.state === "denied") {
    body = <NoPermission testID="AdminRefundDetail.denied" message={reviewStrings.access.deniedMessage(reviewStrings.access.areaLabels.bookings)} onGoHome={gate.goHome} />;
  } else if (data === undefined) {
    if (query.isError || query.isOffline) {
      const failure = adminError(query.error);
      body = <PanelError error={failure.kind === "notFound" ? { ...failure, title: r.notFoundTitle, message: r.notFoundMessage } : failure} onRetry={() => void query.refetch()} onGoHome={() => navigation.navigate("AdminBookingsRefunds")} testID="AdminRefundDetail.loadError" />;
    } else body = <CardListSkeleton testID="AdminRefundDetail.loading" count={3} />;
  } else {
    body = <Detail data={data} />;
  }

  function Detail({ data: d }: { data: AdminRefundDetail }): React.JSX.Element {
    const banner = refundBanner(d);
    const canAct = access.canWrite("bookings") || access.hasFinance;
    const available = refundActions(d, canAct);
    const steps = refundSteps(d);
    const hasActions = available.approve || available.reject || available.execute;
    return (
      <>
        {banner !== null ? <Banner testID="AdminRefundDetail.banner" kind={banner.kind} title={banner.title} message={banner.message} style={styles.gap} /> : null}
        <PanelCard title={r.statusTitle} right={<StatusPill label={r.statusLabels[d.status]} tone={STATUS_TONE[d.status]} />} testID="AdminRefundDetail.status">
          <Text variant="body" color="body" size={15.5}>{r.executionLabels[d.executionStatus]}</Text>
          <Text variant="body" color="muted" size={14.5} style={styles.top4}>{r.createdAt(formatDateTime(d.createdAt))}</Text>
          {d.decision !== null ? (
            <>
              <Text variant="body" color="muted" size={14.5}>{r.decidedAt(formatDateTime(d.decision.at), d.decision.by?.displayName ?? null)}</Text>
              {d.decision.basis !== null ? <Text variant="body" color="muted" size={14.5}>{r.decisionBasis[d.decision.basis]}</Text> : null}
              {d.decision.note !== null && d.decision.note !== "" ? <Text variant="body" color="body" size={14.5}>{r.decisionNote(d.decision.note)}</Text> : null}
            </>
          ) : null}
        </PanelCard>

        <PanelCard title={r.originTitle} style={styles.gap} testID="AdminRefundDetail.origin">
          <Text variant="titleSm" color="heading" size={17}>{r.origins[d.origin]}</Text>
          {d.cancelReason !== null ? <Text variant="body" color="body" size={15}>{r.cancelReasonLine(d.cancelReason)}</Text> : null}
          {d.cancelNote !== null ? <Text variant="body" color="body" size={15}>{r.cancelNoteLine(d.cancelNote)}</Text> : null}
          <View style={styles.people}>
            <Person label={r.passenger} name={d.passenger.displayName} photoUrl={d.passenger.photoUrl} />
            {d.driver !== null ? <Person label={r.driver} name={d.driver.displayName} photoUrl={d.driver.photoUrl} /> : <Text variant="body" color="muted" size={14.5}>{r.noDriver}</Text>}
          </View>
          <Text variant="body" color="muted" size={14.5}>
            {`${r.trip}: ${d.trip.originLabel ?? "—"} → ${d.trip.destinationLabel ?? "—"}${d.trip.departureAt !== null ? ` · ${formatDateTime(d.trip.departureAt)}` : ""}`}
          </Text>
        </PanelCard>

        <PanelCard title={r.amountsTitle} style={styles.gap} testID="AdminRefundDetail.amounts">
          <Fact label={reviewStrings.bookings.labels.paid} money={d.paid} />
          <Fact label={reviewStrings.bookings.labels.proposed} money={d.proposedRefund} />
          <Fact label={reviewStrings.bookings.labels.approved} money={d.approvedRefund} />
          <Fact label={reviewStrings.bookings.labels.fee} money={d.platformFee} />
          <Fact label={reviewStrings.bookings.labels.final} money={d.finalPassengerCost} strong />
          <Fact label={reviewStrings.bookings.labels.maxRefundable} money={d.maxRefundable} />
        </PanelCard>

        <PanelCard title={r.policyTitle} style={styles.gap} testID="AdminRefundDetail.policy">
          {d.policy.status === "approved" && d.policy.version !== null ? (
            <>
              <Text variant="titleSm" color="heading" size={16}>{r.policyVersion(d.policy.version)}</Text>
              {d.policy.summary !== null ? <Text variant="body" color="body" size={15}>{d.policy.summary}</Text> : null}
            </>
          ) : (
            <Text variant="body" color="body" size={15}>{r.policyNone}</Text>
          )}
        </PanelCard>

        <PanelCard title={r.payment} style={styles.gap} testID="AdminRefundDetail.payment">
          {d.payment === null ? (
            <>
              <Text variant="titleSm" color="heading" size={16}>{r.noPaymentTitle}</Text>
              <Text variant="body" color="body" size={15}>{r.noPaymentMessage}</Text>
            </>
          ) : (
            <>
              <Fact label="Importe cobrado" money={d.payment.amount} />
              <Fact label="Ya devuelto" money={d.payment.refunded} />
              <Text variant="body" color="muted" size={14.5}>{r.paymentMethod(d.payment.method.maskedLabel ?? d.payment.method.kind)}</Text>
            </>
          )}
        </PanelCard>

        <PanelCard title="Seguimiento" style={styles.gap} testID="AdminRefundDetail.steps">
          {steps.map((step) => (
            <View key={step.key} style={styles.step} testID={`AdminRefundDetail.step.${step.key}`} accessible accessibilityLabel={`${step.label}${step.caption !== null ? `: ${step.caption}` : ""}`}>
              <StatusPill label={STEP_MARK[step.state]} tone={STEP_TONE[step.state]} size="sm" />
              <View style={styles.flex}>
                <Text variant="titleSm" color={step.state === "pending" ? "muted" : "heading"} size={16}>{step.label}</Text>
                {step.caption !== null ? <Text variant="body" color="muted" size={14}>{step.caption}</Text> : null}
              </View>
            </View>
          ))}
        </PanelCard>

        <PanelCard title={r.ledgerTitle} style={styles.gap} testID="AdminRefundDetail.ledger">
          {d.ledger.length === 0 ? <Text variant="body" color="muted" size={15}>{r.ledgerEmpty}</Text> : null}
          {d.ledger.map((line) => (
            <View key={line.id} style={styles.fact} accessible>
              <View style={styles.flex}>
                <Text variant="body" color="deep" size={15}>{r.ledgerLine(LEDGER_KINDS[line.transactionKind] ?? line.transactionKind, LEDGER_ACCOUNTS[line.account] ?? line.account)}</Text>
                <Text variant="body" color="muted" size={13}>{formatDateTime(line.createdAt)}</Text>
              </View>
              <Text variant="body" color="deep" size={15.5}>{`${line.amountCents < 0 ? "−" : "+"}${centsText(Math.abs(line.amountCents))}`}</Text>
            </View>
          ))}
        </PanelCard>

        <PanelCard title={r.actionsTitle} style={styles.gap} testID="AdminRefundDetail.actions">
          {!canAct ? <Text variant="body" color="muted" size={15}>{r.noWritePermission}</Text> : null}
          {canAct && !hasActions ? <Text variant="body" color="muted" size={15}>{r.noActions}</Text> : null}
          <View style={styles.actions}>
            {available.approve ? <Button testID="AdminRefundDetail.approve" label={r.approve} chevron={false} onPress={() => setApproveOpen(true)} /> : null}
            {available.reject ? <Button testID="AdminRefundDetail.reject" label={r.reject} variant="danger" chevron={false} onPress={() => setRejectOpen(true)} /> : null}
            {available.execute ? <Button testID="AdminRefundDetail.execute" label={available.executeLabel} chevron={false} onPress={() => setExecuteOpen(true)} /> : null}
          </View>
        </PanelCard>
      </>
    );
  }

  const maxCents = data !== undefined ? (maxFromServer ?? centsOf(data.maxRefundable)) : null;
  const amountCheck = checkApprovedAmount(amount, maxCents);
  const proposedCents = data !== undefined ? centsOf(data.proposedRefund) : null;
  const noteRequired = data !== undefined ? approvalNoteRequired({ policyApproved: data.policy.status === "approved" && data.policy.version !== null, proposedCents, approvedCents: amountCheck.ok ? amountCheck.cents : null }) : true;
  const noteCheck = checkNote(note, noteRequired);
  const amountError = !attempted ? undefined : amountCheck.ok ? undefined : amountCheck.reason === "required" ? r.amountRequired : amountCheck.reason === "invalid" ? r.amountInvalid : amountCheck.reason === "too_low" ? r.amountTooLow : r.amountTooHigh(maxCents !== null ? centsText(maxCents) : "");
  const noteError = !attempted ? undefined : noteCheck.ok ? undefined : noteCheck.reason === "required" ? r.noteRequired : r.noteTooLong;

  const submitApprove = async (): Promise<void> => {
    setAttempted(true);
    if (data === undefined || !amountCheck.ok || !noteCheck.ok) return;
    setSheetError(null);
    try {
      const result = await actions.approve.mutateAsync({ refundId, body: { approvedCents: amountCheck.cents, ...(noteCheck.note !== undefined ? { note: noteCheck.note } : {}) } });
      setApproveOpen(false);
      showToast({ kind: "success", message: result.executionStatus === "awaiting_provider" ? r.doneApprovedBlocked : r.doneApproved, id: "refund.approve" });
      void query.refetch();
    } catch (failure) {
      const max = maxRefundableFromError(failure);
      if (max !== null) {
        setMaxFromServer(max);
        setSheetError(r.exceedsPaid(centsText(max)));
      } else setSheetError(adminError(failure).message);
      void query.refetch();
    }
  };

  const submitReject = async (input: { reason: string }): Promise<void> => {
    setSheetError(null);
    try {
      await actions.reject.mutateAsync({ refundId, body: { note: input.reason } });
      setRejectOpen(false);
      showToast({ kind: "success", message: r.doneRejected, id: "refund.reject" });
      void query.refetch();
    } catch (failure) {
      setSheetError(adminError(failure).message);
      void query.refetch();
    }
  };

  const submitExecute = async (): Promise<void> => {
    try {
      await actions.execute.mutateAsync(refundId);
      setExecuteOpen(false);
      showToast({ kind: "success", message: r.doneExecuted, id: "refund.execute" });
    } catch (failure) {
      setExecuteOpen(false);
      const view = adminError(failure);
      showToast({ kind: "error", message: view.code === "PAYMENTS_PROVIDER_DISABLED" ? r.providerDisabledMessage : view.message, id: "refund.execute" });
    }
    void query.refetch();
  };

  return (
    <>
      <Screen testID="AdminRefundDetail" header={header} paddingX={11} refreshing={query.isRefreshing} onRefresh={ready ? () => void query.refetch() : undefined} contentContainerStyle={styles.content}>
        {body}
      </Screen>

      <BottomSheet
        visible={approveOpen}
        onClose={() => (actions.approve.isPending ? undefined : setApproveOpen(false))}
        title={r.approveSheetTitle}
        subtitle={r.approveSheetSubtitle}
        testID="AdminRefundDetail.approveSheet"
        footer={
          <View style={styles.sheetActions}>
            <Button testID="AdminRefundDetail.approveSheet.confirm" label={r.approveConfirm} chevron={false} loading={actions.approve.isPending} onPress={() => void submitApprove()} />
            <Button testID="AdminRefundDetail.approveSheet.cancel" label={reviewStrings.common.cancel} variant="outline" chevron={false} disabled={actions.approve.isPending} onPress={() => setApproveOpen(false)} />
          </View>
        }
      >
        {sheetError !== null ? <Banner kind="error" size="sm" title={r.errorTitle} message={sheetError} style={styles.gap} testID="AdminRefundDetail.approveSheet.error" /> : null}
        <TextField
          testID="AdminRefundDetail.approveSheet.amount"
          label={r.amountLabel}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder={r.amountPlaceholder}
          error={amountError}
          helper={amountError === undefined && maxCents !== null ? (proposedCents === null ? r.amountHelperPending(centsText(maxCents)) : r.amountHelper(centsText(maxCents))) : undefined}
        />
        <Text variant="rowTitle" color="heading" size={16} style={styles.noteLabel}>{noteRequired ? r.noteLabelRequired : r.noteLabel}</Text>
        <TextArea testID="AdminRefundDetail.approveSheet.note" value={note} onChangeText={setNote} placeholder={r.notePlaceholder} maxLength={1100} minHeight={96} error={noteError} helper={r.noteHelper} accessibilityLabel={r.noteLabel} />
      </BottomSheet>

      <ReasonSheet
        visible={rejectOpen}
        title={r.rejectSheetTitle}
        subtitle={r.rejectSheetSubtitle}
        confirmLabel={r.rejectConfirm}
        tone="danger"
        busy={actions.reject.isPending}
        errorMessage={sheetError}
        textRequired
        textLabel={r.noteLabelRequired}
        textPlaceholder={r.notePlaceholder}
        textHelper={r.noteHelper}
        onConfirm={(input) => void submitReject(input)}
        onClose={() => setRejectOpen(false)}
        testID="AdminRefundDetail.rejectSheet"
      />

      <ConfirmDialog
        visible={executeOpen}
        title={r.executeConfirmTitle}
        message={r.executeConfirmMessage}
        confirmLabel={r.executeConfirmLabel}
        loading={actions.execute.isPending}
        onConfirm={() => void submitExecute()}
        onCancel={() => setExecuteOpen(false)}
        testID="AdminRefundDetail.executeDialog"
      />

      <StaffAccessSheet visible={gate.sheetOpen} onClose={gate.closeSheet} me={access.me} loading={access.query.isLoading || access.query.isIdle} error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: 10, paddingBottom: 24 },
  gap: { marginTop: 10 },
  top4: { marginTop: 4 },
  fact: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 30 },
  tag: { marginRight: 2 },
  people: { marginTop: 10, gap: 8 },
  person: { flexDirection: "row", alignItems: "center", gap: 10 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 8 },
  actions: { gap: 10, marginTop: 6 },
  sheetActions: { gap: 10 },
  noteLabel: { marginTop: 14, marginBottom: 6 },
});
