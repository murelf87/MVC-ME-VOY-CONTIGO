/**
 * Acerca de MVC: nombre, lema, versión de la app (sale de la configuración de Expo, no está escrita a mano), dispositivo,
 * estado real del servidor y accesos a legal, ayuda y estado del servicio. «Copiar datos para soporte» deja en el
 * portapapeles lo que el equipo necesita para ayudar (versión, plataforma, servidor, fecha), sin datos personales.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { MvcLogo } from "@/brand";
import { IS_PREVIEW_BUILD, copyToClipboard } from "@/platform";
import { formatDateTime } from "@/i18n";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { Button, Screen, ScreenHeader, Text, showToast } from "@/ui";
import { getHealthLive } from "../api";
import { getAppInfo } from "../appInfo";
import { SettingsRow } from "../components/SettingsRows";
import { helpStrings } from "../strings";

const t = helpStrings.about;
const st = helpStrings.status;

export function AboutScreen({ navigation }: AppScreenProps<"About">): React.JSX.Element {
  const info = getAppInfo();
  const [server, setServer] = useState<"checking" | "ok" | "down">("checking");
  useEffect(() => {
    let alive = true;
    getHealthLive().then(
      () => alive && setServer("ok"),
      () => alive && setServer("down"),
    );
    return () => {
      alive = false;
    };
  }, []);
  const platform = info.runtime === "ios" ? t.platformIos : info.runtime === "android" ? t.platformAndroid : t.platformWeb;
  const version = info.version !== null ? `${info.version}${info.build !== null ? ` (${info.build})` : ""}` : "—";
  const serverText = server === "checking" ? st.serverState.checking : server === "ok" ? st.serverState.ok : st.serverState.down;

  const copy = async (): Promise<void> => {
    const text = [t.copyHeader, `${t.versionLabel}: ${version}`, `${t.platformLabel}: ${platform}`, `${t.serverLabel}: ${serverText}`, formatDateTime(Date.now())].join("\n");
    const ok = await copyToClipboard(text);
    showToast({ kind: ok ? "success" : "error", message: ok ? t.copied : helpStrings.common.loadErrorTitle, id: "about.copy" });
  };

  return (
    <Screen testID="About" header={<ScreenHeader title={t.title} testID="About.header" />}>
      <View style={styles.hero}>
        <MvcLogo variant="stacked" width={150} />
        <Text variant="heading" color="heading" size={24} lineHeight={30} accessibilityRole="header">{t.name}</Text>
        <Text variant="body" color="deep" size={17}>{t.tagline}</Text>
        <Text variant="body" color="muted" size={15.5} style={styles.center}>{t.description}</Text>
        <Text variant="body" color="muted" size={15} style={styles.center}>{t.province}</Text>
      </View>
      <View style={styles.panel} testID="About.info">
        <View style={styles.row}><Text variant="body" color="muted" size={16} style={styles.flex}>{t.versionLabel}</Text><Text variant="body" color="deep" size={16.5} testID="About.version">{version}</Text></View>
        <View style={styles.row}><Text variant="body" color="muted" size={16} style={styles.flex}>{t.platformLabel}</Text><Text variant="body" color="deep" size={16.5}>{platform}</Text></View>
        <View style={styles.row}><Text variant="body" color="muted" size={16} style={styles.flex}>{t.serverLabel}</Text><Text variant="body" color="deep" size={16.5} testID="About.server">{serverText}</Text></View>
      </View>
      {IS_PREVIEW_BUILD ? <Text variant="body" color="muted" size={14.5} style={styles.note} testID="About.previewNote">{t.previewNote}</Text> : null}
      <Button testID="About.copy" label={t.copyInfo} variant="outline" chevron={false} onPress={() => void copy()} style={styles.gap} />
      <View style={styles.gap} />
      <SettingsRow testID="About.legal" icon="documentOutline" title={t.rowLegal} tone="white" onPress={() => navigation.navigate("LegalCenter")} />
      <View style={styles.rowGap} />
      <SettingsRow testID="About.help" icon="chatHelp" title={t.rowHelp} tone="white" onPress={() => navigation.navigate("HelpCenter")} />
      <View style={styles.rowGap} />
      <SettingsRow testID="About.status" icon="signal" title={t.rowStatus} tone="white" onPress={() => navigation.navigate("ServiceStatus")} />
      <Text variant="body" color="muted" size={14} style={styles.footer}>{t.footer}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: "center" },
  hero: { alignItems: "center", gap: 8, paddingVertical: 12 },
  panel: { marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF" },
  row: { flexDirection: "row", alignItems: "center", minHeight: 40, gap: 10 },
  note: { marginTop: 10 },
  gap: { marginTop: 14 },
  rowGap: { height: 8 },
  footer: { marginTop: 20, textAlign: "center" },
});
