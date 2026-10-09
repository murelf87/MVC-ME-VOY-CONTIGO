/**
 * Los tres cuerpos de la pantalla 33 «Mis pagos y cobros»:
 *  - `PassengerPanel`  pestaña «Soy pasajero» de una cuenta de pasajero (lámina 33b);
 *  - `OverviewPanel`   pestaña «Soy pasajero» de una cuenta con los dos roles (lámina 33a: pagos y cobros juntos);
 *  - `DriverPanel`     pestaña «Soy conductor» (lámina 34b).
 *
 * Son presentacionales: reciben los datos del servidor ya cargados y las acciones; no piden nada por su cuenta. Los
 * márgenes verticales salen de las medidas de cada lámina (ver `metrics.ts`), así que cada cuerpo tiene los suyos.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { DriverPaymentsSummary, PassengerPaymentsSummary } from "@/api/types/money";
import { strings } from "@/i18n";
import { colors } from "@/theme";
import { EmptyState, Skeleton, Text } from "@/ui";
import {
  amountView,
  anyIllustrative,
  commissionValue,
  driverMovement,
  movementsIllustrative,
  nextPayoutView,
  overviewMovements,
  passengerMovement,
  paymentsBlocked,
  pendingTitle,
  toCollectTitle,
  type Movement,
} from "../model";
import { moneyStrings } from "../strings";
import { CommissionRow, LinkGroup, LinkRow } from "./InfoRows";
import { MethodCard } from "./MethodCard";
import { MovementRow } from "./MovementRow";
import { NextPayoutCard } from "./NextPayoutCard";
import { SectionTitle } from "./SectionTitle";
import { LoadError } from "./StateBlocks";
import { SummaryCard } from "./SummaryCard";
import { ink } from "./metrics";

const t = moneyStrings;

/** Acciones que dispara el cuerpo (la pantalla decide a dónde llevan). */
export interface PanelActions {
  openHistory: (mode: "passenger" | "driver") => void;
  openPayouts: () => void;
  openMovement: (movement: Movement) => void;
  editMethod: () => void;
  openCommission: () => void;
  openNextPayout: () => void;
  openReceipts: () => void;
  openRefunds: () => void;
}

function Gap({ size }: { size: number }): React.JSX.Element {
  return <View style={{ height: size }} />;
}

/** Nota al pie cuando algún importe de la pantalla es ilustrativo (nunca se presenta como tarifa final). */
export function IllustrativeNote({ visible }: { visible: boolean }): React.JSX.Element | null {
  if (!visible) return null;
  return (
    <Text testID="PaymentsEarnings.note" variant="caption" color="muted" size={14} lineHeight={18} style={styles.note}>
      {t.illustrativeNote}
    </Text>
  );
}

/** Contenedor blanco con borde fino que agrupa las filas de «Últimos cobros» (lámina 34b). */
function ListCard({ children, testID }: { children: React.ReactNode; testID?: string }): React.JSX.Element {
  return (
    <View testID={testID} style={styles.listCard}>
      {children}
    </View>
  );
}

function methodEmptyMessage(enabled: boolean, payout: boolean): string {
  if (!enabled) return t.overview.notAvailableYet;
  return payout ? t.overview.noPayoutEnabled : t.overview.noMethodEnabled;
}

// ── Pasajero (33b) ───────────────────────────────────────────────────────────────────────────────────────────────

export interface PassengerPanelProps {
  summary: PassengerPaymentsSummary;
  month: string;
  now: number;
  actions: PanelActions;
}

export function PassengerPanel({ summary, month, now, actions }: PassengerPanelProps): React.JSX.Element {
  const movements = summary.recent.map(passengerMovement);
  const blocked = paymentsBlocked(summary.availability);
  const illustrative = anyIllustrative([summary.pendingThisMonth]) || movementsIllustrative(movements);

  return (
    <View testID="PaymentsEarnings.passenger">
      <View style={styles.cardsTop}>
        <SummaryCard
          tone="blue"
          leading="clock"
          title={pendingTitle(month, now)}
          amount={amountView(summary.pendingThisMonth)}
          caption={t.overview.upcomingTrips(summary.upcomingTripsCount)}
          onPress={() => actions.openHistory("passenger")}
          accessibilityHint={t.overview.history}
          testID="PaymentsEarnings.pending"
        />
      </View>

      <SectionTitle
        title={t.overview.passengerList}
        actionLabel={t.seeAll}
        onAction={() => actions.openHistory("passenger")}
        testID="PaymentsEarnings.payments"
        style={styles.sectionAfterCard}
      />
      {movements.length === 0 ? (
        <EmptyState
          testID="PaymentsEarnings.payments.empty"
          icon="receipt"
          title={t.overview.emptyPassenger.title}
          message={t.overview.emptyPassenger.message}
          style={styles.emptyGap}
        />
      ) : (
        movements.map((movement, index) => (
          <View key={movement.key} style={index === 0 ? styles.firstRow : styles.nextRow}>
            <MovementRow movement={movement} variant="card" now={now} onPress={() => actions.openMovement(movement)} testID={`PaymentsEarnings.payments.${index}`} />
          </View>
        ))
      )}

      <SectionTitle
        title={t.overview.methodTitle}
        actionLabel={t.edit}
        onAction={actions.editMethod}
        testID="PaymentsEarnings.methodTitle"
        style={styles.sectionAfterRows}
      />
      <View style={styles.afterSectionTitleMethod}>
        <MethodCard
          method={summary.paymentMethod}
          emptyTitle={t.overview.noMethodTitle}
          emptyMessage={methodEmptyMessage(!blocked, false)}
          onPress={actions.editMethod}
          accessibilityHint={t.edit}
          testID="PaymentsEarnings.method"
        />
      </View>

      <View style={styles.commissionGapRegular}>
        <CommissionRow
          label={t.overview.commissionPlatform}
          value={commissionValue(summary.platformCommission, "passenger")}
          variant="a"
          onPress={actions.openCommission}
          accessibilityHint={t.commissionSheet.title}
          testID="PaymentsEarnings.commission"
        />
      </View>

      <View style={styles.linkGapFirst}>
        <LinkRow label={t.overview.history} icon="document" onPress={() => actions.openHistory("passenger")} testID="PaymentsEarnings.history" />
      </View>
      <View style={styles.linkGapNext}>
        <LinkRow label={t.overview.receipts} icon="document" onPress={actions.openReceipts} testID="PaymentsEarnings.receipts" />
      </View>
      <View style={styles.linkGapNext}>
        <LinkRow label={t.overview.refunds} icon="receipt" onPress={actions.openRefunds} testID="PaymentsEarnings.refunds" />
      </View>

      <IllustrativeNote visible={illustrative} />
    </View>
  );
}

// ── Cuenta con los dos roles (33a) ───────────────────────────────────────────────────────────────────────────────

/** Estado de la consulta de conductor dentro de la vista de los dos roles. */
export interface DriverSlot {
  summary: DriverPaymentsSummary | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

export interface OverviewPanelProps {
  passenger: PassengerPaymentsSummary;
  driver: DriverSlot;
  month: string;
  now: number;
  actions: PanelActions;
}

export function OverviewPanel({ passenger, driver, month, now, actions }: OverviewPanelProps): React.JSX.Element {
  const driverSummary = driver.summary;
  const movements = overviewMovements(passenger.recent, driverSummary?.recent ?? []);
  const blocked = paymentsBlocked(passenger.availability);
  const illustrative =
    anyIllustrative([passenger.pendingThisMonth, driverSummary?.toCollectThisMonth]) || movementsIllustrative(movements);

  return (
    <View testID="PaymentsEarnings.overview">
      <View style={styles.cardsTopCompact}>
        <SummaryCard
          tone="blue"
          leading="clock"
          density="compact"
          title={pendingTitle(month, now)}
          amount={amountView(passenger.pendingThisMonth)}
          caption={t.overview.upcomingTrips(passenger.upcomingTripsCount)}
          onPress={() => actions.openHistory("passenger")}
          accessibilityHint={t.overview.history}
          testID="PaymentsEarnings.pending"
        />
      </View>

      <View style={styles.cardsBetween}>
        {driverSummary !== null ? (
          <SummaryCard
            tone="green"
            leading="coins"
            density="compact"
            title={toCollectTitle(month, now)}
            amount={amountView(driverSummary.toCollectThisMonth)}
            caption={t.overview.completedTrips(driverSummary.completedTripsCount)}
            onPress={() => actions.openHistory("driver")}
            accessibilityHint={t.overview.driverHistory}
            testID="PaymentsEarnings.toCollect"
          />
        ) : driver.loading ? (
          <View testID="PaymentsEarnings.toCollect.loading" accessible accessibilityLabel={strings.common.loading} accessibilityState={{ busy: true }}>
            <Skeleton height={113} radius={18} />
          </View>
        ) : (
          <LoadError testID="PaymentsEarnings.toCollect.error" error={driver.error} heading={t.overview.loadError} onRetry={driver.onRetry} />
        )}
      </View>

      <SectionTitle
        title={t.overview.mixedList}
        actionLabel={t.seeAll}
        onAction={() => actions.openHistory("passenger")}
        testID="PaymentsEarnings.payments"
        style={styles.sectionAfterCardCompact}
      />
      {movements.length === 0 ? (
        <EmptyState
          testID="PaymentsEarnings.payments.empty"
          icon="receipt"
          title={t.overview.emptyMixed.title}
          message={t.overview.emptyMixed.message}
          style={styles.emptyGapCompact}
        />
      ) : (
        movements.map((movement, index) => (
          <View key={movement.key} style={index === 0 ? styles.firstRowCompact : styles.nextRowCompact}>
            <MovementRow
              movement={movement}
              variant="cardCompact"
              tagged
              now={now}
              onPress={() => actions.openMovement(movement)}
              testID={`PaymentsEarnings.payments.${index}`}
            />
          </View>
        ))
      )}

      <SectionTitle
        title={t.overview.methodTitle}
        actionLabel={t.edit}
        onAction={actions.editMethod}
        testID="PaymentsEarnings.methodTitle"
        style={styles.sectionAfterRowsCompact}
      />
      <View style={styles.afterSectionTitleMethodCompact}>
        <MethodCard
          method={passenger.paymentMethod}
          emptyTitle={t.overview.noMethodTitle}
          emptyMessage={methodEmptyMessage(!blocked, false)}
          density="compact"
          onPress={actions.editMethod}
          accessibilityHint={t.edit}
          testID="PaymentsEarnings.method"
        />
      </View>

      <View style={styles.groupGap}>
        <LinkGroup
          testID="PaymentsEarnings.links"
          links={[
            { key: "payouts", label: t.overview.monthlyPayout, icon: "calendarGrid", onPress: actions.openPayouts, testID: "PaymentsEarnings.payouts" },
            {
              key: "commission",
              label: t.overview.commissionMvc(commissionValue(passenger.platformCommission, "both")),
              icon: "help",
              onPress: actions.openCommission,
              testID: "PaymentsEarnings.commission",
            },
            { key: "receipts", label: t.overview.receipts, icon: "document", onPress: actions.openReceipts, testID: "PaymentsEarnings.receipts" },
          ]}
        />
      </View>

      <View style={styles.linkGapFirst}>
        <LinkRow label={t.overview.history} icon="document" onPress={() => actions.openHistory("passenger")} testID="PaymentsEarnings.history" />
      </View>
      <View style={styles.linkGapNext}>
        <LinkRow label={t.overview.refunds} icon="receipt" onPress={actions.openRefunds} testID="PaymentsEarnings.refunds" />
      </View>

      <IllustrativeNote visible={illustrative} />
    </View>
  );
}

// ── Conductor (34b) ──────────────────────────────────────────────────────────────────────────────────────────────

export interface DriverPanelProps {
  summary: DriverPaymentsSummary;
  month: string;
  now: number;
  actions: PanelActions;
}

export function DriverPanel({ summary, month, now, actions }: DriverPanelProps): React.JSX.Element {
  const movements = summary.recent.map(driverMovement);
  const blocked = paymentsBlocked(summary.availability);
  const next = nextPayoutView(summary.nextPayout);
  const nextAmount = amountView(next.amount);
  const illustrative = anyIllustrative([summary.toCollectThisMonth, next.kind === "pending_definition" ? null : next.amount]) || movementsIllustrative(movements);
  const nextLabel = next.kind === "pending_definition" || nextAmount.pending ? next.value : `${next.value} · ${nextAmount.text}`;

  return (
    <View testID="PaymentsEarnings.driver">
      <View style={styles.cardsTop}>
        <SummaryCard
          tone="green"
          leading="coins"
          title={toCollectTitle(month, now)}
          amount={amountView(summary.toCollectThisMonth)}
          caption={t.overview.completedTrips(summary.completedTripsCount)}
          onPress={() => actions.openHistory("driver")}
          accessibilityHint={t.overview.driverHistory}
          testID="PaymentsEarnings.toCollect"
        />
      </View>

      <View style={styles.payoutGap}>
        <NextPayoutCard
          title={t.overview.nextPayout}
          value={next.value}
          amountText={next.kind === "pending_definition" || nextAmount.pending ? null : nextAmount.text}
          onPress={actions.openNextPayout}
          accessibilityLabel={`${t.overview.nextPayout}: ${nextLabel}`}
          testID="PaymentsEarnings.nextPayout"
        />
      </View>

      <SectionTitle
        title={t.overview.driverList}
        actionLabel={t.seeAll}
        onAction={() => actions.openHistory("driver")}
        testID="PaymentsEarnings.earnings"
        style={styles.sectionAfterPayout}
      />
      {movements.length === 0 ? (
        <EmptyState
          testID="PaymentsEarnings.earnings.empty"
          icon="coins"
          title={t.overview.emptyDriver.title}
          message={t.overview.emptyDriver.message}
          style={styles.emptyGap}
        />
      ) : (
        <View style={styles.listCardGap}>
          <ListCard testID="PaymentsEarnings.earnings.list">
            {movements.map((movement, index) => (
              <MovementRow
                key={movement.key}
                movement={movement}
                variant="grouped"
                now={now}
                last={index === movements.length - 1}
                onPress={() => actions.openMovement(movement)}
                testID={`PaymentsEarnings.earnings.${index}`}
              />
            ))}
          </ListCard>
        </View>
      )}

      <View style={styles.commissionGapDriver}>
        <CommissionRow
          label={t.overview.commissionPlatform}
          value={commissionValue(summary.platformCommission, "driver")}
          variant="b"
          onPress={actions.openCommission}
          accessibilityHint={t.commissionSheet.title}
          testID="PaymentsEarnings.commission"
        />
      </View>

      <SectionTitle
        title={t.overview.payoutAccountTitle}
        actionLabel={t.edit}
        onAction={actions.editMethod}
        testID="PaymentsEarnings.methodTitle"
        style={styles.sectionBelowFold}
      />
      <View style={styles.afterSectionTitleMethod}>
        <MethodCard
          method={summary.payoutAccount}
          emptyTitle={t.overview.noPayoutTitle}
          emptyMessage={methodEmptyMessage(!blocked, true)}
          onPress={actions.editMethod}
          accessibilityHint={t.edit}
          testID="PaymentsEarnings.method"
        />
      </View>

      <View style={styles.linkGapFirst}>
        <LinkRow label={t.overview.monthlyPayout} icon="calendarGrid" onPress={actions.openPayouts} testID="PaymentsEarnings.payouts" />
      </View>
      <View style={styles.linkGapNext}>
        <LinkRow label={t.overview.driverHistory} icon="document" onPress={() => actions.openHistory("driver")} testID="PaymentsEarnings.history" />
      </View>
      <View style={styles.linkGapNext}>
        <LinkRow label={t.overview.receipts} icon="document" onPress={actions.openReceipts} testID="PaymentsEarnings.receipts" />
      </View>

      <IllustrativeNote visible={illustrative} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Márgenes verticales medidos en las láminas (pt). `cardsTop*`: de las pestañas a la primera tarjeta.
  cardsTop: { marginTop: 13.5 },
  cardsTopCompact: { marginTop: 12.5 },
  cardsBetween: { marginTop: 8 },
  payoutGap: { marginTop: 11.5 },

  // 33b: tarjeta → título de sección (15,1), título → fila (7,9), fila → fila (6), fila → título (16,6), título → método (10,4).
  sectionAfterCard: { marginTop: 15.1 },
  firstRow: { marginTop: 7.9 },
  nextRow: { marginTop: 6 },
  sectionAfterRows: { marginTop: 16.6 },
  afterSectionTitleMethod: { marginTop: 10.4 },
  commissionGapRegular: { marginTop: 13.5 },
  linkGapFirst: { marginTop: 12 },
  linkGapNext: { marginTop: 5 },
  emptyGap: { marginTop: 8 },

  // 33a (más compacta).
  sectionAfterCardCompact: { marginTop: 14.6 },
  firstRowCompact: { marginTop: 1.9 },
  nextRowCompact: { marginTop: 8 },
  sectionAfterRowsCompact: { marginTop: 14.6 },
  afterSectionTitleMethodCompact: { marginTop: 7.9 },
  groupGap: { marginTop: 3.5 },
  emptyGapCompact: { marginTop: 6 },

  // 34b: tarjeta de abono → título (15,6), título → contenedor (6,4), contenedor → comisión (13,5).
  sectionAfterPayout: { marginTop: 15.6 },
  listCardGap: { marginTop: 6.4 },
  commissionGapDriver: { marginTop: 13.5 },
  sectionBelowFold: { marginTop: 22 },

  listCard: { borderWidth: 1, borderColor: ink.rowBorder, borderRadius: 16, backgroundColor: colors.bg.white, overflow: "hidden" },
  note: { marginTop: 14, paddingHorizontal: 4 },
});
