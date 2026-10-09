/**
 * Editar perfil. Foto (estado real de la revisión y acceso a subir otra), nombre público (2–80 caracteres, validado antes
 * de enviar), móvil verificado (no editable desde la app: se pide ayuda), provincia (solo la de MVC) y preferencias que
 * llevan a sus pantallas. Guardar solo se activa con cambios válidos; salir con cambios pregunta antes de descartarlos.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import { useIsOnline, useApiMutation } from "@/hooks";
import type { AppScreenProps } from "@/navigation/types";
import { useAuth } from "@/session";
import { colors } from "@/theme";
import { Avatar, Banner, Button, ConfirmDialog, Screen, ScreenHeader, StatusPill, Text, TextField, showToast } from "@/ui";
import { OfflineNotice } from "../components/ScreenStates";
import { ProfileRow } from "../components/ProfileRow";
import { SectionTitle } from "../components/SectionTitle";
import { saveDisplayName } from "../api";
import { useProvinces } from "../hooks/useProvince";
import { useVerification, useViewer } from "../hooks/useVerification";
import { profileStrings } from "../strings";

const copy = profileStrings.editProfile;
const MIN = 2;
const MAX = 80;

/** Misma normalización que el servidor: recorta y junta espacios. */
export function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function nameError(value: string): string | undefined {
  const name = normalizeName(value);
  if (name === "") return copy.nameRequired;
  if (name.length < MIN) return copy.nameTooShort;
  if (name.length > MAX) return copy.nameTooLong;
  return undefined;
}

export function EditProfileScreen({ navigation }: AppScreenProps<"EditProfile">): React.JSX.Element {
  const { me, refreshMe } = useAuth();
  const online = useIsOnline();
  const viewer = useViewer();
  const verification = useVerification();
  const provinces = useProvinces();
  const original = me?.display_name ?? "";
  const [name, setName] = useState(original);
  const [touched, setTouched] = useState(false);
  const [discard, setDiscard] = useState(false);
  const save = useApiMutation<unknown, string>((value, { signal }) => saveDisplayName(value, { signal }));

  const error = touched ? nameError(name) : undefined;
  const dirty = normalizeName(name) !== normalizeName(original);
  const valid = nameError(name) === undefined;
  const photo = verification.data?.photo;
  const photoState = photo?.state ?? "none";

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (!valid || !dirty) return;
    try {
      await save.mutateAsync(normalizeName(name));
      await refreshMe();
      showToast({ kind: "success", message: copy.saved, id: "profile.save" });
      navigation.goBack();
    } catch (failure) {
      showToast({ kind: "error", message: describeError(failure).message, id: "profile.save" });
    }
  };

  const leave = (): void => {
    if (dirty) setDiscard(true);
    else navigation.goBack();
  };

  const province = provinces.data?.[0]?.name ?? null;
  const header = <ScreenHeader title={copy.title} testID="EditProfile.header" onBack={dirty ? () => setDiscard(true) : undefined} />;

  return (
    <Screen testID="EditProfile" header={header}>
      {!online ? <OfflineNotice testID="EditProfile.offline" detail={copy.offlineSave} onRetry={() => undefined} style={styles.gap} /> : null}

      <SectionTitle title={copy.photoHeading} />
      <View style={[styles.card, styles.row]} testID="EditProfile.photo">
        <Avatar source={viewer?.photoUrl ?? null} name={original} size="xl" />
        <View style={styles.flex}>
          <Text variant="body" color="body" size={16}>{copy.photoState[photoState]}</Text>
          {photoState === "in_review" ? <StatusPill label={profileStrings.verification.photo.in_review.tag} tone="amber" size="sm" /> : null}
        </View>
      </View>
      <Button
        testID="EditProfile.changePhoto"
        label={photoState === "none" ? copy.addPhoto : copy.changePhoto}
        variant="outline"
        chevron={false}
        disabled={photo?.uploadAvailable === false}
        onPress={() => navigation.navigate("ProfilePhoto")}
        style={styles.gapTop}
      />
      {photo?.uploadAvailable === false ? <Banner testID="EditProfile.storageOff" kind="warning" message={profileStrings.verification.storageOff} /> : null}

      <SectionTitle title={copy.nameLabel} style={styles.section} />
      <TextField
        testID="EditProfile.name"
        label={copy.nameLabel}
        value={name}
        onChangeText={(text) => { setName(text); setTouched(true); }}
        onBlur={() => setTouched(true)}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        error={error}
        helper={error === undefined ? copy.nameHelper : undefined}
        maxLength={MAX + 20}
      />

      <SectionTitle title={copy.phoneHeading} style={styles.section} />
      <View style={styles.card} testID="EditProfile.phone">
        <Text variant="titleSm" color="heading" size={19}>{me?.phone_e164 ?? "—"}</Text>
        <Text variant="body" color="muted" size={15.5}>{copy.phoneHelper}</Text>
        <Button testID="EditProfile.phoneSupport" label={copy.phoneSupport} variant="outline" size="sm" inline chevron={false} onPress={() => navigation.navigate("HelpCenter", { category: "account_profile" })} style={styles.gapTop} />
      </View>

      <SectionTitle title={copy.provinceHeading} style={styles.section} />
      <View style={styles.card} testID="EditProfile.province">
        <Text variant="titleSm" color="heading" size={19}>{province ?? "Sevilla"}</Text>
        <Text variant="body" color="muted" size={15.5}>{copy.provinceHelper}</Text>
      </View>

      <SectionTitle title={copy.preferencesHeading} style={styles.section} />
      <ProfileRow testID="EditProfile.notifications" icon="bell" title={copy.notifications.title} subtitle={copy.notifications.subtitle} onPress={() => navigation.navigate("NotificationSettings")} />
      <ProfileRow testID="EditProfile.livePrivacy" icon="lock" title={copy.livePrivacy.title} subtitle={copy.livePrivacy.subtitle} onPress={() => navigation.navigate("LivePrivacy")} />
      <ProfileRow testID="EditProfile.fontSize" icon="settings" title={copy.fontSize.title} subtitle={copy.fontSize.subtitle} onPress={() => navigation.navigate("Settings")} />

      {dirty ? <Text variant="body" color="warning" size={15} style={styles.gapTop} testID="EditProfile.unsaved">{copy.unsaved}</Text> : null}
      <View style={styles.actions}>
        <Button testID="EditProfile.save" label={copy.save} loading={save.isPending} disabled={!dirty || (touched && !valid) || !online} onPress={() => void submit()} />
        <Button testID="EditProfile.cancel" label={profileStrings.common.cancel} variant="outline" chevron={false} disabled={save.isPending} onPress={leave} />
      </View>

      <ConfirmDialog
        testID="EditProfile.discardDialog"
        visible={discard}
        destructive
        title={copy.discardTitle}
        message={copy.discardMessage}
        confirmLabel={copy.discardConfirm}
        cancelLabel={profileStrings.common.cancel}
        onConfirm={() => {
          setDiscard(false);
          navigation.goBack();
        }}
        onCancel={() => setDiscard(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 6 },
  gap: { marginBottom: 12 },
  gapTop: { marginTop: 12 },
  section: { marginTop: 22 },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  card: { marginTop: 8, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 4 },
  actions: { marginTop: 24, gap: 12, paddingBottom: 12 },
});
