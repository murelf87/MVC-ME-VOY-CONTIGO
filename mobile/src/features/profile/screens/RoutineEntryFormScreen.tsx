/**
 * Fila de rutina (sin lámina; se diseña con la 31 al lado). Días (varios al crear; el día no cambia al editar), hora de
 * salida, «Desde» y «Hasta» (destinos guardados, con «Intercambiar») y «Rutina activa». Necesita al menos dos destinos.
 * Valida en español y avisa de filas repetidas antes de enviar (el servidor también responde 409 `ROUTINE_ENTRY_EXISTS`).
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { Weekday } from "@/api/types";
import { TimePickerSheet } from "@/features/search/browse/components/TimePickerSheet";
import { weekdayLabel } from "@/i18n";
import { Icon } from "@/icons";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { Banner, Button, ConfirmDialog, DayPills, EmptyState, OptionSheet, Screen, ScreenHeader, Switch, Text, showToast } from "@/ui";
import { ListSkeleton, LoadFailure } from "../components/ScreenStates";
import { useCreateRoutineEntries, useDeleteRoutineEntry, useRoutine, useUpdateRoutineEntry } from "../hooks/useRoutine";
import { kindIcon } from "../model/favorites";
import { canCreateEntries, clashingWeekdays, hasEntryErrors, placeChoices, validateEntryDraft, weekdayNames, type EntryDraft } from "../model/routine";
import { profileStrings } from "../strings";

const copy = profileStrings.routineForm;
const SIDE = 14;

type Picker = "from" | "to" | null;

export function RoutineEntryFormScreen({ navigation, route }: AppScreenProps<"RoutineEntryForm">): React.JSX.Element {
  const entryId = route.params?.entryId;
  const routine = useRoutine();
  const create = useCreateRoutineEntries();
  const update = useUpdateRoutineEntry();
  const remove = useDeleteRoutineEntry();

  const original = entryId === undefined ? undefined : routine.data?.entries.find((e) => e.id === entryId);
  const [days, setDays] = React.useState<Weekday[]>(["mon", "tue", "wed", "thu", "fri"]);
  const [time, setTime] = React.useState("07:30");
  const [fromId, setFromId] = React.useState<string | null>(null);
  const [toId, setToId] = React.useState<string | null>(null);
  const [enabled, setEnabled] = React.useState(true);
  const [picker, setPicker] = React.useState<Picker>(null);
  const [timeOpen, setTimeOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [tried, setTried] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(entryId === undefined);

  React.useEffect(() => {
    if (hydrated || original === undefined) return;
    setDays([original.weekday]);
    setTime(original.time);
    setFromId(original.fromPlace.id);
    setToId(original.toPlace.id);
    setEnabled(original.enabled);
    setHydrated(true);
  }, [hydrated, original]);

  const header = <ScreenHeader title={entryId === undefined ? copy.titleNew : copy.titleEdit} testID="RoutineEntryForm.header" />;
  const data = routine.data;

  if (data === undefined) {
    return (
      <Screen testID="RoutineEntryForm" header={header} padded={false}>
        {routine.error ? <LoadFailure testID="RoutineEntryForm.error" title={profileStrings.favorites.loadErrorTitle} error={routine.error} onRetry={() => void routine.refetch()} /> : <ListSkeleton testID="RoutineEntryForm.loading" count={3} />}
      </Screen>
    );
  }
  if (entryId !== undefined && !hydrated) {
    return (
      <Screen testID="RoutineEntryForm" header={header}>
        <EmptyState testID="RoutineEntryForm.missing" icon="calendar" title={copy.missingTitle} message={copy.missingMessage} actionLabel={profileStrings.common.close} onAction={() => navigation.goBack()} variant="plain" />
      </Screen>
    );
  }
  if (!canCreateEntries(data.places)) {
    return (
      <Screen testID="RoutineEntryForm" header={header}>
        <EmptyState testID="RoutineEntryForm.needPlaces" icon="pin" title={copy.needPlacesTitle} message={copy.needPlacesMessage} actionLabel={copy.needPlacesAction} onAction={() => navigation.replace("FavoriteForm")} variant="plain" />
      </Screen>
    );
  }

  const choices = placeChoices(data.places);
  const nameOf = (id: string | null): string | null => choices.find((c) => c.id === id)?.label ?? null;
  const draft: EntryDraft = { weekdays: days, time, fromPlaceId: fromId, toPlaceId: toId, enabled };
  const errors = tried ? validateEntryDraft(draft) : {};
  const clash = clashingWeekdays(data.entries, draft, entryId);
  const pending = create.isPending || update.isPending || remove.isPending;
  const failure = create.error ?? update.error;

  const save = async (): Promise<void> => {
    setTried(true);
    if (hasEntryErrors(validateEntryDraft(draft)) || fromId === null || toId === null) return;
    if (clash.length > 0) return;
    if (original === undefined) {
      const saved = await create.mutate({ weekdays: days, time, fromPlaceId: fromId, toPlaceId: toId, enabled });
      if (saved) {
        showToast({ kind: "success", message: copy.saved });
        navigation.goBack();
      }
      return;
    }
    const saved = await update.mutate({ id: original.id, body: { time, fromPlaceId: fromId, toPlaceId: toId, enabled } });
    if (saved) {
      showToast({ kind: "success", message: copy.updated });
      navigation.goBack();
    }
  };

  const doDelete = async (): Promise<void> => {
    if (original === undefined) return;
    try {
      await remove.mutateAsync(original.id);
      setDeleteOpen(false);
      showToast({ kind: "success", message: profileStrings.favorites.delete.entryDone });
      navigation.goBack();
    } catch (error) {
      setDeleteOpen(false);
      showToast({ kind: "error", message: describeError(error).message });
    }
  };

  const placeButton = (which: "from" | "to", label: string, id: string | null, error: string | undefined): React.JSX.Element => (
    <>
      <Text variant="titleSm" color="heading" size={17} style={styles.labelGap}>{label}</Text>
      <Pressable testID={`RoutineEntryForm.${which}`} accessibilityRole="button" accessibilityLabel={`${label}: ${nameOf(id) ?? copy.placePlaceholder}`} disabled={pending} onPress={() => setPicker(which)} style={[styles.field, error !== undefined ? styles.fieldError : null]}>
        <Text variant="body" color={id === null ? "muted" : "strong"} size={17} style={styles.flex}>{nameOf(id) ?? copy.placePlaceholder}</Text>
        <Icon name="chevronDown" size={20} color={colors.primary} />
      </Pressable>
      {error !== undefined ? <Text variant="body" color="error" size={14} style={styles.helper} testID={`RoutineEntryForm.${which}Error`}>{error}</Text> : null}
    </>
  );

  return (
    <Screen testID="RoutineEntryForm" header={header} paddingX={SIDE}>
      <View style={styles.body}>
        <Text variant="titleSm" color="heading" size={17} style={styles.label}>{entryId === undefined ? copy.days : copy.day}</Text>
        {entryId === undefined ? (
          <>
            <DayPills testID="RoutineEntryForm.days" value={days} onChange={setDays} />
            <Text variant="body" color={errors.weekdays !== undefined ? "error" : "muted"} size={14} style={styles.helper} testID={errors.weekdays !== undefined ? "RoutineEntryForm.daysError" : undefined}>{errors.weekdays ?? copy.daysHelper}</Text>
          </>
        ) : (
          <Text variant="body" color="strong" size={17} testID="RoutineEntryForm.day">{weekdayLabel(days[0] ?? "mon", "long")}</Text>
        )}

        <Text variant="titleSm" color="heading" size={17} style={styles.labelGap}>{copy.time}</Text>
        <Pressable testID="RoutineEntryForm.time" accessibilityRole="button" accessibilityLabel={`${copy.time}: ${time}`} disabled={pending} onPress={() => setTimeOpen(true)} style={[styles.field, errors.time !== undefined ? styles.fieldError : null]}>
          <Icon name="clock" size={22} color={colors.primary} />
          <Text variant="body" color="strong" size={17} style={styles.flex}>{time}</Text>
          <Icon name="chevronDown" size={20} color={colors.primary} />
        </Pressable>
        {errors.time !== undefined ? <Text variant="body" color="error" size={14} style={styles.helper}>{errors.time}</Text> : null}

        {placeButton("from", copy.from, fromId, errors.fromPlaceId)}
        <Pressable testID="RoutineEntryForm.swap" accessibilityRole="button" accessibilityLabel={copy.swap} hitSlop={8} disabled={pending} onPress={() => { setFromId(toId); setToId(fromId); }} style={styles.swap}>
          <Icon name="swapVertical" size={22} color={colors.primary} />
          <Text variant="rowTextStrong" color="link" size={15}>{copy.swap}</Text>
        </Pressable>
        {placeButton("to", copy.to, toId, errors.toPlaceId)}

        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Text variant="titleSm" color="heading" size={17}>{copy.enabled}</Text>
            <Text variant="body" color="muted" size={14.5}>{copy.enabledHelper}</Text>
          </View>
          <Switch testID="RoutineEntryForm.enabled" value={enabled} onValueChange={setEnabled} tone="blue" disabled={pending} accessibilityLabel={copy.enabled} />
        </View>

        {clash.length > 0 ? <Banner testID="RoutineEntryForm.clash" kind="warning" size="sm" title={copy.clash(weekdayNames(clash))} style={styles.gapTop} /> : null}
        {failure ? <Banner testID="RoutineEntryForm.submitError" kind="error" title={describeError(failure).message} style={styles.gapTop} /> : null}

        <Button testID="RoutineEntryForm.save" label={entryId === undefined ? copy.save : copy.saveEdit} loading={create.isPending || update.isPending} disabled={pending || clash.length > 0} onPress={() => void save()} style={styles.gapTopLg} />
        {entryId !== undefined ? <Button testID="RoutineEntryForm.delete" label={profileStrings.favorites.delete.confirm} variant="outline" leadingIcon="trash" chevron={false} disabled={pending} onPress={() => setDeleteOpen(true)} style={styles.gapTop} /> : null}
      </View>

      <OptionSheet<string>
        testID="RoutineEntryForm.placeSheet"
        visible={picker !== null}
        title={picker === "from" ? copy.from : copy.to}
        options={choices.map((c) => ({ value: c.id, label: c.label, icon: kindIcon(c.icon) }))}
        selected={(picker === "from" ? fromId : toId) ?? undefined}
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          if (picker === "from") setFromId(id);
          else setToId(id);
          setPicker(null);
        }}
      />
      <TimePickerSheet visible={timeOpen} kind="arrival" value={time} title={copy.timeSheetTitle} subtitle="" onApply={(next) => { if (next !== null) setTime(next); setTimeOpen(false); }} onClose={() => setTimeOpen(false)} />
      <ConfirmDialog
        testID="RoutineEntryForm.deleteDialog"
        visible={deleteOpen}
        destructive
        loading={remove.isPending}
        title={profileStrings.favorites.delete.entryTitle}
        message={original === undefined ? "" : profileStrings.favorites.delete.entryMessage(weekdayLabel(original.weekday, "long"), original.time)}
        confirmLabel={profileStrings.favorites.delete.confirm}
        cancelLabel={profileStrings.common.cancel}
        onConfirm={() => void doDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { paddingTop: 8, paddingBottom: 28 },
  label: { marginBottom: 8 },
  labelGap: { marginTop: 20, marginBottom: 8 },
  gapTop: { marginTop: 12 },
  gapTopLg: { marginTop: 24 },
  helper: { marginTop: 6 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border.soft, backgroundColor: colors.bg.tint },
  fieldError: { borderColor: colors.error.text },
  swap: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 12 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 22 },
});
