import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { strings } from "@/i18n";
import { requireAccount, type AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Banner, EmptyState, ErrorStateCard, IconButton, Screen, ScreenHeader, Segmented, type SegmentedOption } from "@/ui";
import { InfoSheet, MonthSheet } from "../components/MoneySheets";
import { DriverPanel, OverviewPanel, PassengerPanel, type PanelActions } from "../components/OverviewPanels";
import { LoadError, OverviewSkeleton, StaleNote } from "../components/StateBlocks";
import { useMoneyAccess } from "../hooks/useMoneyAccess";
import { useNow } from "../hooks/useNow";
import { useDriverSummary, usePassengerSummary } from "../hooks/useSummaries";
import { commissionParagraphs, isCurrentMonth, monthKeyOf, monthLongLabel, nextPayoutView, type Movement } from "../model";
import { moneyStrings } from "../strings";

type Role = "passenger" | "driver";
type Sheet = "month" | "commission" | "nextPayout" | null;

const t = moneyStrings;

const TAB_OPTIONS: readonly SegmentedOption<Role>[] = [
  { value: "passenger", label: t.roles.passenger },
  { value: "driver", label: t.roles.driver },
];

/**
 * Láminas 33a, 33b y 34b: «Mis pagos y cobros». Dos pestañas según el rol («Soy pasajero» / «Soy conductor»), resumen del
 * mes con selector de mes, últimos movimientos con «Ver todos», método de pago con «Editar», comisión, historial y
 * justificantes. Los importes salen del servidor; mientras la economía no esté activada se leen «Por definir» o `--,-- €`,
 * y un importe ilustrativo lleva siempre su nota. Una cuenta sin rol de conductor no ve datos de conductor.
 */
export function PaymentsEarningsScreen({ navigation, route }: AppScreenProps<"PaymentsEarnings">): React.JSX.Element {
  const access = useMoneyAccess();
  const now = useNow();
  const [tab, setTab] = useState<Role>(() => route.params?.mode ?? (access.activeRole === "driver" && access.isDriver ? "driver" : "passenger"));
  const [chosenMonth, setChosenMonth] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pulling, setPulling] = useState(false);

  const currentMonth = monthKeyOf(now);
  const month = chosenMonth ?? currentMonth;
  const dualRole = access.isDriver;

  const wantsPassenger = access.signedIn && tab === "passenger";
  const wantsDriver = access.signedIn && access.isDriver && (tab === "driver" || tab === "passenger");
  const passenger = usePassengerSummary(month, wantsPassenger);
  const driver = useDriverSummary(month, wantsDriver);

  const refetchAll = passenger.refetch;
  const refetchDriver = driver.refetch;
  const refreshAll = useCallback(async () => {
    setPulling(true);
    try {
      await Promise.all([wantsPassenger ? refetchAll() : Promise.resolve(), wantsDriver ? refetchDriver() : Promise.resolve()]);
    } finally {
      setPulling(false);
    }
  }, [refetchAll, refetchDriver, wantsPassenger, wantsDriver]);

  const actions = useMemo<PanelActions>(
    () => ({
      openHistory: (mode) => navigation.navigate("PaymentHistory", { mode }),
      openPayouts: () => navigation.navigate("PaymentHistory", { mode: "driver", section: "payouts" }),
      openMovement: (movement: Movement) => {
        const target = movement.target;
        if (target.kind === "request_payment") navigation.navigate("RequestStatusPayment", { requestId: target.requestId });
        else if (target.kind === "booking") navigation.navigate("BookingDetail", { bookingId: target.bookingId });
        else navigation.navigate("EarningDetail", { bookingId: target.bookingId });
      },
      editMethod: () => navigation.navigate("PaymentMethods"),
      openCommission: () => setSheet("commission"),
      openNextPayout: () => setSheet("nextPayout"),
      openReceipts: () => navigation.navigate("ReceiptsList"),
      openRefunds: () => navigation.navigate("Refunds"),
    }),
    [navigation],
  );

  const chooseMonth = useCallback(
    (key: string) => {
      setChosenMonth(isCurrentMonth(key, now) ? null : key);
      setSheet(null);
    },
    [now],
  );
  const closeSheet = useCallback(() => setSheet(null), []);

  const active = tab === "driver" ? driver : passenger;
  const availability = active.data?.availability;
  const commissionInfo = tab === "driver" ? driver.data?.platformCommission : passenger.data?.platformCommission;
  const commissionRole = tab === "driver" ? "driver" : dualRole ? "both" : "passenger";
  const nextPayout = driver.data !== undefined ? nextPayoutView(driver.data.nextPayout) : null;

  // ── Cuerpo según sesión, rol y estado de la consulta ───────────────────────────────────────────────────────────────
  let body: React.ReactNode;
  let showTabs = true;
  if (access.booting) {
    body = <OverviewSkeleton testID="PaymentsEarnings.loading" cards={1} />;
    showTabs = false;
  } else if (!access.signedIn) {
    showTabs = false;
    body = (
      <EmptyState
        testID="PaymentsEarnings.guest"
        variant="plain"
        icon="card"
        title={t.overview.guest.title}
        message={t.overview.guest.message}
        actionLabel={t.overview.guest.action}
        onAction={() => {
          requireAccount({ name: "PaymentsEarnings", params: route.params });
        }}
        style={styles.centered}
      />
    );
  } else if (tab === "driver" && !access.rolesKnown) {
    body = (
      <ErrorStateCard
        testID="PaymentsEarnings.error"
        tone="blue"
        icon="offline"
        iconTone="solidBlue"
        title={strings.connectivity.offlineTitle}
        message={`${t.overview.loadError}. ${strings.connectivity.serverErrorHint}`}
        actionLabel={t.retry}
        onAction={() => {
          void access.refreshMe();
        }}
        style={styles.stateGap}
      />
    );
  } else if (tab === "driver" && !access.isDriver) {
    body = (
      <EmptyState
        testID="PaymentsEarnings.notDriver"
        icon="coins"
        title={t.overview.notDriver.title}
        message={t.overview.notDriver.message}
        actionLabel={t.overview.notDriver.action}
        onAction={() => setTab("passenger")}
        style={styles.stateGap}
      />
    );
  } else if (tab === "driver") {
    if (driver.data !== undefined) {
      body = <DriverPanel summary={driver.data} month={month} now={now} actions={actions} />;
    } else if (driver.isLoading || (!driver.isError && !driver.isOffline)) {
      body = (
        <View style={styles.stateGap}>
          <OverviewSkeleton testID="PaymentsEarnings.loading" cards={1} />
        </View>
      );
    } else {
      body = <LoadError testID="PaymentsEarnings.error" error={driver.error} heading={t.overview.loadError} onRetry={() => void driver.refetch()} style={styles.stateGap} />;
    }
  } else if (passenger.data !== undefined) {
    body = dualRole ? (
      <OverviewPanel
        passenger={passenger.data}
        driver={{
          summary: driver.data ?? null,
          loading: driver.isLoading || (!driver.isError && !driver.isOffline),
          error: driver.error,
          onRetry: () => void driver.refetch(),
        }}
        month={month}
        now={now}
        actions={actions}
      />
    ) : (
      <PassengerPanel summary={passenger.data} month={month} now={now} actions={actions} />
    );
  } else if (passenger.isLoading || (!passenger.isError && !passenger.isOffline)) {
    body = (
      <View style={styles.stateGap}>
        <OverviewSkeleton testID="PaymentsEarnings.loading" cards={dualRole ? 2 : 1} />
      </View>
    );
  } else {
    body = <LoadError testID="PaymentsEarnings.error" error={passenger.error} heading={t.overview.loadError} onRetry={() => void passenger.refetch()} style={styles.stateGap} />;
  }

  const hasData = active.data !== undefined;
  const viewingOtherMonth = chosenMonth !== null;

  return (
    <Screen
      testID="PaymentsEarnings"
      paddingX={14}
      refreshing={pulling}
      onRefresh={access.signedIn ? () => void refreshAll() : undefined}
      header={
        <ScreenHeader
          title={t.title}
          testID="PaymentsEarnings.header"
          right={
            access.signedIn ? (
              <IconButton
                icon="calendarOutline"
                size={44}
                iconSize={28}
                color={colors.heading}
                accessibilityLabel={t.overview.monthButton}
                onPress={() => setSheet("month")}
                testID="PaymentsEarnings.month"
              />
            ) : undefined
          }
        />
      }
    >
      {showTabs ? (
        <Segmented<Role>
          variant="outline"
          options={TAB_OPTIONS}
          value={tab}
          onChange={setTab}
          accessibilityLabel={t.roles.a11yTabs}
          testID="PaymentsEarnings.tabs"
          style={styles.tabs}
        />
      ) : null}

      {showTabs && viewingOtherMonth ? (
        <Banner
          testID="PaymentsEarnings.monthBanner"
          kind="info"
          size="xs"
          icon="calendarOutline"
          message={t.overview.viewingMonth(monthLongLabel(month))}
          actionLabel={t.overview.backToCurrentMonth}
          onAction={() => setChosenMonth(null)}
          style={styles.banner}
        />
      ) : null}

      {showTabs && hasData ? (
        <StaleNote
          testID="PaymentsEarnings.stale"
          offline={active.isOffline}
          failedToRefresh={active.failedToRefresh}
          onRetry={() => void active.refetch()}
          style={styles.banner}
        />
      ) : null}

      {showTabs && availability !== undefined && !availability.enabled ? (
        <Banner
          testID="PaymentsEarnings.availability"
          kind="info"
          size="sm"
          title={t.overview.availabilityTitle}
          message={availability.message ?? t.overview.availabilityMessage}
          style={styles.banner}
        />
      ) : null}

      {body}

      <InfoSheet
        visible={sheet === "commission"}
        title={t.commissionSheet.title}
        paragraphs={commissionInfo !== undefined ? commissionParagraphs(commissionInfo, commissionRole) : [t.commissionSheet.pending]}
        onClose={closeSheet}
        testID="PaymentsEarnings.commissionSheet"
      />
      <InfoSheet
        visible={sheet === "nextPayout"}
        title={t.nextPayoutSheet.title}
        paragraphs={[nextPayout !== null ? nextPayout.explanation : t.nextPayoutSheet.pending]}
        actionLabel={t.nextPayoutSheet.seePayouts}
        onAction={() => {
          setSheet(null);
          navigation.navigate("PaymentHistory", { mode: "driver", section: "payouts" });
        }}
        onClose={closeSheet}
        testID="PaymentsEarnings.nextPayoutSheet"
      />
      <MonthSheet visible={sheet === "month"} month={month} now={now} onSelect={chooseMonth} onClose={closeSheet} testID="PaymentsEarnings.monthSheet" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  /** 33b: pestañas en 106,5..160,5 (54 pt). */
  tabs: { height: 54, marginTop: 9 },
  banner: { marginTop: 10 },
  stateGap: { marginTop: 14 },
  centered: { marginTop: 48 },
});
