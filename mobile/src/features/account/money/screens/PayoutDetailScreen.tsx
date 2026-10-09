/**
 * Liquidación mensual del conductor: periodo, neto, estado REAL (solo «abonada» cuando el proveedor la confirma), fecha
 * prevista («Por definir» si no hay calendario) y los viajes incluidos, cada uno con su cobro.
 */
import React, { useMemo } from "react";
import { StyleSheet } from "react-native";
import { ApiError } from "@/api";
import { formatDateShort, formatMoneyLabelled } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { Banner, Button, EmptyState, Screen, ScreenHeader, StatusPill, Text } from "@/ui";
import { DetailCard, DetailRow } from "../components/ListBits";
import { MovementRow } from "../components/MovementRow";
import { LoadError, RowsSkeleton, StaleNote } from "../components/StateBlocks";
import { useNow } from "../hooks/useNow";
import { usePayout } from "../hooks/usePayouts";
import { driverMovement, monthLongLabel, payoutStatusChip } from "../model";
import { moneyStrings } from "../strings";

const t = moneyStrings.payout;

export function PayoutDetailScreen({ navigation, route }: AppScreenProps<"PayoutDetail">): React.JSX.Element {
  const { payoutId } = route.params;
  const query = usePayout(payoutId);
  const now = useNow();
  const payout = query.data;
  const movements = useMemo(() => (payout !== undefined ? payout.items.map(driverMovement) : []), [payout]);
  const header = <ScreenHeader title={t.title} testID="PayoutDetail.header" />;

  if (payout === undefined) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Screen testID="PayoutDetail" header={header}>
        {notFound ? (
          <EmptyState testID="PayoutDetail.notFound" icon="alertCircle" title={t.notFound} message="" actionLabel={moneyStrings.refunds.close} onAction={() => navigation.goBack()} variant="plain" />
        ) : query.isError || query.isOffline ? (
          <LoadError testID="PayoutDetail.error" error={query.error} heading={t.loadError} onRetry={() => void query.refetch()} />
        ) : (
          <RowsSkeleton testID="PayoutDetail.loading" count={3} />
        )}
      </Screen>
    );
  }

  const chip = payoutStatusChip(payout.status);
  return (
    <Screen testID="PayoutDetail" header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      <StaleNote offline={query.isOffline} failedToRefresh={query.isError} onRetry={() => void query.refetch()} testID="PayoutDetail.stale" />
      <DetailCard testID="PayoutDetail.summary">
        <Text variant="titleSm" color="heading" size={20}>{`${t.periodLabel}: ${monthLongLabel(payout.period)}`}</Text>
        <DetailRow label={t.netLabel} value={formatMoneyLabelled(payout.net)} strong />
        <DetailRow label={t.tripsLabel} value={String(payout.bookingsCount)} />
        <DetailRow label={t.scheduledLabel} value={payout.scheduledFor !== null ? formatDateShort(payout.scheduledFor) : moneyStrings.history.payoutScheduledPending} />
        {payout.paidAt !== null ? <DetailRow label={t.paidLabel} value={formatDateShort(payout.paidAt)} /> : null}
        <StatusPill label={chip.label} tone={chip.tone} />
      </DetailCard>
      <Banner testID="PayoutDetail.status" kind={payout.status === "paid" ? "success" : payout.status === "failed" ? "error" : "info"} message={t.statusText[payout.status]} style={styles.gap} />
      {payout.status === "failed" && payout.failureCode !== null ? <Text variant="body" color="muted" size={14.5} testID="PayoutDetail.failure">{t.failureHint(payout.failureCode)}</Text> : null}
      <Text variant="titleSm" color="heading" size={19} style={styles.section}>{t.tripsIncluded}</Text>
      {movements.length === 0 ? <Text variant="body" color="muted" size={15.5} testID="PayoutDetail.itemsEmpty">{t.itemsEmpty}</Text> : null}
      {movements.map((movement, index) => (
        <MovementRow key={movement.key} testID={`PayoutDetail.item.${movement.key}`} movement={movement} variant="card" now={now} last={index === movements.length - 1} onPress={() => navigation.navigate("EarningDetail", { bookingId: movement.target.kind === "earning" ? movement.target.bookingId : "" })} />
      ))}
      <Button testID="PayoutDetail.receipts" label={t.seeReceipts} variant="outline" chevron={false} onPress={() => navigation.navigate("ReceiptsList")} style={styles.section} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 12, marginBottom: 8 },
  section: { marginTop: 20 },
});
