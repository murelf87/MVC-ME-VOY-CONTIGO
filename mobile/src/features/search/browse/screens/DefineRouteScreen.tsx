import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { describeError } from "@/api/errors";
import type { SearchMode } from "@/api/types";
import { useIsOnline } from "@/hooks";
import { Icon } from "@/icons";
import { strings } from "@/i18n";
import { useAppNavigation, useAppRoute, type AppScreenProps } from "@/navigation";
import { colors, radii } from "@/theme";
import { Banner, DayPills, LargeButton, OfflineBanner, OptionSheet, Screen, ScreenHeader, Segmented, SelectField, Text } from "@/ui";
import { checkPlaceProvince } from "../api";
import { LocationCard } from "../components/LocationCard";
import { DatePickerSheet } from "../components/DatePickerSheet";
import { PlaceFieldRow } from "../components/PlaceFieldRow";
import { TimePickerSheet } from "../components/TimePickerSheet";
import { useExploreCategory } from "../hooks/useExploreCategory";
import { useMyLocationPlace } from "../hooks/useMyLocationPlace";
import { usePlaceResult } from "../hooks/usePlaceResult";
import { useProvinces } from "../hooks/useProvinces";
import { locateProblem } from "../logic/locate";
import { initialRouteForm, hasErrors, provinceVerdict, swapPlaces, toCriteria, toggleWeekday, validateRouteForm, type RouteFormErrors, type RouteFormState } from "../logic/searchCriteria";
import { dateFieldLabel } from "../logic/schedule";
import { browseStrings } from "../strings";
import type { PlaceParam } from "../../routes";
import { tripCategoryOrder } from "@/ui";
import type { TripCategory } from "@/api/types";

const copy = browseStrings.defineRoute;
const MODES: readonly { value: SearchMode; label: string; icon: "calendarGrid" | "calendar" }[] = [
  { value: "weekly", label: copy.weekly, icon: "calendarGrid" },
  { value: "one_off", label: copy.oneOff, icon: "calendar" },
];

type SubmitState = { kind: "idle" } | { kind: "checking" } | { kind: "failed"; message: string };

/**
 * 10 · Define tu recorrido. Origen y destino (buscador de lugares), «Usar mi ubicación» opcional, llegada, regreso
 * opcional, frecuencia (semanal con días, o puntual con fecha) y categoría opcional. «Buscar compañeros» valida todo, comprueba
 * con el servidor que origen y destino están en la MISMA provincia disponible y abre Resultados.
 */
export function DefineRouteScreen(_props: AppScreenProps<"DefineRoute">): React.JSX.Element {
  const navigation = useAppNavigation();
  const params = useAppRoute("DefineRoute").params;
  const online = useIsOnline();
  const { province } = useProvinces();
  const [exploreCategory, setExploreCategory] = useExploreCategory();
  const locator = useMyLocationPlace();

  const [form, setForm] = useState<RouteFormState>(() =>
    initialRouteForm({ ...(params?.origin !== undefined ? { origin: params.origin } : {}), ...(params?.destination !== undefined ? { destination: params.destination } : {}), category: params?.category ?? exploreCategory }),
  );
  const [errors, setErrors] = useState<RouteFormErrors>({});
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | "arrival" | "return" | "date" | "category">(null);
  const now = new Date();

  const patch = useCallback((next: Partial<RouteFormState>, clear: readonly (keyof RouteFormErrors)[] = []) => {
    setForm((current) => ({ ...current, ...next }));
    setSubmit({ kind: "idle" });
    if (clear.length > 0) {
      setErrors((current) => {
        const copyOf = { ...current };
        for (const key of clear) delete copyOf[key];
        return copyOf;
      });
    }
  }, []);

  usePlaceResult("origin", (place) => patch({ origin: place }, ["origin", "destination"]));
  usePlaceResult("destination", (place) => patch({ destination: place }, ["origin", "destination"]));

  const useMyLocation = useCallback(async () => {
    setLocationNotice(null);
    const place = await locator.locate();
    if (place === null) return;
    const verdict = await checkPlaceProvince(place);
    if (verdict.ok) {
      patch({ origin: place }, ["origin"]);
    } else if (verdict.reason === "outside") {
      setLocationNotice(copy.locationOutside(province?.name ?? null));
    } else {
      patch({ origin: place }, ["origin"]);
    }
  }, [locator, patch, province]);

  const swap = useCallback(() => {
    setForm((current) => swapPlaces(current));
    setErrors((current) => ({ ...current, origin: undefined, destination: undefined }));
  }, []);

  const search = useCallback(async () => {
    if (submit.kind === "checking") return;
    const found = validateRouteForm(form, new Date());
    setErrors(found);
    if (hasErrors(found)) return;
    const criteria = toCriteria(form);
    if (criteria === null || form.origin === null || form.destination === null) return;
    setSubmit({ kind: "checking" });
    try {
      const [origin, destination] = await Promise.all([checkPlaceProvince(form.origin), checkPlaceProvince(form.destination)]);
      const verdict = provinceVerdict(origin, destination, province?.name ?? null);
      if (verdict.kind === "invalid") {
        setErrors(verdict.errors);
        setSubmit({ kind: "idle" });
        return;
      }
      if (verdict.kind === "failed") {
        setSubmit({ kind: "failed", message: describeError(verdict.error).message || copy.provinceCheckFailed });
        return;
      }
      setSubmit({ kind: "idle" });
      setExploreCategory(form.category);
      navigation.navigate("TripResults", { criteria });
    } catch (failure) {
      setSubmit({ kind: "failed", message: describeError(failure).message || copy.provinceCheckFailed });
    }
  }, [form, navigation, province, setExploreCategory, submit.kind]);

  const openPlace = useCallback(
    (field: "origin" | "destination") => {
      const current: PlaceParam | null = form[field];
      navigation.navigate("PlaceSearch", { field, ...(current !== null ? { current } : {}) });
    },
    [form, navigation],
  );

  const problem = locateProblem(locator.status, copy);
  const categoryLabel = form.category !== null ? strings.categories[form.category] : null;
  const categoryOptions = useMemo(
    () => [
      { value: "any" as const, label: copy.categoryAnyOption, description: copy.categoryAnyDescription },
      ...tripCategoryOrder.map((category) => ({ value: category, label: strings.categories[category] })),
    ],
    [],
  );

  const checking = submit.kind === "checking";
  const hasProblems = hasErrors(errors);

  return (
    <Screen
      testID="DefineRoute"
      padded={false}
      header={<ScreenHeader title={copy.title} testID="DefineRoute.header" />}
      footer={
        <LargeButton
          label={checking ? copy.submitBusy : copy.submit}
          leadingIcon="search"
          onPress={() => void search()}
          loading={checking}
          disabled={!online}
          style={styles.submit}
          testID="DefineRoute.submit"
        />
      }
    >
      {!online ? <OfflineBanner detail={copy.offlineDetail} testID="DefineRoute.offline" /> : null}

      <View style={styles.pad}>
        <LocationCard title={copy.useLocation} subtitle={locator.isLocating ? copy.locating : copy.useLocationHint} loading={locator.isLocating} onPress={() => void useMyLocation()} testID="DefineRoute.useLocation" />
        {problem !== null ? (
          <Banner
            kind="warning"
            size="sm"
            title={problem.title}
            message={problem.message}
            actionLabel={problem.needsSettings ? copy.openSettings : problem.canAllow ? copy.allowLocation : problem.canRetry ? copy.retry : undefined}
            onAction={problem.needsSettings ? locator.openSettings : problem.canAllow || problem.canRetry ? () => void useMyLocation() : undefined}
            testID="DefineRoute.locationProblem"
          />
        ) : null}
        {locationNotice !== null ? <Banner kind="notice" size="sm" title={copy.locationNoticeOutsideTitle} message={locationNotice} testID="DefineRoute.locationOutside" /> : null}
      </View>

      <View style={styles.places}>
        <View style={styles.fields}>
          <View style={styles.originRow}>
            <View style={styles.markerOrigin} pointerEvents="none">
              <View style={styles.dot}>
                <View style={styles.dotCore} />
              </View>
            </View>
            <View style={styles.lineSolid} pointerEvents="none" />
            <PlaceFieldRow
              label={copy.originLabel}
              value={form.origin?.label ?? null}
              placeholder={copy.originPlaceholder}
              accessibilityLabel={copy.originA11y(form.origin?.label ?? null)}
              clearLabel={copy.clearField(copy.originLabel.toLowerCase())}
              {...(errors.origin !== undefined ? { error: errors.origin } : {})}
              onPress={() => openPlace("origin")}
              onClear={() => patch({ origin: null })}
              style={styles.originField}
              testID="DefineRoute.origin"
            />
            <Pressable accessibilityRole="button" accessibilityLabel={copy.swap} onPress={swap} style={styles.swap} testID="DefineRoute.swap">
              <Icon name="swapVertical" size={30} color={colors.primary} />
            </Pressable>
          </View>
          <View style={styles.markerDestination} pointerEvents="none">
            <Icon name="pin" size={30} color={colors.primary} />
          </View>
          <View style={styles.lineDashed} pointerEvents="none" />
          <PlaceFieldRow
            label={copy.destinationLabel}
            value={form.destination?.label ?? null}
            placeholder={copy.destinationPlaceholder}
            accessibilityLabel={copy.destinationA11y(form.destination?.label ?? null)}
            clearLabel={copy.clearField(copy.destinationLabel.toLowerCase())}
            {...(errors.destination !== undefined ? { error: errors.destination } : {})}
            onPress={() => openPlace("destination")}
            onClear={() => patch({ destination: null })}
            style={styles.destination}
            testID="DefineRoute.destination"
          />
        </View>
      </View>

      <View style={styles.when}>
        <View style={styles.whenTitle}>
          <Icon name="clock" size={26} color={colors.primary} />
          <Text variant="title" color="heading" size={21} lineHeight={26} accessibilityRole="header">{copy.whenTitle}</Text>
        </View>
        <View style={styles.times}>
          <View style={styles.time}>
            <Text variant="body" color="heading" size={19} lineHeight={23}>{copy.arrivalLabel}</Text>
            <SelectField
              variant="compact"
              height={50}
              valueSize={20}
              valueLabel={form.arriveBy}
              accessibilityLabel={`${copy.arrivalLabel}: ${form.arriveBy}`}
              onPress={() => setSheet("arrival")}
              {...(errors.arriveBy !== undefined ? { error: errors.arriveBy } : {})}
              style={styles.timeField}
              testID="DefineRoute.arrival"
            />
          </View>
          <View style={styles.time}>
            <Text variant="body" color="heading" size={19} lineHeight={23}>{copy.returnLabel}</Text>
            <SelectField
              variant="compact"
              height={50}
              valueSize={20}
              valueLabel={form.returnAt ?? undefined}
              placeholder={copy.returnNone}
              accessibilityLabel={`${copy.returnLabel}: ${form.returnAt ?? copy.returnNone}`}
              onPress={() => setSheet("return")}
              {...(errors.returnAt !== undefined ? { error: errors.returnAt } : {})}
              style={styles.timeField}
              testID="DefineRoute.return"
            />
          </View>
        </View>

        <Segmented
          options={MODES}
          value={form.mode}
          onChange={(mode) => patch({ mode }, ["weekdays", "date", "arriveBy"])}
          variant="segmented"
          accessibilityLabel={copy.modeA11y}
          style={styles.modes}
          testID="DefineRoute.mode"
        />

        {form.mode === "weekly" ? (
          <View>
            <Text variant="rowTitle" color="heading" size={19} lineHeight={23} style={styles.daysLabel}>{copy.weekdaysLabel}</Text>
            <DayPills value={form.weekdays} onChange={(days) => patch({ weekdays: days }, ["weekdays"])} style={styles.days} testID="DefineRoute.days" />
            {errors.weekdays !== undefined ? <Text variant="caption" color="error" accessibilityRole="alert" style={styles.fieldError} testID="DefineRoute.days.error">{errors.weekdays}</Text> : null}
          </View>
        ) : (
          <SelectField
            variant="compact"
            height={50}
            valueSize={20}
            leadingIcon="calendar"
            accessibilityLabel={copy.dateLabel}
            valueLabel={form.date !== null ? dateFieldLabel(form.date, now) : undefined}
            placeholder={copy.datePlaceholder}
            onPress={() => setSheet("date")}
            {...(errors.date !== undefined ? { error: errors.date } : {})}
            style={styles.dateField}
            testID="DefineRoute.date"
          />
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.categoryChipA11y(categoryLabel)}
          onPress={() => setSheet("category")}
          style={styles.category}
          testID="DefineRoute.category"
        >
          <Icon name="filter" size={20} color={colors.primary} />
          <Text variant="subtitle" color="link" weight="medium" size={17}>{categoryLabel !== null ? `${copy.categoryChip}: ${categoryLabel}` : copy.categoryAny}</Text>
        </Pressable>
      </View>

      <View style={styles.messages} accessibilityLiveRegion="polite">
        {hasProblems ? <Banner kind="error" size="sm" message={copy.summaryFix} testID="DefineRoute.summary" /> : null}
        {submit.kind === "failed" ? <Banner kind="error" size="sm" title={copy.provinceCheckFailed} message={submit.message} actionLabel={copy.retry} onAction={() => void search()} testID="DefineRoute.failed" /> : null}
      </View>

      <TimePickerSheet
        visible={sheet === "arrival"}
        kind="arrival"
        value={form.arriveBy}
        onApply={(time) => {
          if (time !== null) patch({ arriveBy: time }, ["arriveBy", "returnAt"]);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
      <TimePickerSheet
        visible={sheet === "return"}
        kind="return"
        value={form.returnAt}
        onApply={(time) => {
          patch({ returnAt: time }, ["returnAt"]);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
      <DatePickerSheet
        visible={sheet === "date"}
        value={form.date}
        now={now}
        onApply={(date) => {
          patch({ date }, ["date", "arriveBy"]);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
      <OptionSheet<TripCategory | "any">
        visible={sheet === "category"}
        title={copy.categorySheetTitle}
        options={categoryOptions}
        selected={form.category ?? "any"}
        onSelect={(value) => {
          patch({ category: value === "any" ? null : value });
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="DefineRoute.categorySheet"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 14, gap: 8 },
  places: { paddingLeft: 44, paddingRight: 14, marginTop: 12 },
  markerOrigin: { position: "absolute", left: -30, top: 3, width: 22, alignItems: "center" },
  markerDestination: { position: "absolute", left: -33, top: 118, width: 28, alignItems: "center" },
  lineSolid: { position: "absolute", left: -20, top: 28, height: 78, borderLeftWidth: 2, borderColor: colors.primary },
  lineDashed: { position: "absolute", left: -20, top: 150, height: 40, borderLeftWidth: 2, borderStyle: "dashed", borderColor: colors.primary },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  dotCore: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.onPrimary },
  fields: { },
  originRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  originField: { flex: 1 },
  swap: { width: 46, height: 50, marginTop: 32, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border.default, backgroundColor: colors.bg.tint, alignItems: "center", justifyContent: "center" },
  destination: { marginTop: 14 },
  when: { paddingHorizontal: 14, marginTop: 18 },
  whenTitle: { flexDirection: "row", alignItems: "center", gap: 10 },
  times: { flexDirection: "row", gap: 12, marginTop: 14 },
  time: { flex: 1 },
  timeField: { marginTop: 8 },
  modes: { marginTop: 14 },
  daysLabel: { marginTop: 14 },
  days: { marginTop: 10 },
  fieldError: { marginTop: 6 },
  dateField: { marginTop: 14 },
  category: { marginTop: 10, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start" },
  messages: { paddingHorizontal: 14, marginTop: 6, gap: 8 },
  submit: { marginHorizontal: 14, height: 64 },
});
