import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { TripDetail, TripLeg, Weekday } from "@/api/types";
import { formatDateLong, formatTime, WEEKDAY_KEYS } from "@/i18n";
import { Icon, IconTile } from "@/icons";
import { requireAccount, useAppNavigation, useAppRoute, type AppScreenProps } from "@/navigation";
import { colors, radii } from "@/theme";
import { BottomSheet, Banner, Button, Checkbox, DayPills, EmptyState, LargeButton, OfflineBanner, Screen, ScreenHeader, Skeleton, Switch, Text } from "@/ui";
import { DatePickerSheet } from "../../browse/components/DatePickerSheet";
import { InfoSheet } from "../components/InfoSheet";
import { ProblemCard } from "../components/ProblemCard";
import { RouteBar } from "../components/RouteBar";
import { useTripDetail } from "../hooks/useTripDetail";
import { useWeeklyPreview } from "../hooks/useWeeklyPreview";
import { routeBar } from "../logic/reviewModel";
import { exceptionCandidates, exceptionsRowText, initialForm, isFormValid, listDates, MAX_WEEKS, MIN_WEEKS, setExceptions, setStartDate, setWeeks, summarizePreview, toWeeklyBody, toggleLeg, toggleWeekday, validateForm, type WeeklyForm } from "../logic/weekly";
import { requestStrings } from "../strings";

const copy = requestStrings.weekly;
const SCREEN_X = 14;

type Sheet = "leg-outbound" | "leg-return" | "start" | "exceptions" | "cancellation" | null;

/**
 * «Tu plaza semanal» (lámina 14): días de la semana, trayectos (ida/vuelta), inicio, semanas y excepciones. Cada cambio
 * consulta al servidor qué días tienen plaza (`POST …/weekly-requests/preview`) antes de crear nada. «Continuar» lleva a
 * «Revisa tu solicitud» con la selección.
 */
export function WeeklySeatScreen(_props: AppScreenProps<"WeeklySeat">): React.JSX.Element {
  const navigation = useAppNavigation();
  const { tripId, pickupPointId, dropoffStopSeq, criteria, pickup } = useAppRoute("WeeklySeat").params;
  const trip = useTripDetail(tripId);
  const now = useMemo(() => new Date(), []);

  const [form, setForm] = useState<WeeklyForm | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [showErrors, setShowErrors] = useState(false);

  const data = trip.data;
  const recurrence = data?.recurrence ?? null;
  const offered: Weekday[] = recurrence?.weekdays ?? [];
  const current = useMemo<WeeklyForm | null>(() => {
    if (form !== null) return form;
    if (recurrence === null) return null;
    return initialForm({ recurrence, preferredWeekdays: criteria?.mode === "weekly" ? criteria.weekdays : undefined, nowMs: now.getTime() });
  }, [form, recurrence, criteria, now]);

  const patch = useCallback((fn: (value: WeeklyForm) => WeeklyForm) => setForm((previous) => fn(previous ?? current ?? ({} as WeeklyForm))), [current]);

  const errors = current !== null ? validateForm(current, now.getTime()) : {};
  const valid = current !== null && isFormValid(errors);
  const body = useMemo(() => (current !== null && valid ? toWeeklyBody(current, { pickupPointId, ...(dropoffStopSeq !== undefined ? { dropoffStopSeq } : {}) }) : null), [current, valid, pickupPointId, dropoffStopSeq]);
  const preview = useWeeklyPreview(tripId, body, true);
  const summary = preview.data !== undefined ? summarizePreview(preview.data) : null;

  const close = useCallback(() => setSheet(null), []);

  const goToReview = useCallback(() => {
    if (current === null) return;
    setShowErrors(true);
    if (!valid) return;
    if (summary !== null && summary.nothingAvailable) return;
    if (summary !== null && summary.needsPartialConsent && !current.allowPartial) return;
    const params = {
      tripId,
      pickupPointId,
      ...(pickup !== undefined ? { pickup } : {}),
      ...(criteria !== undefined ? { criteria } : {}),
      ...(dropoffStopSeq !== undefined ? { dropoffStopSeq } : {}),
      weekly: {
        weekdays: current.weekdays,
        startDate: current.startDate,
        weeks: current.weeks,
        legs: current.legs,
        ...(current.exceptionDates.length > 0 ? { exceptionDates: current.exceptionDates } : {}),
        ...(current.allowPartial ? { allowPartial: true } : {}),
      },
    };
    if (!requireAccount({ name: "ReviewRequest", params })) return;
    navigation.navigate("ReviewRequest", params);
  }, [current, valid, summary, tripId, pickupPointId, pickup, criteria, dropoffStopSeq, navigation]);

  const requestOne = useCallback(() => {
    const params = { tripId, pickupPointId, ...(pickup !== undefined ? { pickup } : {}), ...(criteria !== undefined ? { criteria } : {}), ...(dropoffStopSeq !== undefined ? { dropoffStopSeq } : {}) };
    if (!requireAccount({ name: "ReviewRequest", params })) return;
    navigation.navigate("ReviewRequest", params);
  }, [tripId, pickupPointId, pickup, criteria, dropoffStopSeq, navigation]);

  const bar = data !== undefined ? routeBar(data) : null;
  const legTo = bar?.to ?? "";
  const returnOffered = recurrence?.returnLocal !== null && recurrence?.returnLocal !== undefined;

  const continueDisabled = current === null || preview.isLoading || (summary !== null && summary.nothingAvailable);

  return (
    <Screen
      testID="WeeklySeat"
      padded={false}
      header={<ScreenHeader title={copy.title} testID="WeeklySeat.header" />}
      footer={
        <View style={styles.footer}>
          <LargeButton size="compact" label={copy.continue} chevron onPress={goToReview} disabled={continueDisabled} loading={preview.isLoading && current !== null && valid} testID="WeeklySeat.continue" />
        </View>
      }
    >
      {trip.isOffline && data === undefined ? <OfflineBanner testID="WeeklySeat.offline" /> : null}
      <View style={styles.pad} accessibilityLiveRegion="polite">
        {trip.isLoading && data === undefined ? (
          <>
            <Skeleton height={56} />
            <Skeleton height={60} />
            <Skeleton height={100} />
            <Skeleton height={100} />
          </>
        ) : null}

        {trip.isError && data === undefined ? (
          <ProblemCard error={trip.error} offline={trip.isOffline} onRetry={() => void trip.refetch()} exitLabel={requestStrings.common.seeOtherTrips} onExit={() => navigation.navigate("MapHome", undefined)} testID="WeeklySeat.problem" />
        ) : null}

        {data !== undefined && recurrence === null ? (
          <EmptyState icon="calendar" title={copy.notRecurringTitle} message={copy.notRecurringMessage} actionLabel={copy.notRecurringAction} onAction={requestOne} testID="WeeklySeat.notRecurring" />
        ) : null}

        {data !== undefined && recurrence !== null && current !== null && bar !== null ? (
          <>
            <RouteBar from={bar.from} to={bar.to} category={bar.category} testID="WeeklySeat.route" />

            <Text variant="heading" color="strong" size={19.5} lineHeight={24} accessibilityRole="header" style={styles.h}>{copy.daysTitle}</Text>
            <DayPills
              shape="square"
              value={current.weekdays}
              disabledDays={WEEKDAY_KEYS.filter((day) => !offered.includes(day))}
              onChange={(days) => {
                const added = days.find((day) => !current.weekdays.includes(day));
                const removed = current.weekdays.find((day) => !days.includes(day));
                const day = added ?? removed;
                if (day !== undefined) patch((value) => toggleWeekday(value, day, offered));
              }}
              testID="WeeklySeat.days"
            />
            {showErrors && errors.weekdays !== undefined ? <Text variant="caption" color="error" accessibilityRole="alert">{errors.weekdays}</Text> : null}

            <LegRow
              leg="outbound"
              title={copy.outbound}
              time={formatTime(recurrence.outboundLocal)}
              text={copy.legFrom(copy.pickupPoint(pickup?.code ?? null), legTo)}
              selected={current.legs.includes("outbound")}
              onPress={() => setSheet("leg-outbound")}
              testID="WeeklySeat.leg.outbound"
            />
            {returnOffered && recurrence.returnLocal !== null ? (
              <LegRow
                leg="return"
                title={copy.returnLeg}
                time={formatTime(recurrence.returnLocal)}
                text={copy.legFrom(legTo, copy.pickupPoint(pickup?.code ?? null))}
                selected={current.legs.includes("return")}
                onPress={() => setSheet("leg-return")}
                testID="WeeklySeat.leg.return"
              />
            ) : null}
            {showErrors && errors.legs !== undefined ? <Text variant="caption" color="error" accessibilityRole="alert">{errors.legs}</Text> : null}

            <View style={styles.divider} />
            <Text variant="heading" color="strong" size={19.5} lineHeight={24} accessibilityRole="header" style={styles.h}>{copy.startTitle}</Text>
            <ValueRow icon="calendar" label={formatDateLong(current.startDate)} a11y={copy.startEdit(formatDateLong(current.startDate))} onPress={() => setSheet("start")} testID="WeeklySeat.start" error={showErrors ? errors.startDate : undefined} />

            <View style={styles.weeks} testID="WeeklySeat.weeks">
              <Text variant="body" color="strong" size={17} style={styles.weeksLabel}>{copy.weeksTitle}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={copy.weeksLess} disabled={current.weeks <= MIN_WEEKS} onPress={() => patch((value) => setWeeks(value, value.weeks - 1))} style={[styles.step, current.weeks <= MIN_WEEKS ? styles.stepOff : null]} testID="WeeklySeat.weeks.less">
                <Text variant="title" color="link" size={24}>−</Text>
              </Pressable>
              <Text variant="rowTitle" color="heading" size={17} align="center" style={styles.weeksValue}>{copy.weeksValue(current.weeks)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={copy.weeksMore} disabled={current.weeks >= MAX_WEEKS} onPress={() => patch((value) => setWeeks(value, value.weeks + 1))} style={[styles.step, current.weeks >= MAX_WEEKS ? styles.stepOff : null]} testID="WeeklySeat.weeks.more">
                <Text variant="title" color="link" size={24}>+</Text>
              </Pressable>
            </View>

            <Text variant="heading" color="strong" size={19.5} lineHeight={24} accessibilityRole="header" style={styles.h}>{copy.exceptionsTitle}</Text>
            <ValueRow icon="calendar" label={exceptionsRowText(current.exceptionDates)} a11y={copy.exceptionsEdit} onPress={() => setSheet("exceptions")} testID="WeeklySeat.exceptions" />

            {errors.occurrences !== undefined ? <Banner kind="warning" size="sm" message={errors.occurrences} testID="WeeklySeat.noOccurrences" /> : null}
            {valid && preview.isLoading && preview.data === undefined ? <Text variant="caption" color="muted" align="center">{copy.checking}</Text> : null}
            {valid && preview.isError && preview.data === undefined ? (
              <ProblemCard error={preview.error} offline={preview.isOffline} onRetry={() => void preview.refetch()} testID="WeeklySeat.previewProblem" />
            ) : null}

            {summary !== null && summary.nothingAvailable ? <Banner kind="error" size="sm" title={copy.noneTitle} message={copy.noneMessage} testID="WeeklySeat.none" /> : null}
            {summary !== null && summary.needsPartialConsent ? (
              <View style={styles.partial} testID="WeeklySeat.partial">
                <Banner kind="warning" size="sm" title={copy.partialTitle(summary.fullDates.length)} message={copy.partialMessage(listDates(summary.fullDates))} />
                <View style={styles.partialRow}>
                  <View style={styles.partialText}>
                    <Text variant="rowTitle" color="strong" size={16.5}>{copy.partialSwitch}</Text>
                    <Text variant="caption" color="muted">{copy.partialSwitchHint}</Text>
                  </View>
                  <Switch value={current.allowPartial} onValueChange={(value) => patch((state) => ({ ...state, allowPartial: value }))} accessibilityLabel={copy.partialSwitch} testID="WeeklySeat.partial.switch" />
                </View>
              </View>
            ) : null}
            {summary !== null && !summary.nothingAvailable && !summary.needsPartialConsent ? (
              <View style={styles.ok} testID="WeeklySeat.ok">
                <IconTile name="checkCircle" tone="green" size={34} iconSize={22} />
                <Text variant="body" color="strong" size={17}>{copy.banner}</Text>
              </View>
            ) : null}

            <ValueRow icon="document" label={copy.cancellation} a11y={copy.cancellation} onPress={() => setSheet("cancellation")} testID="WeeklySeat.cancellation" />
          </>
        ) : null}
      </View>

      {current !== null ? (
        <>
          <LegSheet
            visible={sheet === "leg-outbound" || sheet === "leg-return"}
            leg={sheet === "leg-return" ? "return" : "outbound"}
            form={current}
            trip={data}
            offeredReturn={returnOffered}
            onToggle={(leg) => patch((value) => toggleLeg(value, leg, returnOffered))}
            onClose={close}
          />
          <DatePickerSheet
            visible={sheet === "start"}
            value={current.startDate}
            now={now}
            onApply={(date) => {
              patch((value) => setStartDate(value, date));
              close();
            }}
            onClose={close}
          />
          <ExceptionsSheet visible={sheet === "exceptions"} form={current} nowMs={now.getTime()} onSave={(dates) => { patch((value) => setExceptions(value, dates)); close(); }} onClose={close} />
        </>
      ) : null}
      <InfoSheet visible={sheet === "cancellation"} title={copy.cancellationTitle} message={copy.cancellationMessage} closeLabel={copy.cancellationClose} onClose={close} testID="WeeklySeat.cancellationSheet" />
    </Screen>
  );
}

function LegRow({ leg, title, time, text, selected, onPress, testID }: { leg: TripLeg; title: string; time: string; text: string; selected: boolean; onPress: () => void; testID: string }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={copy.legSheetTitle(`${title}, ${time}. ${text}`)} accessibilityState={{ selected }} onPress={onPress} style={[styles.leg, !selected ? styles.legOff : null]} testID={testID}>
      <View style={[styles.legIcon, !selected ? styles.legIconOff : null]}>
        <Icon name={leg === "outbound" ? "arrowRight" : "arrowLeft"} size={26} color={colors.onPrimary} />
      </View>
      <View style={styles.legText}>
        <Text variant="rowTitle" color="heading" size={19} lineHeight={23}>{title}</Text>
        <Text variant="body" color="body" size={16} lineHeight={21}>{text}</Text>
      </View>
      <Text variant="rowTitle" color="link" size={17.5} weight="bold" style={styles.legTime}>{time}</Text>
      <Icon name="chevronRight" size={20} color={colors.primary} />
    </Pressable>
  );
}

function ValueRow({ icon, label, a11y, onPress, testID, error }: { icon: "calendar" | "document"; label: string; a11y: string; onPress: () => void; testID: string; error?: string | undefined }): React.JSX.Element {
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={[styles.value, error !== undefined ? styles.valueError : null]} testID={testID}>
        <IconTile name={icon} tone="blue" size={40} iconSize={24} />
        <Text variant="body" color="strong" size={17} style={styles.valueText} numberOfLines={2}>{label}</Text>
        <Icon name="chevronRight" size={22} color={colors.primary} />
      </Pressable>
      {error !== undefined ? <Text variant="caption" color="error" accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

function LegSheet({ visible, leg, form, trip, offeredReturn, onToggle, onClose }: { visible: boolean; leg: TripLeg; form: WeeklyForm; trip: TripDetail | undefined; offeredReturn: boolean; onToggle: (leg: TripLeg) => void; onClose: () => void }): React.JSX.Element {
  const label = leg === "outbound" ? copy.outbound : copy.returnLeg;
  const included = form.legs.includes(leg);
  const onlyOne = included && form.legs.length === 1;
  const unavailable = leg === "return" && !offeredReturn;
  const time = leg === "outbound" ? trip?.recurrence?.outboundLocal : trip?.recurrence?.returnLocal;
  return (
    <BottomSheet visible={visible} onClose={onClose} title={copy.legSheetTitle(label)} testID="WeeklySeat.legSheet" footer={<Button label={requestStrings.common.close} chevron={false} variant="outline" onPress={onClose} testID="WeeklySeat.legSheet.close" />}>
      <View style={styles.legSheet}>
        {time !== undefined && time !== null ? <Text variant="body" color="body" size={17}>{leg === "outbound" ? copy.legSheetBoards(formatTime(time)) : `${copy.legSheetBoards(formatTime(time))}`}</Text> : null}
        <View style={styles.partialRow}>
          <Text variant="rowTitle" color="strong" size={17} style={styles.partialText}>{copy.legSheetInclude}</Text>
          <Switch value={included} onValueChange={() => onToggle(leg)} disabled={onlyOne || unavailable} accessibilityLabel={copy.legSheetInclude} testID="WeeklySeat.legSheet.switch" />
        </View>
        {onlyOne ? <Text variant="caption" color="muted">{copy.legSheetKeepOne}</Text> : null}
        {unavailable ? <Text variant="caption" color="muted">{copy.legSheetNoReturn}</Text> : null}
      </View>
    </BottomSheet>
  );
}

function ExceptionsSheet({ visible, form, nowMs, onSave, onClose }: { visible: boolean; form: WeeklyForm; nowMs: number; onSave: (dates: string[]) => void; onClose: () => void }): React.JSX.Element {
  const [picked, setPicked] = useState<string[]>(form.exceptionDates);
  React.useEffect(() => {
    if (visible) setPicked(form.exceptionDates);
  }, [visible, form.exceptionDates]);
  const candidates = exceptionCandidates(form, nowMs);
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={copy.pickerExceptionsTitle}
      subtitle={copy.pickerExceptionsHint}
      testID="WeeklySeat.exceptionsSheet"
      footer={
        <View style={styles.sheetFooter}>
          <Button label={copy.pickerExceptionsSave} chevron={false} onPress={() => onSave(picked)} testID="WeeklySeat.exceptionsSheet.save" />
          {picked.length > 0 ? <Button label={copy.pickerExceptionsClear} variant="ghost" chevron={false} onPress={() => setPicked([])} testID="WeeklySeat.exceptionsSheet.clear" /> : null}
        </View>
      }
    >
      {candidates.length === 0 ? <Text variant="body" color="muted">{copy.pickerExceptionsEmpty}</Text> : null}
      {candidates.map((candidate) => (
        <Checkbox
          key={candidate.date}
          checked={picked.includes(candidate.date)}
          onChange={(checked) => setPicked((previous) => (checked ? [...previous, candidate.date].sort() : previous.filter((date) => date !== candidate.date)))}
          label={candidate.label}
          testID={`WeeklySeat.exceptionsSheet.${candidate.date}`}
          style={styles.excRow}
        />
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: SCREEN_X, paddingTop: 4, gap: 10, paddingBottom: 12 },
  h: { marginTop: 4 },
  footer: { paddingHorizontal: SCREEN_X },
  divider: { height: 1, backgroundColor: colors.border.soft, marginTop: 2 },
  leg: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.bg.tint, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border.soft, padding: 12 },
  legOff: { opacity: 0.6 },
  legIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  legIconOff: { backgroundColor: colors.daypill.mutedText },
  legText: { flex: 1, gap: 2 },
  legTime: { alignSelf: "flex-start" },
  value: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.bg.tint, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border.soft, padding: 8, minHeight: 56 },
  valueError: { borderColor: colors.error.solid },
  valueText: { flex: 1 },
  weeks: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  weeksLabel: { flex: 1 },
  weeksValue: { minWidth: 88 },
  step: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bg.tint, borderWidth: 1, borderColor: colors.border.soft, alignItems: "center", justifyContent: "center" },
  stepOff: { opacity: 0.4 },
  ok: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.success.bg, borderRadius: radii.lg, padding: 8 },
  partial: { gap: 8 },
  partialRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  partialText: { flex: 1 },
  legSheet: { gap: 12 },
  sheetFooter: { gap: 4 },
  excRow: { paddingVertical: 8 },
});
