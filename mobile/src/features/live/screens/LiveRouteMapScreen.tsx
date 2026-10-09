import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { isValidPoint } from "@/maps";
import { openMapsAt } from "@/platform";
import { colors, shadows } from "@/theme";
import { strings } from "@/i18n";
import { OfflineBanner, Screen, ScreenHeader, showToast, Text } from "@/ui";
import type { AppScreenProps } from "@/navigation";
import { ActionButton } from "../components/ActionButton";
import { LiveMap } from "../components/LiveMap";
import { LoadError } from "../components/LoadError";
import { SignalInfoSheet, SignalStrip } from "../components/SignalStrip";
import { useLiveStatus } from "../hooks/useLiveStatus";
import { liveMapModel, toMapPoint } from "../model/mapModel";
import { formatAge } from "../model/time";
import { liveStrings } from "../strings";

const copy = liveStrings.waiting;

/**
 * Ruta del coche a pantalla completa (desde «Ver ruta en el mapa» de la 21): mapa interactivo con el coche y tu recogida,
 * la señal y la llegada estimada. Comparte caché y sondeo con «Esperando el coche».
 */
export function LiveRouteMapScreen({ navigation, route }: AppScreenProps<"LiveRouteMap">): React.JSX.Element {
  const { bookingId } = route.params;
  const { view, query, signal, eta } = useLiveStatus(bookingId);
  const [infoOpen, setInfoOpen] = useState(false);

  const model = useMemo(() => {
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

  const openInMaps = useCallback(async () => {
    if (view === undefined) return;
    const result = await openMapsAt({ latitude: view.pickup.location.lat, longitude: view.pickup.location.lng, label: view.pickup.label ?? undefined });
    if (result !== "opened") showToast({ message: copy.openInMapsFailed, kind: "error", id: "live-open-maps" });
  }, [view]);

  const header = <ScreenHeader title={copy.fullMapTitle} testID="LiveRouteMap.header" />;

  if (view === undefined || signal === null || model === null) {
    return (
      <Screen header={header} testID="LiveRouteMap">
        <View style={styles.errorBox}>
          {query.isError ? (
            <LoadError error={query.error} onRetry={() => void query.refetch()} fallbackLabel={copy.cancelledAction} onFallback={() => navigation.navigate("MapHome")} testID="LiveRouteMap.error" />
          ) : (
            <View style={styles.loading} accessible accessibilityState={{ busy: true }} accessibilityLabel={liveStrings.common.loadingTrip} testID="LiveRouteMap.loading" />
          )}
        </View>
      </Screen>
    );
  }

  const mapStatus = isValidPoint(toMapPoint(view.pickup.location)) ? "ready" : "unavailable";
  const age = signal.ageSeconds === null ? null : formatAge(signal.ageSeconds);
  const connectionProblem = query.isOffline || query.failedToRefresh;

  return (
    <Screen header={header} scroll={false} padded={false} testID="LiveRouteMap">
      <View style={styles.fill}>
        <LiveMap model={model} status={mapStatus} interactive fitKey={bookingId} onRetry={() => void query.refetch()} accessibilityLabel={copy.routeMapA11y} testID="LiveRouteMap.map" />
        <View style={styles.panel} pointerEvents="box-none">
          <View style={styles.card}>
            {connectionProblem ? (
              <OfflineBanner
                title={strings.connectivity.offlineTitle}
                detail={liveStrings.common.staleData}
                retryLabel={strings.common.retry}
                onRetry={() => void query.refetch()}
                style={styles.gap}
                testID="LiveRouteMap.offline"
              />
            ) : null}
            <Text variant="heading" weight="bold" color="heading" size={19} lineHeight={24} numberOfLines={2}>
              {copy.pickupLine(view.pickup.label)}
            </Text>
            {eta !== null ? (
              <Text variant="body" color="deep" size={17} lineHeight={22} style={styles.eta} testID="LiveRouteMap.eta">
                {`${eta.label} ${eta.time} · ${eta.line}`}
              </Text>
            ) : null}
            <SignalStrip kind={signal.kind} age={age} idleText={view.phase === "scheduled" ? liveStrings.signal.scheduled(view.driver.firstName) : undefined} onInfo={() => setInfoOpen(true)} style={styles.gap} testID="LiveRouteMap.signal" />
            <ActionButton label={copy.openInMaps} leadingIcon="navigate" variant="outline" height={50} fontSize={18} chevron={false} onPress={() => void openInMaps()} style={styles.gap} testID="LiveRouteMap.openInMaps" />
          </View>
        </View>
      </View>
      <SignalInfoSheet visible={infoOpen} kind={signal.kind} onClose={() => setInfoOpen(false)} testID="LiveRouteMap.signalSheet" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.empty.bg },
  errorBox: { paddingTop: 16 },
  loading: { height: 120 },
  panel: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingBottom: 14 },
  card: { backgroundColor: colors.bg.white, borderRadius: 18, padding: 16, boxShadow: shadows.float },
  eta: { marginTop: 2 },
  gap: { marginTop: 10 },
});
