/**
 * Detalle de un cobro del conductor: pasajero (solo nombre y foto; nunca datos de pago), viaje, desglose (aportación −
 * comisión − devoluciones = neto), estado real y enlaces a la liquidación y al viaje.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { ApiError } from "@/api";
import { formatMoneyLabelled } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { Banner, Button, Divider, EmptyState, Screen, ScreenHeader, StatusPill, Text } from "@/ui";
import { DetailCard, DetailRow } from "../components/ListBits";
import { LoadError, RowsSkeleton, StaleNote } from "../components/StateBlocks";
import { useEarning } from "../hooks/useEarning";
import { earningStateChip, tripDateText, tripRouteText, withPerson } from "../model";
import { useNow } from "../hooks/useNow";
import { moneyStrings } from "../strings";

const t = moneyStrings.earning;

export function EarningDetailScreen({ navigation, route }: AppScreenProps<"EarningDetail">): React.JSX.Element {
  const { bookingId } = route.params;
  const query = useEarning(bookingId);
  const now = useNow();
  const earning = query.data;
  const header = <ScreenHeader title={t.title} testID="EarningDetail.header" />;

  if (earning === undefined) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Screen testID="EarningDetail" header={header}>
        {notFound ? (
          <EmptyState testID="EarningDetail.notFound" icon="alertCircle" title={t.notFound} message="" actionLabel={moneyStrings.refunds.close} onAction={() => navigation.goBack()} variant="plain" />
        ) : query.isError || query.isOffline ? (
          <LoadError testID="EarningDetail.error" error={query.error} heading={t.loadError} onRetry={() => void query.refetch()} />
        ) : (
          <RowsSkeleton testID="EarningDetail.loading" count={3} />
        )}
      </Screen>
    );
  }

  const chip = earningStateChip(earning.state);
  return (
    <Screen testID="EarningDetail" header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      <StaleNote offline={query.isOffline} failedToRefresh={query.isError} onRetry={() => void query.refetch()} testID="EarningDetail.stale" />
      <DetailCard testID="EarningDetail.trip">
        <Text variant="titleSm" color="heading" size={19}>{t.withPerson(earning.passenger.displayName.split(" ")[0] ?? earning.passenger.displayName)}</Text>
        <Text variant="body" color="deep" size={16.5}>{tripRouteText(earning.trip)}</Text>
        <Text variant="body" color="muted" size={15}>{`${t.tripOn}: ${tripDateText(earning.trip, earning.occurredAt, now)}`}</Text>
        <StatusPill label={chip.label} tone={chip.tone} />
      </DetailCard>
      <Text variant="titleSm" color="heading" size={19} style={styles.section}>{t.breakdown}</Text>
      <DetailCard testID="EarningDetail.breakdown">
        <DetailRow label={t.contribution} value={formatMoneyLabelled(earning.lines.contribution)} />
        <DetailRow label={t.driverCommission} value={formatMoneyLabelled(earning.lines.driverCommission)} />
        <DetailRow label={t.refundAdjustments} value={formatMoneyLabelled(earning.lines.refundAdjustments)} />
        <Divider />
        <DetailRow label={t.net} value={formatMoneyLabelled(earning.lines.net)} strong />
      </DetailCard>
      <Banner testID="EarningDetail.state" kind={earning.state === "paid_out" ? "success" : "info"} message={t.stateText[earning.state]} style={styles.gap} />
      <Text variant="body" color="muted" size={14.5} testID="EarningDetail.privacy">{t.privacy}</Text>
      {earning.payoutId !== null ? <Button testID="EarningDetail.payout" label={t.seePayout} variant="outline" chevron={false} onPress={() => navigation.navigate("PayoutDetail", { payoutId: earning.payoutId as string })} style={styles.section} /> : null}
      <Button testID="EarningDetail.trip.open" label={t.seeTrip} variant="outline" chevron={false} onPress={() => navigation.navigate("TripDetail", { tripId: earning.trip.tripId })} style={styles.gapTop} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 12, marginBottom: 8 },
  gapTop: { marginTop: 10 },
  section: { marginTop: 20 },
});
