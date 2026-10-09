import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { startPhoneVerification } from "@/api";
import type { Role } from "@/api/types";
import { useApiMutation, useIsOnline } from "@/hooks";
import { Avatar, Banner, Checkbox, OfflineBanner, OptionSheet, PhoneField, Screen, ScreenHeader, SelectField, Text, TextField } from "@/ui";
import { useAppNavigation, useAppRoute, type AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { openAppSettings } from "@/platform";
import { AuthButton } from "../components/AuthButton";
import { useImagePicker, type PickSource } from "../hooks/useImagePicker";
import { useProvinces } from "../hooks/useProvinces";
import { classifyStartError } from "../logic/otp";
import { validateRegistration, type RegistrationErrors } from "../logic/registration";
import { registrationDraft, useRegistrationDraft } from "../stores/registrationDraft";
import { authStrings } from "../strings";

const copy = authStrings.create;

type PhotoAction = "camera" | "library" | "remove";

/**
 * 03 · Tu cuenta. Foto opcional, nombre, apellidos, móvil, provincia y aceptación de Política de Privacidad y Términos.
 * «Recibir código» valida todo a la vez, pide el SMS (`POST /v1/auth/phone/start`) y pasa a «Confirma tu móvil».
 * Lo escrito se guarda en el borrador en memoria para que «Cambiar número de móvil» vuelva con todo relleno.
 */
export function CreateAccountScreen(_props: AppScreenProps<"CreateAccount">): React.JSX.Element {
  const navigation = useAppNavigation();
  const route = useAppRoute("CreateAccount");
  const online = useIsOnline();
  const draft = useRegistrationDraft();
  const provinces = useProvinces();
  const picker = useImagePicker();

  const roles: Role[] = route.params?.roles ?? (draft.roles.length > 0 ? draft.roles : ["passenger"]);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [provinceOpen, setProvinceOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoNotice, setPhotoNotice] = useState<{ kind: "warning" | "error"; message: string; settings?: boolean } | null>(null);

  const province = provinces.provinces.find((entry) => entry.id === draft.provinceId) ?? null;
  const provinceOptions = useMemo(
    () => provinces.provinces.map((entry) => ({ value: entry.id, label: entry.name })),
    [provinces.provinces],
  );

  const prefill = route.params?.prefill;
  const provinceList = provinces.provinces;
  useEffect(() => {
    if (prefill === undefined) return;
    const current = registrationDraft.get();
    const code = prefill.provinceCode?.toUpperCase();
    const match = code !== undefined ? provinceList.find((entry) => entry.code.toUpperCase() === code) : undefined;
    const patch: Parameters<typeof registrationDraft.set>[0] = {};
    if (current.givenName === "" && prefill.givenName !== undefined) patch.givenName = prefill.givenName;
    if (current.familyName === "" && prefill.familyName !== undefined) patch.familyName = prefill.familyName;
    if (current.phone === "" && prefill.phone !== undefined) patch.phone = prefill.phone;
    if (current.provinceId === null && match !== undefined) patch.provinceId = match.id;
    if (!current.accepted && prefill.accepted === true) patch.accepted = true;
    if (Object.keys(patch).length > 0) registrationDraft.set(patch);
  }, [prefill, provinceList]);

  const send = useApiMutation(
    async (variables: { phoneE164: string }, { signal }) => startPhoneVerification({ phone: variables.phoneE164, roles }, { signal }),
    {
      onSuccess: (data, variables) => {
        registrationDraft.set({ roles, lastChallenge: { phoneE164: variables.phoneE164, challengeId: data.challengeId, expiresAt: data.expiresAt } });
        navigation.navigate("VerifyPhone", { challengeId: data.challengeId, phoneE164: variables.phoneE164, expiresAt: data.expiresAt, roles });
      },
    },
  );

  const update = useCallback((patch: Parameters<typeof registrationDraft.set>[0], field?: keyof RegistrationErrors) => {
    registrationDraft.set(patch);
    if (field !== undefined) setErrors((current) => (current[field] === undefined ? current : { ...current, [field]: undefined }));
  }, []);

  const onSubmit = useCallback(() => {
    const result = validateRegistration({
      givenName: draft.givenName,
      familyName: draft.familyName,
      phone: draft.phone,
      provinceId: draft.provinceId,
      accepted: draft.accepted,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    // Un código ya pedido para este mismo número y todavía vigente se retoma: no se pide otro SMS.
    const previous = draft.lastChallenge;
    if (previous !== null && previous.phoneE164 === result.value.phoneE164 && Date.parse(previous.expiresAt) > Date.now()) {
      navigation.navigate("VerifyPhone", { challengeId: previous.challengeId, phoneE164: previous.phoneE164, expiresAt: previous.expiresAt, roles });
      return;
    }
    void send.mutate({ phoneE164: result.value.phoneE164 });
  }, [draft, navigation, roles, send]);

  const choosePhoto = useCallback(
    async (source: PickSource) => {
      setPhotoNotice(null);
      const outcome = await picker.pick(source);
      if (outcome.kind === "picked") {
        registrationDraft.set({ photo: { uri: outcome.image.uri, mimeType: outcome.image.mimeType, sizeBytes: outcome.image.sizeBytes ?? null } });
      } else if (outcome.kind === "denied") {
        setPhotoNotice({ kind: "warning", message: authStrings.photo.permission.cameraUnavailable });
      } else if (outcome.kind === "blocked") {
        setPhotoNotice({ kind: "warning", message: authStrings.photo.permission.cameraBlocked, settings: true });
      } else if (outcome.kind === "unavailable") {
        setPhotoNotice({ kind: "error", message: authStrings.photo.permission.galleryUnavailable });
      }
    },
    [picker],
  );

  const onPhotoAction = useCallback(
    (action: PhotoAction) => {
      setPhotoOpen(false);
      if (action === "remove") {
        registrationDraft.set({ photo: null });
        return;
      }
      void choosePhoto(action);
    },
    [choosePhoto],
  );

  const failure = send.error !== null ? classifyStartError(send.error) : null;
  const displayName = `${draft.givenName} ${draft.familyName}`.trim();

  return (
    <Screen
      padded={false}
      testID="CreateAccount"
      header={<ScreenHeader variant="large" title={copy.title} subtitle={copy.subtitle} testID="CreateAccount.header" />}
      footer={
        <AuthButton
          label={copy.submit}
          onPress={onSubmit}
          loading={send.isPending}
          disabled={!online && !send.isPending}
          style={styles.submit}
          testID="CreateAccount.submit"
        />
      }
    >
      {!online ? <OfflineBanner testID="CreateAccount.offline" /> : null}

      <View style={styles.photoRow}>
        <View style={styles.photoButton}>
          <Avatar
            source={draft.photo?.uri ?? null}
            name={displayName}
            size={112}
            badge="camera"
            onBadgePress={() => setPhotoOpen(true)}
            badgeAccessibilityLabel={draft.photo !== null ? copy.photoChange : copy.photoAdd}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={draft.photo !== null ? copy.photoChange : copy.photoAdd}
            onPress={() => setPhotoOpen(true)}
            style={styles.photoOverlay}
            testID="CreateAccount.photo"
          />
        </View>
      </View>
      {photoNotice !== null ? (
        <View style={styles.notice}>
          <Banner
            kind={photoNotice.kind}
            size="sm"
            message={photoNotice.message}
            actionLabel={photoNotice.settings === true ? authStrings.photo.permission.openSettings : undefined}
            onAction={photoNotice.settings === true ? () => void openAppSettings() : undefined}
            testID="CreateAccount.photoNotice"
          />
        </View>
      ) : null}

      <View style={styles.fields}>
        <TextField
          label={copy.givenName}
          value={draft.givenName}
          onChangeText={(text) => update({ givenName: text }, "givenName")}
          leadingIcon="person"
          autoCapitalize="words"
          autoComplete="given-name"
          textContentType="givenName"
          maxLength={60}
          returnKeyType="next"
          error={errors.givenName}
          testID="CreateAccount.givenName"
        />
        <TextField
          label={copy.familyName}
          value={draft.familyName}
          onChangeText={(text) => update({ familyName: text }, "familyName")}
          leadingIcon="person"
          autoCapitalize="words"
          autoComplete="family-name"
          textContentType="familyName"
          maxLength={60}
          returnKeyType="next"
          error={errors.familyName}
          testID="CreateAccount.familyName"
        />
        <PhoneField
          label={copy.phone}
          value={draft.phone}
          onChangeText={(text) => update({ phone: text }, "phone")}
          maxLength={16}
          returnKeyType="done"
          error={errors.phone}
          testID="CreateAccount.phone"
        />
        <SelectField
          label={copy.province}
          valueLabel={province?.name}
          placeholder={provinces.isLoading ? copy.provincesLoading : copy.provincePlaceholder}
          leadingIcon="pin"
          onPress={() => setProvinceOpen(true)}
          error={errors.province}
          testID="CreateAccount.province"
        />
      </View>

      {provinces.isError ? (
        <View style={styles.notice}>
          <Banner
            kind="error"
            size="sm"
            title={copy.provincesErrorTitle}
            message={provinces.isOffline ? authStrings.common.offlineDetail : authStrings.common.serverDown}
            actionLabel={authStrings.common.retry}
            onAction={provinces.refetch}
            testID="CreateAccount.provincesError"
          />
        </View>
      ) : null}

      <View style={styles.consent}>
        <Checkbox
          checked={draft.accepted}
          onChange={(checked) => update({ accepted: checked }, "consent")}
          error={errors.consent !== undefined}
          accessibilityLabel={copy.consentA11y}
          testID="CreateAccount.consent"
        >
          <Text variant="body" color="muted" size={19} lineHeight={25}>
            {copy.consentPrefix}
            <Text
              variant="body"
              color={colors.primary}
              size={19}
              underline
              accessibilityRole="link"
              onPress={() => navigation.navigate("LegalDocument", { kind: "privacy" })}
              testID="CreateAccount.privacyLink"
            >
              {copy.privacyLink}
            </Text>
            {copy.consentMiddle}
            <Text
              variant="body"
              color={colors.primary}
              size={19}
              underline
              accessibilityRole="link"
              onPress={() => navigation.navigate("LegalDocument", { kind: "terms" })}
              testID="CreateAccount.termsLink"
            >
              {copy.termsLink}
            </Text>
            {copy.consentSuffix}
          </Text>
        </Checkbox>
        {errors.consent !== undefined ? (
          <Text variant="caption" color="error" style={styles.consentError} accessibilityRole="alert" testID="CreateAccount.consentError">
            {errors.consent}
          </Text>
        ) : null}
      </View>

      <View style={styles.messages} accessibilityLiveRegion="polite">
        {failure !== null && !send.isOffline ? (
          <Banner
            kind="error"
            size="sm"
            title={failure.title}
            message={failure.message}
            actionLabel={failure.retryable ? authStrings.common.retry : undefined}
            onAction={failure.retryable ? () => void send.retry() : undefined}
            testID="CreateAccount.sendError"
          />
        ) : null}
        {send.isOffline ? (
          <Banner
            kind="notice"
            size="sm"
            message={authStrings.common.offlineDetail}
            actionLabel={authStrings.common.retry}
            onAction={() => void send.retry()}
            testID="CreateAccount.sendOffline"
          />
        ) : null}
      </View>

      <OptionSheet
        visible={provinceOpen}
        title={copy.provinceSheet}
        options={provinceOptions}
        selected={draft.provinceId ?? undefined}
        onSelect={(value) => {
          setProvinceOpen(false);
          update({ provinceId: value }, "province");
        }}
        onClose={() => setProvinceOpen(false)}
        testID="CreateAccount.provinceSheet"
      />
      <OptionSheet<PhotoAction>
        visible={photoOpen}
        title={copy.photoSheetTitle}
        options={[
          { value: "camera", label: copy.photoTake, icon: "camera" },
          { value: "library", label: copy.photoPick, icon: "image" },
          ...(draft.photo !== null ? [{ value: "remove" as const, label: copy.photoRemove, icon: "trash" as const, destructive: true }] : []),
        ]}
        onSelect={onPhotoAction}
        onClose={() => setPhotoOpen(false)}
        testID="CreateAccount.photoSheet"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photoRow: { paddingHorizontal: 22, paddingTop: 8 },
  photoButton: { alignSelf: "flex-start", width: 124, height: 124 },
  photoOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  notice: { paddingHorizontal: 18, marginTop: 8 },
  fields: { paddingHorizontal: 20, paddingTop: 20, gap: 14 },
  consent: { paddingHorizontal: 24, marginTop: 34 },
  consentError: { marginTop: 6 },
  messages: { paddingHorizontal: 18, marginTop: 10, gap: 10 },
  submit: { marginHorizontal: 20 },
});
