/**
 * Ajustes de notificaciones (sin lámina; se diseña con la 27 al lado). Tipos de avisos (el esencial es fijo; llegada y
 * mensajes se pueden apagar), permiso de notificaciones del móvil (pedir · abrir Ajustes · no disponible) y móviles
 * registrados. Honestidad: el servidor dice si ya envía avisos fuera de la app; si no, se explica y no se promete nada.
 */
import React from "react";
import { AppState, StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { NotificationPreferencesPatch } from "@/api/types";
import { IconTile } from "@/icons/IconTile";
import type { AppScreenProps } from "@/navigation/types";
import { Banner, Button, ErrorStateCard, ListRow, Screen, ScreenHeader, Skeleton, Switch, Text, showToast } from "@/ui";
import { useNotificationPreferences, usePatchNotificationPreferences } from "../hooks/useNotifications";
import { usePushDevice, type RegisterOutcome } from "../hooks/usePushDevice";
import { messagesStrings } from "../strings";

const copy = messagesStrings.settings;
const SIDE = 14;

const OUTCOME_MESSAGE: Record<Exclude<RegisterOutcome, "registered">, string> = {
  permission_denied: copy.systemDeniedBody,
  permission_blocked: copy.systemDeniedBody,
  no_project_id: copy.registerFailed,
  unavailable: copy.systemUnavailableBody,
  failed: copy.registerFailed,
};

export function NotificationSettingsScreen(_props: AppScreenProps<"NotificationSettings">): React.JSX.Element {
  const prefs = useNotificationPreferences();
  const patch = usePatchNotificationPreferences();
  const device = usePushDevice();
  const header = <ScreenHeader title={copy.title} testID="NotificationSettings.header" />;

  // Al volver de Ajustes del sistema se vuelve a leer el permiso.
  const { recheck } = device;
  React.useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void recheck();
    });
    return () => sub.remove();
  }, [recheck]);

  const data = prefs.data;
  const pendingValue = (key: "arrivalAlerts" | "messages"): boolean => {
    const v = patch.variables as NotificationPreferencesPatch | undefined;
    if (patch.isPending && v?.[key] !== undefined) return v[key] as boolean;
    return data?.[key] ?? true;
  };

  const toggle = async (key: "arrivalAlerts" | "messages", value: boolean): Promise<void> => {
    const saved = await patch.mutate({ [key]: value });
    showToast(saved ? { kind: "success", message: copy.saved } : { kind: "error", message: copy.saveFailed });
  };

  const enable = async (): Promise<void> => {
    const outcome = await device.enable();
    if (outcome === "registered") showToast({ kind: "success", message: copy.registered });
    else showToast({ kind: "error", message: OUTCOME_MESSAGE[outcome] });
  };

  if (data === undefined) {
    return (
      <Screen testID="NotificationSettings" paddingX={SIDE} header={header}>
        <View style={styles.block}>
          {prefs.error ? (
            <ErrorStateCard testID="NotificationSettings.error" tone="red" icon="alertCircle" title={copy.loadError} message={describeError(prefs.error).message} actionLabel={messagesStrings.common.retry} onAction={() => void prefs.refetch()} />
          ) : (
            <View testID="NotificationSettings.loading" accessible accessibilityLabel={messagesStrings.common.updating} accessibilityState={{ busy: true }}>
              <Skeleton height={70} radius={16} />
              <Skeleton height={70} radius={16} style={styles.gap} />
              <Skeleton height={70} radius={16} style={styles.gap} />
            </View>
          )}
        </View>
      </Screen>
    );
  }

  const permission = device.permission;
  const registered = device.tokens.data?.length ?? data.push.registeredDevices;
  let system: React.ReactNode = null;
  if (permission !== null) {
    if (permission.status === "granted") {
      system = (
        <>
          <Banner testID="NotificationSettings.systemGranted" kind="success" size="sm" title={copy.systemGrantedTitle} message={copy.systemGrantedBody} />
          {registered === 0 ? <Button testID="NotificationSettings.register" label={copy.registerAction} variant="outline" chevron={false} loading={device.busy} onPress={() => void enable()} style={styles.gap} /> : null}
        </>
      );
    } else if (permission.status === "blocked") {
      system = (
        <>
          <Banner testID="NotificationSettings.systemDenied" kind="warning" size="sm" title={copy.systemDeniedTitle} message={copy.systemDeniedBody} />
          <Button testID="NotificationSettings.openSettings" label={copy.systemDeniedAction} variant="outline" chevron={false} onPress={() => void device.openSystemSettings()} style={styles.gap} />
        </>
      );
    } else if (permission.status === "denied") {
      system = (
        <>
          <Banner testID="NotificationSettings.systemAsk" kind="info" size="sm" title={copy.systemAskTitle} message={copy.systemAskBody} />
          <Button testID="NotificationSettings.allow" label={copy.systemAskAction} loading={device.busy} onPress={() => void enable()} style={styles.gap} />
        </>
      );
    } else {
      system = (
        <>
          <Banner testID="NotificationSettings.systemUnavailable" kind="notice" size="sm" title={copy.systemUnavailableTitle} message={copy.systemUnavailableBody} />
          <Button testID="NotificationSettings.recheck" label={copy.systemRetry} variant="outline" chevron={false} onPress={() => void device.recheck()} style={styles.gap} />
        </>
      );
    }
  }

  return (
    <Screen testID="NotificationSettings" paddingX={SIDE} header={header} refreshing={prefs.isRefreshing} onRefresh={() => void prefs.refetch()}>
      <View style={styles.block}>
        <Text variant="body" color="body" size={16} lineHeight={22} testID="NotificationSettings.intro">{copy.intro}</Text>

        <Text variant="titleSm" color="heading" size={19} style={styles.section}>{copy.sectionTypes}</Text>
        <ListRow
          testID="NotificationSettings.essential"
          title={messagesStrings.notifications.essentialTitle}
          subtitle={`${messagesStrings.notifications.essentialBody} ${copy.lockedBadge}.`}
          titleSize={17}
          leading={<IconTile name="car" tone="white" size={46} iconSize={26} />}
          trailing={<Switch testID="NotificationSettings.essentialSwitch" value disabled tone="blue" onValueChange={() => undefined} accessibilityLabel={copy.essentialLockedA11y} />}
          style={styles.gap}
        />
        <ListRow
          testID="NotificationSettings.arrival"
          title={copy.arrivalTitle}
          subtitle={copy.arrivalBody}
          titleSize={17}
          leading={<IconTile name="bell" tone="white" size={46} iconSize={26} />}
          trailing={<Switch testID="NotificationSettings.arrivalSwitch" value={pendingValue("arrivalAlerts")} disabled={patch.isPending} tone="blue" onValueChange={(v) => void toggle("arrivalAlerts", v)} accessibilityLabel={copy.arrivalTitle} />}
          style={styles.gap}
        />
        <ListRow
          testID="NotificationSettings.messages"
          title={copy.messagesTitle}
          subtitle={copy.messagesBody}
          titleSize={17}
          leading={<IconTile name="chat" tone="white" size={46} iconSize={26} />}
          trailing={<Switch testID="NotificationSettings.messagesSwitch" value={pendingValue("messages")} disabled={patch.isPending} tone="blue" onValueChange={(v) => void toggle("messages", v)} accessibilityLabel={copy.messagesTitle} />}
          style={styles.gap}
        />

        <Text variant="titleSm" color="heading" size={19} style={styles.section}>{copy.sectionSystem}</Text>
        <View style={styles.gap}>{system}</View>

        <Text variant="titleSm" color="heading" size={19} style={styles.section}>{copy.sectionDevice}</Text>
        <Text variant="body" color="body" size={16} style={styles.gap} testID="NotificationSettings.deviceCount">{copy.deviceCount(registered)}</Text>
        {data.push.available ? (
          <Banner testID="NotificationSettings.pushOn" kind="success" size="sm" title={copy.pushAvailableTitle} style={styles.gap} />
        ) : (
          <Banner testID="NotificationSettings.pushOff" kind="notice" size="sm" title={copy.pushUnavailableTitle} message={copy.pushUnavailableBody} style={styles.gap} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { paddingTop: 8, paddingBottom: 24 },
  gap: { marginTop: 10 },
  section: { marginTop: 22 },
});
