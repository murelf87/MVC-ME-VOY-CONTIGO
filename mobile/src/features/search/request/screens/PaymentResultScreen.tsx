/**
 * Resultado del pago. Solo cuenta lo que dice el servidor: plaza confirmada, pago tardío (sin plaza), en revisión,
 * rechazado, caducado, devuelto o parcial (reserva semanal). «Cancelado» y «sin confirmación» son salidas locales
 * (`route.params.result`) y no afirman nada sobre el cobro.
 */
import { StackActions } from "@react-navigation/native";
import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Icon, type IconName } from "@/icons";
import type { AppScreenProps } from "@/navigation";
import { colors, radii } from "@/theme";
import { Button, OfflineBanner, Screen, ScreenHeader, Text } from "@/ui";
import { ProblemCard } from "../components/ProblemCard";
import { usePaymentsStatus } from "../hooks/usePaymentStatus";
import { buildResultModel, type ResultKind, type ResultTone } from "../logic/resultModel";
import { requestStrings } from "../strings";

const copy = requestStrings.result;
const common = requestStrings.common;

const TONE: Record<ResultTone, { bg: string; solid: string }> = {
  success: { bg: colors.success.bg, solid: colors.success.solid },
  warning: { bg: colors.warning.bgSoft, solid: colors.warning.solid },
  error: { bg: colors.error.bg, solid: colors.error.solid },
  info: { bg: colors.bg.tint, solid: colors.primary },
};
const ICON: Record<ResultKind, IconName> = {
  confirmed: "checkBold",
  partial: "exclaim",
  late: "clock",
  review: "clock",
  failed: "closeBold",
  expired: "clock",
  refunded: "receipt",
  cancelled: "closeBold",
  pending: "clock",
};

export function PaymentResultScreen({ navigation, route }: AppScreenProps<"PaymentResult">): React.JSX.Element {
  const { requestId, paymentId, reservationId, paymentIds, result } = route.params;
  const ids = useMemo(() => (paymentIds !== undefined && paymentIds.length > 0 ? paymentIds : [paymentId]), [paymentIds, paymentId]);
  const status = usePaymentsStatus(result === "cancelled" ? [] : ids);
  const model = useMemo(() => buildResultModel(status.payments, ids.length, result), [status.payments, ids.length, result]);

  const toRequest = (): void => {
    navigation.dispatch(StackActions.replace("RequestStatusPayment", { requestId, ...(reservationId !== undefined ? { reservationId } : {}) }));
  };
  const searchAgain = (): void => navigation.dispatch(StackActions.popTo("MapHome"));

  if (status.loading && result === undefined) {
    return (
      <Screen testID="PaymentResult" header={<ScreenHeader title={copy.title} onBack={toRequest} />}>
        <Text variant="body" color="muted" align="center" style={styles.loading}>
          {requestStrings.status.loadingContext}
        </Text>
      </Screen>
    );
  }
  if (status.failed !== undefined && status.payments.length === 0 && result === undefined) {
    return (
      <Screen testID="PaymentResult" header={<ScreenHeader title={copy.title} onBack={toRequest} />}>
        <ProblemCard error={status.failed.error ?? new Error(copy.notFoundMessage)} offline={status.failed.isOffline} onRetry={status.recheck} exitLabel={copy.backToRequest} onExit={toRequest} testID="PaymentResult.problem" />
      </Screen>
    );
  }

  const tone = TONE[model.tone];
  const footer = (() => {
    switch (model.kind) {
      case "confirmed":
        return (
          <View style={styles.footer}>
            <Button label={reservationId !== undefined ? copy.seeWeekly : copy.seeBooking} onPress={() => (reservationId !== undefined ? navigation.navigate("WeeklyReservation", { reservationId }) : navigation.navigate("BookingDetail", model.bookingId ? { bookingId: model.bookingId, requestId } : { requestId }))} testID="PaymentResult.seeBooking" />
            <Button label={copy.seePayments} variant="outline" onPress={() => navigation.navigate("PaymentHistory")} testID="PaymentResult.seePayments" />
          </View>
        );
      case "failed":
      case "cancelled":
      case "expired":
        return (
          <View style={styles.footer}>
            <Button label={copy.retry} onPress={toRequest} testID="PaymentResult.retry" />
            <Button label={copy.backToRequest} variant="outline" chevron={false} onPress={toRequest} testID="PaymentResult.back" />
          </View>
        );
      case "partial":
        return (
          <View style={styles.footer}>
            <Button label={reservationId !== undefined ? copy.seeWeekly : copy.backToRequest} onPress={() => (reservationId !== undefined ? navigation.navigate("WeeklyReservation", { reservationId }) : toRequest())} testID="PaymentResult.seeWeekly" />
            <Button label={copy.seePayments} variant="outline" onPress={() => navigation.navigate("PaymentHistory")} testID="PaymentResult.seePayments" />
          </View>
        );
      case "late":
      case "review":
      case "refunded":
        return (
          <View style={styles.footer}>
            <Button label={copy.seePayments} onPress={() => navigation.navigate("PaymentHistory")} testID="PaymentResult.seePayments" />
            <Button label={common.seeOtherTrips} variant="outline" chevron={false} onPress={searchAgain} testID="PaymentResult.search" />
          </View>
        );
      case "pending":
        return (
          <View style={styles.footer}>
            <Button label={requestStrings.processing.check} onPress={() => navigation.dispatch(StackActions.replace("PaymentProcessing", { requestId, paymentId, ...(reservationId !== undefined ? { reservationId } : {}), paymentIds: ids }))} testID="PaymentResult.check" />
            <Button label={requestStrings.processing.seeStatus} variant="outline" chevron={false} onPress={toRequest} testID="PaymentResult.seeStatus" />
          </View>
        );
    }
  })();

  return (
    <Screen testID="PaymentResult" paddingX={20} header={<ScreenHeader title={copy.title} onBack={toRequest} testID="PaymentResult.header" />} footer={footer}>
      {status.offline ? <OfflineBanner title={common.offlineTitle} detail={common.staleDetail} retryLabel={common.retry} onRetry={status.recheck} /> : null}
      <View style={styles.center} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${model.title}. ${model.message}`}>
        <View style={[styles.disc, { backgroundColor: tone.solid }]}>
          <Icon name={ICON[model.kind]} size={44} color={colors.onPrimary} />
        </View>
        <Text variant="title" color="heading" align="center" style={styles.title} testID="PaymentResult.title">
          {model.title}
        </Text>
        <Text variant="body" color="body" align="center" size={17.5} lineHeight={23} testID="PaymentResult.message">
          {model.message}
        </Text>
      </View>
      {model.paid !== null ? (
        <View style={[styles.card, { backgroundColor: tone.bg }]} testID="PaymentResult.paid">
          <Row label={copy.paidAmount} value={model.paid.amount} />
          <Row label={copy.method} value={model.paid.method} />
          <Text variant="caption" color="muted" size={14.5} lineHeight={19} style={styles.receipt}>
            {copy.receiptNote}
          </Text>
        </View>
      ) : (
        <Text variant="caption" color="muted" align="center" size={14.5} lineHeight={19} style={styles.receipt}>
          {copy.nothingCharged}
        </Text>
      )}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text variant="body" color="body" size={17} lineHeight={22}>
        {label}
      </Text>
      <Text variant="heading" color="strong" size={17} lineHeight={22} align="right">
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 60 },
  center: { alignItems: "center", paddingTop: 40, paddingBottom: 22, gap: 12 },
  disc: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
  title: { marginTop: 10 },
  card: { borderRadius: radii.lg, padding: 16, gap: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  receipt: { marginTop: 8 },
  footer: { gap: 10 },
});
