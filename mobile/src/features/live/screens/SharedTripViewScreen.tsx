/**
 * «Viaje compartido»: vista PÚBLICA (sin sesión) de un enlace de «Compartir viaje». Muestra lo que el servidor permite y
 * nada más: nombre de pila de ambas personas, coche (matrícula solo si quien comparte la incluyó), ruta, llegada y una
 * ZONA aproximada de ~1 km. Nunca teléfono ni posición exacta. Se actualiza sola cada 15 s. Estados: cargando · enlace no
 * existe (404) · caducado / retirado (410) · error · programado · en camino · llegando · en recogida · en el coche ·
 * terminado · cancelado · sin señal / señal vieja.
 */
import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { LivePhase } from "@/api/types";
import { formatDateTime, formatTime } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { Banner, Card, ErrorStateCard, MapCard, OfflineBanner, Screen, ScreenHeader, Skeleton, Text } from "@/ui";
import { strings } from "@/i18n";
import { EtaCard } from "../components/EtaCard";
import { LiveMap } from "../components/LiveMap";
import { SignalInfoSheet, SignalStrip } from "../components/SignalStrip";
import { useNow } from "../hooks/useNow";
import { useSharedTrip } from "../hooks/useShare";
import { etaView } from "../model/eta";
import { sharedMapModel } from "../model/mapModel";
import { resolveSignal } from "../model/signal";
import { ageNow, elapsedSince, formatAge } from "../model/time";
import { plateText, vehicleLine } from "../model/vehicle";
import { liveStrings } from "../strings";

const T = liveStrings.shared;
const SIDE = 14;
const MAP_HEIGHT = 200;

function phaseText(phase: LivePhase, passenger: string, driver: string): string {
  switch (phase) {
    case "scheduled":
      return T.phase.scheduled(passenger, driver);
    case "driver_en_route":
      return T.phase.driver_en_route(passenger, driver);
    case "arriving":
      return T.phase.arriving(passenger, driver);
    case "at_pickup":
      return T.phase.at_pickup(passenger, driver);
    case "in_vehicle":
      return T.phase.in_vehicle(passenger, driver);
    case "completed":
      return T.phase.completed(passenger);
    case "cancelled":
      return T.phase.cancelled(passenger);
  }
}

export function SharedTripViewScreen({ route }: AppScreenProps<"SharedTripView">): React.JSX.Element {
  const token = route.params?.token ?? "";
  const query = useSharedTrip(token);
  const trip = query.data;
  const now = useNow(1_000);
  const [info, setInfo] = useState(false);
  const header = <ScreenHeader title={T.title} testID="SharedTripView.header" />;

  const signal = useMemo(() => {
    if (trip === undefined) return null;
    return resolveSignal({
      signal: trip.signal,
      position: trip.position === null ? null : { ...trip.position, headingDegrees: null, speedMps: null, accuracyM: 1000, receivedAt: trip.position.recordedAt, precision: "approximate" },
      lastUpdateAgeSeconds: trip.position?.ageSeconds ?? null,
      staleAfterSeconds: 90,
      elapsedSeconds: elapsedSince(query.updatedAt, now),
    });
  }, [trip, query.updatedAt, now]);

  if (token === "") {
    return (
      <Screen testID="SharedTripView" paddingX={SIDE} header={header}>
        <View style={styles.block}><ErrorStateCard testID="SharedTripView.badToken" tone="red" icon="exclaim" iconTone="solidRed" title={T.badToken} /></View>
      </Screen>
    );
  }

  if (trip === undefined || signal === null) {
    if (query.error) {
      const described = describeError(query.error);
      const code = described.code;
      const title = described.status === 404 ? T.notFoundTitle : code === "SHARE_EXPIRED" ? T.expiredTitle : code === "SHARE_REVOKED" ? T.revokedTitle : T.loadFailed;
      const final = described.status === 404 || described.status === 410;
      return (
        <Screen testID="SharedTripView" paddingX={SIDE} header={header}>
          <View style={styles.block}>
            <ErrorStateCard
              testID={final ? "SharedTripView.gone" : "SharedTripView.error"}
              tone={final ? "amber" : "red"}
              icon={final ? "clock" : "exclaim"}
              iconTone={final ? "solidAmber" : "solidRed"}
              title={title}
              message={final ? undefined : described.message}
              {...(final ? {} : { actionLabel: strings.common.retry, onAction: () => void query.refetch() })}
            />
          </View>
        </Screen>
      );
    }
    return (
      <Screen testID="SharedTripView" paddingX={SIDE} header={header}>
        <View style={styles.block} testID="SharedTripView.loading" accessible accessibilityLabel={T.loading} accessibilityState={{ busy: true }}>
          <Skeleton height={64} radius={14} />
          <Skeleton height={80} radius={14} style={styles.gap} />
          <Skeleton height={MAP_HEIGHT} radius={14} style={styles.gap} />
        </View>
      </Screen>
    );
  }

  const terminal = trip.phase === "completed" || trip.phase === "cancelled";
  const eta = terminal ? null : etaView(trip.eta);
  const age = signal.ageSeconds === null ? null : formatAge(ageNow(signal.ageSeconds, 0) ?? signal.ageSeconds);
  const connectionProblem = query.error !== null;
  const mapModel = sharedMapModel(trip.position);
  const bannerKind = trip.phase === "completed" ? "success" : trip.phase === "cancelled" ? "warning" : "info";

  return (
    <Screen testID="SharedTripView" paddingX={SIDE} header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      <View style={styles.block}>
        {connectionProblem ? (
          <OfflineBanner title={strings.connectivity.offlineTitle} detail={liveStrings.common.staleData} retryLabel={strings.common.retry} onRetry={() => void query.refetch()} style={styles.offline} testID="SharedTripView.offline" />
        ) : null}
        <Text variant="body" color="muted" size={15}>{T.from(trip.passengerFirstName)}</Text>
        <Banner testID="SharedTripView.phase" kind={bannerKind} title={phaseText(trip.phase, trip.passengerFirstName, trip.driverFirstName)} style={styles.gapSm} />

        {!terminal ? <EtaCard eta={eta} style={styles.gap} testID="SharedTripView.eta" /> : null}

        {!terminal ? (
          <>
            <View style={[styles.map, styles.gap]} testID="SharedTripView.mapFrame">
              <MapCard height={MAP_HEIGHT} radius={14}>
                <LiveMap model={mapModel} status={trip.position === null ? "unavailable" : "ready"} fitKey={trip.position?.recordedAt ?? "none"} accessibilityLabel={T.mapA11y} testID="SharedTripView.map" />
              </MapCard>
            </View>
            <SignalStrip kind={signal.kind} age={age} idleText={trip.phase === "scheduled" ? liveStrings.signal.scheduled(trip.driverFirstName) : undefined} onInfo={() => setInfo(true)} style={styles.gapSm} testID="SharedTripView.signal" />
            <Text testID="SharedTripView.approxNote" variant="body" color="muted" size={14} lineHeight={19} style={styles.gapSm}>{T.approxNote}</Text>
          </>
        ) : null}

        <Card tone="blue" padding={14} style={styles.gap} testID="SharedTripView.route">
          <Text variant="rowTitle" color="heading" size={17}>{T.routeTitle}</Text>
          <Text variant="body" color="strong" size={16.5} lineHeight={22} style={styles.line}>{`${trip.route.originLabel ?? "—"} → ${trip.route.destinationLabel ?? "—"}`}</Text>
          {trip.plannedDepartureAt !== null ? <Text variant="body" color="muted" size={15}>{`${formatDateTime(trip.plannedDepartureAt)}`}</Text> : null}
        </Card>

        <Card padding={14} style={styles.gap} testID="SharedTripView.vehicle">
          <Text variant="rowTitle" color="heading" size={17}>{T.vehicleTitle}</Text>
          <Text variant="body" color="strong" size={16.5} style={styles.line}>{vehicleLine(trip.vehicle)}</Text>
          <Text testID="SharedTripView.plate" variant="body" color="muted" size={15}>{trip.vehicle.plate !== null ? plateText(trip.vehicle.plate) : T.plateHidden}</Text>
        </Card>

        <Text variant="body" color="muted" size={14} align="center" style={styles.gap}>{`${T.expires(formatDateTime(trip.expiresAt))} · ${T.updated}`}</Text>
        <Text variant="body" color="muted" size={13} align="center">{`${formatTime(trip.serverTime)}`}</Text>
      </View>
      <SignalInfoSheet visible={info} kind={signal.kind} onClose={() => setInfo(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { paddingTop: 8, paddingBottom: 24 },
  gap: { marginTop: 14 },
  gapSm: { marginTop: 10 },
  line: { marginTop: 4 },
  map: { overflow: "hidden", borderRadius: 14 },
  offline: { marginBottom: 10 },
});
