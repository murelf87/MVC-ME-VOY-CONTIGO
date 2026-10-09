import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAppNavigation, useAppRoute } from "@/navigation";
import { colors, radii } from "@/theme";
import { Banner, ConfirmDialog, EmptyState, OfflineBanner, Screen, Skeleton, Text, showToast } from "@/ui";
import { DecisionBar } from "../components/DecisionBar";
import { DriverHeader } from "../components/DriverHeader";
import { HoldBanner } from "../components/HoldBanner";
import { InfoStrip } from "../components/InfoStrip";
import { LoadFailure } from "../components/LoadFailure";
import { RequestCard } from "../components/RequestCard";
import { DRIVER_SIDE, DRIVER_TOP_GAP } from "../components/metrics";
import { useDecideRequest, useDriverRequests, useInboxView } from "../hooks/useDriverRequests";
import { useNow } from "../hooks/useNow";
import { describePublishError } from "../logic/errors";
import { secondsUntil, sectionFor, type RequestCardView } from "../logic/requests";
import { publishStrings } from "../strings";

const copy = publishStrings.requests;

type Decision = "accept" | "reject";

interface PendingConfirm {
  card: RequestCardView;
  decision: Decision;
}

/**
 * 20 · «Solicitudes»: bandeja del conductor. Cada solicitud muestra al pasajero, su tramo con horas, el desvío estimado y
 * las plazas ocupadas por tramo; se acepta o se rechaza desde aquí. Aceptar NO confirma la reserva: retiene la plaza y
 * el pasajero tiene un tiempo (cuenta atrás visible) para pagar. Una reserva semanal se acepta o se rechaza entera.
 */
export function DriverRequestsScreen(): React.JSX.Element {
  const navigation = useAppNavigation();
  const { params } = useAppRoute("DriverRequests");
  const tripId = params?.tripId;
  const query = useDriverRequests(tripId);
  const decide = useDecideRequest();
  const [confirm, setConfirm] = React.useState<PendingConfirm | null>(null);

  const waitingForPayment = React.useMemo(
    () => (query.data ?? []).some((item) => sectionFor(item.status) === "payment"),
    [query.data],
  );
  const now = useNow(1000, waitingForPayment);
  const { cards, groups } = useInboxView(query.data, now);

  // Cuando una cuenta atrás llega a cero se recarga la bandeja una vez: el servidor ya habrá liberado la plaza.
  const expiredKey = cards
    .filter((card) => card.section === "payment" && card.holdSeconds !== null && card.holdSeconds <= 0)
    .map((card) => card.id)
    .join(",");
  const refetchedFor = React.useRef("");
  const { refetch } = query;
  React.useEffect(() => {
    if (expiredKey === "" || refetchedFor.current === expiredKey) return;
    refetchedFor.current = expiredKey;
    void refetch();
  }, [expiredKey, refetch]);

  const header = <DriverHeader title={copy.title} testID="DriverRequests.header" />;
  const frame = { paddingTop: DRIVER_TOP_GAP } as const;
  const top = <InfoStrip icon="car" text={copy.banner} testID="DriverRequests.banner" />;

  const openDetail = (card: RequestCardView): void => {
    navigation.navigate("DriverRequestDetail", card.kind === "weekly" ? { weeklyReservationId: card.id } : { requestId: card.id });
  };

  const run = async (card: RequestCardView, decision: Decision): Promise<void> => {
    try {
      const result = await decide.mutateAsync({ id: card.id, kind: card.kind, decision });
      if (decision === "reject") {
        showToast({ message: card.kind === "weekly" ? copy.rejectedWeeklyToast(card.name) : copy.rejectedToast(card.name), kind: "success" });
        return;
      }
      const seconds = result.hold !== null ? secondsUntil(result.hold.expiresAt, Date.now()) : null;
      const message =
        card.kind === "weekly"
          ? copy.acceptedWeeklyToast(card.name)
          : seconds !== null && seconds > 0
            ? copy.acceptedToastClock(card.name, copy.holdCountdown(seconds))
            : copy.acceptedToast(card.name);
      showToast({ message, kind: "success", durationMs: 6000 });
    } catch (error) {
      const view = describePublishError(error);
      showToast({
        kind: "error",
        title: view.offline ? publishStrings.common.offlineTitle : view.title,
        message: view.offline ? publishStrings.common.offlineAction : view.message,
        durationMs: 7000,
      });
      if (view.stale) void query.refetch();
    }
  };

  const onAccept = (card: RequestCardView): void => {
    if (card.kind === "weekly") {
      setConfirm({ card, decision: "accept" });
      return;
    }
    void run(card, "accept");
  };

  const onConfirm = async (): Promise<void> => {
    if (confirm === null) return;
    await run(confirm.card, confirm.decision);
    setConfirm(null);
  };

  // ── Cargando / error ─────────────────────────────────────────────────────────────────────────────────────────────────
  if (query.data === undefined) {
    return (
      <Screen header={header} paddingX={DRIVER_SIDE} contentContainerStyle={frame} testID="DriverRequests">
        {top}
        {query.isLoading ? (
          <View testID="DriverRequests.loading" accessibilityLabel={copy.loading} accessibilityLiveRegion="polite">
            <Skeleton height={490} radius={16} style={styles.skeleton} />
            <Skeleton height={67.5} radius={radii.lg} style={styles.skeletonSmall} />
          </View>
        ) : (
          <View style={styles.failure}>
            <LoadFailure error={query.error} title={publishStrings.common.loadError} onRetry={() => void query.refetch()} testID="DriverRequests.error" />
          </View>
        )}
      </Screen>
    );
  }

  const offline = query.failedToRefresh || query.isOffline;
  const busyId = decide.isPending ? decide.variables?.id ?? null : null;
  const sections: { key: "pending" | "payment"; title: string; items: RequestCardView[] }[] = [
    { key: "pending", title: copy.sectionPending, items: groups.pending },
    { key: "payment", title: copy.sectionPayment, items: groups.payment },
  ];
  // La bandeja pide solo solicitudes abiertas (`status=open`): las cerradas no se pintan aunque llegaran.
  const visibleSections = sections.filter((section) => section.items.length > 0);
  const showTitles = visibleSections.length > 1;

  return (
    <>
      <Screen
        header={header}
        paddingX={DRIVER_SIDE}
        contentContainerStyle={frame}
        refreshing={query.isRefreshing}
        onRefresh={() => void query.refetch()}
        testID="DriverRequests"
      >
        {offline ? (
          <OfflineBanner
            testID="DriverRequests.offline"
            title={publishStrings.common.offlineTitle}
            detail={publishStrings.common.offlineDetail}
            retryLabel={publishStrings.common.retry}
            onRetry={() => void query.refetch()}
            style={styles.offline}
          />
        ) : null}
        {top}

        {tripId !== undefined ? (
          <View style={styles.filter} testID="DriverRequests.filter">
            <Text variant="rowText" color="muted" size={15.5} lineHeight={20} style={styles.filterText}>
              {copy.filterTripNote}
            </Text>
            <Pressable
              testID="DriverRequests.filter.clear"
              accessibilityRole="link"
              accessibilityLabel={copy.filterTripClear}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              onPress={() => navigation.replace("DriverRequests")}
            >
              <Text variant="rowTextStrong" color="link" underline size={15.5} lineHeight={20}>
                {copy.filterTripClear}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {visibleSections.length === 0 ? (
          <EmptyState
            testID="DriverRequests.empty"
            icon="passenger"
            title={copy.emptyTitle}
            message={copy.emptyMessage}
            actionLabel={copy.emptyAction}
            onAction={() => navigation.navigate("MyTrips", { role: "driver" })}
            style={styles.empty}
          />
        ) : (
          <>
            {visibleSections.map((section) => (
              <View key={section.key} testID={`DriverRequests.section.${section.key}`}>
                {showTitles ? (
                  <Text variant="heading" color="heading" size={21} accessibilityRole="header" style={styles.sectionTitle}>
                    {section.title}
                  </Text>
                ) : null}
                {section.items.map((card) => (
                  <RequestBlock
                    key={card.id}
                    card={card}
                    pending={busyId === card.id ? (decide.variables?.decision ?? null) : null}
                    locked={busyId !== null && busyId !== card.id}
                    onOpenDetail={() => openDetail(card)}
                    onAccept={() => onAccept(card)}
                    onReject={() => setConfirm({ card, decision: "reject" })}
                  />
                ))}
              </View>
            ))}
            <InfoStrip
              icon="infoMark"
              text={copy.mutualNote}
              disc={41}
              iconSize={26}
              textSize={20}
              lineHeight={22}
              minHeight={96}
              discAlign="start"
              style={styles.note}
              testID="DriverRequests.note"
            />
          </>
        )}
      </Screen>

      <ConfirmDialog
        visible={confirm !== null}
        destructive={confirm?.decision === "reject"}
        title={confirmTitle(confirm)}
        message={confirmMessage(confirm)}
        confirmLabel={confirm?.decision === "reject" ? copy.confirmRejectAction : copy.confirmAcceptWeeklyAction}
        loading={decide.isPending}
        onConfirm={() => void onConfirm()}
        onCancel={() => {
          if (!decide.isPending) setConfirm(null);
        }}
        testID="DriverRequests.confirm"
      />
    </>
  );
}

function confirmTitle(confirm: PendingConfirm | null): string {
  if (confirm === null) return "";
  return confirm.decision === "reject" ? copy.confirmRejectTitle(confirm.card.name) : copy.confirmAcceptWeeklyTitle(confirm.card.name);
}

function confirmMessage(confirm: PendingConfirm | null): string {
  if (confirm === null) return "";
  if (confirm.decision === "accept") return copy.confirmAcceptWeeklyMessage(confirm.card.weekly?.occurrences ?? 0);
  return confirm.card.kind === "weekly" ? copy.confirmRejectWeeklyMessage(confirm.card.name) : copy.confirmRejectMessage(confirm.card.name);
}

interface RequestBlockProps {
  card: RequestCardView;
  /** Decisión de ESTA solicitud que se está enviando. */
  pending: Decision | null;
  /** Se está enviando la decisión de otra solicitud: esta espera. */
  locked: boolean;
  onOpenDetail: () => void;
  onAccept: () => void;
  onReject: () => void;
}

/** Tarjeta de la solicitud y, debajo, lo que se puede hacer con ella: decidir, esperar el pago o nada. */
function RequestBlock({ card, pending, locked, onOpenDetail, onAccept, onReject }: RequestBlockProps): React.JSX.Element {
  const weekly = card.kind === "weekly";
  const testID = `DriverRequests.card.${card.id}`;
  return (
    <View style={styles.block}>
      <RequestCard card={card} onOpenDetail={onOpenDetail} testID={testID} />
      <View style={styles.actions}>
        {card.decidable ? (
          <>
            <DecisionBar
              acceptLabel={weekly ? copy.acceptAll : copy.accept}
              rejectLabel={weekly ? copy.rejectAll : copy.reject}
              acceptAccessibilityLabel={weekly ? copy.acceptAllA11y(card.name) : copy.acceptA11y(card.name)}
              rejectAccessibilityLabel={weekly ? copy.rejectAllA11y(card.name) : copy.rejectA11y(card.name)}
              pending={pending}
              disabled={locked}
              acceptDisabled={!card.canAccept}
              onAccept={onAccept}
              onReject={onReject}
              testID={`${testID}.decision`}
            />
            {!card.canAccept && card.blockedText !== null ? (
              <Banner kind="warning" size="xs" message={card.blockedText} testID={`${testID}.blocked`} />
            ) : null}
          </>
        ) : (
          <HoldBanner card={card} testID={`${testID}.hold`} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { marginTop: 13 },
  skeletonSmall: { marginTop: 8 },
  failure: { marginTop: 13 },
  offline: { marginBottom: 10 },
  filter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, paddingHorizontal: 4 },
  filterText: { flex: 1, marginRight: 12 },
  empty: { marginTop: 13 },
  sectionTitle: { marginTop: 16, marginBottom: 2, marginLeft: 2 },
  block: { marginTop: 13 },
  actions: { marginTop: 8, marginHorizontal: 3.5 },
  note: { marginTop: 14, marginHorizontal: 3.5, paddingVertical: 15, paddingLeft: 5, borderRadius: radii.lg, backgroundColor: colors.info.bg },
});
