/**
 * Reserva cancelada (sin lámina; se diseña con la 28 al lado). Confirma la cancelación, avisa de que se ha liberado la
 * plaza y avisado a quien conduce, y explica con honestidad qué pasa con el dinero: es una PROPUESTA que revisa
 * Administración; nunca se promete una devolución. Estados: cargando · error · cancelada (con o sin devolución).
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { RefundView } from "@/api/types";
import { formatMoney } from "@/i18n";
import { Icon } from "@/icons";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { Banner, Button, Card, ErrorStateCard, Screen, ScreenHeader, Skeleton, StatusPill, Text } from "@/ui";
import { useCancelOutcome } from "../hooks/useCancellation";
import { messagesStrings } from "../strings";

const copy = messagesStrings.cancelResult;
const SIDE = 14;

const STATUS_TONE = { pending_review: "amber", approved: "blue", executing: "blue", refunded: "green", rejected: "gray", failed: "red", not_applicable: "gray" } as const;

/** Frase de «Qué pasa ahora» según la devolución; sin promesas. */
export function refundSentence(refund: RefundView | null): string {
  if (refund === null) return copy.refundNone;
  switch (refund.status) {
    case "approved":
    case "executing":
      return copy.refundApproved;
    case "refunded":
      return copy.refundRefunded;
    case "rejected":
      return copy.refundRejected;
    case "failed":
      return copy.refundFailed;
    case "not_applicable":
      return copy.refundNotApplicable;
    case "pending_review":
      return refund.proposedRefund.cents === null ? `${copy.refundReview} ${copy.refundPending}` : copy.refundProposed(formatMoney(refund.proposedRefund));
  }
}

export function CancelBookingResultScreen({ navigation, route }: AppScreenProps<"CancelBookingResult">): React.JSX.Element {
  const bookingId = route.params.bookingId;
  const query = useCancelOutcome(bookingId);
  const header = <ScreenHeader title={copy.title} testID="CancelBookingResult.header" hideBack />;
  const outcome = query.data;

  if (outcome === undefined) {
    return (
      <Screen testID="CancelBookingResult" paddingX={SIDE} header={header}>
        <View style={styles.block}>
          {query.error ? (
            <ErrorStateCard testID="CancelBookingResult.error" tone="red" icon="alertCircle" title={copy.loadError} message={describeError(query.error).message} actionLabel={messagesStrings.common.retry} onAction={() => void query.refetch()} />
          ) : (
            <View testID="CancelBookingResult.loading" accessible accessibilityLabel={messagesStrings.common.updating} accessibilityState={{ busy: true }}>
              <Skeleton height={150} radius={16} />
              <Skeleton height={140} radius={16} style={styles.gap} />
            </View>
          )}
        </View>
      </Screen>
    );
  }

  const { response, driverName } = outcome;
  const refund = response.refund;
  return (
    <Screen testID="CancelBookingResult" paddingX={SIDE} header={header}>
      <View style={styles.block}>
        <View style={styles.hero} accessible accessibilityRole="header" testID="CancelBookingResult.hero">
          <View style={styles.heroIcon}>
            <Icon name="check" size={38} color="#FFFFFF" />
          </View>
          <Text variant="title" color="heading" align="center" size={22} style={styles.heroTitle}>{response.alreadyCancelled && driverName === null ? copy.headlineAlready : copy.headline}</Text>
          {driverName !== null ? <Text variant="body" color="body" align="center" size={16.5} lineHeight={22}>{copy.lead(driverName)}</Text> : null}
        </View>

        <Text variant="titleSm" color="heading" size={19} style={styles.section}>{copy.nextTitle}</Text>
        <Card tone="blue" padding={14} style={styles.gap} testID="CancelBookingResult.next">
          <Text variant="body" color="strong" size={16.5} lineHeight={22} testID="CancelBookingResult.refundText">{refundSentence(refund)}</Text>
        </Card>

        {refund !== null ? (
          <Card tone="white" padding={14} style={styles.gap} testID="CancelBookingResult.refund">
            <View style={styles.statusRow}>
              <Text variant="titleSm" color="heading" size={17}>{copy.statusTitle}</Text>
              <StatusPill label={copy.statusLabels[refund.status]} tone={STATUS_TONE[refund.status]} testID="CancelBookingResult.status" />
            </View>
            <View style={styles.amountRow}>
              <Text variant="body" color="body" size={16}>{copy.paid}</Text>
              <Text variant="titleSm" color="heading" size={17}>{refund.paid.cents === null ? "Por definir" : formatMoney(refund.paid)}</Text>
            </View>
            <View style={styles.amountRow}>
              <Text variant="body" color="body" size={16}>{copy.proposedRefund}</Text>
              <Text variant="titleSm" color="heading" size={17} testID="CancelBookingResult.proposed">{refund.proposedRefund.cents === null ? "Por definir" : formatMoney(refund.proposedRefund)}</Text>
            </View>
          </Card>
        ) : null}

        <Banner testID="CancelBookingResult.legal" kind="info" size="sm" title={copy.legal} style={styles.gap} />

        <View style={styles.actions}>
          {refund !== null ? <Button testID="CancelBookingResult.refunds" label={copy.seeRefunds} onPress={() => navigation.navigate("Refunds")} /> : null}
          <Button testID="CancelBookingResult.trips" label={copy.seeTrips} variant={refund !== null ? "outline" : "primary"} onPress={() => navigation.navigate("MyTrips")} style={refund !== null ? styles.btnGap : undefined} />
          <Button testID="CancelBookingResult.findAnother" label={copy.findAnother} variant="outline" leadingIcon="search" onPress={() => navigation.navigate("MapHome")} style={styles.btnGap} />
          <Button testID="CancelBookingResult.help" label={copy.help} variant="ghost" chevron={false} onPress={() => navigation.navigate("HelpCenter", { category: "payment_issue" })} style={styles.btnGap} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { paddingTop: 10, paddingBottom: 24 },
  gap: { marginTop: 12 },
  section: { marginTop: 22 },
  hero: { alignItems: "center", paddingVertical: 14 },
  heroIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.brand.green, alignItems: "center", justifyContent: "center" },
  heroTitle: { marginTop: 14, marginBottom: 6 },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  amountRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  actions: { marginTop: 20 },
  btnGap: { marginTop: 10 },
});
