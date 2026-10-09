/**
 * Historial de pagos (pasajero) y de cobros (conductor), con filtro por estado y «Ver más». El conductor tiene además
 * «Liquidaciones» (próximo abono, calendario y lista). Cada fila abre su pantalla: estado y pago, reserva, cobro o
 * liquidación. Estados: cargando · error · sin conexión (se conserva lo cargado) · vacío (con y sin filtro).
 */
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { DriverEarningState, PassengerPaymentState, PayoutView } from "@/api/types/money";
import { formatMoney, formatMoneyLabelled } from "@/i18n";
import { requireAccount, type AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Banner, EmptyState, Screen, ScreenHeader, Segmented, StatusPill, Text } from "@/ui";
import { FilterPills, ListFooter, type FilterOption } from "../components/ListBits";
import { MovementRow } from "../components/MovementRow";
import { IllustrativeNote } from "../components/OverviewPanels";
import { LoadError, RowsSkeleton, StaleNote } from "../components/StateBlocks";
import { useEarningsList, usePaymentsList } from "../hooks/useMovementLists";
import { useMoneyAccess } from "../hooks/useMoneyAccess";
import { useNow } from "../hooks/useNow";
import { usePayoutsList } from "../hooks/usePayouts";
import { driverMovement, earningStateChip, monthLongLabel, movementsIllustrative, nextPayoutView, passengerMovement, payoutRowSubtitle, payoutStatusChip, paymentStateChip, scheduleText, type Movement } from "../model";
import { moneyStrings } from "../strings";

const t = moneyStrings.history;
const PASSENGER_STATES: PassengerPaymentState[] = ["pending", "under_review", "paid", "partially_refunded", "refunded", "failed", "expired"];
const DRIVER_STATES: DriverEarningState[] = ["pending", "available", "in_payout", "paid_out"];

function openMovement(navigation: AppScreenProps<"PaymentHistory">["navigation"], movement: Movement): void {
  const target = movement.target;
  if (target.kind === "request_payment") navigation.navigate("RequestStatusPayment", { requestId: target.requestId });
  else if (target.kind === "booking") navigation.navigate("BookingDetail", { bookingId: target.bookingId });
  else navigation.navigate("EarningDetail", { bookingId: target.bookingId });
}

function PayoutRow({ payout, onPress }: { payout: PayoutView; onPress: () => void }): React.JSX.Element {
  const chip = payoutStatusChip(payout.status);
  return (
    <Pressable testID={`PaymentHistory.payout.${payout.id}`} accessibilityRole="button" accessibilityLabel={`${t.payoutPeriod} ${monthLongLabel(payout.period)}. ${formatMoney(payout.net)}. ${chip.label}`} onPress={onPress} style={({ pressed }) => [styles.payout, pressed ? styles.pressed : null]}>
      <View style={styles.flex}>
        <Text variant="titleSm" color="heading" size={18}>{`${t.payoutPeriod} ${monthLongLabel(payout.period)}`}</Text>
        <Text variant="body" color="muted" size={15}>{payoutRowSubtitle(payout.bookingsCount, payout.status, payout.scheduledFor, payout.paidAt)}</Text>
      </View>
      <View style={styles.right}>
        <Text variant="titleSm" color="heading" size={18}>{formatMoneyLabelled(payout.net)}</Text>
        <StatusPill label={chip.label} tone={chip.tone} size="sm" />
      </View>
    </Pressable>
  );
}

export function PaymentHistoryScreen({ navigation, route }: AppScreenProps<"PaymentHistory">): React.JSX.Element {
  const access = useMoneyAccess();
  const now = useNow();
  const initialRole = route.params?.mode ?? (access.activeRole === "driver" && access.isDriver ? "driver" : "passenger");
  const [role, setRole] = useState<"passenger" | "driver">(initialRole);
  const [section, setSection] = useState<"earnings" | "payouts">(route.params?.section === "payouts" ? "payouts" : "earnings");
  const [passengerState, setPassengerState] = useState<PassengerPaymentState | null>(null);
  const [driverState, setDriverState] = useState<DriverEarningState | null>(null);

  const signedIn = access.signedIn;
  const asPassenger = signedIn && role === "passenger";
  const asDriver = signedIn && role === "driver" && access.isDriver;
  const payments = usePaymentsList(passengerState, asPassenger);
  const earnings = useEarningsList(driverState, asDriver && section === "earnings");
  const payouts = usePayoutsList(asDriver && section === "payouts");

  const title = role === "driver" ? t.driverTitle : t.passengerTitle;
  const header = <ScreenHeader title={title} testID="PaymentHistory.header" />;

  const movements = useMemo<Movement[]>(() => (role === "driver" ? earnings.items.map(driverMovement) : payments.items.map(passengerMovement)), [role, earnings.items, payments.items]);
  const list = role === "driver" ? earnings : payments;

  if (!signedIn) {
    return (
      <Screen testID="PaymentHistory" header={header}>
        <EmptyState testID="PaymentHistory.guest" variant="plain" icon="card" title={moneyStrings.overview.guest.title} message={moneyStrings.overview.guest.message} actionLabel={moneyStrings.overview.guest.action} onAction={() => requireAccount({ name: "PaymentHistory", params: route.params })} />
      </Screen>
    );
  }

  const stateOptions: FilterOption<string>[] = [{ value: null, label: t.filterAll }, ...(role === "driver" ? DRIVER_STATES.map((s) => ({ value: s as string, label: earningStateChip(s).label })) : PASSENGER_STATES.map((s) => ({ value: s as string, label: paymentStateChip(s).label })))];
  const filterValue = role === "driver" ? driverState : passengerState;
  const filtered = filterValue !== null;
  const showPayouts = role === "driver" && section === "payouts";
  const nextPayout = payouts.overview !== null ? nextPayoutView(payouts.overview.nextPayout) : null;

  return (
    <Screen testID="PaymentHistory" header={header} refreshing={showPayouts ? payouts.isRefreshing : list.isRefreshing} onRefresh={() => void (showPayouts ? payouts.refresh() : list.refresh())}>
      {access.isDriver ? (
        <Segmented
          testID="PaymentHistory.role"
          value={role}
          onChange={(value: "passenger" | "driver") => setRole(value)}
          options={[{ value: "passenger", label: moneyStrings.roles.passenger }, { value: "driver", label: moneyStrings.roles.driver }]}
          style={styles.gap}
        />
      ) : null}
      {role === "driver" && !access.isDriver ? null : null}
      {role === "driver" ? (
        <Segmented
          testID="PaymentHistory.section"
          value={section}
          onChange={(value: "earnings" | "payouts") => setSection(value)}
          options={[{ value: "earnings", label: t.sectionEarnings }, { value: "payouts", label: t.sectionPayouts }]}
          style={styles.gap}
        />
      ) : null}

      {showPayouts ? (
        <>
          {payouts.overview !== null ? (
            <View style={styles.card} testID="PaymentHistory.schedule">
              <Text variant="titleSm" color="heading" size={18}>{t.nextPayoutCardTitle}</Text>
              {nextPayout !== null ? <Text variant="body" color="deep" size={16.5}>{`${nextPayout.value} · ${formatMoneyLabelled(nextPayout.amount)}`}</Text> : null}
              <Text variant="body" color="muted" size={15}>{`${t.scheduleTitle}: ${scheduleText(payouts.overview.schedule)}`}</Text>
            </View>
          ) : null}
          {payouts.isLoading && payouts.items.length === 0 ? <RowsSkeleton testID="PaymentHistory.skeleton" /> : null}
          {payouts.items.length === 0 && (payouts.isError || payouts.isOffline) ? <LoadError testID="PaymentHistory.error" error={payouts.error} heading={t.loadError} onRetry={() => void payouts.refresh()} /> : null}
          {payouts.isEmpty ? <EmptyState testID="PaymentHistory.emptyPayouts" icon="coins" title={t.emptyPayouts.title} message={t.emptyPayouts.message} variant="plain" /> : null}
          {payouts.items.map((payout) => <View key={payout.id} style={styles.row}><PayoutRow payout={payout} onPress={() => navigation.navigate("PayoutDetail", { payoutId: payout.id })} /></View>)}
          <ListFooter testID="PaymentHistory.more" hasMore={payouts.hasMore} loading={payouts.isFetchingMore} error={payouts.fetchMoreError !== null} errorText={t.loadMoreError} moreLabel={moneyStrings.seeAll} onMore={() => void payouts.fetchMore()} />
        </>
      ) : (
        <>
          <FilterPills testID="PaymentHistory.filter" a11yLabel={t.filterLabel} options={stateOptions} value={filterValue} onChange={(value) => (role === "driver" ? setDriverState(value as DriverEarningState | null) : setPassengerState(value as PassengerPaymentState | null))} />
          <StaleNote offline={list.isOffline} failedToRefresh={list.isError && list.items.length > 0} onRetry={() => void list.refresh()} testID="PaymentHistory.stale" />
          {list.isLoading && list.items.length === 0 ? <RowsSkeleton testID="PaymentHistory.skeleton" /> : null}
          {list.items.length === 0 && (list.isError || list.isOffline) ? <LoadError testID="PaymentHistory.error" error={list.error} heading={t.loadError} onRetry={() => void list.refresh()} /> : null}
          {list.isEmpty ? (
            <EmptyState
              testID="PaymentHistory.empty"
              icon="card"
              title={filtered ? t.emptyFiltered.title : role === "driver" ? t.emptyDriver.title : t.emptyPassenger.title}
              message={filtered ? t.emptyFiltered.message : role === "driver" ? t.emptyDriver.message : t.emptyPassenger.message}
              actionLabel={filtered ? t.emptyFiltered.action : undefined}
              onAction={filtered ? () => (role === "driver" ? setDriverState(null) : setPassengerState(null)) : undefined}
              variant="plain"
            />
          ) : null}
          {movements.map((movement, index) => (
            <MovementRow key={movement.key} testID={`PaymentHistory.row.${movement.key}`} movement={movement} variant="card" now={now} last={index === movements.length - 1} onPress={() => openMovement(navigation, movement)} />
          ))}
          <IllustrativeNote visible={movementsIllustrative(movements)} />
          <ListFooter testID="PaymentHistory.more" hasMore={list.hasMore} loading={list.isFetchingMore} error={list.fetchMoreError !== null} errorText={t.loadMoreError} moreLabel={moneyStrings.seeAll} onMore={() => void list.fetchMore()} />
        </>
      )}
      <Banner testID="PaymentHistory.note" kind="info" message={moneyStrings.receipts.notFiscalMessage} style={styles.gapTop} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { marginBottom: 12 },
  gapTop: { marginTop: 16 },
  row: { marginTop: 8 },
  right: { alignItems: "flex-end", gap: 4 },
  pressed: { opacity: 0.7 },
  card: { padding: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 4, marginBottom: 8 },
  payout: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF" },
});
