import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Icon } from "@/icons";
import { usePlaceResult } from "@/features/search/browse/hooks/usePlaceResult";
import type { PlaceParam } from "@/features/search/routes";
import { MvcMap, type MapMarkerSpec } from "@/maps";
import { useAppNavigation, useAppRoute } from "@/navigation";
import { colors, radii } from "@/theme";
import { Banner, Button, EmptyState, LargeButton, OfflineBanner, OptionSheet, Screen, Skeleton, Text } from "@/ui";
import { DriverHeader } from "../components/DriverHeader";
import { LoadFailure } from "../components/LoadFailure";
import { DRIVER_SIDE, DRIVER_TOP_GAP } from "../components/metrics";
import { useDriverReadiness } from "../hooks/useDriverReadiness";
import { usePublishRoute } from "../hooks/usePublishRoute";
import { useRoutePlan } from "../hooks/useRoutePlan";
import { describePublishError } from "../logic/errors";
import { formatKm, indexOfMarker, markersOf, outsideStops, regionOf, routesOf } from "../logic/planView";
import { addStop, canAddStop, moveStop, removeStop, replacePoint, shortPlaceName, toggleOptional, type DraftPlace } from "../logic/routeDraft";
import { routeDraftStore, useRouteDraft } from "../stores/routeDraftStore";
import { publishStrings } from "../strings";

const copy = publishStrings.stops;
const form = publishStrings.routeForm;
const MAP_HEIGHT = 410;
const MAP_HEIGHT_WITH_ISSUES = 330;

const toPlace = (p: PlaceParam): DraftPlace => ({ label: p.label, lat: p.latitude, lng: p.longitude });

type StopAction = "up" | "down" | "optional" | "change" | "remove";

/**
 * 19 · «Paradas y recorrido»: el servidor calcula la ruta del borrador (hora de paso por parada) y comprueba la provincia
 * punto por punto. Se pueden añadir, mover, cambiar o quitar paradas (cada cambio recalcula). «Guardar ruta» solo se
 * habilita cuando el servidor dice que se puede (toda la ruta dentro de la provincia) y el conductor cumple los requisitos.
 */
export function StopsRouteScreen(): React.JSX.Element {
  const navigation = useAppNavigation();
  const { width: windowWidth } = useWindowDimensions();
  const mapWidth = Math.min(windowWidth, 600) - 2 * DRIVER_SIDE;
  const { params } = useAppRoute("StopsRoute");
  const draftId = params.draftId;
  const stored = useRouteDraft(draftId);
  // Solo vista previa: los borradores «preview-…» se crean al abrir la lámina directamente.
  React.useEffect(() => {
    if (stored === undefined && draftId.startsWith("preview-")) routeDraftStore.ensure(draftId, 3);
  }, [stored, draftId]);
  const draft = stored;
  const readiness = useDriverReadiness();
  const plan = useRoutePlan(draft);
  const publish = usePublishRoute();
  const [selected, setSelected] = React.useState<number | null>(null);
  const replaceIndex = React.useRef<number | null>(null);

  const edit = (change: (d: NonNullable<typeof draft>) => NonNullable<typeof draft>): void => routeDraftStore.update(draftId, change);

  usePlaceResult("addStop", (place) => edit((d) => addStop(d, toPlace(place))));
  usePlaceResult("replaceStop", (place) => {
    const index = replaceIndex.current;
    replaceIndex.current = null;
    if (index !== null) edit((d) => replacePoint(d, index, toPlace(place)));
  });

  const header = <DriverHeader title={copy.title} testID="StopsRoute.header" />;
  const frame = { paddingTop: DRIVER_TOP_GAP } as const;

  if (draft === undefined || draft.origin === null || draft.destination === null) {
    return (
      <Screen header={header} paddingX={DRIVER_SIDE} contentContainerStyle={frame} testID="StopsRoute">
        <EmptyState
          testID="StopsRoute.missing"
          icon="route"
          title={copy.missingDraftTitle}
          message={copy.missingDraftMessage}
          actionLabel={copy.missingDraftAction}
          onAction={() => navigation.navigate("PublishRoute")}
        />
      </Screen>
    );
  }

  const originPoint = draft.origin;
  const destinationPoint = draft.destination;
  const changePlace = (pointIndex: number): void => {
    replaceIndex.current = pointIndex;
    const point = pointIndex === 0 ? originPoint : pointIndex === draft.stops.length + 1 ? destinationPoint : draft.stops[pointIndex - 1];
    navigation.navigate("PlaceSearch", {
      field: "place",
      title: copy.searchOtherSheet,
      ...(point !== undefined && point !== null ? { current: { label: point.label, latitude: point.lat, longitude: point.lng } } : {}),
      returnTo: { route: "StopsRoute", param: "replaceStop" },
    });
  };

  const addNew = (): void => {
    navigation.navigate("PlaceSearch", { field: "place", title: copy.addStopSearch, returnTo: { route: "StopsRoute", param: "addStop" } });
  };

  const data = plan.data;
  const vehicle = readiness.data?.vehicle ?? null;
  const notReady = readiness.data !== undefined && (!readiness.data.canPublish || vehicle === null);
  const canSave = data !== undefined && data.canSave && !notReady && !plan.isFetching;
  const outside = data !== undefined ? outsideStops(data) : [];
  const markers: MapMarkerSpec[] = data !== undefined ? markersOf(data, { origin: copy.originTag, destination: copy.destinationTag }) : [];
  const lastPoint = draft.stops.length + 1;
  const mapHeight = outside.length > 0 ? MAP_HEIGHT_WITH_ISSUES : MAP_HEIGHT;

  const onMarker = (marker: MapMarkerSpec): void => {
    const index = indexOfMarker(marker.id);
    if (index !== null) setSelected(index);
  };

  const onAction = (action: StopAction): void => {
    const index = selected;
    setSelected(null);
    if (index === null) return;
    const stopIndex = index - 1;
    switch (action) {
      case "up":
        edit((d) => moveStop(d, stopIndex, -1));
        return;
      case "down":
        edit((d) => moveStop(d, stopIndex, 1));
        return;
      case "optional":
        edit((d) => toggleOptional(d, stopIndex));
        return;
      case "remove":
        edit((d) => removeStop(d, stopIndex));
        return;
      case "change":
        changePlace(index);
        return;
    }
  };

  const selectedStop = selected !== null && selected > 0 && selected < lastPoint ? draft.stops[selected - 1] : undefined;
  const sheetOptions: { value: StopAction; label: string; icon?: "arrowUp" | "arrowDown" | "edit" | "trash" | "eye"; destructive?: boolean; disabled?: boolean }[] = [];
  if (selected !== null) {
    if (selectedStop !== undefined) {
      sheetOptions.push({ value: "up", label: copy.moveUp, icon: "arrowUp", disabled: selected <= 1 });
      sheetOptions.push({ value: "down", label: copy.moveDown, icon: "arrowDown", disabled: selected >= draft.stops.length });
      sheetOptions.push({ value: "optional", label: selectedStop.optional === true ? copy.makeFixed : copy.makeOptional, icon: "eye" });
    }
    sheetOptions.push({ value: "change", label: copy.change, icon: "edit" });
    if (selectedStop !== undefined) sheetOptions.push({ value: "remove", label: copy.remove, icon: "trash", destructive: true });
  }
  const selectedLabel = selected === null ? undefined : selected === 0 ? originPoint.label : selected === lastPoint ? destinationPoint.label : selectedStop?.label;

  const onSave = async (): Promise<void> => {
    if (vehicle === null || data === undefined) return;
    const result = await publish.mutate({ draft, vehicleId: vehicle.id });
    if (result === undefined) return;
    const first = result.trips[0];
    routeDraftStore.discard(draftId);
    navigation.replace("RoutePublished", {
      ...(first !== undefined ? { tripId: first.id } : {}),
      ...(result.seriesId !== null ? { seriesId: result.seriesId } : {}),
      summary: {
        origin: shortPlaceName(originPoint.label),
        destination: shortPlaceName(destinationPoint.label),
        outbound: draft.outboundLocal ?? "",
        ...(draft.returnLocal !== null ? { returnAt: draft.returnLocal } : {}),
        seats: draft.seats,
        frequency: result.frequency,
        count: result.occurrencesCreated,
        ...(first !== undefined ? { firstDeparture: first.departureAt } : {}),
        km: formatKm(result.route.distanceM),
      },
    });
  };

  const saveError = publish.isError ? describePublishError(publish.error) : null;
  const blocking = notReady
    ? readiness.data?.vehicle === null
      ? form.noVehicleMessage
      : `${form.notReadyTitle}: ${(readiness.data?.items ?? []).filter((i) => i.blocking && i.state !== "approved").map((i) => i.label).join(" · ")}`
    : (data?.blockingMessage ?? null);

  return (
    <>
      <Screen
        header={header}
        paddingX={DRIVER_SIDE}
        contentContainerStyle={frame}
        testID="StopsRoute"
        footer={
          <View>
            <LargeButton
              label={copy.save}
              onPress={() => void onSave()}
              size="compact"
              loading={publish.isPending}
              disabled={!canSave}
              testID="StopsRoute.save"
            />
            {!canSave && blocking !== null && blocking !== "" ? (
              <Text variant="caption" color="muted" size={14} lineHeight={18} align="center" style={styles.blocking} testID="StopsRoute.blocking" accessibilityLiveRegion="polite">
                {blocking}
              </Text>
            ) : null}
          </View>
        }
      >
        {plan.failedToRefresh || plan.isOffline ? <OfflineBanner testID="StopsRoute.offline" style={styles.gapBottom} /> : null}

        {data !== undefined ? (
          data.headline !== null && outside.length === 0 ? (
            <Banner kind="success" icon="pin" size="md" message={data.headline} style={styles.gapBottom} testID="StopsRoute.headline" />
          ) : (
            <Banner
              kind="warning"
              icon="pin"
              size="md"
              message={data.issues.find((i) => i.severity === "error")?.message ?? data.blockingMessage ?? copy.planError}
              style={styles.gapBottom}
              testID="StopsRoute.issue"
            />
          )
        ) : null}

        {data === undefined && plan.isLoading ? (
          <View testID="StopsRoute.loading" accessibilityLabel={copy.recalculating} accessibilityLiveRegion="polite">
            <Skeleton height={MAP_HEIGHT} radius={radii.lg} />
          </View>
        ) : data === undefined ? (
          <LoadFailure error={plan.error} title={copy.planError} onRetry={() => void plan.refetch()} testID="StopsRoute.error" />
        ) : (
          <View style={[styles.mapCard, { height: mapHeight }]} testID="StopsRoute.map">
            <MvcMap
              key={`${draft.stops.length}-${data.computedAt}`}
              markers={markers}
              routes={routesOf(data)}
              initialRegion={regionOf(data, { width: mapWidth, height: mapHeight })}
              onMarkerPress={onMarker}
              accessibilityLabel={copy.mapLabel}
              style={styles.map}
            />
            {plan.isFetching ? (
              <View style={styles.recalc} accessibilityLiveRegion="polite" testID="StopsRoute.recalculating">
                <Text variant="caption" color="heading" size={14}>{copy.recalculating}</Text>
              </View>
            ) : null}
          </View>
        )}
        {data?.route != null ? (
          <Text variant="caption" color="muted" size={14} lineHeight={18} align="center" style={styles.summary} testID="StopsRoute.summary">
            {copy.summary(formatKm(data.route.distanceM), data.route.durationMinutes)}
          </Text>
        ) : null}

        <Button
          label={copy.addStop}
          variant="outline"
          leadingIcon="addCircle"
          chevron={false}
          disabled={!canAddStop(draft)}
          onPress={addNew}
          testID="StopsRoute.addStop"
          style={styles.add}
        />

        {outside.map((stop) => (
          <View key={stop.index} style={styles.outsideCard} testID={`StopsRoute.outside.${stop.index}`} accessibilityRole="alert">
            <View style={styles.outsideTop}>
              <View style={styles.outsideDisc}>
                <Icon name="pin" size={28} color={colors.error.solid} />
              </View>
              <Text variant="rowTitle" color="error" size={19} lineHeight={23} letterSpacing={-0.3} style={styles.outsideTitle} numberOfLines={2}>
                {stop.label ?? copy.stopTag}
              </Text>
              <View style={styles.tag}>
                <Text variant="caption" color="error" weight="semibold" size={14} lineHeight={17}>{copy.outsideTag}</Text>
              </View>
            </View>
            <Text variant="body" color="heading" size={16.5} lineHeight={21} style={styles.outsideMessage}>
              {stop.message ?? data?.blockingMessage ?? ""}
            </Text>
            <Button label={copy.searchOther} variant="outline" size="sm" chevron={false} onPress={() => changePlace(stop.index)} testID={`StopsRoute.searchOther.${stop.index}`} />
            {stop.alternatives.length > 0 ? (
              <View style={styles.alts}>
                <Text variant="caption" color="muted" size={14} style={styles.altsTitle}>{copy.alternatives}</Text>
                {stop.alternatives.map((alt) => (
                  <Button
                    key={`${alt.label}-${alt.location.lat}`}
                    label={alt.label}
                    variant="ghost"
                    size="sm"
                    chevron={false}
                    leadingIcon="pinOutline"
                    onPress={() => edit((d) => replacePoint(d, stop.index, { label: alt.label, lat: alt.location.lat, lng: alt.location.lng }))}
                    testID={`StopsRoute.alt.${stop.index}.${alt.label}`}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ))}

        {saveError !== null ? (
          <Banner
            kind="error"
            size="sm"
            title={saveError.title}
            message={saveError.message}
            {...(saveError.retryable ? { actionLabel: publishStrings.common.retry, onAction: () => void publish.retry() } : {})}
            style={styles.gapTop}
            testID="StopsRoute.saveError"
          />
        ) : null}
      </Screen>

      <OptionSheet
        visible={selected !== null}
        title={selectedLabel !== undefined ? copy.moveTitle(selectedLabel) : undefined}
        options={sheetOptions}
        onSelect={onAction}
        onClose={() => setSelected(null)}
        testID="StopsRoute.stopSheet"
      />
    </>
  );
}

const styles = StyleSheet.create({
  gapBottom: { marginBottom: 10 },
  gapTop: { marginTop: 10 },
  mapCard: { borderRadius: radii.lg, overflow: "hidden", backgroundColor: colors.bg.tint },
  map: { flex: 1 },
  recalc: { position: "absolute", top: 8, alignSelf: "center", backgroundColor: colors.bg.white, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 4 },
  summary: { marginTop: 6 },
  add: { marginTop: 10 },
  outsideCard: { marginTop: 10, borderRadius: radii.lg, backgroundColor: colors.error.bg, padding: 12 },
  outsideTop: { flexDirection: "row", alignItems: "center" },
  outsideDisc: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bg.white, alignItems: "center", justifyContent: "center" },
  outsideTitle: { flex: 1, marginHorizontal: 10 },
  tag: { backgroundColor: colors.error.bgStrong, borderRadius: radii.md, paddingHorizontal: 10, paddingVertical: 5 },
  outsideMessage: { marginVertical: 8 },
  alts: { marginTop: 8 },
  altsTitle: { marginBottom: 2 },
  blocking: { marginTop: 8 },
});
