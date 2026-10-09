import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { describeError } from "@/api/errors";
import { queryCache, useIsOnline } from "@/hooks";
import { Icon } from "@/icons";
import { applyGate, useAppNavigation, type AppScreenProps } from "@/navigation";
import { openAppSettings } from "@/platform";
import { useAuth } from "@/session";
import { colors } from "@/theme";
import { Avatar, Banner, Button, Card, ErrorStateCard, OfflineBanner, Screen, ScreenHeader, Skeleton, Text } from "@/ui";
import { saveRoles, uploadProfilePhoto, type UploadPhase } from "../api";
import { AuthButton } from "../components/AuthButton";
import { TRUST, useProfilePhotoState } from "../hooks/useTrust";
import { useImagePicker, type PickSource } from "../hooks/useImagePicker";
import { validateLocalFile, type LocalFile } from "../logic/uploads";
import { derivePhotoView } from "../logic/verification";
import { authStrings } from "../strings";

const copy = authStrings.photo;
type SelfRole = "driver" | "passenger";
const ROLE_ORDER: readonly SelfRole[] = ["driver", "passenger"];

/**
 * 05 · Tu foto de perfil. Elige rol(es), haz o elige una foto y «Guardar»: se sube al almacén privado y queda en revisión
 * humana. Nunca se muestra como aprobada una foto que el servidor no ha aprobado. Es el último paso del alta: con la
 * foto entregada la app abre el mapa.
 */
export function ProfilePhotoScreen(_props: AppScreenProps<"ProfilePhoto">): React.JSX.Element {
  const navigation = useAppNavigation();
  const { me, roles, refreshMe, signOut, onboardingRequirements } = useAuth();
  const online = useIsOnline();
  const picker = useImagePicker();
  const query = useProfilePhotoState();
  const view = useMemo(() => (query.data !== undefined ? derivePhotoView(query.data) : null), [query.data]);

  const [picked, setPicked] = useState<LocalFile | null>(null);
  const [notice, setNotice] = useState<{ kind: "warning" | "error"; title?: string; message: string; settings?: boolean } | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState(false);

  const onboarding = onboardingRequirements.includes("photo");
  const selfRoles = ROLE_ORDER.filter((role) => roles.includes(role));
  const shown = picked?.uri ?? view?.previewUrl ?? view?.publicUrl ?? null;
  const uploading = phase !== null;

  const finish = useCallback(() => {
    if (onboarding) {
      const decision = applyGate();
      if (decision === null || decision.reason === "onboarding_photo") navigation.canGoBack() ? navigation.goBack() : undefined;
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
    else applyGate();
  }, [navigation, onboarding]);

  const choose = useCallback(
    async (source: PickSource) => {
      setNotice(null);
      setPickError(null);
      const outcome = await picker.pick(source);
      if (outcome.kind === "picked") {
        const file: LocalFile = { uri: outcome.image.uri, mimeType: outcome.image.mimeType, sizeBytes: outcome.image.sizeBytes ?? null };
        const check = validateLocalFile("photo", file);
        if (!check.ok) setPickError(check.message);
        else setPicked(file);
      } else if (outcome.kind === "denied") {
        setNotice({ kind: "warning", title: copy.permission.cameraBlockedTitle, message: copy.permission.cameraBlocked });
      } else if (outcome.kind === "blocked") {
        setNotice({ kind: "warning", title: copy.permission.cameraBlockedTitle, message: copy.permission.cameraBlocked, settings: true });
      } else if (outcome.kind === "unavailable") {
        setNotice({ kind: "error", message: source === "library" ? copy.permission.galleryUnavailable : copy.permission.cameraUnavailable });
      }
    },
    [picker],
  );

  const toggleRole = useCallback(
    async (role: SelfRole) => {
      if (savingRole) return;
      setRoleError(null);
      const next = selfRoles.includes(role) ? selfRoles.filter((r) => r !== role) : ROLE_ORDER.filter((r) => selfRoles.includes(r) || r === role);
      if (next.length === 0) {
        setRoleError(copy.roleOneRequired);
        return;
      }
      setSavingRole(true);
      try {
        await saveRoles(next);
        await refreshMe();
      } catch (error) {
        setRoleError(describeError(error).message || copy.roleSaveFailed);
      } finally {
        setSavingRole(false);
      }
    },
    [refreshMe, savingRole, selfRoles],
  );

  const [saveError, setSaveError] = useState<{ title: string; message: string } | null>(null);
  const save = useCallback(async () => {
    if (uploading) return;
    setSaveError(null);
    if (picked === null) {
      setPickError(copy.needPhoto);
      return;
    }
    const check = validateLocalFile("photo", picked);
    if (!check.ok) {
      setPickError(check.message);
      return;
    }
    try {
      await uploadProfilePhoto({ uri: picked.uri, contentType: check.contentType, sizeBytes: check.sizeBytes }, { onPhase: setPhase });
      setPicked(null);
      await queryCache.invalidate(TRUST);
      await refreshMe();
      setPhase(null);
      finish();
    } catch (error) {
      const described = describeError(error);
      setSaveError({ title: described.title, message: described.message });
      setPhase(null);
    }
  }, [finish, picked, refreshMe, uploading]);

  const primaryLabel = picked !== null || view === null || view.phase === "none" || view.phase === "rejected" ? copy.save : copy.continue;
  const onPrimary = picked !== null || view === null || view.phase === "none" || view.phase === "rejected" ? () => void save() : finish;

  return (
    <Screen
      testID="ProfilePhoto"
      padded={false}
      header={<ScreenHeader title={copy.title} onBack={onboarding ? () => void signOut() : undefined} testID="ProfilePhoto.header" />}
      footer={<AuthButton label={primaryLabel} onPress={onPrimary} loading={uploading} disabled={!online && picked !== null} style={styles.primary} testID="ProfilePhoto.save" />}
    >
      {!online ? <OfflineBanner testID="ProfilePhoto.offline" /> : null}

      <Text variant="subtitle" color="heading" align="center" size={21} lineHeight={26} style={styles.chooseRole}>
        <Text variant="subtitle" color="heading" weight="medium" size={21}>
          Elige tu rol
        </Text>
        {" (puedes tener ambos)"}
      </Text>
      <View style={styles.roles} accessibilityRole="radiogroup">
        {ROLE_ORDER.map((role) => {
          const on = selfRoles.includes(role);
          return (
            <Pressable
              key={role}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, busy: savingRole }}
              accessibilityLabel={role === "driver" ? copy.driver : copy.passenger}
              onPress={() => void toggleRole(role)}
              style={[styles.role, on ? styles.roleOn : styles.roleOff]}
              testID={`ProfilePhoto.role.${role}`}
            >
              <Icon name={role === "driver" ? "car" : "people"} size={34} color={on ? colors.onPrimary : colors.primary} />
              <Text variant="button" size={22} color={on ? colors.onPrimary : colors.primary}>
                {role === "driver" ? copy.driver : copy.passenger}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {roleError !== null ? (
        <Text variant="caption" color="error" align="center" style={styles.roleError} accessibilityRole="alert" testID="ProfilePhoto.roleError">
          {roleError}
        </Text>
      ) : null}

      <View style={styles.avatarWrap}>
        {query.isLoading && shown === null ? (
          <Skeleton circle height={238} />
        ) : (
          <Avatar
            source={shown}
            name={me?.display_name ?? ""}
            size={238}
            badge="camera"
            badgeVariant="ring"
            ring
            onBadgePress={() => void choose("selfie")}
            badgeAccessibilityLabel={copy.avatarBadge}
            testID="ProfilePhoto.avatar"
          />
        )}
      </View>

      <View style={styles.messages} accessibilityLiveRegion="polite">
        {query.isError && view === null ? (
          <ErrorStateCard title={copy.loadFailedTitle} message={describeError(query.error).message} actionLabel={authStrings.common.retry} onAction={() => void query.refetch()} testID="ProfilePhoto.loadError" />
        ) : null}
        {view !== null && view.phase === "in_review" && picked === null ? (
          <Banner kind="notice" size="sm" title={copy.inReviewTitle} message={copy.inReview} testID="ProfilePhoto.inReview" />
        ) : null}
        {view !== null && view.phase === "approved" && view.replacementInReview && picked === null ? (
          <Banner kind="notice" size="sm" title={copy.inReviewTitle} message={copy.inReview} testID="ProfilePhoto.replacementInReview" />
        ) : null}
        {view !== null && view.phase === "rejected" && picked === null ? (
          <Banner kind="error" size="sm" title={copy.rejectedTitle} message={view.reason?.message ?? copy.rejectedFallback} testID="ProfilePhoto.rejected" />
        ) : null}
        {view !== null && !view.uploadAvailable ? <Banner kind="warning" size="sm" title={copy.uploadUnavailableTitle} message={copy.uploadUnavailable} testID="ProfilePhoto.noUpload" /> : null}
        {picked !== null && !uploading ? <Text variant="caption" color="muted" align="center">{copy.pickedHint}</Text> : null}
        {uploading ? <Text variant="subtitle" color="muted" align="center" testID="ProfilePhoto.uploading">{copy.saving}</Text> : null}
        {pickError !== null ? <Banner kind="error" size="sm" message={pickError} testID="ProfilePhoto.pickError" /> : null}
        {notice !== null ? (
          <Banner
            kind={notice.kind}
            size="sm"
            title={notice.title}
            message={notice.message}
            actionLabel={notice.settings === true ? copy.permission.openSettings : undefined}
            onAction={notice.settings === true ? () => void openAppSettings() : undefined}
            testID="ProfilePhoto.notice"
          />
        ) : null}
        {saveError !== null ? (
          <Banner kind="error" size="sm" title={saveError.title} message={saveError.message} actionLabel={authStrings.common.retry} onAction={() => void save()} testID="ProfilePhoto.saveError" />
        ) : null}
      </View>

      <Card tone="blue" padding={0} radius={18} style={styles.info} testID="ProfilePhoto.required">
        <View style={styles.infoIcon}>
          <Icon name="infoMark" size={30} color={colors.onPrimary} />
        </View>
        <View style={styles.infoText}>
          <Text variant="rowTitle" color="heading" size={19} lineHeight={23}>{copy.requiredTitle}</Text>
          <Text variant="subtitle" color="muted" size={18} lineHeight={22}>{copy.required}</Text>
        </View>
      </Card>

      <Card tone="blue" padding={0} radius={18} style={styles.tips} testID="ProfilePhoto.tips">
        <Text variant="rowTitle" color="heading" size={19.5} lineHeight={24} style={styles.tipsTitle}>{copy.tipsTitle}</Text>
        {copy.tips.map((tip) => (
          <View key={tip} style={styles.tip}>
            <Icon name="checkCircle" size={28} color={colors.success.solid} />
            <Text variant="body" color="body" size={18.5} lineHeight={22}>{tip}</Text>
          </View>
        ))}
      </Card>

      <View style={styles.pickRow}>
        <Button label={copy.take} variant="outline" leadingIcon="camera" chevron={false} onPress={() => void choose("selfie")} disabled={picker.busy || uploading} style={styles.pickButton} testID="ProfilePhoto.take" />
        <Button label={copy.pick} variant="outline" leadingIcon="image" chevron={false} onPress={() => void choose("library")} disabled={picker.busy || uploading} style={styles.pickButton} testID="ProfilePhoto.pick" />
      </View>
      {onboarding ? (
        <Button label={copy.signOut} variant="ghost" onPress={() => void signOut()} style={styles.signOut} testID="ProfilePhoto.signOut" />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chooseRole: { marginTop: 6, paddingHorizontal: 20 },
  roles: { flexDirection: "row", gap: 12, paddingHorizontal: 16, marginTop: 12 },
  role: { flex: 1, height: 58, borderRadius: 18, borderWidth: 1.5, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  roleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleOff: { backgroundColor: colors.bg.white, borderColor: colors.primary },
  roleError: { marginTop: 6, paddingHorizontal: 20 },
  avatarWrap: { alignItems: "center", marginTop: 10 },
  messages: { paddingHorizontal: 16, marginTop: 12, gap: 10 },
  info: { marginHorizontal: 16, marginTop: 10, flexDirection: "row", alignItems: "center", minHeight: 80 },
  infoIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginLeft: 16, marginRight: 14 },
  infoText: { flex: 1, paddingVertical: 8, paddingRight: 12 },
  tips: { marginHorizontal: 16, marginTop: 10, paddingBottom: 6 },
  tipsTitle: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 4 },
  tip: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 5 },
  pickRow: { flexDirection: "row", gap: 12, paddingHorizontal: 16, marginTop: 12 },
  pickButton: { flex: 1 },
  signOut: { marginTop: 8 },
  primary: { marginHorizontal: 16 },
});
