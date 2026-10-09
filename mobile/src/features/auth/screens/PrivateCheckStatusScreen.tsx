import React, { useCallback, useMemo, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { describeError } from "@/api/errors";
import { queryCache, useIsOnline } from "@/hooks";
import { Icon } from "@/icons";
import { applyGate, useAppNavigation, type AppScreenProps } from "@/navigation";
import { openAppSettings } from "@/platform";
import { useAuth } from "@/session";
import { colors } from "@/theme";
import { Banner, Card, ErrorStateCard, OfflineBanner, Screen, ScreenHeader, Skeleton, Text } from "@/ui";
import { AuthButton } from "../components/AuthButton";
import { TRUST, usePrivateCheckState } from "../hooks/useTrust";
import { useImagePicker } from "../hooks/useImagePicker";
import { validateLocalFile } from "../logic/uploads";
import { deriveCheckView, type CheckView, type StripStep } from "../logic/verification";
import { authStrings } from "../strings";

const copy = authStrings.status;
const STEPS: readonly StripStep[] = ["in_review", "retry", "completed"];
/** Mientras la captura está en revisión se vuelve a preguntar al servidor cada 15 s. */
const POLL_MS = 15_000;

/**
 * 08 · Estado de la comprobación. Franja «En revisión · Repetir · Completada» (solo se ilumina el tramo que dice el
 * servidor), tarjeta con el motivo, la captura desenfocada, consejos y acciones. Nunca marca «completada» sin que el
 * servidor lo diga y recuerda que la selfie no acredita la identidad por sí sola.
 */
export function PrivateCheckStatusScreen(_props: AppScreenProps<"PrivateCheckStatus">): React.JSX.Element {
  const navigation = useAppNavigation();
  const online = useIsOnline();
  const { onboardingRequirements } = useAuth();
  const picker = useImagePicker();
  const query = usePrivateCheckState({ pollMs: POLL_MS });
  const view = useMemo(() => (query.data !== undefined ? deriveCheckView(query.data) : null), [query.data]);
  const [notice, setNotice] = useState<{ kind: "warning" | "error"; title?: string; message: string; settings?: boolean } | null>(null);

  const retry = useCallback(async () => {
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
      setNotice({ kind: "warning", title: authStrings.check.cameraBlockedTitle, message: authStrings.check.cameraBlocked });
    } else if (outcome.kind === "blocked") {
      setNotice({ kind: "warning", title: authStrings.check.cameraBlockedTitle, message: authStrings.check.cameraBlocked, settings: true });
    } else if (outcome.kind === "unavailable") {
      setNotice({ kind: "error", message: authStrings.check.cameraUnavailable });
    }
  }, [navigation, picker]);

  const refresh = useCallback(async () => {
    await queryCache.invalidate(TRUST);
    await query.refetch();
  }, [query]);

  const done = useCallback(() => {
    if (onboardingRequirements.length > 0) {
      const decision = applyGate();
      if (decision !== null) return;
    }
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation, onboardingRequirements.length]);

  const goHelp = useCallback(() => navigation.navigate("HelpCenter", undefined), [navigation]);
  const goOtherWay = useCallback(() => navigation.navigate("PrivateCheckOtherWay", undefined), [navigation]);

  return (
    <Screen
      testID="PrivateCheckStatus"
      padded={false}
      header={<ScreenHeader title={copy.title} testID="PrivateCheckStatus.header" />}
      onRefresh={() => void refresh()}
      refreshing={query.isFetching && view !== null}
    >
      {!online ? <OfflineBanner testID="PrivateCheckStatus.offline" /> : null}

      {query.isLoading && view === null ? (
        <View style={styles.pad}>
          <Skeleton height={64} />
          <Skeleton height={220} style={styles.gap} />
        </View>
      ) : null}

      {query.isError && view === null ? (
        <View style={styles.pad}>
          <ErrorStateCard title={copy.loadFailedTitle} message={describeError(query.error).message} actionLabel={authStrings.common.retry} onAction={() => void query.refetch()} testID="PrivateCheckStatus.loadError" />
        </View>
      ) : null}

      {view !== null ? (
        <>
          <Strip step={view.step} />
          <ResultCard view={view} />
          {view.state === "needs_retry" || view.state === "rejected" || view.state === "not_started" ? <Tips /> : null}
          <View style={styles.messages} accessibilityLiveRegion="polite">
            {view.state === "completed" ? <Text variant="caption" color="muted" align="center">{copy.completedNote}</Text> : null}
            {!view.uploadAvailable && view.canCapture ? <Banner kind="warning" size="sm" title={authStrings.check.uploadUnavailableTitle} message={authStrings.check.uploadUnavailable} testID="PrivateCheckStatus.noUpload" /> : null}
            {notice !== null ? (
              <Banner
                kind={notice.kind}
                size="sm"
                title={notice.title}
                message={notice.message}
                actionLabel={notice.settings === true ? authStrings.check.openSettings : undefined}
                onAction={notice.settings === true ? () => void openAppSettings() : undefined}
                testID="PrivateCheckStatus.notice"
              />
            ) : null}
          </View>
          <View style={styles.actions}>
            {view.state === "needs_retry" || view.state === "not_started" ? (
              <AuthButton size="compact" label={view.state === "not_started" ? copy.notStartedAction : copy.retry} leadingIcon="camera" onPress={() => void retry()} loading={picker.busy} disabled={!online || !view.uploadAvailable} testID="PrivateCheckStatus.retry" />
            ) : null}
            {view.state === "rejected" && view.canUseAlternative ? <AuthButton size="compact" label={copy.otherWay} leadingIcon="idCard" onPress={goOtherWay} testID="PrivateCheckStatus.otherWay" /> : null}
            {view.state === "in_review" ? <AuthButton size="compact" label={copy.refresh} variant="outline" leadingIcon="refresh" onPress={() => void refresh()} loading={query.isFetching} testID="PrivateCheckStatus.refresh" /> : null}
            {view.state === "completed" ? <AuthButton size="compact" label={authStrings.privacy.continue} onPress={done} testID="PrivateCheckStatus.done" /> : null}
            {view.state !== "completed" ? <AuthButton size="compact" label={copy.help} variant="outline" leadingIcon="chatEllipses" onPress={goHelp} testID="PrivateCheckStatus.help" /> : null}
            {view.state === "needs_retry" && view.canUseAlternative ? <AuthButton size="compact" label={copy.otherWay} variant="outline" leadingIcon="idCard" onPress={goOtherWay} testID="PrivateCheckStatus.otherWay" /> : null}
          </View>
          <Text variant="subtitle" color="muted" align="right" size={18} lineHeight={22} style={styles.attempts} accessibilityLabel={copy.attemptsA11y(view.used, view.max)} testID="PrivateCheckStatus.attempts">
            {view.attemptsLabel}
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

function Strip({ step }: { step: StripStep | null }): React.JSX.Element {
  return (
    <View style={styles.strip} accessibilityRole="tablist" testID="PrivateCheckStatus.strip">
      {STEPS.map((id) => {
        const active = step === id;
        const tone = id === "retry" ? colors.warning.solid : id === "completed" ? colors.success.solid : colors.primary;
        return (
          <View
            key={id}
            style={[styles.stripItem, active ? { borderBottomColor: tone } : null]}
            accessible
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={copy.steps[id]}
            testID={`PrivateCheckStatus.step.${id}`}
          >
            <View style={[styles.stripDisc, { backgroundColor: active ? tone : colors.gray.icon }]}>
              {id === "in_review" ? <View style={styles.dot} /> : <Icon name={id === "retry" ? "exclaim" : "check"} size={id === "retry" ? 26 : 24} color={colors.onPrimary} />}
            </View>
            <Text variant="rowTitle" color={active ? "heading" : "muted"} weight={active ? "bold" : "regular"} size={17.5} lineHeight={21} style={active ? { color: tone } : undefined}>
              {copy.steps[id]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function ResultCard({ view }: { view: CheckView }): React.JSX.Element {
  const kind = view.state;
  const spec = (() => {
    switch (kind) {
      case "needs_retry":
        return { bg: colors.warning.bgSoft, border: colors.warning.border, disc: colors.warning.solid, title: view.reasonTitle ?? authStrings.check.retryTitle, titleColor: colors.error.text, message: view.reasonMessage ?? "", badge: "closeBold" as const, badgeBg: colors.error.solid };
      case "rejected":
        return { bg: colors.error.bg, border: colors.error.borderSoft, disc: colors.error.solid, title: view.reasonTitle ?? copy.rejectedFallbackTitle, titleColor: colors.error.strong, message: view.reasonMessage ?? authStrings.check.rejected, badge: "closeBold" as const, badgeBg: colors.error.solid };
      case "completed":
        return { bg: colors.success.bg, border: colors.success.border, disc: colors.success.solid, title: copy.completedTitle, titleColor: colors.success.strong, message: copy.completed, badge: "checkBold" as const, badgeBg: colors.success.solid };
      case "in_review":
        return { bg: colors.info.bg, border: colors.bg.tintStrong, disc: colors.primary, title: copy.inReviewTitle, titleColor: colors.heading, message: copy.inReview, badge: null, badgeBg: colors.primary };
      case "not_started":
        return { bg: colors.info.bg, border: colors.bg.tintStrong, disc: colors.primary, title: copy.notStartedTitle, titleColor: colors.heading, message: copy.notStartedMessage, badge: null, badgeBg: colors.primary };
    }
  })();
  const glyph = kind === "needs_retry" || kind === "rejected" ? "exclaim" : kind === "completed" ? "check" : "infoMark";
  return (
    <Card tone="white" padding={0} radius={20} style={[styles.result, { backgroundColor: spec.bg, borderColor: spec.border }]} testID="PrivateCheckStatus.result">
      <View style={styles.resultHead}>
        <View style={[styles.resultDisc, { backgroundColor: spec.disc }]}>
          <Icon name={glyph} size={34} color={colors.onPrimary} />
        </View>
        <Text variant="title" size={22.5} lineHeight={27} style={[styles.resultTitle, { color: spec.titleColor }]} accessibilityRole="header">
          {spec.title}
        </Text>
      </View>
      <Text variant="subtitle" color="heading" align="center" size={18.5} lineHeight={24} style={styles.resultText}>
        {spec.message}
      </Text>
      {view.previewUrl !== null && kind !== "not_started" ? (
        <View style={styles.thumbWrap}>
          <View style={styles.thumb} accessibilityRole="image" accessibilityLabel={copy.thumbnailA11y}>
            <Image source={{ uri: view.previewUrl }} blurRadius={5} resizeMode="cover" style={styles.thumbImage} />
          </View>
          {spec.badge !== null ? (
            <View style={[styles.thumbBadge, { backgroundColor: spec.badgeBg }]}>
              <Icon name={spec.badge} size={22} color={colors.onPrimary} />
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function Tips(): React.JSX.Element {
  return (
    <Card tone="blue" padding={0} radius={18} style={styles.tips} testID="PrivateCheckStatus.tips">
      <Text variant="rowTitle" color="heading" size={19} lineHeight={23} style={styles.tipsTitle}>
        {copy.tipsTitle}
      </Text>
      {copy.tips.map((tip) => (
        <View key={tip} style={styles.tip}>
          <Icon name="checkCircle" size={28} color={colors.success.solid} />
          <Text variant="body" color="body" size={18.5} lineHeight={22}>
            {tip}
          </Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 16 },
  gap: { marginTop: 12 },
  strip: { flexDirection: "row", marginHorizontal: 16, marginTop: 6, borderRadius: 16, backgroundColor: colors.bg.tint, overflow: "hidden" },
  stripItem: { flex: 1, alignItems: "center", paddingTop: 8, paddingBottom: 6, borderBottomWidth: 3, borderBottomColor: "transparent", gap: 4 },
  stripDisc: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.onPrimary },
  result: { marginHorizontal: 16, marginTop: 12, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  resultHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  resultDisc: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center" },
  resultTitle: { flex: 1 },
  resultText: { marginTop: 10, paddingHorizontal: 24 },
  thumbWrap: { alignItems: "center", marginTop: 12 },
  thumb: { width: 192, height: 132, borderRadius: 22, overflow: "hidden", backgroundColor: colors.gray.ring, borderWidth: 2, borderColor: colors.bg.white },
  thumbImage: { width: "100%", height: "100%" },
  thumbBadge: { position: "absolute", right: 72, bottom: -10, width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: colors.bg.white },
  tips: { marginHorizontal: 16, marginTop: 12, paddingBottom: 6 },
  tipsTitle: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4 },
  tip: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 3 },
  messages: { paddingHorizontal: 16, marginTop: 10, gap: 8 },
  actions: { paddingHorizontal: 16, marginTop: 12, gap: 8 },
  attempts: { paddingHorizontal: 20, marginTop: 8 },
});
