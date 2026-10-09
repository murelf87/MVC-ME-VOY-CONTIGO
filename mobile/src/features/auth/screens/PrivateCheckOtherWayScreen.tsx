import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api/errors";
import { queryCache, useIsOnline } from "@/hooks";
import { Icon } from "@/icons";
import { useAppNavigation, useAppRoute, type AppScreenProps } from "@/navigation";
import { openAppSettings, pickDocument } from "@/platform";
import { colors } from "@/theme";
import { Banner, Button, Card, ErrorStateCard, OfflineBanner, Screen, ScreenHeader, Skeleton, StatusPill, Text } from "@/ui";
import { uploadIdentityDocument, type UploadPhase } from "../api";
import { AuthButton } from "../components/AuthButton";
import { TRUST, useTrustOverview } from "../hooks/useTrust";
import { useImagePicker } from "../hooks/useImagePicker";
import { DOCUMENT_CONTENT_TYPES, DOCUMENT_MAX_BYTES, formatFileSize, validateLocalFile, type LocalFile } from "../logic/uploads";
import { documentPhase, latestIdentityDocument } from "../logic/verification";
import { authStrings } from "../strings";

const copy = authStrings.otherWay;

interface ChosenFile extends LocalFile {
  name: string;
}

/**
 * Otra forma de verificar (sin lámina; mismo lenguaje que 06–08). La persona aporta una foto o un PDF de su documento de
 * identidad: se sube al almacén privado y lo revisa una persona del equipo. Un documento aprobado es lo único que
 * acredita la identidad; mientras tanto se dice «en revisión», nunca «verificada».
 */
export function PrivateCheckOtherWayScreen(_props: AppScreenProps<"PrivateCheckOtherWay">): React.JSX.Element {
  const navigation = useAppNavigation();
  const reason = useAppRoute("PrivateCheckOtherWay").params?.reason;
  const online = useIsOnline();
  const picker = useImagePicker();
  const query = useTrustOverview();
  const identity = query.data?.identity ?? null;
  const phase = useMemo(() => (identity !== null ? documentPhase(identity) : null), [identity]);
  const latest = useMemo(() => (identity !== null ? latestIdentityDocument(identity) : null), [identity]);

  const [file, setFile] = useState<ChosenFile | null>(null);
  const [notice, setNotice] = useState<{ kind: "warning" | "error"; title?: string; message: string; settings?: boolean } | null>(null);
  const [upload, setUpload] = useState<UploadPhase | null>(null);
  const [sendError, setSendError] = useState<{ title: string; message: string } | null>(null);
  const sending = upload !== null;

  const choose = useCallback(
    (next: ChosenFile) => {
      const check = validateLocalFile("document", next);
      if (!check.ok) {
        setNotice({ kind: "error", message: check.message });
        return;
      }
      setNotice(null);
      setSendError(null);
      setFile({ ...next, mimeType: check.contentType, sizeBytes: check.sizeBytes });
    },
    [],
  );

  const takePhoto = useCallback(async () => {
    setNotice(null);
    const outcome = await picker.pick("camera");
    if (outcome.kind === "picked") {
      choose({ uri: outcome.image.uri, mimeType: outcome.image.mimeType, sizeBytes: outcome.image.sizeBytes ?? null, name: outcome.image.fileName ?? "documento.jpg" });
    } else if (outcome.kind === "denied") {
      setNotice({ kind: "warning", title: copy.cameraBlockedTitle, message: copy.cameraBlocked });
    } else if (outcome.kind === "blocked") {
      setNotice({ kind: "warning", title: copy.cameraBlockedTitle, message: copy.cameraBlocked, settings: true });
    } else if (outcome.kind === "unavailable") {
      setNotice({ kind: "error", message: copy.cameraUnavailable });
    }
  }, [choose, picker]);

  const pickFile = useCallback(async () => {
    setNotice(null);
    const result = await pickDocument({ types: [...DOCUMENT_CONTENT_TYPES], maxBytes: DOCUMENT_MAX_BYTES });
    if (result.status === "picked") {
      choose({ uri: result.document.uri, mimeType: result.document.mimeType, sizeBytes: result.document.sizeBytes, name: result.document.name });
    } else if (result.status === "too_large") {
      setNotice({ kind: "error", message: copy.tooLarge });
    } else if (result.status === "unavailable") {
      setNotice({ kind: "error", message: copy.pickerUnavailable });
    }
  }, [choose]);

  const send = useCallback(async () => {
    if (sending) return;
    setSendError(null);
    if (file === null) {
      setNotice({ kind: "error", message: copy.needFile });
      return;
    }
    const check = validateLocalFile("document", file);
    if (!check.ok) {
      setNotice({ kind: "error", message: check.message });
      return;
    }
    try {
      await uploadIdentityDocument("identity_document", { uri: file.uri, contentType: check.contentType, sizeBytes: check.sizeBytes }, { onPhase: setUpload });
      setFile(null);
      await queryCache.invalidate(TRUST);
      setUpload(null);
    } catch (failure) {
      const described = describeError(failure);
      setSendError({ title: described.title, message: described.message });
      setUpload(null);
    }
  }, [file, sending]);

  const canSend = phase === "none" || phase === "rejected";
  const goBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("PrivateCheckStatus", undefined);
  }, [navigation]);

  return (
    <Screen
      testID="PrivateCheckOtherWay"
      padded={false}
      header={<ScreenHeader title={copy.title} testID="PrivateCheckOtherWay.header" />}
      footer={
        canSend ? (
          <AuthButton size="compact" label={copy.send} onPress={() => void send()} loading={sending} disabled={!online || identity === null || !identity.uploadAvailable} style={styles.footer} testID="PrivateCheckOtherWay.send" />
        ) : (
          <AuthButton size="compact" label={copy.back} variant="outline" onPress={goBack} style={styles.footer} testID="PrivateCheckOtherWay.back" />
        )
      }
    >
      {!online ? <OfflineBanner testID="PrivateCheckOtherWay.offline" /> : null}

      <Text variant="subtitle" color="heading" weight="medium" align="center" size={21} lineHeight={26} style={styles.heading}>
        {copy.heading}
      </Text>
      <Text variant="subtitle" color="muted" align="center" size={18} lineHeight={23} style={styles.intro}>
        {copy.intro}
      </Text>

      <View style={styles.messages} accessibilityLiveRegion="polite">
        {query.isLoading && identity === null ? <Skeleton height={120} /> : null}
        {query.isError && identity === null ? (
          <ErrorStateCard title={copy.loadFailedTitle} message={describeError(query.error).message} actionLabel={authStrings.common.retry} onAction={() => void query.refetch()} testID="PrivateCheckOtherWay.loadError" />
        ) : null}
        {reason === "selfie_failed" && phase === "none" ? <Banner kind="notice" size="sm" message={copy.reasonSelfieFailed} testID="PrivateCheckOtherWay.reason" /> : null}
        {phase === "approved" ? <Banner kind="success" size="sm" title={copy.approvedTitle} message={copy.approved} testID="PrivateCheckOtherWay.approved" /> : null}
        {phase === "in_review" ? <Banner kind="info" size="sm" title={copy.inReviewTitle} message={copy.inReview} testID="PrivateCheckOtherWay.inReview" /> : null}
        {phase === "rejected" ? <Banner kind="error" size="sm" title={copy.rejectedTitle} message={latest?.reason?.message ?? copy.rejectedFallback} testID="PrivateCheckOtherWay.rejected" /> : null}
        {identity !== null && !identity.uploadAvailable && canSend ? <Banner kind="warning" size="sm" title={copy.storageUnavailableTitle} message={copy.storageUnavailable} testID="PrivateCheckOtherWay.noUpload" /> : null}
      </View>

      {phase !== null && phase !== "approved" ? (
        <Card tone="blue" padding={0} radius={18} style={styles.card} testID="PrivateCheckOtherWay.card">
          <View style={styles.cardHead}>
            <View style={styles.cardIcon}>
              <Icon name="idCard" size={28} color={colors.primary} />
            </View>
            <View style={styles.cardText}>
              <Text variant="rowTitle" color="heading" size={19} lineHeight={23}>{copy.cardTitle}</Text>
              <Text variant="body" color="body" size={17} lineHeight={22}>{copy.cardText}</Text>
            </View>
            {latest !== null ? <StatusPill tone={latest.status === "approved" ? "green" : latest.status === "rejected" ? "red" : "amber"} label={copy.statusLabel[latest.status]} /> : null}
          </View>

          {canSend ? (
            <View style={styles.pickRow}>
              <Button label={copy.take} variant="outline" leadingIcon="camera" chevron={false} onPress={() => void takePhoto()} disabled={picker.busy || sending} style={styles.pick} testID="PrivateCheckOtherWay.take" />
              <Button label={copy.pick} variant="outline" leadingIcon="document" chevron={false} onPress={() => void pickFile()} disabled={sending} style={styles.pick} testID="PrivateCheckOtherWay.pick" />
            </View>
          ) : null}

          {file !== null ? (
            <View style={styles.chosen} testID="PrivateCheckOtherWay.chosen">
              <Icon name={file.mimeType === "application/pdf" ? "opsFilePdf" : "image"} size={26} color={colors.primary} />
              <View style={styles.cardText}>
                <Text variant="rowTitle" color="heading" size={17} lineHeight={21} numberOfLines={1}>{file.name}</Text>
                <Text variant="caption" color="muted">{`${copy.chosen} · ${file.sizeBytes !== null ? formatFileSize(file.sizeBytes) : ""}`}</Text>
              </View>
            </View>
          ) : null}
        </Card>
      ) : null}

      <View style={styles.messages}>
        {sending ? <Text variant="subtitle" color="muted" align="center" testID="PrivateCheckOtherWay.sending">{copy.sending}</Text> : null}
        {notice !== null ? (
          <Banner
            kind={notice.kind}
            size="sm"
            title={notice.title}
            message={notice.message}
            actionLabel={notice.settings === true ? copy.openSettings : undefined}
            onAction={notice.settings === true ? () => void openAppSettings() : undefined}
            testID="PrivateCheckOtherWay.notice"
          />
        ) : null}
        {sendError !== null ? <Banner kind="error" size="sm" title={sendError.title} message={sendError.message} actionLabel={authStrings.common.retry} onAction={() => void send()} testID="PrivateCheckOtherWay.sendError" /> : null}
      </View>

      <Card tone="blue" padding={0} radius={18} style={styles.card} testID="PrivateCheckOtherWay.privacy">
        <View style={styles.cardHead}>
          <View style={styles.cardIcon}>
            <Icon name="lock" size={26} color={colors.primary} />
          </View>
          <View style={styles.cardText}>
            <Text variant="rowTitle" color="heading" size={19} lineHeight={23}>{copy.privacyTitle}</Text>
            <Text variant="body" color="body" size={17} lineHeight={22}>{copy.privacyText}</Text>
          </View>
        </View>
        <View style={styles.retention}>
          <Text variant="rowTitle" color="heading" size={17} lineHeight={21}>{copy.retention}</Text>
          <Text variant="body" color="body" size={16} lineHeight={21}>{copy.retentionText}</Text>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { marginTop: 6, paddingHorizontal: 20 },
  intro: { marginTop: 6, paddingHorizontal: 28 },
  messages: { paddingHorizontal: 16, marginTop: 10, gap: 8 },
  card: { marginHorizontal: 16, marginTop: 12, paddingBottom: 14 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingTop: 14 },
  cardIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.bg.white, alignItems: "center", justifyContent: "center" },
  cardText: { flex: 1 },
  pickRow: { flexDirection: "row", gap: 10, paddingHorizontal: 14, marginTop: 14 },
  pick: { flex: 1 },
  chosen: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 14, marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: colors.bg.white },
  retention: { paddingHorizontal: 14, marginTop: 10, gap: 2 },
  footer: { marginHorizontal: 16 },
});
