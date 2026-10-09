/**
 * 31 · Favoritos y rutina. «Mis destinos» (Trabajo, Campus, Casa… con ⋮ para editar o eliminar y «Añadir»), «Mi rutina
 * semanal» (casilla para activar cada fila, ⋮ para editar o eliminar, «Editar» para añadir filas), «Suspender próxima
 * semana» (retira solo las solicitudes aún pendientes) y «Plaza disponible (semanal)» (preferencia del conductor).
 * Estados: cargando · error · sin conexión (copia guardada) · sin destinos · sin rutina · suspendida.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { describeError, isApiError } from "@/api";
import type { FavoritePlace, RoutineEntry, RoutineResponse } from "@/api/types";
import { useIsOnline } from "@/hooks";
import { Icon } from "@/icons";
import { IconTile } from "@/icons/IconTile";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { BottomSheet, Button, Checkbox, ConfirmDialog, EmptyState, OptionSheet, Screen, ScreenHeader, Switch, Text, showToast } from "@/ui";
import { weekdayLabel } from "@/i18n";
import { ListSkeleton, LoadFailure, OfflineNotice } from "../components/ScreenStates";
import { SectionTitle } from "../components/SectionTitle";
import { useDeleteFavorite, useFavorites } from "../hooks/useFavorites";
import { useDeleteRoutineEntry, useResumeWeek, useRoutine, useRoutineToggle, useSaveWeeklyOffer, useSuspendWeek } from "../hooks/useRoutine";
import { useRoleSwitch } from "../hooks/useRoleSwitch";
import { canAddFavorite, kindIcon } from "../model/favorites";
import { entryRouteText, offerLine, sortEntries, weekRangeLabel } from "../model/routine";
import { profileStrings } from "../strings";

const copy = profileStrings.favorites;
const SIDE = 14;
const MAX_SEATS = 8;

type Target = { type: "favorite"; item: FavoritePlace } | { type: "entry"; item: RoutineEntry };

export function FavoritesRoutineScreen({ navigation }: AppScreenProps<"FavoritesRoutine">): React.JSX.Element {
  const routine = useRoutine();
  const favorites = useFavorites();
  const online = useIsOnline();
  const toggle = useRoutineToggle();
  const deleteFavorite = useDeleteFavorite();
  const deleteEntry = useDeleteRoutineEntry();
  const suspend = useSuspendWeek();
  const resume = useResumeWeek();
  const saveOffer = useSaveWeeklyOffer();
  const roles = useRoleSwitch();

  const [editing, setEditing] = React.useState(false);
  const [menu, setMenu] = React.useState<Target | null>(null);
  const [confirm, setConfirm] = React.useState<Target | null>(null);
  const [inUse, setInUse] = React.useState(false);
  const [suspendOpen, setSuspendOpen] = React.useState(false);
  const [offerOpen, setOfferOpen] = React.useState(false);
  const [offerEnabled, setOfferEnabled] = React.useState(false);
  const [offerSeats, setOfferSeats] = React.useState(1);

  const data: RoutineResponse | undefined = routine.data;
  const places = data?.places ?? favorites.data?.items ?? [];
  const entries = data === undefined ? [] : sortEntries(data.entries);
  const header = <ScreenHeader title={copy.title} testID="FavoritesRoutine.header" />;

  const refetchAll = (): void => {
    void routine.refetch();
    void favorites.refetch();
  };

  if (data === undefined) {
    return (
      <Screen testID="FavoritesRoutine" header={header} padded={false}>
        {routine.error ? <LoadFailure testID="FavoritesRoutine.error" title={copy.loadErrorTitle} error={routine.error} onRetry={refetchAll} /> : <ListSkeleton testID="FavoritesRoutine.loading" count={4} />}
      </Screen>
    );
  }

  const openOffer = (): void => {
    roles.ensureRole("driver", "offer", () => {
      setOfferEnabled(data.weeklyOffer.enabled);
      setOfferSeats(data.weeklyOffer.seats);
      setOfferOpen(true);
    });
  };

  const doDelete = async (): Promise<void> => {
    if (confirm === null) return;
    try {
      if (confirm.type === "favorite") {
        await deleteFavorite.mutateAsync(confirm.item.id);
        showToast({ kind: "success", message: copy.delete.favoriteDone });
      } else {
        await deleteEntry.mutateAsync(confirm.item.id);
        showToast({ kind: "success", message: copy.delete.entryDone });
      }
      setConfirm(null);
    } catch (error) {
      setConfirm(null);
      if (isApiError(error) && error.code === "FAVORITE_IN_USE") setInUse(true);
      else showToast({ kind: "error", message: describeError(error).message });
    }
  };

  const doSuspend = async (): Promise<void> => {
    const result = await suspend.mutate({ weekStart: data.nextWeek.weekStart });
    setSuspendOpen(false);
    if (result) {
      showToast({
        kind: "success",
        message: copy.suspend.done(result.withdrawnRequests, result.keptRequests),
        ...(result.keptRequests > 0 ? { actionLabel: copy.suspend.keptAction, onAction: () => navigation.navigate("MyTrips", { tab: "upcoming" }) } : {}),
        durationMs: result.keptRequests > 0 ? 8000 : 5000,
      });
    } else if (suspend.error) showToast({ kind: "error", message: describeError(suspend.error).message });
  };

  const doResume = async (): Promise<void> => {
    try {
      await resume.mutateAsync(data.nextWeek.weekStart);
      showToast({ kind: "success", message: copy.suspend.resumeDone });
    } catch (error) {
      showToast({ kind: "error", message: describeError(error).message });
    }
  };

  const doSaveOffer = async (): Promise<void> => {
    const saved = await saveOffer.mutate({ enabled: offerEnabled, seats: offerSeats });
    if (saved) {
      setOfferOpen(false);
      showToast({ kind: "success", message: copy.offer.saved });
      void routine.refetch();
    } else if (saveOffer.error) showToast({ kind: "error", message: describeError(saveOffer.error).message });
  };

  const publish = (): void => {
    const prefill = data.weeklyOffer.prefill;
    setOfferOpen(false);
    if (prefill === null) {
      navigation.navigate("PublishRoute");
      return;
    }
    navigation.navigate("PublishRoute", {
      origin: { label: prefill.origin.label, latitude: prefill.origin.lat, longitude: prefill.origin.lng },
      destination: { label: prefill.destination.label, latitude: prefill.destination.lat, longitude: prefill.destination.lng },
    });
  };

  const needPlaces = places.length < 2;
  const range = weekRangeLabel(data.nextWeek.weekStart, data.nextWeek.weekEnd);
  const suspended = data.nextWeek.suspended;
  const canAdd = canAddFavorite(places.length);

  const addFavorite = (): void => {
    if (!canAdd) {
      showToast({ kind: "info", message: profileStrings.favoriteForm.limit });
      return;
    }
    navigation.navigate("FavoriteForm");
  };

  const menuOptions = menu === null ? [] : [{ value: "edit", label: menu.type === "favorite" ? profileStrings.common.edit : copy.routineEdit, icon: "edit" as const }, { value: "delete", label: copy.delete.confirm, icon: "trash" as const, destructive: true }];

  return (
    <Screen testID="FavoritesRoutine" header={header} padded={false} refreshing={routine.isRefreshing} onRefresh={refetchAll}>
      <View style={styles.body}>
        {routine.isOffline || !online ? <OfflineNotice testID="FavoritesRoutine.offline" detail={copy.stale} onRetry={refetchAll} style={styles.gapBottom} /> : null}

        <SectionTitle
          size={22}
          title={copy.destinationsHeading}
          testID="FavoritesRoutine.destinationsTitle"
          right={
            <Pressable testID="FavoritesRoutine.add" accessibilityRole="button" accessibilityLabel={copy.addA11y} onPress={addFavorite} style={styles.addPill}>
              <Icon name="add" size={24} color={colors.primary} />
              <Text variant="rowTextStrong" color="link" size={16}>{copy.add}</Text>
            </Pressable>
          }
        />
        {places.length === 0 ? (
          <EmptyState testID="FavoritesRoutine.emptyPlaces" icon="pin" title={copy.emptyTitle} message={copy.emptyMessage} actionLabel={copy.emptyAction} onAction={addFavorite} variant="plain" />
        ) : (
          <View testID="FavoritesRoutine.places">
            {places.map((place) => (
              <View key={place.id} style={styles.card} testID={`FavoritesRoutine.place.${place.id}`}>
                <IconTile name={kindIcon(place.kind)} tone="white" size={46} iconSize={28} />
                <View style={styles.flex}>
                  <Text variant="titleSm" color="heading" size={19} lineHeight={23} numberOfLines={1}>{place.name}</Text>
                  <Text variant="body" color="body" size={16.5} lineHeight={21} numberOfLines={1}>{place.address}</Text>
                </View>
                <Pressable testID={`FavoritesRoutine.placeMenu.${place.id}`} accessibilityRole="button" accessibilityLabel={`${copy.rowMenu}: ${place.name}`} hitSlop={10} onPress={() => setMenu({ type: "favorite", item: place })} style={styles.dots}>
                  <Icon name="more" size={26} color={colors.primary} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <SectionTitle
          size={22}
          title={copy.routineHeading}
          style={styles.sectionGap}
          testID="FavoritesRoutine.routineTitle"
          right={
            !needPlaces ? (
              <Pressable testID="FavoritesRoutine.editRoutine" accessibilityRole="button" accessibilityLabel={copy.routineEditA11y} hitSlop={8} onPress={() => setEditing((v) => !v)}>
                <Text variant="rowTextStrong" color="link" size={17}>{editing ? copy.routineDone : copy.routineEdit}</Text>
              </Pressable>
            ) : null
          }
        />
        {needPlaces ? (
          <EmptyState testID="FavoritesRoutine.needPlaces" icon="calendar" title={copy.routineNeedPlacesTitle} message={copy.routineNeedPlacesMessage} actionLabel={copy.routineNeedPlacesAction} onAction={addFavorite} variant="plain" />
        ) : entries.length === 0 ? (
          <EmptyState testID="FavoritesRoutine.emptyRoutine" icon="calendar" title={copy.routineEmptyTitle} message={copy.routineEmptyMessage} actionLabel={copy.routineEmptyAction} onAction={() => navigation.navigate("RoutineEntryForm")} variant="plain" />
        ) : (
          <View style={styles.routine} testID="FavoritesRoutine.entries">
            {entries.map((entry) => {
              const enabled = toggle.isEnabled(entry);
              const day = weekdayLabel(entry.weekday, "short");
              return (
                <View key={entry.id} style={styles.entryRow} testID={`FavoritesRoutine.entry.${entry.id}`}>
                  <Checkbox
                    testID={`FavoritesRoutine.entryCheck.${entry.id}`}
                    checked={enabled}
                    disabled={toggle.isPending(entry.id)}
                    onChange={() => toggle.toggle(entry)}
                    accessibilityLabel={copy.rowA11y(weekdayLabel(entry.weekday, "long"), entry.time, entry.fromPlace.name, entry.toPlace.name, enabled)}
                  />
                  <Text variant="body" color="heading" size={17} style={styles.day}>{day}</Text>
                  <Text variant="body" color="body" size={17} style={styles.time}>{entry.time}</Text>
                  <Text variant="body" color="body" size={17} numberOfLines={1} style={styles.flex}>{entryRouteText(entry)}</Text>
                  <Pressable testID={`FavoritesRoutine.entryMenu.${entry.id}`} accessibilityRole="button" accessibilityLabel={`${copy.rowMenu2}: ${weekdayLabel(entry.weekday, "long")} ${entry.time}`} hitSlop={10} onPress={() => setMenu({ type: "entry", item: entry })} style={styles.dots}>
                    <Icon name="more" size={24} color={colors.primary} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
        {editing && !needPlaces ? <Button testID="FavoritesRoutine.addEntry" label={copy.routineAdd} variant="outline" leadingIcon="add" chevron={false} onPress={() => navigation.navigate("RoutineEntryForm")} style={styles.gapTop} /> : null}

        {!needPlaces && entries.length > 0 ? (
          suspended ? (
            <View style={styles.suspendCard} testID="FavoritesRoutine.suspended">
              <IconTile name="pause" tone="blue" size={46} iconSize={30} />
              <View style={styles.flex}>
                <Text variant="titleSm" color="heading" size={18}>{copy.suspend.resumedTitle}</Text>
                <Text variant="body" color="body" size={15.5}>{copy.suspend.resumedMessage(range)}</Text>
              </View>
              <Button testID="FavoritesRoutine.resume" label={copy.suspend.resume} variant="outline" size="sm" inline chevron={false} loading={resume.isPending} accessibilityLabel={copy.suspend.resumeA11y} onPress={() => void doResume()} />
            </View>
          ) : (
            <Pressable testID="FavoritesRoutine.suspend" accessibilityRole="button" accessibilityLabel={`${copy.suspend.title}, ${range}`} onPress={() => setSuspendOpen(true)} style={({ pressed }) => [styles.suspendCard, pressed ? styles.pressed : null]}>
              <IconTile name="pause" tone="blue" size={46} iconSize={30} />
              <Text variant="titleSm" color="heading" size={19} style={styles.flex}>{copy.suspend.title}</Text>
              <Icon name="chevronRight" size={22} color={colors.primary} />
            </Pressable>
          )
        ) : null}

        <Pressable testID="FavoritesRoutine.offer" accessibilityRole="button" accessibilityLabel={`${copy.offer.title}. ${offerLine(data.weeklyOffer)}`} onPress={openOffer} style={({ pressed }) => [styles.offerCard, pressed ? styles.pressed : null]}>
          <IconTile name="car" tone="gray" size={54} iconSize={34} />
          <View style={styles.flex}>
            <Text variant="titleSm" color="heading" size={18} lineHeight={22}>{copy.offer.title}</Text>
            <Text variant="body" color="deep" size={15.5} lineHeight={20} testID="FavoritesRoutine.offerLine">{offerLine(data.weeklyOffer)}</Text>
            <Text variant="body" color="muted" size={14.5} lineHeight={19}>{copy.offer.conditions(data.weeklyOffer.conditions.label)}</Text>
          </View>
          <Icon name="chevronRight" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <OptionSheet
        testID="FavoritesRoutine.menu"
        visible={menu !== null}
        title={menu?.type === "favorite" ? menu.item.name : menu !== null ? `${weekdayLabel(menu.item.weekday, "long")} ${menu.item.time}` : undefined}
        options={menuOptions}
        onClose={() => setMenu(null)}
        onSelect={(value) => {
          const target = menu;
          setMenu(null);
          if (target === null) return;
          if (value === "delete") setConfirm(target);
          else if (target.type === "favorite") navigation.navigate("FavoriteForm", { favoriteId: target.item.id });
          else navigation.navigate("RoutineEntryForm", { entryId: target.item.id });
        }}
      />

      <ConfirmDialog
        testID="FavoritesRoutine.deleteDialog"
        visible={confirm !== null}
        destructive
        loading={deleteFavorite.isPending || deleteEntry.isPending}
        title={confirm?.type === "favorite" ? copy.delete.favoriteTitle : copy.delete.entryTitle}
        message={confirm === null ? "" : confirm.type === "favorite" ? copy.delete.favoriteMessage(confirm.item.name) : copy.delete.entryMessage(weekdayLabel(confirm.item.weekday, "long"), confirm.item.time)}
        confirmLabel={copy.delete.confirm}
        cancelLabel={profileStrings.common.cancel}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog testID="FavoritesRoutine.inUseDialog" visible={inUse} title={copy.delete.inUseTitle} message={copy.delete.inUseMessage} confirmLabel={profileStrings.common.done} cancelLabel={profileStrings.common.close} onConfirm={() => setInUse(false)} onCancel={() => setInUse(false)} />
      <ConfirmDialog testID="FavoritesRoutine.suspendDialog" visible={suspendOpen} loading={suspend.isPending} title={copy.suspend.dialogTitle} message={copy.suspend.dialogMessage(range)} confirmLabel={copy.suspend.dialogConfirm} cancelLabel={profileStrings.common.cancel} onConfirm={() => void doSuspend()} onCancel={() => setSuspendOpen(false)} />
      <ConfirmDialog {...roles.dialog} testID="FavoritesRoutine.roleDialog" cancelLabel={profileStrings.common.cancel} />

      <BottomSheet visible={offerOpen} onClose={() => setOfferOpen(false)} title={copy.offer.sheetTitle} testID="FavoritesRoutine.offerSheet">
        <Text variant="body" color="body" size={16} lineHeight={22}>{copy.offer.sheetIntro}</Text>
        <View style={styles.sheetRow}>
          <Text variant="rowTitle" color="heading" size={17} style={styles.flex}>{copy.offer.enabled}</Text>
          <Switch testID="FavoritesRoutine.offerEnabled" value={offerEnabled} onValueChange={setOfferEnabled} tone="blue" accessibilityLabel={copy.offer.enabled} />
        </View>
        <View style={styles.sheetRow}>
          <Text variant="rowTitle" color="heading" size={17} style={styles.flex}>{copy.offer.seats}</Text>
          <Pressable testID="FavoritesRoutine.seatsDown" accessibilityRole="button" accessibilityLabel={copy.offer.seatsDown} disabled={offerSeats <= 1} onPress={() => setOfferSeats((n) => Math.max(1, n - 1))} style={[styles.step, offerSeats <= 1 ? styles.stepOff : null]}>
            <Text variant="titleSm" color="link" size={24}>−</Text>
          </Pressable>
          <Text variant="titleSm" color="heading" size={20} style={styles.seats} testID="FavoritesRoutine.seats">{offerSeats}</Text>
          <Pressable testID="FavoritesRoutine.seatsUp" accessibilityRole="button" accessibilityLabel={copy.offer.seatsUp} disabled={offerSeats >= MAX_SEATS} onPress={() => setOfferSeats((n) => Math.min(MAX_SEATS, n + 1))} style={[styles.step, offerSeats >= MAX_SEATS ? styles.stepOff : null]}>
            <Text variant="titleSm" color="link" size={24}>+</Text>
          </Pressable>
        </View>
        <Text variant="body" color="muted" size={14.5} lineHeight={20}>{copy.offer.days(offerLine({ enabled: true, seats: offerSeats, weekdays: data.weeklyOffer.weekdays }).replace(/^Ofrezco \d+ plazas? /, ""))}. {copy.offer.daysHint}</Text>
        <Text variant="body" color="muted" size={14.5} lineHeight={20} style={styles.noteGap}>{copy.offer.priceNote}</Text>
        <Button testID="FavoritesRoutine.offerSave" label={copy.offer.save} loading={saveOffer.isPending} onPress={() => void doSaveOffer()} style={styles.noteGap} />
        {data.weeklyOffer.prefill !== null ? <Button testID="FavoritesRoutine.offerPublish" label={copy.offer.publish} variant="outline" onPress={publish} style={styles.btnGap} /> : null}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { paddingHorizontal: SIDE, paddingTop: 6, paddingBottom: 28 },
  gapBottom: { marginBottom: 10 },
  gapTop: { marginTop: 12 },
  btnGap: { marginTop: 10 },
  noteGap: { marginTop: 12 },
  sectionGap: { marginTop: 18 },
  pressed: { opacity: 0.88 },
  addPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.bg.tint },
  card: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.bg.tint, borderWidth: 1, borderColor: colors.border.soft, marginTop: 6 },
  dots: { paddingHorizontal: 6, paddingVertical: 2 },
  routine: { marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border.soft },
  entryRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: colors.border.soft },
  day: { width: 36 },
  time: { width: 54 },
  suspendCard: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.bg.tint, borderWidth: 1, borderColor: colors.border.soft, marginTop: 16 },
  offerCard: { flexDirection: "row", alignItems: "center", gap: 14, padding: 12, borderRadius: 16, backgroundColor: colors.bg.tint, borderWidth: 1, borderColor: colors.border.soft, marginTop: 14 },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  step: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg.tint },
  stepOff: { opacity: 0.4 },
  seats: { minWidth: 28, textAlign: "center" },
});
