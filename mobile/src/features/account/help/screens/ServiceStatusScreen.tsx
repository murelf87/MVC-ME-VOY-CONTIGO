/**
 * 36 · «Si algo no va bien». Las cuatro tarjetas de la lámina (sin plazas, destino fuera de provincia, pago rechazado,
 * sin señal GPS), cada una con su salida real, y debajo el estado del servicio: lo que se puede comprobar de verdad desde
 * el móvil (Internet, servidor, base de datos, ubicación). No inventa estados de módulos que MVC no publica.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { isApiError, isOfflineError } from "@/api";
import { strings, formatDateTime, formatRelative } from "@/i18n";
import { useConnectivity } from "@/hooks";
import type { AppScreenProps } from "@/navigation/types";
import { getCurrentPosition, getLastKnownPosition, getLocationPermission, openAppSettings, requestLocationPermission, type DevicePosition } from "@/platform";
import { colors } from "@/theme";
import { BottomSheet, Button, ErrorStateCard, Screen, ScreenHeader, StatusPill, Text, type StatusTone } from "@/ui";
import { getHealthLive, getHealthReady } from "../api";
import { probeFromResult, summarizeService, type ProbeState } from "../logic/status";
import { helpStrings } from "../strings";

const t = helpStrings.status;
type LocationState = keyof typeof t.locationState;

const TONE: Record<ProbeState, StatusTone> = { ok: "green", down: "red", checking: "gray", unknown: "gray" };

async function probe(): Promise<{ server: ProbeState; database: ProbeState }> {
  try {
    await getHealthLive();
  } catch (error) {
    return probeFromResult(isOfflineError(error) ? "offline" : "unreachable");
  }
  try {
    await getHealthReady();
    return probeFromResult("ok");
  } catch (error) {
    if (isOfflineError(error)) return probeFromResult("offline");
    return probeFromResult(isApiError(error) && error.status === 503 ? "not_ready" : "unreachable");
  }
}

function Row({ label, value, tone, testID }: { label: string; value: string; tone: StatusTone; testID: string }): React.JSX.Element {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Text variant="body" color="deep" size={16.5} style={styles.flex}>{label}</Text>
      <StatusPill label={value} tone={tone} size="sm" />
    </View>
  );
}

export function ServiceStatusScreen({ navigation }: AppScreenProps<"ServiceStatus">): React.JSX.Element {
  const net = useConnectivity();
  const [server, setServer] = useState<ProbeState>("checking");
  const [database, setDatabase] = useState<ProbeState>("checking");
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [location, setLocation] = useState<LocationState>("checking");
  const [sheet, setSheet] = useState(false);
  const alive = useRef(true);

  const checkLocation = useCallback(async () => {
    const permission = await getLocationPermission();
    if (!alive.current) return;
    if (permission.status === "granted") {
      const last = await getLastKnownPosition(10 * 60_000);
      if (alive.current) setLocation(last !== null ? "granted" : "gpsOff");
    } else setLocation(permission.status === "blocked" ? "blocked" : permission.status === "unavailable" ? "unavailable" : "denied");
  }, []);

  const check = useCallback(async () => {
    setServer("checking");
    setDatabase("checking");
    setLocation("checking");
    void checkLocation();
    if (net.isOffline) {
      setServer("unknown");
      setDatabase("unknown");
      setCheckedAt(Date.now());
      return;
    }
    const result = await probe();
    if (!alive.current) return;
    setServer(result.server);
    setDatabase(result.database);
    setCheckedAt(Date.now());
  }, [checkLocation, net.isOffline]);

  useEffect(() => {
    alive.current = true;
    void check();
    return () => {
      alive.current = false;
    };
    // Solo al abrir y cuando cambia la conexión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net.isOffline]);

  const summary = summarizeService({ deviceOnline: !net.isOffline, server, database });
  const summaryText = { checking: t.checking, ok: t.summaryOk, offline: t.summaryOffline, server: t.summaryServer, database: t.summaryDatabase }[summary];
  const deviceText = net.isOffline ? t.device.offline : net.type === "wifi" ? t.device.wifi : net.type === "cellular" ? t.device.cellular : t.device.online;
  const serverText = t.serverState[server === "checking" ? "checking" : server === "ok" ? "ok" : server === "down" ? "down" : "unknown"];
  const databaseText = t.databaseState[database === "checking" ? "checking" : database === "ok" ? "ready" : database === "down" ? "notReady" : "unknown"];

  return (
    <Screen testID="ServiceStatus" header={<ScreenHeader title={t.title} testID="ServiceStatus.header" />}>
      <ErrorStateCard testID="ServiceStatus.noSeats" kind="noSeats" actionLabel={t.noSeatsAction} onAction={() => navigation.navigate("MapHome")} style={styles.card} />
      <ErrorStateCard testID="ServiceStatus.outOfProvince" kind="outOfProvince" actionLabel={t.outOfProvinceAction} onAction={() => navigation.navigate("DefineRoute")} style={styles.card} />
      <ErrorStateCard testID="ServiceStatus.paymentRejected" kind="paymentRejected" actionLabel={t.paymentAction} onAction={() => navigation.navigate("PaymentMethods")} style={styles.card} />
      <ErrorStateCard testID="ServiceStatus.gpsOff" kind="gpsOff" actionLabel={t.gpsAction} onAction={() => setSheet(true)} style={styles.card} />

      <Text variant="heading" color="heading" size={20} lineHeight={25} accessibilityRole="header" style={styles.section}>{t.serviceSection}</Text>
      <Text variant="body" color="muted" size={15.5}>{t.serviceIntro}</Text>
      <View style={styles.panel} testID="ServiceStatus.panel">
        <Row testID="ServiceStatus.row.device" label={t.rows.device} value={deviceText} tone={net.isOffline ? "red" : "green"} />
        <Row testID="ServiceStatus.row.server" label={t.rows.server} value={serverText} tone={TONE[server]} />
        <Row testID="ServiceStatus.row.database" label={t.rows.database} value={databaseText} tone={TONE[database]} />
        <Row testID="ServiceStatus.row.location" label={t.rows.location} value={t.locationState[location]} tone={location === "granted" ? "green" : location === "checking" ? "gray" : "amber"} />
      </View>
      <Text variant="body" color="body" size={16} testID="ServiceStatus.summary" accessibilityLiveRegion="polite">{summaryText}</Text>
      {checkedAt !== null ? <Text variant="body" color="muted" size={14.5} testID="ServiceStatus.lastCheck">{t.lastCheck(formatDateTime(checkedAt))}</Text> : null}
      <Button testID="ServiceStatus.recheck" label={summary === "checking" ? t.checking : t.recheck} variant="outline" chevron={false} disabled={summary === "checking"} onPress={() => void check()} style={styles.gapTop} />
      <Text variant="body" color="muted" size={14} style={styles.gapTop} testID="ServiceStatus.limits">{t.limits}</Text>

      <Text variant="heading" color="heading" size={20} lineHeight={25} accessibilityRole="header" style={styles.section}>{t.stillBroken}</Text>
      <Text variant="body" color="muted" size={15.5}>{t.stillBrokenMessage}</Text>
      <Button testID="ServiceStatus.contact" label={t.stillBrokenAction} chevron={false} onPress={() => navigation.navigate("SupportNewTicket")} style={styles.gapTop} />

      <LocationSheet visible={sheet} onClose={() => setSheet(false)} onChanged={() => void checkLocation()} />
    </Screen>
  );
}

function LocationSheet({ visible, onClose, onChanged }: { visible: boolean; onClose: () => void; onChanged: () => void }): React.JSX.Element {
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const [permission, setPermission] = useState<"granted" | "denied" | "blocked" | "unavailable" | "checking">("checking");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const result = await getLocationPermission();
    setPermission(result.status);
    setPosition(result.status === "granted" ? await getLastKnownPosition(24 * 60 * 60_000) : null);
  }, []);
  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const refresh = async (): Promise<void> => {
    setBusy(true);
    setFailed(false);
    const result = await getCurrentPosition({ timeoutMs: 12_000 });
    setBusy(false);
    if (result.ok) {
      setPosition(result.position);
      onChanged();
    } else setFailed(true);
  };
  const allow = async (): Promise<void> => {
    await requestLocationPermission();
    await load();
    onChanged();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t.locationSheetTitle}
      testID="ServiceStatus.locationSheet"
      footer={<Button testID="ServiceStatus.locationSheet.close" label={helpStrings.common.close} variant="outline" chevron={false} onPress={onClose} />}
    >
      {permission === "granted" ? (
        <>
          {position !== null ? (
            <View testID="ServiceStatus.locationSheet.position">
              <Text variant="titleSm" color="heading" size={19}>{t.locationSheetAge(formatRelative(position.timestamp))}</Text>
              {position.accuracyM !== null ? <Text variant="body" color="muted" size={15.5}>{t.locationSheetAccuracy(Math.round(position.accuracyM))}</Text> : null}
            </View>
          ) : (
            <Text variant="body" color="body" size={16.5} testID="ServiceStatus.locationSheet.none">{t.locationSheetNone}</Text>
          )}
          {failed ? <Text variant="body" color="error" size={15.5} testID="ServiceStatus.locationSheet.failed">{t.locationSheetFailed}</Text> : null}
          <Button testID="ServiceStatus.locationSheet.refresh" label={busy ? t.locationSheetRefreshing : t.locationSheetRefresh} chevron={false} loading={busy} onPress={() => void refresh()} style={styles.gapTop} />
        </>
      ) : permission === "blocked" ? (
        <>
          <Text variant="body" color="body" size={16.5}>{t.locationSheetBlocked}</Text>
          <Button testID="ServiceStatus.locationSheet.settings" label={t.locationSheetSettings} chevron={false} onPress={() => void openAppSettings()} style={styles.gapTop} />
        </>
      ) : permission === "checking" ? (
        <Text variant="body" color="muted" size={16}>{strings.common.loading}</Text>
      ) : (
        <>
          <Text variant="body" color="body" size={16.5}>{permission === "unavailable" ? t.locationState.unavailable : t.locationSheetDenied}</Text>
          {permission === "denied" ? <Button testID="ServiceStatus.locationSheet.allow" label={t.locationSheetAllow} chevron={false} onPress={() => void allow()} style={styles.gapTop} /> : null}
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { marginBottom: 14 },
  section: { marginTop: 20, marginBottom: 6 },
  gapTop: { marginTop: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  panel: { marginVertical: 12, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF" },
});
