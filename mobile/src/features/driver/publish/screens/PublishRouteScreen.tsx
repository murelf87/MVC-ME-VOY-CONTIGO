import React from "react";
import { StyleSheet, View } from "react-native";
import type { IsoDate, LocalTime } from "@/api/types";
import { Icon } from "@/icons";
import { usePlaceResult } from "@/features/search/browse/hooks/usePlaceResult";
import { DatePickerSheet } from "@/features/search/browse/components/DatePickerSheet";
import { TimePickerSheet } from "@/features/search/browse/components/TimePickerSheet";
import { dateFieldLabel } from "@/features/search/browse/logic/schedule";
import type { PlaceParam } from "@/features/search/routes";
import { useAppNavigation, useAppRoute } from "@/navigation";
import { colors, radii } from "@/theme";
import { Banner, CategoryChips, ConfirmDialog, LargeButton, OfflineBanner, OptionSheet, Screen, Skeleton, Switch, Text } from "@/ui";
import { DriverHeader } from "../components/DriverHeader";
import { LoadFailure } from "../components/LoadFailure";
import { PillStepper } from "../components/PillStepper";
import { FrequencyToggle, PlaceRow, SelectBox, TimeCard } from "../components/RouteFormParts";
import { DRIVER_SIDE, DRIVER_TOP_GAP } from "../components/metrics";
import { useDriverReadiness } from "../hooks/useDriverReadiness";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";
import { DETOUR_OPTIONS, hasErrors, shortPlaceName, validateRouteForm, type DraftPlace, type RouteDraft, type RouteFormErrors } from "../logic/routeDraft";
import { newDraftId, routeDraftStore, useRouteDraft } from "../stores/routeDraftStore";
import { publishStrings } from "../strings";

const copy = publishStrings.routeForm;

const toPlace = (p: PlaceParam): DraftPlace => ({ label: p.label, lat: p.latitude, lng: p.longitude });
const placeParam = (p: DraftPlace | null): PlaceParam | undefined => (p === null ? undefined : { label: p.label, latitude: p.lat, longitude: p.lng });

const isUntouched = (d: RouteDraft | undefined): boolean =>
  d === undefined || (d.origin === null && d.destination === null && d.outboundLocal === null && d.returnLocal === null && d.stops.length === 0);

/**
 * 18 · «Publica tu ruta»: origen y destino, categoría, horarios de ida y vuelta, frecuencia (diaria o puntual), plazas,
 * máximo desvío y «Recoger en ruta». «Calcular ruta» valida el formulario y abre «Paradas y recorrido», donde el servidor
 * calcula la ruta y comprueba la provincia por parada. Nada se publica aquí.
 */
export function PublishRouteScreen(): React.JSX.Element {
  const navigation = useAppNavigation();
  const { params } = useAppRoute("PublishRoute");
  const [ownId] = React.useState(newDraftId);
  const draftId = params?.draftId ?? ownId;
  const readiness = useDriverReadiness();
  const vehicle = readiness.data?.vehicle ?? null;
  const vehicleSeats = vehicle?.passengerSeats ?? null;

  const stored = useRouteDraft(draftId);
  React.useEffect(() => {
    if (stored === undefined) routeDraftStore.ensure(draftId, vehicleSeats ?? 3);
  }, [stored, draftId, vehicleSeats]);
  // Cuando llega el vehículo y la persona aún no tocó las plazas, se ajustan a su vehículo.
  React.useEffect(() => {
    if (stored !== undefined && vehicleSeats !== null && stored.seats > vehicleSeats) routeDraftStore.update(draftId, (d) => ({ ...d, seats: vehicleSeats }));
  }, [stored, draftId, vehicleSeats]);
  const draft = stored;

  const patch = (change: Partial<RouteDraft>): void => routeDraftStore.update(draftId, (d) => ({ ...d, ...change }));
  const [errors, setErrors] = React.useState<RouteFormErrors>({});
  const [sheet, setSheet] = React.useState<"outbound" | "return" | "date" | "detour" | null>(null);
  const guard = useUnsavedGuard(!isUntouched(draft));
  const now = React.useMemo(() => new Date(), []);

  usePlaceResult("origin", (place) => patch({ origin: toPlace(place), stops: [] }));
  usePlaceResult("destination", (place) => patch({ destination: toPlace(place), stops: [] }));

  const clearError = (key: keyof RouteFormErrors): void => setErrors((current) => (current[key] === undefined ? current : { ...current, [key]: undefined }));

  const pickPlace = (field: "origin" | "destination"): void => {
    const current = placeParam(field === "origin" ? (draft?.origin ?? null) : (draft?.destination ?? null));
    navigation.navigate("PlaceSearch", {
      field: "place",
      title: field === "origin" ? copy.originSearch : copy.destinationSearch,
      ...(current !== undefined ? { current } : {}),
      returnTo: { route: "PublishRoute", param: field },
    });
  };

  const onCalculate = (): void => {
    if (draft === undefined) return;
    const found = validateRouteForm(draft, vehicleSeats);
    const clean: RouteFormErrors = {};
    for (const [key, value] of Object.entries(found)) if (value !== undefined) clean[key as keyof RouteFormErrors] = value;
    setErrors(clean);
    if (hasErrors(clean)) return;
    navigation.navigate("StopsRoute", { draftId });
  };

  const header = <DriverHeader title={copy.title} testID="PublishRoute.header" />;
  const frame = { paddingTop: DRIVER_TOP_GAP } as const;

  if (draft === undefined || (readiness.data === undefined && readiness.isLoading)) {
    return (
      <Screen header={header} paddingX={DRIVER_SIDE} contentContainerStyle={frame} testID="PublishRoute">
        <View testID="PublishRoute.loading" accessibilityLabel={copy.loading} accessibilityLiveRegion="polite">
          <Skeleton height={140} radius={radii.lg} />
          <Skeleton height={110} radius={radii.lg} style={styles.gap} />
          <Skeleton height={130} radius={radii.lg} style={styles.gap} />
          <Skeleton height={90} radius={radii.lg} style={styles.gap} />
        </View>
      </Screen>
    );
  }

  if (readiness.data === undefined) {
    return (
      <Screen header={header} paddingX={DRIVER_SIDE} contentContainerStyle={frame} testID="PublishRoute">
        <LoadFailure error={readiness.error} onRetry={() => void readiness.refetch()} testID="PublishRoute.error" />
      </Screen>
    );
  }

  const pending = readiness.data.items.filter((item) => item.blocking && item.state !== "approved");
    const destinationShort = shortPlaceName(draft.destination?.label);
  const originShort = shortPlaceName(draft.origin?.label);
  const maxSeats = vehicleSeats ?? 8;

  return (
    <>
      <Screen
        header={header}
        paddingX={DRIVER_SIDE}
        contentContainerStyle={frame}
        testID="PublishRoute"
        footer={
          <LargeButton
            label={copy.calculate}
            onPress={onCalculate}
            size="compact"
            disabled={vehicle === null}
            testID="PublishRoute.calculate"
          />
        }
      >
        {readiness.failedToRefresh || readiness.isOffline ? <OfflineBanner testID="PublishRoute.offline" style={styles.gapBottom} /> : null}

        {vehicle === null ? (
          <Banner
            kind="warning"
            size="sm"
            title={copy.noVehicleTitle}
            message={copy.noVehicleMessage}
            actionLabel={copy.notReadyAction}
            onAction={() => navigation.navigate("MyVehicle")}
            style={styles.gapBottom}
            testID="PublishRoute.noVehicle"
          />
        ) : pending.length > 0 ? (
          <Banner
            kind="warning"
            size="sm"
            title={copy.notReadyTitle}
            message={pending.map((item) => item.label).join(" · ")}
            actionLabel={copy.notReadyAction}
            onAction={() => navigation.navigate("MyVehicle", { vehicleId: vehicle.id })}
            style={styles.gapBottom}
            testID="PublishRoute.notReady"
          />
        ) : null}

        <View style={styles.card} testID="PublishRoute.places">
          <PlaceRow
            icon="pin"
            label={copy.origin}
            value={draft.origin?.label ?? ""}
            placeholder={copy.originPlaceholder}
            error={errors.origin ?? null}
            onPress={() => pickPlace("origin")}
            testID="PublishRoute.origin"
          />
          <PlaceRow
            icon="flag"
            label={copy.destination}
            value={draft.destination?.label ?? ""}
            placeholder={copy.destinationPlaceholder}
            error={errors.destination ?? null}
            onPress={() => pickPlace("destination")}
            testID="PublishRoute.destination"
          />
        </View>

        <CategoryChips layout="tiles" value={draft.category} onChange={(category) => patch({ category })} style={styles.categories} testID="PublishRoute.category" />

        <View style={styles.card} testID="PublishRoute.schedules">
          <View style={styles.cardTitle}>
            <Icon name="clock" size={34} color={colors.primary} />
            <Text variant="heading" color="deep" size={21} lineHeight={26} letterSpacing={-0.4} style={styles.cardTitleText} accessibilityRole="header">
              {copy.schedules}
            </Text>
          </View>
          <View style={styles.timesRow}>
            <TimeCard
              strong="Ida"
              light={destinationShort !== "" ? `(hacia ${destinationShort})` : ""}
              value={draft.outboundLocal}
              placeholder={copy.timeUnset}
              error={errors.outbound ?? null}
              onPress={() => setSheet("outbound")}
              testID="PublishRoute.outbound"
            />
            <View style={styles.timesGap} />
            <TimeCard
              strong="Vuelta"
              light={originShort !== "" || destinationShort !== "" ? `(desde ${destinationShort !== "" ? destinationShort : originShort})` : ""}
              value={draft.returnLocal}
              placeholder={copy.noReturn}
              error={errors.return ?? null}
              onPress={() => setSheet("return")}
              testID="PublishRoute.return"
            />
          </View>
        </View>

        <View style={styles.freqTitle}>
          <Icon name="calendarOutline" size={30} color={colors.primary} />
          <Text variant="rowTitle" color="deep" size={19} lineHeight={24} letterSpacing={-0.3} style={styles.freqTitleText}>
            {copy.frequency}
          </Text>
        </View>
        <FrequencyToggle
          value={draft.frequency}
          dailyLabel={copy.daily}
          oneOffLabel={copy.oneOff}
          groupLabel={copy.frequency}
          onChange={(frequency) => {
            patch({ frequency, date: frequency === "one_off" ? draft.date : null });
            clearError("date");
          }}
          testID="PublishRoute.frequency"
        />
        {draft.frequency === "one_off" ? (
          <View style={[styles.card, styles.dateWrap]}>
            <PlaceRow
              icon="calendar"
              label={copy.date}
              value={draft.date !== null ? dateFieldLabel(draft.date, now) : ""}
              placeholder={copy.dateUnset}
              error={errors.date ?? null}
              onPress={() => setSheet("date")}
              testID="PublishRoute.date"
            />
          </View>
        ) : null}

        <View style={styles.pair}>
          <View style={[styles.card, styles.seatsCard]} testID="PublishRoute.seats">
            <View style={styles.cardTitle}>
              <Icon name="people" size={30} color={colors.primary} />
              <Text variant="rowTitle" color="deep" size={19} lineHeight={24} letterSpacing={-0.3} style={styles.cardTitleText}>
                {copy.seats}
              </Text>
            </View>
            <PillStepper
              value={draft.seats}
              min={1}
              max={maxSeats}
              onChange={(seats) => {
                patch({ seats });
                clearError("seats");
              }}
              decrementLabel={copy.seatsLess}
              incrementLabel={copy.seatsMore}
              valueLabel={`${draft.seats} ${draft.seats === 1 ? "plaza" : "plazas"}`}
              size="compact"
              testID="PublishRoute.seatsStepper"
            />
          </View>
          <View style={styles.pairGap} />
          <View style={[styles.card, styles.detourCard]} testID="PublishRoute.detour">
            <View style={styles.cardTitle}>
              <Icon name="clock" size={30} color={colors.primary} />
              <Text variant="rowTitle" color="deep" size={16} lineHeight={20} letterSpacing={-0.3} style={styles.cardTitleText} numberOfLines={2}>
                {copy.detour}
              </Text>
            </View>
            <SelectBox
              value={copy.detourValue(draft.maxDetourMinutes)}
              label={copy.detour}
              onPress={() => setSheet("detour")}
              testID="PublishRoute.detourField"
            />
          </View>
        </View>
        {errors.seats !== undefined ? (
          <Text variant="caption" color="error" size={14} accessibilityRole="alert" style={styles.hint} testID="PublishRoute.seats.error">
            {errors.seats}
          </Text>
        ) : null}

        <View style={[styles.card, styles.pickupCard]} testID="PublishRoute.pickup">
          <View style={styles.pickupIcon}>
            <Icon name="pin" size={30} color={colors.primary} />
          </View>
          <View style={styles.pickupText}>
            <Text variant="rowTitle" color="deep" size={16} lineHeight={20} letterSpacing={-0.3}>
              {copy.pickupOnRoute}
            </Text>
            <Text variant="body" color="heading" size={14.5} lineHeight={18} letterSpacing={-0.3}>
              {copy.pickupOnRouteHint}
            </Text>
          </View>
          <Switch value={draft.pickupOnRoute} onValueChange={(pickupOnRoute) => patch({ pickupOnRoute })} accessibilityLabel={copy.pickupOnRoute} testID="PublishRoute.pickupSwitch" />
        </View>
      </Screen>

      <TimePickerSheet
        visible={sheet === "outbound"}
        kind="arrival"
        value={draft.outboundLocal}
        title={copy.outboundSheetTitle}
        subtitle={copy.outboundSheetSubtitle}
        onApply={(time: LocalTime | null) => {
          if (time !== null) {
            patch({ outboundLocal: time });
            clearError("outbound");
            clearError("return");
          }
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
      <TimePickerSheet
        visible={sheet === "return"}
        kind="return"
        value={draft.returnLocal}
        title={copy.returnSheetTitle}
        subtitle={copy.returnSheetSubtitle}
        noneLabel={copy.noReturn}
        onApply={(time: LocalTime | null) => {
          patch({ returnLocal: time });
          clearError("return");
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
      <DatePickerSheet
        visible={sheet === "date"}
        value={draft.date}
        now={now}
        onApply={(date: IsoDate) => {
          patch({ date });
          clearError("date");
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === "detour"}
        title={copy.detourSheetTitle}
        options={DETOUR_OPTIONS.map((minutes) => ({ value: String(minutes), label: copy.detourValue(minutes) }))}
        selected={String(draft.maxDetourMinutes)}
        onSelect={(value) => {
          patch({ maxDetourMinutes: Number(value) });
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="PublishRoute.detourSheet"
      />
      <ConfirmDialog
        visible={guard.visible}
        title={copy.discardTitle}
        message={copy.discardMessage}
        confirmLabel={copy.discardConfirm}
        cancelLabel={copy.discardKeep}
        destructive
        onConfirm={() => {
          routeDraftStore.discard(draftId);
          guard.leave();
        }}
        onCancel={guard.stay}
        testID="PublishRoute.discard"
      />
    </>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 10 },
  gapBottom: { marginBottom: 10 },
  card: { backgroundColor: colors.bg.tint, borderRadius: radii.lg, paddingHorizontal: 12, paddingVertical: 8, marginTop: 8 },
  categories: { marginTop: 8 },
  cardTitle: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  cardTitleText: { flex: 1, marginLeft: 10 },
  timesRow: { flexDirection: "row", alignItems: "stretch" },
  timesGap: { width: 10 },
  freqTitle: { flexDirection: "row", alignItems: "center", marginTop: 14, marginBottom: 8, paddingLeft: 8 },
  freqTitleText: { marginLeft: 10 },
  dateWrap: { marginTop: 10 },
  hint: { marginTop: 8, paddingHorizontal: 6 },
  pair: { flexDirection: "row", alignItems: "stretch" },
  pairGap: { width: 10 },
  seatsCard: { flex: 0.86 },
  detourCard: { flex: 1.14 },
  pickupCard: { flexDirection: "row", alignItems: "center" },
  pickupIcon: { width: 44, alignItems: "center" },
  pickupText: { flex: 1, marginHorizontal: 8 },
});
