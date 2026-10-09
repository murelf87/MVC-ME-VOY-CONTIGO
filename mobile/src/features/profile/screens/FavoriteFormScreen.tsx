/**
 * Destino favorito (sin lámina; se diseña con la 31 al lado). Tipo (Trabajo · Campus · Casa · Otro), nombre y dirección
 * (se elige en el buscador de lugares de la provincia). Crea (`POST`) o edita (`PATCH`, solo lo que cambió) y, al editar,
 * permite eliminar. Valida en español antes de enviar; el servidor puede responder 409 (máximo 20) o 422 (fuera de provincia).
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { describeError, isApiError } from "@/api";
import type { FavoriteKind } from "@/api/types";
import { usePlaceResult } from "@/features/search/browse/hooks/usePlaceResult";
import type { PlaceParam } from "@/features/search/routes";
import { Icon } from "@/icons";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { Banner, Button, ConfirmDialog, EmptyState, Screen, ScreenHeader, Segmented, Text, TextField, showToast } from "@/ui";
import { ListSkeleton, LoadFailure } from "../components/ScreenStates";
import { useCreateFavorite, useDeleteFavorite, useFavorites, useUpdateFavorite } from "../hooks/useFavorites";
import {
  FAVORITE_KINDS,
  FAVORITE_NAME_MAX,
  hasFavoriteErrors,
  isEmptyUpdate,
  kindLabel,
  nameAfterKindChange,
  placeOfFavorite,
  toCreateBody,
  toUpdateBody,
  validateFavoriteDraft,
  canAddFavorite,
  type FavoritePlaceValue,
} from "../model/favorites";
import { profileStrings } from "../strings";

const copy = profileStrings.favoriteForm;
const SIDE = 14;

export function FavoriteFormScreen({ navigation, route }: AppScreenProps<"FavoriteForm">): React.JSX.Element {
  const favoriteId = route.params?.favoriteId;
  const favorites = useFavorites();
  const create = useCreateFavorite();
  const update = useUpdateFavorite();
  const remove = useDeleteFavorite();

  const original = favoriteId === undefined ? undefined : favorites.data?.items.find((f) => f.id === favoriteId);
  const [kind, setKind] = React.useState<FavoriteKind>("other");
  const [name, setName] = React.useState("");
  const [place, setPlace] = React.useState<FavoritePlaceValue | null>(null);
  const [tried, setTried] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(favoriteId === undefined);

  React.useEffect(() => {
    if (hydrated || original === undefined) return;
    setKind(original.kind);
    setName(original.name);
    setPlace(placeOfFavorite(original));
    setHydrated(true);
  }, [hydrated, original]);

  const fromParams = route.params?.place;
  React.useEffect(() => {
    // Lugar que llega por parámetros (p. ej. desde el mapa) en la pantalla de alta.
    if (fromParams !== undefined && favoriteId === undefined && place === null) setPlace({ label: fromParams.label, latitude: fromParams.latitude, longitude: fromParams.longitude });
  }, [fromParams, favoriteId, place]);

  usePlaceResult("place", (picked: PlaceParam) => setPlace({ label: picked.label, latitude: picked.latitude, longitude: picked.longitude }));

  const header = <ScreenHeader title={favoriteId === undefined ? copy.titleNew : copy.titleEdit} testID="FavoriteForm.header" />;

  if (favoriteId !== undefined && !hydrated) {
    if (favorites.error && favorites.data === undefined) {
      return (
        <Screen testID="FavoriteForm" header={header} padded={false}>
          <LoadFailure testID="FavoriteForm.error" title={profileStrings.favorites.loadErrorTitle} error={favorites.error} onRetry={() => void favorites.refetch()} />
        </Screen>
      );
    }
    if (favorites.data !== undefined) {
      return (
        <Screen testID="FavoriteForm" header={header}>
          <EmptyState testID="FavoriteForm.missing" icon="pin" title={copy.missingTitle} message={copy.missingMessage} actionLabel={profileStrings.common.close} onAction={() => navigation.goBack()} variant="plain" />
        </Screen>
      );
    }
    return (
      <Screen testID="FavoriteForm" header={header} padded={false}>
        <ListSkeleton testID="FavoriteForm.loading" count={3} />
      </Screen>
    );
  }

  const draft = { kind, name, place };
  const errors = tried ? validateFavoriteDraft(draft) : {};
  const count = favorites.data?.items.length ?? 0;
  const full = favoriteId === undefined && !canAddFavorite(count);
  const pending = create.isPending || update.isPending || remove.isPending;
  const failure = create.error ?? update.error;

  const save = async (): Promise<void> => {
    setTried(true);
    if (hasFavoriteErrors(validateFavoriteDraft(draft))) return;
    if (original === undefined) {
      const body = toCreateBody(draft);
      if (body === null) return;
      const saved = await create.mutate(body);
      if (saved) {
        showToast({ kind: "success", message: copy.saved });
        navigation.goBack();
      }
      return;
    }
    const body = toUpdateBody(original, draft);
    if (isEmptyUpdate(body)) {
      navigation.goBack();
      return;
    }
    const saved = await update.mutate({ id: original.id, body });
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
      showToast({ kind: "success", message: profileStrings.favorites.delete.favoriteDone });
      navigation.goBack();
    } catch (error) {
      setDeleteOpen(false);
      if (isApiError(error) && error.code === "FAVORITE_IN_USE") showToast({ kind: "error", message: profileStrings.favorites.delete.inUseMessage });
      else showToast({ kind: "error", message: describeError(error).message });
    }
  };

  const openSearch = (): void => {
    navigation.navigate("PlaceSearch", {
      field: "place",
      title: copy.placeSearchTitle,
      returnTo: { route: "FavoriteForm", param: "place" },
      ...(place !== null ? { current: { label: place.label, latitude: place.latitude, longitude: place.longitude } } : {}),
    });
  };

  return (
    <Screen testID="FavoriteForm" header={header} paddingX={SIDE}>
      <View style={styles.body}>
        {full ? <Banner testID="FavoriteForm.limit" kind="warning" size="sm" title={copy.limit} style={styles.gapBottom} /> : null}

        <Text variant="titleSm" color="heading" size={17} style={styles.label}>{copy.kind}</Text>
        <Segmented<FavoriteKind>
          testID="FavoriteForm.kind"
          variant="pills"
          scrollable
          accessibilityLabel={profileStrings.favorites.kindsLabel}
          options={FAVORITE_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
          value={kind}
          onChange={(next) => {
            setName((current) => nameAfterKindChange(current, kind, next));
            setKind(next);
          }}
        />

        <Text variant="titleSm" color="heading" size={17} style={styles.labelGap}>{copy.name}</Text>
        <TextField testID="FavoriteForm.name" variant="compact" height={48} value={name} onChangeText={setName} placeholder={copy.namePlaceholder} maxLength={FAVORITE_NAME_MAX} error={errors.name} helper={errors.name === undefined ? copy.nameHelper : undefined} disabled={pending} autoCapitalize="sentences" />

        <Text variant="titleSm" color="heading" size={17} style={styles.labelGap}>{copy.place}</Text>
        <Pressable testID="FavoriteForm.place" accessibilityRole="button" accessibilityLabel={`${copy.place}: ${place?.label ?? copy.placePlaceholder}`} onPress={openSearch} disabled={pending} style={[styles.placeField, errors.place !== undefined ? styles.placeError : null]}>
          <Icon name="pin" size={22} color={colors.primary} />
          <Text variant="body" color={place === null ? "muted" : "strong"} size={16.5} numberOfLines={2} style={styles.flex}>{place?.label ?? copy.placePlaceholder}</Text>
          <Icon name="chevronRight" size={20} color={colors.primary} />
        </Pressable>
        <Text variant="body" color={errors.place !== undefined ? "error" : "muted"} size={14} style={styles.helper} testID={errors.place !== undefined ? "FavoriteForm.placeError" : undefined}>{errors.place ?? copy.placeHelper}</Text>

        {failure ? <Banner testID="FavoriteForm.submitError" kind="error" title={describeError(failure).message} style={styles.gapTop} /> : null}

        <Button testID="FavoriteForm.save" label={favoriteId === undefined ? copy.save : copy.saveEdit} loading={create.isPending || update.isPending} disabled={pending || full} onPress={() => void save()} style={styles.gapTopLg} />
        {favoriteId !== undefined ? <Button testID="FavoriteForm.delete" label={copy.delete} variant="outline" leadingIcon="trash" chevron={false} disabled={pending} onPress={() => setDeleteOpen(true)} style={styles.gapTop} /> : null}
      </View>
      <ConfirmDialog
        testID="FavoriteForm.deleteDialog"
        visible={deleteOpen}
        destructive
        loading={remove.isPending}
        title={profileStrings.favorites.delete.favoriteTitle}
        message={profileStrings.favorites.delete.favoriteMessage(original?.name ?? name)}
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
  gapBottom: { marginBottom: 12 },
  gapTop: { marginTop: 12 },
  gapTopLg: { marginTop: 24 },
  helper: { marginTop: 6 },
  placeField: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border.soft, backgroundColor: colors.bg.tint },
  placeError: { borderColor: colors.error.text },
});
