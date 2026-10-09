/**
 * «Tu viaje publicado» (conductor). Sin lámina propia: se diseña con el lenguaje de la 20 (tarjetas azules, banner de
 * estado) y la línea de paradas de la 12. Resume el viaje y reparte las acciones: abrir la consola, ver solicitudes,
 * proponer una parada y cancelar (solo mientras está publicado y sin empezar).
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { TripDetail } from "@/api/types";
import { formatDateLong, formatDistance, formatDuration, formatTime } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { Banner, Button, Card, KeyValueRow, OfflineBanner, RouteTimeline, Screen, ScreenHeader, SectionHeader, Skeleton, Text, type RouteStop } from "@/ui";
import { OpsErrorCard } from "../components/OpsErrorCard";
import { describeOps } from "../hooks/describe";
import { useDriverConsole } from "../hooks/useDriverConsole";
import { useTripDetail } from "../hooks/useTripDetail";
import { opsStrings } from "../strings";
import { tripStrings } from "../stringsTrip";

const T = tripStrings.manage;
const SCREEN_X = 14;

function stopsOf(detail: TripDetail): RouteStop[] {
  return detail.stops.map((stop, index, all): RouteStop => {
    const last = index === all.length - 1;
    return {
      title: stop.label ?? opsStrings.common.unnamedStop(stop.seq),
      ...(stop.optional ? { titleSuffix: T.optionalSuffix } : {}),
      time: stop.etaLocal,
      state: last ? "destination" : index === 0 ? "current" : stop.optional ? "optional" : "upcoming",
    };
  });
}

export function DriverTripManageScreen({ navigation, route }: AppScreenProps<"DriverTripManage">): React.JSX.Element {
  const tripId = route.params?.tripId ?? "";
  const consoleQuery = useDriverConsole(tripId);
  const detailQuery = useTripDetail(tripId, tripId !== "");
  const data = consoleQuery.data;
  const detail = detailQuery.data;
  const header = <ScreenHeader title={T.title} testID="DriverTripManage.header" />;

  if (data === undefined || detail === undefined) {
    const error = consoleQuery.error ?? detailQuery.error;
    if (error) {
      return (
        <Screen testID="DriverTripManage" paddingX={SCREEN_X} header={header}>
          <View style={styles.block}>
            <OpsErrorCard
              error={describeOps(error)}
              onAction={() => {
                void consoleQuery.refetch();
                void detailQuery.refetch();
              }}
              testID="DriverTripManage.error"
            />
            <Button testID="DriverTripManage.toTrips" label={opsStrings.console.states.goToTrips} variant="outline" chevron={false} onPress={() => navigation.navigate("MyTrips")} style={styles.gap} />
          </View>
        </Screen>
      );
    }
    return (
      <Screen testID="DriverTripManage" paddingX={SCREEN_X} header={header}>
        <View style={styles.block} testID="DriverTripManage.loading" accessible accessibilityLabel={T.loading} accessibilityState={{ busy: true }}>
          <Skeleton height={64} radius={14} />
          <Skeleton height={190} radius={14} style={styles.gap} />
          <Skeleton height={230} radius={14} style={styles.gap} />
        </View>
      </Screen>
    );
  }

  const status = data.status;
  const published = status === "published";
  const confirmed = data.counts.total;
  const pending = detail.owner?.pendingRequests ?? 0;
  const banner =
    status === "published"
      ? { kind: "info" as const, title: T.statusPublished, message: confirmed === 0 ? T.noPassengers : opsStrings.common.confirmedPassengers(confirmed) }
      : status === "active"
        ? { kind: "success" as const, title: T.statusActive, message: opsStrings.console.banner.activeMessageNoTime }
        : status === "completed"
          ? { kind: "success" as const, title: T.statusCompleted, message: opsStrings.console.banner.completedMessageNoTime }
          : { kind: "warning" as const, title: T.statusCancelled, message: opsStrings.console.banner.cancelledMessage };

  const when = detail.departureAt ? `${formatDateLong(detail.departureAt)} · ${formatTime(detail.departureAt)}` : "—";
  const failed = consoleQuery.failedToRefresh || consoleQuery.isOffline;

  const footer = (
    <View style={styles.footer}>
      <Button
        testID="DriverTripManage.console"
        label={T.openConsole}
        leadingIcon="navigate"
        onPress={() => navigation.navigate("DriverConsole", { tripId })}
        disabled={status === "cancelled"}
      />
    </View>
  );

  return (
    <Screen
      testID="DriverTripManage"
      paddingX={SCREEN_X}
      header={header}
      footer={footer}
      refreshing={consoleQuery.isRefreshing}
      onRefresh={() => {
        void consoleQuery.refetch();
        void detailQuery.refetch();
      }}
    >
      <View style={styles.block}>
        {failed ? (
          <OfflineBanner
            testID="DriverTripManage.offline"
            title={opsStrings.common.offlineTitle}
            detail={opsStrings.common.offlineDetail}
            retryLabel={opsStrings.common.retry}
            onRetry={() => void consoleQuery.refetch()}
            style={styles.bottomGap}
          />
        ) : null}
        <Banner testID="DriverTripManage.banner" kind={banner.kind} title={banner.title} message={banner.message} />

        <SectionHeader title={T.summaryTitle} style={styles.section} />
        <Card tone="blue" padding={14}>
          <KeyValueRow label={T.when} value={when} />
          {detail.recurrence ? <Text variant="body" color="muted" size={15} style={styles.recurring}>{T.recurring(detail.recurrence.weekdays.length === 5 ? "de lunes a viernes" : "varios días")}</Text> : null}
          <KeyValueRow label={T.vehicle} value={opsStrings.common.vehicleLine(detail.vehicle.make, detail.vehicle.model, detail.vehicle.color)} caption={detail.vehicle.plate ?? undefined} />
          <KeyValueRow label={T.seats} value={opsStrings.common.seatsOccupied(data.seats.occupied, data.seats.offered)} />
          <KeyValueRow label={T.route} value={T.routeKm(formatDistance(detail.totals.roadDistanceM), formatDuration(detail.totals.durationMinutes))} />
          <KeyValueRow label={T.passengers} value={confirmed === 0 ? "—" : String(confirmed)} />
        </Card>

        <SectionHeader title={T.stopsTitle} style={styles.section} />
        <Card tone="white" padding={14}>
          <RouteTimeline testID="DriverTripManage.stops" stops={stopsOf(detail)} variant="compact" />
        </Card>

        <Button
          testID="DriverTripManage.requests"
          label={pending > 0 ? `${T.requests} (${pending})` : T.requests}
          variant="outline"
          leadingIcon="opsInbox"
          onPress={() => navigation.navigate("DriverRequests", { tripId })}
          style={styles.gap}
        />
        <Button
          testID="DriverTripManage.propose"
          label={T.propose}
          variant="outline"
          leadingIcon="route"
          disabled={!data.actions.canProposeRouteChange}
          onPress={() => navigation.navigate("ProposeRouteChange", { tripId })}
          style={styles.gap}
        />
        {!data.actions.canProposeRouteChange && data.pendingRouteChange ? (
          <Text variant="body" color="muted" size={15} style={styles.note}>{opsStrings.console.routeChange.proposeDisabledPending}</Text>
        ) : null}
        <Button
          testID="DriverTripManage.cancel"
          label={T.cancel}
          variant="dangerOutline"
          leadingIcon="close"
          disabled={!published}
          onPress={() => navigation.navigate("DriverCancelTrip", { tripId })}
          style={styles.gap}
        />
        {!published && status === "active" ? <Text variant="body" color="muted" size={15} style={styles.note}>{T.cancelUnavailable}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { paddingTop: 8, paddingBottom: 24 },
  gap: { marginTop: 12 },
  bottomGap: { marginBottom: 12 },
  section: { marginTop: 18 },
  recurring: { marginTop: 4, marginBottom: 4 },
  note: { marginTop: 6 },
  footer: { paddingHorizontal: SCREEN_X, paddingBottom: 8 },
});
