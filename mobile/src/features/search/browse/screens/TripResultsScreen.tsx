import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { describeError } from "@/api/errors";
import { useApiQuery } from "@/hooks";
import { Icon } from "@/icons";
import { MvcMap, type MapMarkerSpec, type MapPoint, type MapRouteSpec } from "@/maps";
import { useAppNavigation, useAppRoute, type AppScreenProps } from "@/navigation";
import { colors, radii } from "@/theme";
import { Banner, Button, EmptyState, ErrorStateCard, OfflineBanner, Screen, ScreenHeader, Segmented, Skeleton, Text } from "@/ui";
import { getTripDetail } from "../api";
import { TripResultCard } from "../components/TripResultCard";
import { useProvinces } from "../hooks/useProvinces";
import { useTripSearch } from "../hooks/useTripSearch";
import { formFromCriteria, scheduleSummary } from "../logic/searchCriteria";
import { resultCardView, suggestionText } from "../logic/tripResults";
import { browseStrings } from "../strings";

const copy = browseStrings.tripResults;

type ViewMode = "map" | "list";

/**
 * «Coches disponibles» (lámina 11). Resultados de `GET /v1/search/trips` para el recorrido pedido, con mapa del recorrido
 * y una tarjeta por coche. Si no hay coincidencias se enseña la sugerencia del servidor (ampliar horario o días) y se
 * aplica con un toque.
 */
export function TripResultsScreen(_props: AppScreenProps<"TripResults">): React.JSX.Element {
  const navigation = useAppNavigation();
  const { criteria } = useAppRoute("TripResults").params;
  const { province, isLoading: provincesLoading } = useProvinces();
  const search = useTripSearch(criteria, province?.id ?? null);
  const [mode, setMode] = useState<ViewMode>("map");

  const items = search.items;
  const topId = items[0]?.tripId ?? null;
  const topDetail = useApiQuery(["trips", "detail-geometry", topId], ({ signal }) => getTripDetail(topId ?? "", {}, { signal }), {
    enabled: topId !== null,
    staleTimeMs: 60_000,
  });

  const edit = () => {
    const form = formFromCriteria(criteria);
    navigation.navigate("DefineRoute", { origin: form.origin ?? undefined, destination: form.destination ?? undefined, category: form.category ?? undefined });
  };
  const open = (tripId: string, dropoffStopSeq: number) => navigation.navigate("TripDetail", { tripId, criteria, dropoffStopSeq });

  const markers = useMemo<MapMarkerSpec[]>(() => {
    const list: MapMarkerSpec[] = [
      { id: "origin", kind: "origin", position: { lat: criteria.origin.latitude, lng: criteria.origin.longitude } },
      { id: "dest", kind: "destinationCap", position: { lat: criteria.destination.latitude, lng: criteria.destination.longitude }, chip: { title: criteria.destination.label, side: "bottom" } },
    ];
    items.slice(0, 6).forEach((item) => {
      list.push({ id: `car-${item.tripId}`, kind: "car", position: { lat: item.pickup.location.lat, lng: item.pickup.location.lng }, seats: item.seatsAvailable });
    });
    return list;
  }, [criteria, items]);

  const routes = useMemo<MapRouteSpec[]>(() => {
    const coordinates = topDetail.data?.route.geometry.coordinates;
    if (coordinates === undefined || coordinates.length < 2) return [];
    const points: MapPoint[] = coordinates.map(([lng, lat]) => ({ lat, lng }));
    return [{ id: "route", kind: "route", points }];
  }, [topDetail.data]);

  const fitPoints = useMemo<MapPoint[]>(() => {
    const points: MapPoint[] = [
      { lat: criteria.origin.latitude, lng: criteria.origin.longitude },
      { lat: criteria.destination.latitude, lng: criteria.destination.longitude },
    ];
    routes[0]?.points.forEach((point) => points.push(point));
    return points;
  }, [criteria, routes]);

  const summaryDate = criteria.mode === "one_off" ? criteria.date : undefined;
  const suggestion = search.page?.suggestions[0];
  const fallbackDestination = criteria.destination.label !== "" ? criteria.destination.label : copy.destinationFallback;
  const showResults = search.page !== undefined || items.length > 0;
  const loading = provincesLoading || (search.isLoading && !showResults);

  return (
    <Screen testID="TripResults" padded={false} header={<ScreenHeader title={copy.title} testID="TripResults.header" />}>
      <View style={styles.summary}>
        <View style={styles.summaryText}>
          <Text variant="rowTitle" color="heading" size={19} lineHeight={24} numberOfLines={1}>
            {`${criteria.origin.label} → ${criteria.destination.label}`}
          </Text>
          <Text variant="rowText" color="muted" size={16} numberOfLines={1}>{scheduleSummary(criteria, summaryDate)}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={copy.editA11y} onPress={edit} hitSlop={10} testID="TripResults.edit">
          <Text variant="subtitle" color="link" underline weight="medium" size={19}>{copy.edit}</Text>
        </Pressable>
      </View>

      <View style={styles.pad}>
        <Segmented
          value={mode}
          onChange={setMode}
          accessibilityLabel={copy.modesA11y}
          options={[
            { value: "map", label: copy.modeMap, icon: "map", testID: "TripResults.mode.map" },
            { value: "list", label: copy.modeList, icon: "list", testID: "TripResults.mode.list" },
          ]}
          testID="TripResults.mode"
        />
      </View>

      {search.isOffline && !showResults ? <OfflineBanner testID="TripResults.offline" /> : null}

      <View style={styles.pad} accessibilityLiveRegion="polite">
        {mode === "map" ? (
          <View style={styles.mapCard}>
            <MvcMap
              testID="TripResults.map"
              style={styles.map}
              accessibilityLabel={copy.mapLabel}
              initialRegion={{ lat: criteria.origin.latitude, lng: criteria.origin.longitude, latDelta: 0.08, lngDelta: 0.08 }}
              fit={fitPoints}
              fitKey={`${criteria.origin.latitude}-${criteria.destination.latitude}-${routes.length}`}
              edgePadding={{ top: 24, bottom: 24, left: 24, right: 24 }}
              markers={markers}
              routes={routes}
            />
          </View>
        ) : null}

        {loading ? (
          <>
            <Text variant="caption" color="muted" accessibilityRole="text">{copy.loading}</Text>
            <Skeleton height={190} />
            <Skeleton height={190} />
          </>
        ) : null}

        {!loading && province === null ? (
          <EmptyState icon="map" title={copy.noProvinceTitle} message={copy.noProvinceMessage} testID="TripResults.noProvince" />
        ) : null}

        {!loading && search.isError && !showResults ? (
          search.isOffline ? (
            <ErrorStateCard title={copy.offlineTitle} message={copy.offlineMessage} actionLabel={browseStrings.common.retry} onAction={search.refetch} testID="TripResults.offlineCard" />
          ) : (
            <ErrorStateCard title={copy.errorTitle} message={describeError(search.error).message} actionLabel={browseStrings.common.retry} onAction={search.refetch} testID="TripResults.error" />
          )
        ) : null}

        {search.failedToRefresh && showResults ? <Banner kind="warning" size="sm" message={copy.refreshFailed} actionLabel={browseStrings.common.retry} onAction={search.refetch} testID="TripResults.refreshFailed" /> : null}

        {items.map((item) => (
          <TripResultCard key={item.tripId} view={resultCardView(item, fallbackDestination)} onOpen={() => open(item.tripId, item.dropoff.stopSeq)} testID={`TripResults.card.${item.tripId}`} />
        ))}

        {search.hasMore ? (
          <Button label={search.loadingMore ? copy.loadingMore : copy.loadMore} variant="outline" onPress={search.loadMore} disabled={search.loadingMore} testID="TripResults.more" />
        ) : null}
        {search.loadMoreFailed ? <Banner kind="error" size="sm" message={copy.refreshFailed} actionLabel={browseStrings.common.retry} onAction={search.loadMore} testID="TripResults.moreError" /> : null}

        {showResults && items.length === 0 && !search.isError ? (
          <EmptyState icon="car" title={copy.emptyTitle} message={copy.emptyMessage} actionLabel={copy.emptyEdit} onAction={edit} testID="TripResults.empty" />
        ) : null}

        {showResults && (suggestion !== undefined || items.length === 0) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${copy.noMatchesTitle}. ${suggestionText(suggestion)}`}
            accessibilityState={{ disabled: suggestion === undefined }}
            disabled={suggestion === undefined}
            onPress={() => (suggestion !== undefined ? search.applyOverrides(suggestion.apply) : undefined)}
            style={styles.sug}
            testID="TripResults.suggestion"
          >
            <View style={styles.sugIcon}>
              <Icon name="search" size={26} color={colors.primary} />
            </View>
            <View style={styles.sugText}>
              <Text variant="rowTitle" color="heading" size={19} lineHeight={23}>{copy.noMatchesTitle}</Text>
              <Text variant="rowText" color="muted" size={15} lineHeight={19}>{suggestionText(suggestion)}</Text>
            </View>
            {suggestion !== undefined ? <Icon name="chevronRight" size={24} color={colors.primary} /> : null}
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 10 },
  summaryText: { flex: 1 },
  pad: { paddingHorizontal: 16, gap: 12, paddingBottom: 12 },
  mapCard: { height: 168, borderRadius: radii.xl, overflow: "hidden", borderWidth: 1, borderColor: colors.border.soft },
  map: { flex: 1 },
  sug: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radii.xl, backgroundColor: colors.bg.tint, borderWidth: 1, borderColor: colors.border.soft },
  sugIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.bg.white, alignItems: "center", justifyContent: "center" },
  sugText: { flex: 1 },
});
