import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { AdminPeriod, AdminRefundPeriod, AdminRefundTab } from "@/api/types";
import type { AppScreenProps } from "@/navigation";
import { Banner, EmptyState, Screen } from "@/ui";
import { AdminHeader } from "../components/AdminHeader";
import { CheckingAccess, NoPermission, PanelError } from "../components/AccessStates";
import { BillingCard } from "../components/BillingCard";
import { FilterSelect } from "../components/FilterSelect";
import { CardListSkeleton, LoadMore, RefreshFailedStrip } from "../components/ListStates";
import { PillTabs, type PillTab } from "../components/PillTabs";
import { StaffAccessSheet } from "../components/StaffAccessSheet";
import { useAdminGate } from "../hooks/useAdminGate";
import { useBillingList } from "../hooks/useBillingList";
import { useProvinceFilter } from "../hooks/useProvinceFilter";
import { adminError } from "../logic/errors";
import {
  DEFAULT_BOOKING_PERIOD,
  DEFAULT_REFUND_PERIOD,
  bookingPeriodOptions,
  refundPeriodOptions,
} from "../logic/filters";
import { staffInitial } from "../logic/permissions";
import { reviewStrings } from "../strings";

const b = reviewStrings.bookings;

/**
 * Lámina 39a/39b · «Reservas y devoluciones». Para Finanzas y Administración es la lista de propuestas de devolución
 * (con «Revisar devolución ›», que abre el detalle donde se aprueba, rechaza o se pide al proveedor de pago); para Atención
 * al cliente es la lista de reservas, solo de lectura. Cada rol ve solo lo suyo: sin acceso a ninguna de las dos, «Sin permiso».
 */
export function AdminBookingsRefundsScreen({ navigation }: AppScreenProps<"AdminBookingsRefunds">): React.JSX.Element {
  const gate = useAdminGate((access) => access.bookingsSource !== "none");
  const { access } = gate;
  const ready = gate.state === "ready";
  const source = access.bookingsSource;

  const province = useProvinceFilter();
  const [tab, setTab] = useState<AdminRefundTab>("cancelled");
  const [refundPeriod, setRefundPeriod] = useState<AdminRefundPeriod>(DEFAULT_REFUND_PERIOD);
  const [bookingPeriod, setBookingPeriod] = useState<AdminPeriod>(DEFAULT_BOOKING_PERIOD);

  const list = useBillingList({
    source,
    tab,
    refundPeriod,
    bookingPeriod,
    provinceId: province.selected.id,
    provinceCode: province.selected.code,
    enabled: ready && province.ready,
  });

  const openRefund = useCallback((refundId: string) => navigation.navigate("AdminRefundDetail", { refundId }), [navigation]);

  const tabs = useMemo<Array<PillTab<AdminRefundTab>>>(
    () => [
      { value: "all", label: b.tabs.all, badge: list.counts?.all ?? null },
      { value: "cancelled", label: b.tabs.cancelled, badge: list.counts?.cancelled ?? null },
      { value: "refunded", label: b.tabs.refunded, badge: list.counts?.refunded ?? null },
    ],
    [list.counts],
  );
  const refundPeriods = useMemo(refundPeriodOptions, []);
  const bookingPeriods = useMemo(bookingPeriodOptions, []);
  const periodText = source === "bookings" ? b.bookingPeriods[bookingPeriod] : b.refundPeriods[refundPeriod];

  const listError = list.isError ? adminError(list.error) : null;
  const loading = list.isIdle || list.isLoading || !province.ready;

  let body: React.ReactNode;
  if (gate.state === "checking") {
    body = <CheckingAccess />;
  } else if (gate.state === "error" && gate.error !== null) {
    body = <PanelError error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} testID="AdminBookingsRefunds.error" />;
  } else if (gate.state === "denied") {
    body = (
      <NoPermission
        testID="AdminBookingsRefunds.denied"
        message={reviewStrings.access.deniedMessage(reviewStrings.access.areaLabels.bookings)}
        onGoHome={gate.goHome}
      />
    );
  } else if (listError !== null) {
    body = <PanelError error={listError} onRetry={() => void list.refresh()} onGoHome={gate.goHome} testID="AdminBookingsRefunds.listError" />;
  } else if (loading) {
    body = <CardListSkeleton testID="AdminBookingsRefunds.loading" />;
  } else if (list.isEmpty) {
    body = (
      <EmptyState
        testID="AdminBookingsRefunds.empty"
        icon="receipt"
        title={b.emptyTitle[tab]}
        message={b.emptyMessage[tab]}
      />
    );
  } else {
    body = (
      <>
        {list.failedToRefresh ? <RefreshFailedStrip offline={list.isOffline} onRetry={() => void list.refresh()} /> : null}
        {source === "bookings" ? <Banner kind="info" size="sm" message={b.readOnlyNote} style={styles.note} testID="AdminBookingsRefunds.readOnly" /> : null}
        {list.cards.map((card, index) => (
          <View key={card.key} style={index > 0 ? styles.cardGap : null}>
            <BillingCard card={card} onReview={source === "refunds" ? openRefund : undefined} testID={`AdminBookingsRefunds.card.${card.key}`} />
          </View>
        ))}
        <LoadMore hasMore={list.hasMore} loading={list.isFetchingMore} failed={list.fetchMoreError !== null} onPress={() => void list.fetchMore()} />
      </>
    );
  }

  const header = (
    <View>
      <AdminHeader
        subtitle={b.subtitle}
        initial={staffInitial(access.me)}
        staffName={access.me?.displayName ?? null}
        onAvatarPress={gate.openSheet}
        testID="AdminBookingsRefunds.header"
      />
      {ready ? (
        <View style={styles.controls}>
          <View style={styles.filters}>
            <FilterSelect<string>
              testID="AdminBookingsRefunds.filter.province"
              value={province.selectedValue}
              displayText={province.selected.label}
              options={province.options}
              sheetTitle={reviewStrings.provinces.sheetTitle}
              accessibilityLabel={reviewStrings.provinces.a11y(province.selected.label)}
              leadingIcon="pin"
              height={45}
              onChange={province.choose}
              style={styles.filterProvince}
            />
            {source === "bookings" ? (
              <FilterSelect<AdminPeriod>
                testID="AdminBookingsRefunds.filter.period"
                value={bookingPeriod}
                displayText={periodText}
                options={bookingPeriods}
                sheetTitle={b.periodSheetTitle}
                accessibilityLabel={b.periodA11y}
                leadingIcon="calendarGrid"
                height={45}
                onChange={setBookingPeriod}
                style={[styles.filterGap, styles.filterPeriod]}
              />
            ) : (
              <FilterSelect<AdminRefundPeriod>
                testID="AdminBookingsRefunds.filter.period"
                value={refundPeriod}
                displayText={periodText}
                options={refundPeriods}
                sheetTitle={b.periodSheetTitle}
                accessibilityLabel={b.periodA11y}
                leadingIcon="calendarGrid"
                height={45}
                onChange={setRefundPeriod}
                style={[styles.filterGap, styles.filterPeriod]}
              />
            )}
          </View>
          <View style={styles.tabs}>
            <PillTabs tabs={tabs} value={tab} onChange={setTab} accessibilityLabel={b.tabsA11y} height={43} testID="AdminBookingsRefunds.tab" />
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <Screen
        testID="AdminBookingsRefunds"
        header={header}
        paddingX={11}
        refreshing={list.isRefreshing}
        onRefresh={ready ? () => void list.refresh() : undefined}
        contentContainerStyle={styles.list}
      >
        {body}
      </Screen>
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
  controls: { paddingHorizontal: 11, paddingTop: 14 },
  filters: { flexDirection: "row" },
  filterProvince: { flex: 159.5 },
  filterPeriod: { flex: 197 },
  filterGap: { marginLeft: 16 },
  tabs: { marginTop: 13.5 },
  list: { paddingTop: 10, paddingBottom: 16 },
  cardGap: { marginTop: 10 },
  note: { marginBottom: 10 },
});
