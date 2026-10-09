/**
 * Mis devoluciones. Cada devolución con su origen, importes (pagado · propuesto · aprobado · coste final), política de
 * cancelación y la línea de seguimiento real. Nunca se promete la devolución: solo cuenta cuando Administración la aprueba
 * y el proveedor de pagos la confirma. La lista se refresca sola mientras haya devoluciones abiertas.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { formatDateShort, formatMoneyLabelled } from "@/i18n";
import { requireAccount, type AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Banner, Button, EmptyState, Screen, ScreenHeader, StatusPill, Text } from "@/ui";
import { DetailRow, ListFooter, TrackingList } from "../components/ListBits";
import { LoadError, RowsSkeleton, StaleNote } from "../components/StateBlocks";
import { useMoneyAccess } from "../hooks/useMoneyAccess";
import { useRefundsList } from "../hooks/useRefunds";
import { refundChip, refundOriginLabel, refundTracking } from "../model";
import { moneyStrings } from "../strings";

const t = moneyStrings.refunds;

export function RefundsScreen({ navigation, route }: AppScreenProps<"Refunds">): React.JSX.Element {
  const access = useMoneyAccess();
  const list = useRefundsList();
  const header = <ScreenHeader title={t.title} testID="Refunds.header" />;

  if (!access.signedIn) {
    return (
      <Screen testID="Refunds" header={header}>
        <EmptyState testID="Refunds.guest" variant="plain" icon="card" title={moneyStrings.overview.guest.title} message={moneyStrings.overview.guest.message} actionLabel={moneyStrings.overview.guest.action} onAction={() => requireAccount({ name: "Refunds", params: route.params })} />
      </Screen>
    );
  }

  return (
    <Screen testID="Refunds" header={header} refreshing={list.isRefreshing} onRefresh={() => void list.refresh()}>
      <Banner testID="Refunds.intro" kind="info" title={t.introTitle} message={t.introMessage} />
      <StaleNote offline={list.isOffline} failedToRefresh={list.isError && list.items.length > 0} onRetry={() => void list.refresh()} testID="Refunds.stale" style={styles.gap} />
      {list.isLoading && list.items.length === 0 ? <RowsSkeleton testID="Refunds.skeleton" count={2} /> : null}
      {list.items.length === 0 && (list.isError || list.isOffline) ? <LoadError testID="Refunds.error" error={list.error} heading={t.loadError} onRetry={() => void list.refresh()} /> : null}
      {list.isEmpty ? <EmptyState testID="Refunds.empty" icon="card" title={t.empty.title} message={t.empty.message} variant="plain" /> : null}
      {list.items.map((refund) => {
        const chip = refundChip(refund);
        return (
          <View key={refund.id} style={styles.card} testID={`Refunds.item.${refund.id}`}>
            <View style={styles.head}>
              <View style={styles.flex}>
                <Text variant="titleSm" color="heading" size={18}>{refundOriginLabel(refund.origin)}</Text>
                <Text variant="body" color="muted" size={14.5}>{t.requestedOn(formatDateShort(refund.createdAt))}</Text>
              </View>
              <StatusPill label={chip.label} tone={chip.tone} size="sm" />
            </View>
            <DetailRow label={t.paid} value={formatMoneyLabelled(refund.paid)} />
            <DetailRow label={t.proposed} value={formatMoneyLabelled(refund.proposedRefund)} />
            <DetailRow label={t.approved} value={formatMoneyLabelled(refund.approvedRefund)} />
            <DetailRow label={t.platformFee} value={formatMoneyLabelled(refund.platformFee)} />
            <DetailRow label={t.finalCost} value={formatMoneyLabelled(refund.finalPassengerCost)} strong />
            <Text variant="body" color="muted" size={14.5}>{`${t.policy}: ${refund.policy.status === "approved" ? t.policyApproved(refund.policy.version) : t.policyPending}`}</Text>
            <Text variant="titleSm" color="heading" size={17} style={styles.trackTitle}>{t.trackingTitle}</Text>
            <TrackingList steps={refundTracking(refund)} testID={`Refunds.tracking.${refund.id}`} />
            <Text variant="body" color="muted" size={14} testID={`Refunds.noPromise.${refund.id}`}>{t.noPromise}</Text>
            {refund.bookingId !== null ? <Button testID={`Refunds.booking.${refund.id}`} label={t.seeBooking} variant="outline" size="sm" chevron={false} onPress={() => navigation.navigate("BookingDetail", { bookingId: refund.bookingId as string })} style={styles.gapTop} /> : null}
          </View>
        );
      })}
      <ListFooter testID="Refunds.more" hasMore={list.hasMore} loading={list.isFetchingMore} error={list.fetchMoreError !== null} errorText={t.loadMoreError} moreLabel={moneyStrings.seeAll} onMore={() => void list.fetchMore()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { marginTop: 8 },
  gapTop: { marginTop: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  trackTitle: { marginTop: 8 },
  card: { marginTop: 12, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 6 },
});
