/**
 * Procesando el pago. Espera la confirmación del SERVIDOR (`GET /v1/payments/:id`, sondeo): autorizar en la hoja de
 * Apple/Google Pay no es haber pagado. Cuando el estado es definitivo pasa a «Resultado del pago»; si tarda demasiado no
 * lo da por pagado ni por fallido: ofrece volver a comprobar, ver la solicitud o salir. Sin red no pierde nada: el pago
 * sigue su curso en el servidor.
 */
import { StackActions } from "@react-navigation/native";
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import type { AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Banner, Button, OfflineBanner, Screen, ScreenHeader, Spinner, Text } from "@/ui";
import { usePaymentsStatus } from "../hooks/usePaymentStatus";
import { describeRequestError } from "../logic/errors";
import { requestStrings } from "../strings";

const copy = requestStrings.processing;
const common = requestStrings.common;

export function PaymentProcessingScreen({ navigation, route }: AppScreenProps<"PaymentProcessing">): React.JSX.Element {
  const { requestId, paymentId, reservationId, paymentIds } = route.params;
  const ids = paymentIds !== undefined && paymentIds.length > 0 ? paymentIds : [paymentId];
  const status = usePaymentsStatus(ids);

  useEffect(() => {
    if (!status.settled) return;
    navigation.dispatch(StackActions.replace("PaymentResult", { requestId, paymentId, ...(reservationId !== undefined ? { reservationId } : {}), paymentIds: ids }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.settled]);

  const toRequest = (): void => {
    navigation.dispatch(StackActions.replace("RequestStatusPayment", { requestId, ...(reservationId !== undefined ? { reservationId } : {}) }));
  };
  const done = status.payments.filter((p) => p.status !== "processing" && p.status !== "requires_action").length;
  const problem = status.failed !== undefined && status.payments.length === 0 ? describeRequestError(status.failed.error) : null;

  return (
    <Screen
      testID="PaymentProcessing"
      paddingX={20}
      header={<ScreenHeader title={copy.title} onBack={toRequest} testID="PaymentProcessing.header" />}
    >
      {status.offline ? (
        <OfflineBanner title={copy.offlineTitle} detail={copy.offlineDetail} retryLabel={common.retry} onRetry={status.recheck} testID="PaymentProcessing.offline" />
      ) : null}

      <View style={styles.center} accessible accessibilityLiveRegion="polite" accessibilityLabel={status.timedOut ? copy.timeoutTitle : copy.a11yWorking}>
        {status.timedOut ? null : <Spinner size="lg" />}
        <Text variant="title" color="heading" align="center" style={styles.heading}>
          {status.timedOut ? copy.timeoutTitle : copy.heading}
        </Text>
        <Text variant="body" color="body" align="center" size={17.5} lineHeight={23}>
          {status.timedOut ? copy.timeoutMessage : ids.length > 1 ? copy.messageWeekly(done, ids.length) : copy.message}
        </Text>
        {!status.timedOut ? (
          <Text variant="caption" color="muted" align="center" size={14.5} lineHeight={19} style={styles.note}>
            {copy.note}
          </Text>
        ) : null}
      </View>

      {problem !== null ? (
        <Banner kind="error" size="sm" title={copy.errorTitle} message={problem.message} actionLabel={common.retry} onAction={status.recheck} testID="PaymentProcessing.error" />
      ) : null}

      {status.timedOut ? (
        <View style={styles.actions}>
          <Button label={copy.check} onPress={status.recheck} testID="PaymentProcessing.check" />
          <Button label={copy.seeStatus} variant="outline" onPress={toRequest} testID="PaymentProcessing.seeStatus" />
          <Button label={copy.leave} variant="ghost" chevron={false} onPress={() => navigation.dispatch(StackActions.popTo("MapHome"))} testID="PaymentProcessing.leave" />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", paddingTop: 56, paddingBottom: 24, gap: 14 },
  heading: { marginTop: 18 },
  note: { marginTop: 10, color: colors.text.muted },
  actions: { gap: 12, marginTop: 8 },
});
