import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useIsScreenFocused } from "@/hooks";
import { strings } from "@/i18n";
import { colors } from "@/theme";
import { Banner, OfflineBanner, Screen, ScreenHeader, Skeleton } from "@/ui";
import type { AppScreenProps } from "@/navigation";
import { ActionButton } from "../components/ActionButton";
import { ContactSheet } from "../components/ContactSheet";
import { DriverRow } from "../components/DriverRow";
import { EtaTile, ShareTile } from "../components/InfoTiles";
import { LoadError } from "../components/LoadError";
import { OccupancyCard } from "../components/OccupancyCard";
import { PickupCodeCard } from "../components/PickupCodeCard";
import { RouteChangeBanner } from "../components/RouteChangeBanner";
import { SignalInfoSheet } from "../components/SignalStrip";
import { TripTimelineCard } from "../components/TripTimelineCard";
import { useContactDriver } from "../hooks/useContactDriver";
import { useInCar } from "../hooks/useInCar";
import { usePickupCode } from "../hooks/usePickupCode";
import { redirectFromInCar } from "../model/phase";
import { formatAge } from "../model/time";
import { liveStrings } from "../strings";

const copy = liveStrings.inCar;

/**
 * 23 · En el coche. Quién conduce, tu código de recogida, quién va dentro, tu trayecto con horas, llegada estimada al
 * destino, compartir el viaje (privado), ayuda y contacto. Sondea con calma mientras está a la vista.
 */
export function InCarScreen({ navigation, route }: AppScreenProps<"InCar">): React.JSX.Element {
  const { bookingId } = route.params;
  const inCar = useInCar(bookingId);
  const { state, query, signal, eta, remaining } = inCar;
  const focused = useIsScreenFocused();
  const [contactOpen, setContactOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const contact = useContactDriver({
    tripId: state?.tripId ?? "",
    peerUserId: state?.chat.peerUserId ?? "",
    chatAvailable: state?.chat.available ?? false,
    driverName: state?.driver.firstName ?? "",
  });
  const code = usePickupCode(bookingId, state?.pickupCode, { tripStatus: state?.tripStatus ?? "active", phase: state?.phase ?? "in_vehicle" });

  const phase = state?.phase;
  useEffect(() => {
    if (!focused || phase === undefined) return;
    if (redirectFromInCar(phase) === "TripFinished") navigation.replace("TripFinished", { bookingId });
  }, [focused, phase, navigation, bookingId]);

  const goHome = useCallback(() => navigation.navigate("MapHome"), [navigation]);
  const openWaiting = useCallback(() => navigation.navigate("WaitingForCar", { bookingId }), [navigation, bookingId]);
  const openRouteChange = useCallback(() => {
    const pending = state?.pendingRouteChange;
    if (pending === null || pending === undefined) return;
    navigation.navigate("RouteChange", { proposalId: pending.proposalId, bookingId });
  }, [navigation, state?.pendingRouteChange, bookingId]);

  const header = <ScreenHeader title={copy.title} testID="InCar.header" />;

  if (state === undefined || signal === null) {
    if (query.isError) {
      return (
        <Screen header={header} testID="InCar">
          <View style={styles.errorBox}>
            <LoadError error={query.error} onRetry={() => void query.refetch()} fallbackLabel={liveStrings.waiting.cancelledAction} onFallback={goHome} testID="InCar.error" />
          </View>
        </Screen>
      );
    }
    return (
      <Screen header={header} padded={false} testID="InCar">
        <View style={styles.pad} accessible accessibilityLabel={liveStrings.common.loadingTrip} accessibilityState={{ busy: true }} testID="InCar.loading">
          <View style={styles.skeletonDriver}>
            <Skeleton height={63} circle />
            <View style={styles.skeletonDriverText}>
              <Skeleton height={22} width="40%" radius={6} />
              <Skeleton height={18} width="65%" radius={6} style={styles.skeletonGap} />
            </View>
          </View>
          <Skeleton height={143} radius={16} style={styles.skeletonBlock} />
          <Skeleton height={178} radius={16} style={styles.skeletonBlock} />
          <Skeleton height={165} radius={16} style={styles.skeletonBlock} />
        </View>
      </Screen>
    );
  }

  const driverName = state.driver.firstName;
  const cancelled = state.phase === "cancelled";
  const beforePickup = state.phase === "scheduled" || state.phase === "driver_en_route" || state.phase === "arriving";
  const connectionProblem = query.isOffline || query.failedToRefresh;
  const weakSignal = !cancelled && (signal.kind === "stale" || signal.kind === "none") && state.tripStatus === "active";
  const age = signal.ageSeconds === null ? null : formatAge(signal.ageSeconds);

  return (
    <Screen header={header} padded={false} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()} testID="InCar">
      <View style={styles.divider} />
      <View style={styles.pad}>
        {connectionProblem ? (
          <OfflineBanner
            title={strings.connectivity.offlineTitle}
            detail={liveStrings.common.staleData}
            retryLabel={strings.common.retry}
            onRetry={() => void query.refetch()}
            style={styles.notice}
            testID="InCar.offline"
          />
        ) : null}

        <DriverRow
          driver={state.driver}
          vehicle={state.vehicle}
          variant="compact"
          callBusy={contact.busy !== null}
          onCall={
            cancelled
              ? undefined
              : () => {
                  void contact.call().then((ok) => {
                    if (!ok) setContactOpen(true);
                  });
                }
          }
          style={styles.driver}
          testID="InCar.driver"
        />

        {cancelled ? (
          <>
            <Banner kind="error" title={copy.cancelledTitle} message={copy.cancelledMessage} style={styles.block} testID="InCar.cancelled" />
            <ActionButton label={liveStrings.waiting.cancelledAction} leadingIcon="map" onPress={goHome} style={styles.cancelledButton} testID="InCar.home" />
          </>
        ) : (
          <>
            {weakSignal ? (
              <OfflineBanner
                title={liveStrings.signal.staleTitle}
                detail={signal.kind === "stale" && age !== null ? liveStrings.signal.staleDetail(age) : liveStrings.signal.noneDetail}
                onInfo={() => setInfoOpen(true)}
                style={styles.notice}
                testID="InCar.signal"
              />
            ) : null}
            {state.pendingRouteChange !== null ? (
              <RouteChangeBanner pending={state.pendingRouteChange} driverName={driverName} onOpen={openRouteChange} style={styles.notice} testID="InCar.routeChange" />
            ) : null}
            {beforePickup ? (
              <Banner
                kind="info"
                size="md"
                title={copy.notArrivedTitle(driverName)}
                message={copy.notArrivedMessage}
                chevron
                onPress={openWaiting}
                accessibilityLabel={`${copy.notArrivedTitle(driverName)}. ${copy.notArrivedAction}`}
                style={styles.notice}
                testID="InCar.notArrived"
              />
            ) : null}

            <View style={styles.codeWrap}>
              <PickupCodeCard controller={code} state={state.pickupCode} driverName={driverName} testID="InCar.code" />
            </View>
            <OccupancyCard occupancy={state.occupancy} style={styles.block} testID="InCar.occupancy" />
            <TripTimelineCard stops={state.timeline} style={styles.block} testID="InCar.timeline" />

            <View style={styles.tiles}>
              <EtaTile eta={eta} remaining={remaining} style={styles.etaTile} testID="InCar.eta" />
              <ShareTile active={state.share.active} onPress={() => navigation.navigate("ShareTrip", { bookingId })} style={styles.shareTile} testID="InCar.share" />
            </View>

            <View style={styles.buttons}>
              <ActionButton
                label={copy.help}
                leadingIcon="info"
                variant="outline"
                chevron={false}
                fontSize={18}
                fontWeight="bold"
                iconSize={30}
                onPress={() => navigation.navigate("HelpCenter", { tripId: state.tripId, category: "trip_issue" })}
                style={styles.help}
                testID="InCar.help"
              />
              <ActionButton
                label={liveStrings.waiting.contact(driverName)}
                leadingIcon="phone"
                variant="outline"
                fontSize={18}
                fontWeight="bold"
                iconSize={26}
                gutter={40}
                onPress={() => {
                  contact.clearNotice();
                  setContactOpen(true);
                }}
                style={styles.contact}
                testID="InCar.contact"
              />
            </View>
          </>
        )}
      </View>

      <SignalInfoSheet visible={infoOpen} kind={signal.kind} onClose={() => setInfoOpen(false)} testID="InCar.signalSheet" />
      <ContactSheet visible={contactOpen} onClose={() => setContactOpen(false)} driverName={driverName} controller={contact} testID="InCar.contactSheet" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 13.5 },
  divider: { height: 1, backgroundColor: colors.border.divider },
  errorBox: { paddingTop: 16 },
  notice: { marginTop: 10 },
  driver: { marginTop: 11 },
  codeWrap: { marginTop: 12 },
  block: { marginTop: 15 },
  tiles: { flexDirection: "row", marginTop: 9 },
  etaTile: { flex: 202 },
  shareTile: { flex: 153.5, marginLeft: 13, marginTop: 1 },
  buttons: { flexDirection: "row", marginTop: 20 },
  help: { flex: 117 },
  contact: { flex: 236.5, marginLeft: 15 },
  cancelledButton: { marginTop: 12 },
  skeletonDriver: { flexDirection: "row", alignItems: "center", marginTop: 11 },
  skeletonDriverText: { flex: 1, marginLeft: 12 },
  skeletonGap: { marginTop: 8 },
  skeletonBlock: { marginTop: 15 },
});
