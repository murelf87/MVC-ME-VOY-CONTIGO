/**
 * 16a/16b · Estado y pago. Sigue la solicitud (o la reserva semanal) desde «Solicitud» hasta «Confirmada». Con la solicitud
 * aceptada enseña la cuenta atrás de la reserva provisional, el método de pago, el resumen y «Pagar reserva».
 *
 * Todo lo decide el servidor: aceptada ≠ confirmada (la plaza solo existe cuando se confirma el pago), el importe sale
 * de la oferta fijada a la solicitud y el botón de pago se bloquea con el motivo real (proveedor sin activar, importe por
 * definir, reserva caducada, pago ya en curso). Con el proveedor desactivado NO se cobra nada y se dice con claridad.
 *
 * Datos: `GET /v1/ride-requests/:id`, `GET /v1/weekly-reservations/:id`, `GET /v1/ride-requests/:id/payment`;
 * acciones: `POST …/withdraw` (solo pendiente) y `POST …/payment-intents` (Idempotency-Key obligatoria).
 */
import { StackActions } from "@react-navigation/native";
import React, { useCallback, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { ChargeMethodKind } from "@/api/types";
import { useApiMutation } from "@/hooks";
import { resolveDevicePlatform } from "@/platform";
import type { AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Banner, Button, ConfirmDialog, OfflineBanner, Screen, ScreenHeader, StepProgress, Text, showToast } from "@/ui";
import { HoldCountdownCard } from "../components/HoldCountdownCard";
import { InfoSheet } from "../components/InfoSheet";
import { MethodPicker } from "../components/MethodPicker";
import { PaymentSummaryCard } from "../components/PaymentSummaryCard";
import { ProblemCard } from "../components/ProblemCard";
import { postWithdrawRideRequest, postWithdrawWeeklyReservation } from "../api";
import { usePayRequest } from "../hooks/usePayRequest";
import { useRequestStatus } from "../hooks/useRequestStatus";
import { AFFECTED_ELSEWHERE, REQUEST_ALL } from "../hooks/keys";
import { describeRequestError, hasErrorCode, openPaymentIdOf } from "../logic/errors";
import { buildStatusModel, defaultMethod, methodOptions } from "../logic/statusModel";
import { requestStrings } from "../strings";

const copy = requestStrings.status;
const common = requestStrings.common;

const SCREEN_X = 14;

export function RequestStatusScreen({ navigation, route }: AppScreenProps<"RequestStatusPayment">): React.JSX.Element {
  const { requestId, reservationId } = route.params;
  const status = useRequestStatus(requestId, reservationId);
  const { ride, weekly, context, secondsLeft } = status;
  const pay = usePayRequest();
  const withdraw = useApiMutation(
    async (_: void, { signal }) => (reservationId !== undefined ? postWithdrawWeeklyReservation(reservationId, { signal }) : postWithdrawRideRequest(requestId, { signal })),
    { invalidates: [REQUEST_ALL, ...AFFECTED_ELSEWHERE] },
  );

  const platform = resolveDevicePlatform(Platform.OS);
  const [chosen, setChosen] = useState<ChargeMethodKind | null>(null);
  const [rejectInfo, setRejectInfo] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const waitingForWeekly = reservationId !== undefined && weekly.data === undefined && !weekly.isError;
  const loading = (ride.isLoading && ride.data === undefined) || waitingForWeekly;
  const rideFailed = ride.data === undefined && (ride.isError || ride.isOffline);

  const model = useMemo(() => {
    if (ride.data === undefined || (reservationId !== undefined && weekly.data === undefined)) return null;
    const options = methodOptions(context.data ?? null, platform);
    return buildStatusModel(
      { ride: ride.data, weekly: weekly.data ?? null, context: context.data ?? null },
      { secondsLeft, platform, method: chosen ?? defaultMethod(options) },
    );
  }, [ride.data, weekly.data, context.data, secondsLeft, platform, chosen, reservationId]);

  const selected: ChargeMethodKind = chosen ?? (model === null ? "card" : defaultMethod(model.methods));
  const saved = context.data?.savedMethods.find((m) => m.kind === "card") ?? null;
  const stale = ride.failedToRefresh || context.failedToRefresh || (ride.isOffline && ride.data !== undefined);

  const payIds = useMemo(() => {
    if (weekly.data === undefined) return [requestId];
    const ids = weekly.data.occurrences
      .filter((o) => o.requestId !== null && (o.requestStatus === "accepted" || o.requestStatus === "payment_pending"))
      .map((o) => o.requestId as string);
    return ids.length > 0 ? ids : [requestId];
  }, [weekly.data, requestId]);

  const goProcessing = useCallback(
    (payments: Array<{ id: string }>) => {
      const first = payments[0];
      if (first === undefined) return;
      navigation.navigate("PaymentProcessing", {
        requestId,
        paymentId: first.id,
        ...(reservationId !== undefined ? { reservationId } : {}),
        paymentIds: payments.map((p) => p.id),
      });
    },
    [navigation, requestId, reservationId],
  );

  const onPay = useCallback(async () => {
    if (model === null || pay.isPending) return;
    if (model.openPaymentId !== null) {
      goProcessing([{ id: model.openPaymentId }]);
      return;
    }
    if (!model.canPay) return;
    if (selected === "card" && saved === null) {
      navigation.navigate("AddPaymentMethod", { purpose: "charge" });
      return;
    }
    const outcome = await pay.mutate({
      requestIds: payIds,
      method: selected === "card" && saved !== null ? { kind: "card", paymentMethodId: saved.id } : { kind: selected },
      sheetLabel: [ride.data?.trip.originLabel, ride.data?.trip.destinationLabel].filter((x): x is string => Boolean(x)).join(" → "),
      amountLabel: model.summary?.total.value ?? "",
    });
    if (outcome === undefined) {
      const openId = openPaymentIdOf(pay.error);
      if (openId !== null) goProcessing([{ id: openId }]);
      return;
    }
    if (outcome.kind === "started") goProcessing(outcome.payments);
    else if (outcome.kind === "cancelled") {
      showToast({ kind: "info", message: copy.paymentCancelled, id: "request.pay.cancelled" });
      status.refetchAll();
    } else status.refetchAll();
  }, [model, pay, selected, saved, payIds, ride.data, goProcessing, navigation, status]);

  const onWithdraw = useCallback(async () => {
    const done = await withdraw.mutate(undefined);
    setConfirmWithdraw(false);
    if (done === undefined) return;
    showToast({ kind: "success", message: copy.withdrawn, id: "request.withdrawn" });
    status.refetchAll();
  }, [withdraw, status]);

  const searchAgain = useCallback(() => navigation.dispatch(StackActions.popTo("MapHome")), [navigation]);

  // ── Problemas de pago ──────────────────────────────────────────────────────────────────────────────────────────
  const payProblem = (() => {
    if (pay.error === null || pay.isPending) return null;
    if (pay.isOffline) {
      return <OfflineBanner title={common.offlineTitle} detail={common.offlineDetail} retryLabel={common.retry} onRetry={() => void pay.retry()} testID="RequestStatus.payOffline" />;
    }
    if (hasErrorCode(pay.error, "PAYMENT_ALREADY_OPEN")) return null;
    const d = describeRequestError(pay.error);
    return (
      <Banner kind="error" size="sm" title={d.title} message={d.message} actionLabel={d.retryable ? common.retry : undefined} onAction={d.retryable ? () => void pay.retry() : undefined} testID="RequestStatus.payError" />
    );
  })();
  const sheetProblem =
    pay.data?.kind === "sdk_unsupported" ? (
      <Banner kind="warning" size="sm" title={copy.sdkUnsupportedTitle} message={copy.sdkUnsupportedMessage} testID="RequestStatus.sdkUnsupported" />
    ) : pay.data?.kind === "sheet_failed" ? (
      <Banner kind="error" size="sm" title={copy.sheetFailedTitle} message={copy.sheetFailedMessage} testID="RequestStatus.sheetFailed" />
    ) : null;

  // ── Pie ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const footer = (() => {
    if (model === null) return null;
    switch (model.phase) {
      case "accepted":
        return (
          <Button
            label={model.openPaymentId !== null ? copy.paymentOpenAction : model.canPay || model.payBlock === null ? copy.pay : copy.payBlocked}
            accessibilityLabel={pay.isPending ? copy.paying : undefined}
            loading={pay.isPending}
            disabled={model.openPaymentId === null && !model.canPay}
            onPress={() => void onPay()}
            testID="RequestStatus.pay"
          />
        );
      case "waiting":
        return <Button label={copy.withdraw} variant="dangerOutline" chevron={false} onPress={() => setConfirmWithdraw(true)} testID="RequestStatus.withdraw" />;
      case "confirmed":
        return (
          <Button
            label={copy.confirmedAction}
            onPress={() => navigation.navigate("BookingDetail", model.confirmed?.bookingId ? { bookingId: model.confirmed.bookingId, requestId } : { requestId })}
            testID="RequestStatus.seeBooking"
          />
        );
      case "partial":
        return (
          <Button label={copy.seeWeekly} onPress={() => navigation.navigate("WeeklyReservation", { reservationId: reservationId ?? "" })} disabled={reservationId === undefined} testID="RequestStatus.seeWeekly" />
        );
      default:
        return <Button label={common.seeOtherTrips} onPress={searchAgain} testID="RequestStatus.searchAgain" />;
    }
  })();

  return (
    <Screen
      testID="RequestStatus"
      paddingX={SCREEN_X}
      header={<ScreenHeader title={copy.title} testID="RequestStatus.header" />}
      refreshing={ride.isRefreshing}
      onRefresh={status.refetchAll}
      footer={footer}
    >
      {stale && model !== null ? (
        <OfflineBanner title={common.offlineTitle} detail={common.staleDetail} retryLabel={common.retry} onRetry={status.refetchAll} testID="RequestStatus.offline" style={styles.gap} />
      ) : null}

      {loading ? (
        <View testID="RequestStatus.loading" style={styles.loading}>
          <Text variant="body" color="muted" align="center">
            {copy.loadingContext}
          </Text>
        </View>
      ) : null}

      {!loading && rideFailed ? (
        <ProblemCard
          error={ride.error ?? new Error(copy.notFoundMessage)}
          offline={ride.isOffline}
          onRetry={status.refetchAll}
          exitLabel={common.seeOtherTrips}
          onExit={searchAgain}
          testID="RequestStatus.problem"
        />
      ) : null}

      {model !== null ? (
        <>
          <StepProgress steps={model.steps} states={model.stepStates} current={model.stepIndex} testID="RequestStatus.steps" style={styles.steps} />

          <Banner
            kind={model.banner.tone}
            size="lg"
            title={model.banner.title}
            message={model.banner.message}
            icon={model.banner.tone === "error" ? "closeBold" : model.banner.tone === "success" ? "checkBold" : model.banner.tone === "warning" ? "exclaim" : "clock"}
            testID="RequestStatus.banner"
          />

          {model.weeklyCounts !== null && model.phase !== "accepted" ? (
            <Text variant="body" color="muted" size={16.5} lineHeight={21} style={styles.counts} testID="RequestStatus.counts">
              {copy.weeklyConfirmedCount(model.weeklyCounts.confirmed, model.weeklyCounts.total)} · {copy.weeklyDays(model.weeklyCounts.total)}
            </Text>
          ) : null}

          {model.hold !== null ? (
            <View style={styles.block}>
              <HoldCountdownCard text={model.hold.text} seconds={model.hold.secondsLeft} testID="RequestStatus.hold" />
            </View>
          ) : null}

          {model.phase === "accepted" ? (
            <Banner kind="info" size="xs" icon="infoOutline" message={copy.holdInfo} style={styles.block} testID="RequestStatus.holdInfo" />
          ) : null}

          {model.showPayment ? (
            <>
              <MethodPicker options={model.methods} selected={selected} onSelect={setChosen} savedLabel={saved?.last4 ? `Tarjeta ${saved.last4}` : null} testID="RequestStatus.methods" />
              {selected === "card" && saved === null && model.phase === "accepted" ? (
                <Text variant="caption" color="muted" size={14.5} lineHeight={19} style={styles.hint}>
                  {copy.addCardHint}
                </Text>
              ) : null}
              {model.summary !== null ? <PaymentSummaryCard model={model.summary} testID="RequestStatus.summary" /> : null}
              {model.payBlock !== null ? (
                <Banner
                  kind={model.payBlock.code === "PAYMENT_ALREADY_OPEN" ? "info" : "warning"}
                  size="sm"
                  title={model.payBlock.title}
                  message={model.payBlock.message}
                  style={styles.block}
                  testID="RequestStatus.payBlock"
                />
              ) : null}
              {payProblem !== null ? <View style={styles.block}>{payProblem}</View> : null}
              {sheetProblem !== null ? <View style={styles.block}>{sheetProblem}</View> : null}
              {model.phase === "accepted" ? (
                <Banner
                  kind="error"
                  size="xs"
                  icon="closeBold"
                  title={copy.rejectedBandTitle}
                  message={copy.rejectedBandMessage}
                  chevron
                  onPress={() => setRejectInfo(true)}
                  style={styles.block}
                  testID="RequestStatus.rejectedBand"
                />
              ) : null}
            </>
          ) : null}

          {withdraw.error !== null && !withdraw.isPending ? (
            <Banner kind="error" size="sm" title={describeRequestError(withdraw.error).title} message={describeRequestError(withdraw.error).message} style={styles.block} testID="RequestStatus.withdrawError" />
          ) : null}
        </>
      ) : null}

      <InfoSheet visible={rejectInfo} title={copy.rejectedBandTitle} message={copy.rejectedSheetMessage} closeLabel={copy.rejectedSheetClose} onClose={() => setRejectInfo(false)} testID="RequestStatus.rejectedSheet" />
      <ConfirmDialog
        visible={confirmWithdraw}
        title={copy.withdrawTitle}
        message={copy.withdrawMessage(model?.driverName ?? "")}
        confirmLabel={copy.withdrawConfirm}
        cancelLabel={copy.withdrawKeep}
        destructive
        loading={withdraw.isPending}
        onConfirm={() => void onWithdraw()}
        onCancel={() => setConfirmWithdraw(false)}
        testID="RequestStatus.withdrawDialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  steps: { marginTop: 2, marginBottom: 10 },
  block: { marginTop: 12 },
  gap: { marginBottom: 10 },
  loading: { paddingVertical: 60 },
  counts: { marginTop: 10 },
  hint: { marginTop: 6, color: colors.text.muted },
});
