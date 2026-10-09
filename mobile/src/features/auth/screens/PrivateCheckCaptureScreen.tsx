import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api/errors";
import { useIsOnline } from "@/hooks";
import { Icon } from "@/icons";
import { useAppNavigation, type AppScreenProps } from "@/navigation";
import { openAppSettings } from "@/platform";
import { colors } from "@/theme";
import { Banner, Card, ErrorStateCard, NumberedList, OfflineBanner, Screen, ScreenHeader, Skeleton, Text } from "@/ui";
import { AuthButton } from "../components/AuthButton";
import { usePrivateCheckState } from "../hooks/useTrust";
import { useImagePicker } from "../hooks/useImagePicker";
import { validateLocalFile } from "../logic/uploads";
import { deriveCheckView } from "../logic/verification";
import { authStrings } from "../strings";

const copy = authStrings.check;

/**
 * 06 · Comprobación privada. Explica la captura (marco, cuatro pasos y el aviso «la selfie no acredita por sí sola tu
 * identidad») y abre la cámara frontal del sistema. La captura NO se envía aquí: pasa a la pantalla 07 (aviso de
 * privacidad) y solo allí, con el aviso aceptado, se sube. El marco es una guía (no una vista previa de cámara).
 */
export function PrivateCheckCaptureScreen(_props: AppScreenProps<"PrivateCheckCapture">): React.JSX.Element {
  const navigation = useAppNavigation();
  const online = useIsOnline();
  const picker = useImagePicker();
  const query = usePrivateCheckState();
  const view = useMemo(() => (query.data !== undefined ? deriveCheckView(query.data) : null), [query.data]);
  const [notice, setNotice] = useState<{ kind: "warning" | "error"; title?: string; message: string; settings?: boolean } | null>(null);

  const goOtherWay = useCallback(() => navigation.navigate("PrivateCheckOtherWay", undefined), [navigation]);
  const goStatus = useCallback(() => navigation.navigate("PrivateCheckStatus", undefined), [navigation]);

  const start = useCallback(async () => {
    setNotice(null);
    const outcome = await picker.pick("selfie");
    if (outcome.kind === "picked") {
      const file = { uri: outcome.image.uri, mimeType: outcome.image.mimeType, sizeBytes: outcome.image.sizeBytes ?? null };
      const check = validateLocalFile("photo", file);
      if (!check.ok) {
        setNotice({ kind: "error", message: check.message });
        return;
      }
      navigation.navigate("PrivateCheckPrivacy", { photoUri: file.uri, mimeType: check.contentType, sizeBytes: check.sizeBytes });
    } else if (outcome.kind === "denied") {
      setNotice({ kind: "warning", title: copy.cameraBlockedTitle, message: copy.cameraBlocked });
    } else if (outcome.kind === "blocked") {
      setNotice({ kind: "warning", title: copy.cameraBlockedTitle, message: copy.cameraBlocked, settings: true });
    } else if (outcome.kind === "unavailable") {
      setNotice({ kind: "error", message: copy.cameraUnavailable });
    }
  }, [navigation, picker]);

  const waiting = view !== null && (view.state === "in_review" || view.state === "completed");
  const exhausted = view !== null && !view.canCapture && !waiting;
  const captureBlocked = !online || (view !== null && !view.uploadAvailable) || picker.busy;

  const primary = (() => {
    if (waiting) return { label: authStrings.status.title, onPress: goStatus, disabled: false, chevron: true };
    if (exhausted) return null;
    return { label: copy.start, onPress: () => void start(), disabled: captureBlocked || query.isLoading, chevron: true };
  })();

  return (
    <Screen
      testID="PrivateCheckCapture"
      padded={false}
      header={<ScreenHeader title={copy.title} testID="PrivateCheckCapture.header" />}
    >
      {!online ? <OfflineBanner testID="PrivateCheckCapture.offline" /> : null}

      <View style={styles.frameWrap}>
        <View style={styles.frame} accessibilityLabel={copy.framePill} accessibilityRole="image" testID="PrivateCheckCapture.frame">
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
          <View style={styles.oval}>
            <Icon name="person" size={150} color="rgba(255,255,255,0.55)" />
          </View>
        </View>
        <View style={styles.pill}>
          <Text variant="rowTitle" color="heading" size={19} lineHeight={23}>
            {copy.framePill}
          </Text>
        </View>
      </View>

      <NumberedList items={copy.steps} size={18.5} style={styles.steps} testID="PrivateCheckCapture.steps" />

      <View style={styles.messages} accessibilityLiveRegion="polite">
        {query.isError && view === null ? (
          <ErrorStateCard title={copy.loadFailedTitle} message={describeError(query.error).message} actionLabel={authStrings.common.retry} onAction={() => void query.refetch()} testID="PrivateCheckCapture.loadError" />
        ) : null}
        {view !== null && view.state === "in_review" ? <Banner kind="notice" size="sm" title={copy.inReviewTitle} message={copy.inReview} testID="PrivateCheckCapture.inReview" /> : null}
        {view !== null && view.state === "completed" ? <Banner kind="success" size="sm" title={copy.completedTitle} message={copy.completed} testID="PrivateCheckCapture.completed" /> : null}
        {view !== null && view.state === "rejected" ? (
          <Banner kind="error" size="sm" title={view.reasonTitle ?? copy.rejectedTitle} message={view.reasonMessage ?? copy.maxAttempts} testID="PrivateCheckCapture.rejected" />
        ) : null}
        {view !== null && !view.uploadAvailable && !waiting && !exhausted ? <Banner kind="warning" size="sm" title={copy.uploadUnavailableTitle} message={copy.uploadUnavailable} testID="PrivateCheckCapture.noUpload" /> : null}
        {notice !== null ? (
          <Banner
            kind={notice.kind}
            size="sm"
            title={notice.title}
            message={notice.message}
            actionLabel={notice.settings === true ? copy.openSettings : undefined}
            onAction={notice.settings === true ? () => void openAppSettings() : undefined}
            testID="PrivateCheckCapture.notice"
          />
        ) : null}
      </View>

      <Card tone="blue" padding={0} radius={18} style={styles.info} testID="PrivateCheckCapture.info">
        <View style={styles.infoIcon}>
          <Icon name="infoMark" size={30} color={colors.onPrimary} />
        </View>
        <View style={styles.infoText}>
          <Text variant="rowTitle" color="heading" size={19} lineHeight={23}>{copy.infoTitle}</Text>
          <Text variant="subtitle" color="muted" size={18} lineHeight={22}>{copy.infoText}</Text>
        </View>
      </Card>

      <View style={styles.actions}>
        {query.isLoading && view === null ? (
          <Skeleton height={59} />
        ) : primary !== null ? (
          <AuthButton size="compact" label={primary.label} onPress={primary.onPress} disabled={primary.disabled} loading={picker.busy} leadingIcon="camera" chevron={primary.chevron} testID="PrivateCheckCapture.start" />
        ) : null}
        {view === null || view.canUseAlternative ? (
          <AuthButton size="compact" label={copy.otherWay} variant="outline" leadingIcon="idCard" onPress={goOtherWay} testID="PrivateCheckCapture.otherWay" />
        ) : null}
      </View>
    </Screen>
  );
}

const CORNER = { width: 30, height: 30, borderColor: "#FFFFFF", position: "absolute" } as const;

const styles = StyleSheet.create({
  frameWrap: { alignItems: "center", marginTop: 8 },
  frame: { width: 313, height: 354, borderRadius: 14, backgroundColor: "#8E959E", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  oval: { width: 255, height: 333, borderRadius: 128, borderWidth: 3, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "flex-end", overflow: "hidden", paddingBottom: 18 },
  corner: CORNER,
  tl: { top: 26, left: 26, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 4 },
  tr: { top: 26, right: 26, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 4 },
  bl: { bottom: 26, left: 26, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 4 },
  br: { bottom: 26, right: 26, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 4 },
  pill: { marginTop: -18, minWidth: 180, height: 33, paddingHorizontal: 18, borderRadius: 17, backgroundColor: colors.bg.tint, alignItems: "center", justifyContent: "center" },
  steps: { marginTop: 14, paddingHorizontal: 54 },
  messages: { paddingHorizontal: 16, marginTop: 10, gap: 10 },
  info: { marginHorizontal: 16, marginTop: 12, flexDirection: "row", alignItems: "center", minHeight: 84 },
  infoIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginLeft: 16, marginRight: 14 },
  infoText: { flex: 1, paddingVertical: 8, paddingRight: 12 },
  actions: { paddingHorizontal: 16, marginTop: 10, gap: 8 },
});
