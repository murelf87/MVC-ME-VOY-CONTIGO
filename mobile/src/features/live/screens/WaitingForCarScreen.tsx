import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { isValidPoint } from "@/maps";
import { useIsScreenFocused } from "@/hooks";
import { strings } from "@/i18n";
import { colors } from "@/theme";
import { Banner, OfflineBanner, Screen, ScreenHeader, Skeleton } from "@/ui";
import type { AppScreenProps } from "@/navigation";
import { ActionButton } from "../components/ActionButton";
import { ContactSheet } from "../components/ContactSheet";
import { DriverRow } from "../components/DriverRow";
import { EtaCard } from "../components/EtaCard";
import { LiveMap } from "../components/LiveMap";
import { LiveStatusBanner } from "../components/LiveStatusBanner";
import { LoadError } from "../components/LoadError";
import { PickupCodeSheet } from "../components/PickupCodeSheet";
import { RouteChangeBanner } from "../components/RouteChangeBanner";
import { SignalInfoSheet, SignalStrip } from "../components/SignalStrip";
import { useContactDriver } from "../hooks/useContactDriver";
import { useLiveStatus } from "../hooks/useLiveStatus";
import { liveMapModel, toMapPoint } from "../model/mapModel";
import { redirectFromWaiting } from "../model/phase";
import { formatAge } from "../model/time";
import { liveStrings } from "../strings";

const copy = liveStrings.waiting;
const MAP_HEIGHT = 287;

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * 21 · Esperando el coche. Franja de estado, llegada estimada, mapa con el coche y tu recogida, estado de la señal, quién
 * conduce y los botones de ruta, contacto y código de recogida. Sondea mientras la pantalla está a la vista.
 */
export function WaitingForCarScreen({ navigation, route }: AppScreenProps<"WaitingForCar">): React.JSX.Element {
  const { bookingId } = route.params;
  const live = useLiveStatus(bookingId);
  const { view, query, signal, banner, eta } = live;
  const focused = useIsScreenFocused();
  const [infoOpen, setInfoOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);

  const contact = useContactDriver({
    tripId: view?.tripId ?? "",
    peerUserId: view?.chat.peerUserId ?? "",
    chatAvailable: view?.chat.available ?? false,
    driverName: view?.driver.firstName ?? "",
  });

  // La pantalla es solo para esperar: al subir al coche pasa a «En el coche»; al terminar, a «Viaje terminado».
  const phase = view?.phase;
  useEffect(() => {
    if (!focused || phase === undefined) return;
    const target = redirectFromWaiting(phase);
    if (target === "InCar") navigation.replace("InCar", { bookingId });
    else if (target === "TripFinished") navigation.replace("TripFinished", { bookingId });
  }, [focused, phase, navigation, bookingId]);

  const goHome = useCallback(() => navigation.navigate("MapHome"), [navigation]);
  const openRouteChange = useCallback(() => {
    const pending = view?.pendingRouteChange;
    if (pending === null || pending === undefined) return;
    navigation.navigate("RouteChange", { proposalId: pending.proposalId, bookingId });
  }, [navigation, view?.pendingRouteChange, bookingId]);
  const openMap = useCallback(() => navigation.navigate("LiveRouteMap", { bookingId }), [navigation, bookingId]);

  const mapModel = useMemo(() => {
    if (view === undefined || signal === null) return null;
    return liveMapModel({
      driverName: view.driver.firstName,
      pickup: { label: view.pickup.label, location: view.pickup.location },
      position: view.position,
      signalKind: signal.kind,
      etaMinutes: view.eta?.minutes ?? null,
      ageSeconds: signal.ageSeconds,
    });
  }, [view, signal]);

  const header = <ScreenHeader title={copy.title} testID="WaitingForCar.header" />;

  if (view === undefined || signal === null || banner === null || mapModel === null) {
    if (query.isError) {
      return (
        <Screen header={header} testID="WaitingForCar">
          <View style={styles.errorBox}>
            <LoadError
              error={query.error}
              onRetry={() => void query.refetch()}
              fallbackLabel={copy.cancelledAction}
              onFallback={goHome}
              testID="WaitingForCar.error"
            />
          </View>
        </Screen>
      );
    }
    return (
      <Screen header={header} padded={false} testID="WaitingForCar">
        <View style={styles.pad} accessible accessibilityLabel={liveStrings.common.loadingTrip} accessibilityState={{ busy: true }} testID="WaitingForCar.loading">
          <Skeleton height={68} radius={16} />
          <Skeleton height={136} radius={14} style={styles.skeletonGap} />
        </View>
        <Skeleton height={MAP_HEIGHT} radius={0} style={styles.skeletonMap} />
        <View style={styles.pad}>
          <Skeleton height={40} radius={12} style={styles.skeletonGap} />
          <View style={styles.skeletonDriver}>
            <Skeleton height={92} circle />
            <View style={styles.skeletonDriverText}>
              <Skeleton height={26} width="45%" radius={6} />
              <Skeleton height={20} width="70%" radius={6} style={styles.skeletonGap} />
            </View>
          </View>
        </View>
      </Screen>
    );
  }

  const cancelled = view.phase === "cancelled";
  const tracking = view.phase === "driver_en_route" || view.phase === "arriving" || view.phase === "at_pickup";
  const mapStatus = isValidPoint(toMapPoint(view.pickup.location)) ? "ready" : "unavailable";
  const car = view.position !== null ? `${round4(view.position.location.lat)},${round4(view.position.location.lng)}` : "none";
  const age = signal.ageSeconds === null ? null : formatAge(signal.ageSeconds);
  const driverName = view.driver.firstName;
  const connectionProblem = query.isOffline || query.failedToRefresh;
  const codeFirst = view.phase === "arriving" || view.phase === "at_pickup";

  const codeButton = tracking ? (
    <ActionButton
      key="code"
      label={liveStrings.codeEntry.action}
      leadingIcon="lock"
      variant={codeFirst ? "primary" : "outline"}
      onPress={() => setCodeOpen(true)}
      accessibilityHint={liveStrings.codeEntry.subtitle(driverName)}
      testID="WaitingForCar.code"
      style={styles.button}
    />
  ) : null;

  return (
    <Screen
      header={header}
      padded={false}
      refreshing={query.isRefreshing}
      onRefresh={() => void query.refetch()}
      testID="WaitingForCar"
    >
      <View style={styles.pad}>
        {connectionProblem ? (
          <OfflineBanner
            title={strings.connectivity.offlineTitle}
            detail={liveStrings.common.staleData}
            retryLabel={strings.common.retry}
            onRetry={() => void query.refetch()}
            style={styles.offline}
            testID="WaitingForCar.offline"
          />
        ) : null}
        <LiveStatusBanner kind={banner.kind} title={banner.title} message={banner.message} testID="WaitingForCar.banner" />
        {view.pendingRouteChange !== null ? (
          <RouteChangeBanner pending={view.pendingRouteChange} driverName={driverName} onOpen={openRouteChange} style={styles.routeChange} testID="WaitingForCar.routeChange" />
        ) : null}
        {!cancelled ? <EtaCard eta={eta} style={styles.eta} testID="WaitingForCar.eta" /> : null}
      </View>

      {!cancelled ? (
        <View style={styles.map} testID="WaitingForCar.mapFrame">
          <LiveMap model={mapModel} status={mapStatus} fitKey={`${signal.kind}:${car}`} onRetry={() => void query.refetch()} testID="WaitingForCar.map" />
        </View>
      ) : null}

      <View style={styles.pad}>
        {!cancelled ? (
          <SignalStrip
            kind={signal.kind}
            age={age}
            idleText={view.phase === "scheduled" ? liveStrings.signal.scheduled(driverName) : undefined}
            onInfo={() => setInfoOpen(true)}
            style={styles.strip}
            testID="WaitingForCar.signal"
          />
        ) : null}

        <DriverRow driver={view.driver} vehicle={view.vehicle} variant="hero" style={styles.driver} testID="WaitingForCar.driver" />

        {cancelled ? (
          <>
            <Banner kind="info" size="sm" message={liveStrings.waiting.cancelledMessage} style={styles.cancelledNote} />
            <ActionButton label={copy.cancelledAction} leadingIcon="map" onPress={goHome} style={styles.button} testID="WaitingForCar.home" />
          </>
        ) : (
          <>
            {codeFirst ? codeButton : null}
            <ActionButton
              label={copy.viewRoute}
              leadingIcon="navigate"
              variant={codeFirst ? "outline" : "primary"}
              onPress={openMap}
              accessibilityHint={copy.viewRouteA11y}
              testID="WaitingForCar.viewRoute"
              style={styles.button}
            />
            <ActionButton
              label={copy.contact(driverName)}
              leadingIcon="phone"
              variant="outline"
              onPress={() => setContactOpen(true)}
              testID="WaitingForCar.contact"
              style={styles.buttonSecond}
            />
            {codeFirst ? null : codeButton}
          </>
        )}
      </View>

      <SignalInfoSheet visible={infoOpen} kind={signal.kind} onClose={() => setInfoOpen(false)} testID="WaitingForCar.signalSheet" />
      <ContactSheet visible={contactOpen} onClose={() => setContactOpen(false)} driverName={driverName} controller={contact} testID="WaitingForCar.contactSheet" />
      <PickupCodeSheet visible={codeOpen} onClose={() => setCodeOpen(false)} bookingId={bookingId} driverName={driverName} testID="WaitingForCar.codeSheet" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 14 },
  errorBox: { paddingTop: 16 },
  offline: { marginBottom: 8 },
  routeChange: { marginTop: 8 },
  eta: { marginTop: 8.5 },
  map: { height: MAP_HEIGHT, marginTop: 1.5, backgroundColor: colors.empty.bg },
  strip: { marginTop: 1.5 },
  driver: { marginTop: 12.5 },
  button: { marginTop: 11.5 },
  buttonSecond: { marginTop: 8, height: 54 },
  cancelledNote: { marginTop: 12 },
  skeletonGap: { marginTop: 8 },
  skeletonMap: { marginTop: 2 },
  skeletonDriver: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  skeletonDriverText: { flex: 1, marginLeft: 16 },
});
