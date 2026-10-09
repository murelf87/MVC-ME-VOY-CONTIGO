import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { describeError } from "@/api/errors";
import type { TripDetail } from "@/api/types";
import { formatWeekdays } from "@/i18n";
import { Icon, IconTile } from "@/icons";
import { MvcMap, type MapMarkerSpec, type MapPoint, type MapRouteSpec } from "@/maps";
import { requireAccount, useAppNavigation, useAppRoute, type AppScreenProps } from "@/navigation";
import { colors, radii } from "@/theme";
import { Avatar, Button, EmptyState, ErrorStateCard, OfflineBanner, Screen, ScreenHeader, Skeleton, Text } from "@/ui";
import { isApiError } from "@/api/errors";
import { TripBreakdownSheet } from "../components/TripBreakdownSheet";
import { StopTimeline } from "../components/StopTimeline";
import { useTripDetailView } from "../hooks/useTripDetailView";
import { plateText, priceView, requestAction, stopViews, totalsView, vehicleText } from "../logic/tripDetail";
import { browseStrings } from "../strings";

const copy = browseStrings.tripDetail;

function mapModel(trip: TripDetail): { markers: MapMarkerSpec[]; routes: MapRouteSpec[]; points: MapPoint[] } {
  const stops = [...trip.stops].sort((a, b) => a.seq - b.seq);
  const markers: MapMarkerSpec[] = stops.map((stop, index) => {
    const position = { lat: stop.location.lat, lng: stop.location.lng };
    const last = index === stops.length - 1;
    const label = stop.label ?? "";
    if (index === 0) return { id: `stop-${stop.seq}`, kind: "origin", position, chip: { title: label, subtitle: stop.etaLocal } };
    if (last) return { id: `stop-${stop.seq}`, kind: "destinationCap", position, chip: { title: label, subtitle: stop.etaLocal } };
    return { id: `stop-${stop.seq}`, kind: "stop", position, tone: "brand", accessibilityLabel: label };
  });
  const line: MapPoint[] = trip.route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  return { markers, routes: line.length >= 2 ? [{ id: "route", kind: "route", points: line }] : [], points: line.length >= 2 ? line : markers.map((m) => m.position) };
}

/**
 * «Detalle del viaje» (lámina 12): conductor, vehículo, ruta prevista, paradas con horas, totales y aportación. Todo viene
 * de `GET /v1/trips/:tripId`. «Solicitar plaza» exige cuenta (el invitado puede mirar todo lo anterior).
 */
export function TripDetailScreen(_props: AppScreenProps<"TripDetail">): React.JSX.Element {
  const navigation = useAppNavigation();
  const { tripId, criteria, dropoffStopSeq } = useAppRoute("TripDetail").params;
  const query = useTripDetailView(tripId, criteria, dropoffStopSeq);
  const [breakdown, setBreakdown] = useState(false);
  const trip = query.data;

  const model = useMemo(() => (trip !== undefined ? mapModel(trip) : null), [trip]);
  const stops = useMemo(() => (trip !== undefined ? stopViews(trip.stops) : []), [trip]);

  const goRequest = () => {
    const params = { tripId, ...(criteria !== undefined ? { criteria } : {}), ...(dropoffStopSeq !== undefined ? { dropoffStopSeq } : {}) };
    if (!requireAccount({ name: "PickupPoint", params })) return;
    navigation.navigate("PickupPoint", params);
  };

  const action = trip !== undefined ? requestAction(trip) : null;
  const onAction = () => {
    if (action === null) return;
    if (action.kind === "request" || action.kind === "auth") goRequest();
    else if (action.kind === "existing") navigation.navigate("RequestStatusPayment", { requestId: action.requestId });
    else if (action.kind === "owner") navigation.navigate("DriverTripManage", { tripId });
  };

  const notFound = query.isError && isApiError(query.error) && query.error.code === "TRIP_NOT_FOUND";
  const price = trip !== undefined ? priceView(trip) : null;
  const totals = trip !== undefined ? totalsView(trip) : null;

  return (
    <Screen
      testID="TripDetail"
      padded={false}
      header={<ScreenHeader title={copy.title} testID="TripDetail.header" />}
      footer={
        action !== null ? (
          <View style={styles.footer}>
            <Button
              label={action.label}
              leadingIcon={action.kind === "request" || action.kind === "auth" ? "passenger" : undefined}
              variant={action.kind === "blocked" ? "outline" : "primary"}
              disabled={action.kind === "blocked"}
              onPress={onAction}
              testID="TripDetail.action"
            />
          </View>
        ) : null
      }
    >
      {query.isOffline && trip === undefined ? <OfflineBanner testID="TripDetail.offline" /> : null}
      <View style={styles.pad} accessibilityLiveRegion="polite">
        {query.isLoading && trip === undefined ? (
          <>
            <Text variant="caption" color="muted">{copy.loading}</Text>
            <Skeleton height={120} />
            <Skeleton height={170} />
            <Skeleton height={120} />
          </>
        ) : null}

        {query.isError && trip === undefined ? (
          notFound ? (
            <EmptyState icon="car" title={copy.notFoundTitle} message={copy.notFoundMessage} actionLabel={copy.backToSearch} onAction={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate("MapHome", undefined))} testID="TripDetail.notFound" />
          ) : query.isOffline ? (
            <ErrorStateCard title={copy.offlineTitle} message={copy.offlineMessage} actionLabel={browseStrings.common.retry} onAction={() => void query.refetch()} testID="TripDetail.offlineCard" />
          ) : (
            <ErrorStateCard title={copy.errorTitle} message={describeError(query.error).message} actionLabel={browseStrings.common.retry} onAction={() => void query.refetch()} testID="TripDetail.error" />
          )
        ) : null}

        {trip !== undefined && model !== null && totals !== null && price !== null ? (
          <>
            <View style={styles.driver} testID="TripDetail.driver" accessible accessibilityLabel={copy.driverA11y(trip.driver.firstName, `${trip.seats.available} ${copy.seatsAvailable(trip.seats.available)}`)}>
              <Avatar source={trip.driver.photoUrl} name={trip.driver.firstName} size={90} />
              <View style={styles.driverText}>
                <Text variant="title" color="heading" size={26} lineHeight={30} numberOfLines={1}>{trip.driver.firstName}</Text>
                {trip.driver.ratingAverage !== null ? (
                  <View style={styles.ratingRow}>
                    <Icon name="star" size={20} color={colors.amber.star} />
                    <Text variant="bodyStrong" color="strong" size={17}>{`${String(trip.driver.ratingAverage).replace(".", ",")} (${trip.driver.ratingCount})`}</Text>
                  </View>
                ) : null}
                <View style={styles.vehicleRow}>
                  <IconTile name="car" tone="blue" size={32} iconSize={20} />
                  <View style={styles.vehicleText}>
                    <Text variant="rowTitle" color="heading" size={15.5} numberOfLines={1}>{vehicleText(trip)}</Text>
                    {plateText(trip) !== null ? <Text variant="caption" color="muted" size={13} numberOfLines={1}>{plateText(trip)}</Text> : null}
                  </View>
                </View>
              </View>
              <View style={styles.seats}>
                <Text variant="title" color="link" size={22} lineHeight={26} weight="bold" align="right">{`${trip.seats.available} ${trip.seats.available === 1 ? "plaza" : "plazas"}`}</Text>
                <Text variant="rowText" color="link" size={16} align="right">{copy.seatsAvailable(trip.seats.available).split(" ").slice(-1)[0]}</Text>
              </View>
            </View>

            <View style={styles.sectionHead}>
              <Text variant="title" color="heading" size={21} lineHeight={26} accessibilityRole="header">{copy.route}</Text>
              <View style={styles.chip}>
                <Icon name="pin" size={18} color={colors.success.solid} />
                <Text variant="rowText" color="success" size={14.5}>{copy.provinceChip(trip.provinceName)}</Text>
              </View>
            </View>

            <View style={styles.mapCard}>
              <MvcMap
                testID="TripDetail.map"
                style={styles.map}
                accessibilityLabel={copy.mapLabel}
                initialRegion={{ lat: model.points[0]?.lat ?? 37.39, lng: model.points[0]?.lng ?? -5.99, latDelta: 0.2, lngDelta: 0.2 }}
                fit={model.points}
                fitKey={trip.id}
                edgePadding={{ top: 0, bottom: 0, left: 0, right: 0 }}
                markers={model.markers}
                routes={model.routes}
              />
            </View>

            <Text variant="title" color="heading" size={21} lineHeight={26} accessibilityRole="header">{copy.stops}</Text>
            <StopTimeline stops={stops} testID="TripDetail.stops" />

            <View style={styles.totals} testID="TripDetail.totals">
              <Total icon="route" value={totals.distance} label={copy.totalDistance} />
              <View style={styles.sep} />
              <Total icon="clock" value={totals.duration} label={copy.estimatedTime} />
              <View style={styles.sep} />
              <Total icon="turn" value={totals.detour} label={copy.totalDetour} />
            </View>

            <View style={styles.price} testID="TripDetail.price">
              <IconTile name="coins" tone="blue" size={52} iconSize={30} />
              <View style={styles.priceText}>
                <Text variant="title" color="heading" size={19} lineHeight={23}>{copy.pricePerPerson}</Text>
                <Text variant="rowText" color="body" size={16}>{price.defined ? price.text : copy.pricePending}</Text>
              </View>
              {trip.breakdownAvailable ? (
                <Pressable accessibilityRole="button" accessibilityLabel={copy.breakdown} onPress={() => setBreakdown(true)} hitSlop={8} style={styles.breakdown} testID="TripDetail.breakdownOpen">
                  <Text variant="subtitle" color="link" underline weight="medium" size={17}>{copy.breakdown}</Text>
                  <Icon name="chevronRight" size={20} color={colors.primary} />
                </Pressable>
              ) : null}
            </View>

            {trip.recurrence !== null ? (
              <Text variant="caption" color="muted" align="center">{copy.recurrence(formatWeekdays(trip.recurrence.weekdays), trip.recurrence.outboundLocal)}</Text>
            ) : null}
          </>
        ) : null}
      </View>
      <TripBreakdownSheet visible={breakdown} tripId={tripId} dropoffStopSeq={dropoffStopSeq} onClose={() => setBreakdown(false)} />
    </Screen>
  );
}

function Total({ icon, value, label }: { icon: "route" | "clock" | "turn"; value: string; label: string }): React.JSX.Element {
  return (
    <View style={styles.total} accessible accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} size={28} color={colors.primary} />
      <View>
        <Text variant="rowTitle" color="heading" size={18} lineHeight={22}>{value}</Text>
        <Text variant="caption" color="muted" size={12.5} numberOfLines={2}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 16, gap: 12, paddingBottom: 12 },
  driver: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.bg.tint, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border.soft, padding: 10 },
  driverText: { flex: 1, gap: 3 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  vehicleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  vehicleText: { flex: 1 },
  seats: { alignSelf: "flex-start", paddingTop: 6 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.success.bg, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 8 },
  mapCard: { height: 215, borderRadius: radii.xl, overflow: "hidden", borderWidth: 1, borderColor: colors.border.soft },
  map: { flex: 1 },
  totals: { flexDirection: "row", alignItems: "center", backgroundColor: colors.bg.tint, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border.soft, paddingVertical: 10, paddingHorizontal: 8 },
  total: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" },
  sep: { width: 1, alignSelf: "stretch", backgroundColor: colors.border.soft },
  price: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.bg.tint, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border.soft, padding: 12 },
  priceText: { flex: 1 },
  breakdown: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 44 },
  footer: { paddingHorizontal: 16 },
});
