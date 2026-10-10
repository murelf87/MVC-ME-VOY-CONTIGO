/**
 * Permisos de la app (público): ubicación, notificaciones y cámara con su estado real en este móvil, para qué se usan, y la
 * acción que toca: pedirlo (si el sistema aún deja) o abrir los ajustes del móvil (si se ha bloqueado). Se vuelve a leer
 * al volver de los ajustes. No se usa el micrófono ni la ubicación en segundo plano.
 */
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getCameraPermission, getLocationPermission, getNotificationPermission, openAppSettings, requestCameraPermission, requestLocationPermission, requestNotificationPermission, type PermissionResult } from "@/platform";
import { useAppActive } from "@/hooks";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { Button, Screen, ScreenHeader, StatusPill, Text, showToast, type StatusTone } from "@/ui";
import { helpStrings } from "../strings";

const t = helpStrings.permissions;
type Kind = "location" | "notifications" | "camera";

const READ: Record<Kind, () => Promise<PermissionResult>> = { location: getLocationPermission, notifications: getNotificationPermission, camera: getCameraPermission };
const ASK: Record<Kind, () => Promise<PermissionResult>> = { location: requestLocationPermission, notifications: requestNotificationPermission, camera: requestCameraPermission };

function label(result: PermissionResult | null): { text: string; tone: StatusTone } {
  if (result === null) return { text: "…", tone: "gray" };
  if (result.status === "granted") return { text: t.status.granted, tone: "green" };
  if (result.status === "blocked") return { text: t.status.blocked, tone: "red" };
  if (result.status === "unavailable") return { text: t.status.unavailable, tone: "gray" };
  return { text: result.undetermined ? t.status.undetermined : t.status.denied, tone: "amber" };
}

export function AppPermissionsScreen(_props: AppScreenProps<"AppPermissions">): React.JSX.Element {
  const [state, setState] = useState<Record<Kind, PermissionResult | null>>({ location: null, notifications: null, camera: null });
  const active = useAppActive();

  const load = useCallback(async () => {
    const [location, notifications, camera] = await Promise.all([READ.location(), READ.notifications(), READ.camera()]);
    setState({ location, notifications, camera });
  }, []);
  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const ask = async (kind: Kind): Promise<void> => {
    await ASK[kind]();
    await load();
  };
  const settings = async (): Promise<void> => {
    const ok = await openAppSettings();
    if (!ok) showToast({ kind: "error", message: t.settingsFailed, id: "permissions.settings" });
  };

  const items: Array<{ kind: Kind; title: string; reason: string }> = [
    { kind: "location", title: t.location.title, reason: t.location.reason },
    { kind: "notifications", title: t.notifications.title, reason: t.notifications.reason },
    { kind: "camera", title: t.camera.title, reason: t.camera.reason },
  ];

  return (
    <Screen testID="AppPermissions" header={<ScreenHeader title={t.title} testID="AppPermissions.header" />}>
      <Text variant="body" color="muted" size={16} lineHeight={22}>{t.intro}</Text>
      {items.map(({ kind, title, reason }) => {
        const result = state[kind];
        const l = label(result);
        const canAsk = result !== null && result.status === "denied" && result.canAskAgain;
        const needsSettings = result !== null && (result.status === "blocked" || (result.status === "denied" && !result.canAskAgain));
        return (
          <View key={kind} style={styles.card} testID={`AppPermissions.${kind}`}>
            <View style={styles.head}>
              <Text variant="titleSm" color="heading" size={18} style={styles.flex}>{title}</Text>
              <StatusPill label={l.text} tone={l.tone} size="sm" />
            </View>
            <Text variant="body" color="body" size={15.5}>{reason}</Text>
            {canAsk ? <Button testID={`AppPermissions.${kind}.allow`} label={t.actionAllow} size="sm" chevron={false} onPress={() => void ask(kind)} style={styles.gapSmall} /> : null}
            {needsSettings ? (
              <>
                <Text variant="body" color="muted" size={14.5}>{t.settingsHint}</Text>
                <Button testID={`AppPermissions.${kind}.settings`} label={t.actionSettings} variant="outline" size="sm" chevron={false} onPress={() => void settings()} style={styles.gapSmall} />
              </>
            ) : null}
          </View>
        );
      })}
      <Text variant="body" color="muted" size={14.5} style={styles.footer} testID="AppPermissions.footer">{t.footer}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  gapSmall: { marginTop: 8 },
  card: { marginTop: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 6 },
  footer: { marginTop: 18 },
});
