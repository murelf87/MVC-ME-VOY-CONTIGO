import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Icon, type IconName } from "@/icons";
import { useAppNavigation, useAppRoute, type AppScreenProps } from "@/navigation";
import {
  getCameraPermission,
  getLocationPermission,
  getNotificationPermission,
  isGranted,
  needsSettings,
  openAppSettings,
  requestCameraPermission,
  requestLocationPermission,
  requestNotificationPermission,
  type PermissionResult,
} from "@/platform";
import { colors } from "@/theme";
import { Banner, Button, Screen, ScreenHeader, Spinner, Text } from "@/ui";
import { AuthButton } from "../components/AuthButton";
import { setPromptOutcome, type PromptKind, type PromptOutcome } from "../stores/permissionHandoff";
import { authStrings } from "../strings";

const copy = authStrings.permission;

const ICONS: Record<PromptKind, IconName> = { location: "locate", notifications: "bell", camera: "camera", photos: "image" };

async function read(kind: PromptKind): Promise<PermissionResult> {
  switch (kind) {
    case "location":
      return getLocationPermission();
    case "notifications":
      return getNotificationPermission();
    case "camera":
      return getCameraPermission();
    case "photos":
      // El selector de fotos del sistema no necesita permiso: solo se ve lo que la persona elige.
      return { status: "granted", canAskAgain: false, undetermined: false };
  }
}

async function ask(kind: PromptKind): Promise<PermissionResult> {
  switch (kind) {
    case "location":
      return requestLocationPermission();
    case "notifications":
      return requestNotificationPermission();
    case "camera":
      return requestCameraPermission();
    case "photos":
      return { status: "granted", canAskAgain: false, undetermined: false };
  }
}

type Phase = "checking" | "ask" | "asking" | "granted" | "denied" | "blocked" | "unavailable";

function outcomeOf(phase: Phase): PromptOutcome {
  switch (phase) {
    case "granted":
      return "granted";
    case "blocked":
      return "blocked";
    case "unavailable":
      return "unavailable";
    default:
      return "denied";
  }
}

function phaseOf(result: PermissionResult): Phase {
  if (isGranted(result)) return "granted";
  if (result.status === "unavailable") return "unavailable";
  if (needsSettings(result)) return "blocked";
  return result.undetermined ? "ask" : "denied";
}

/**
 * Permiso del sistema (ubicación, avisos, cámara, fotos). Explica para qué se pide ANTES del diálogo del sistema y
 * deja siempre una salida («Ahora no» / «Buscar sin ubicación»): ningún permiso bloquea el uso de la app. El resultado
 * se deja en `permissionHandoff` y la pantalla de origen lo recoge al recuperar el foco.
 */
export function PermissionPromptScreen(_props: AppScreenProps<"PermissionPrompt">): React.JSX.Element {
  const navigation = useAppNavigation();
  const { kind } = useAppRoute("PermissionPrompt").params;
  const [phase, setPhase] = useState<Phase>("checking");

  useEffect(() => {
    let alive = true;
    void read(kind).then((result) => {
      if (alive) setPhase(phaseOf(result));
    });
    return () => {
      alive = false;
    };
  }, [kind]);

  const close = useCallback(
    (outcome: PromptOutcome) => {
      setPromptOutcome(kind, outcome);
      if (navigation.canGoBack()) navigation.goBack();
    },
    [kind, navigation],
  );

  const allow = useCallback(async () => {
    setPhase("asking");
    const result = await ask(kind);
    setPhase(isGranted(result) ? "granted" : result.status === "unavailable" ? "unavailable" : needsSettings(result) ? "blocked" : "denied");
  }, [kind]);

  const done = phase === "granted";
  const failed = phase === "denied" || phase === "blocked" || phase === "unavailable";

  return (
    <Screen
      testID="PermissionPrompt"
      padded={false}
      header={<ScreenHeader title={copy.titles[kind]} onBack={() => close(done ? "granted" : outcomeOf(phase) === "denied" ? "skipped" : outcomeOf(phase))} testID="PermissionPrompt.header" />}
      footer={
        <View style={styles.footer}>
          {done ? (
            <AuthButton size="compact" label={copy.continue} onPress={() => close("granted")} testID="PermissionPrompt.continue" />
          ) : phase === "blocked" ? (
            <AuthButton size="compact" label={authStrings.photo.permission.openSettings} onPress={() => void openAppSettings()} testID="PermissionPrompt.settings" />
          ) : phase === "unavailable" ? (
            <AuthButton size="compact" label={copy.continue} onPress={() => close("unavailable")} testID="PermissionPrompt.continueWithout" />
          ) : (
            <AuthButton size="compact" label={authStrings.permission.allow} onPress={() => void allow()} loading={phase === "asking" || phase === "checking"} testID="PermissionPrompt.allow" />
          )}
          {!done && phase !== "unavailable" ? (
            <Button label={copy.skip[kind]} variant="ghost" onPress={() => close(failed ? outcomeOf(phase) : "skipped")} testID="PermissionPrompt.skip" />
          ) : null}
        </View>
      }
    >
      <View style={styles.body}>
        <View style={[styles.disc, done ? styles.discOk : null]}>
          <Icon name={done ? "checkCircle" : ICONS[kind]} size={64} color={done ? colors.success.solid : colors.primary} />
        </View>
        <Text variant="title" color="heading" align="center" accessibilityRole="header" style={styles.title}>
          {done ? copy.grantedTitle : phase === "unavailable" ? copy.unavailableTitle : copy.titles[kind]}
        </Text>
        <Text variant="subtitle" color="muted" align="center" size={19} lineHeight={25} style={styles.message}>
          {done ? copy.grantedMessage : phase === "unavailable" ? copy.unavailableMessage : copy.messages[kind]}
        </Text>
        {phase === "checking" ? <Spinner accessibilityLabel={copy.checking} /> : null}
        {phase === "denied" ? <Banner kind="warning" size="sm" message={authStrings.permission.deniedMessage[kind]} testID="PermissionPrompt.denied" /> : null}
        {phase === "blocked" ? <Banner kind="warning" size="sm" title={authStrings.permission.blockedTitle} message={authStrings.permission.blockedMessage[kind]} testID="PermissionPrompt.blocked" /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingTop: 36, alignItems: "center", gap: 14 },
  disc: { width: 132, height: 132, borderRadius: 66, backgroundColor: colors.bg.tint, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  discOk: { backgroundColor: colors.success.bg },
  title: { paddingHorizontal: 8 },
  message: { paddingHorizontal: 8 },
  footer: { paddingHorizontal: 16, gap: 4 },
});
