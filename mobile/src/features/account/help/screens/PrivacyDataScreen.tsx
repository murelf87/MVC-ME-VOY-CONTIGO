/**
 * Privacidad y datos: punto de entrada a los derechos de la persona sobre sus datos (copia, bloqueados, legal, consultas,
 * permisos y eliminación). Cada fila abre su pantalla; no hay nada decorativo.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { AppScreenProps } from "@/navigation/types";
import { Screen, ScreenHeader, Text } from "@/ui";
import { SettingsRow } from "../components/SettingsRows";
import { helpStrings } from "../strings";

const t = helpStrings.privacy;

export function PrivacyDataScreen({ navigation }: AppScreenProps<"PrivacyData">): React.JSX.Element {
  return (
    <Screen testID="PrivacyData" header={<ScreenHeader title={t.title} testID="PrivacyData.header" />}>
      <Text variant="body" color="muted" size={16} style={styles.intro}>{t.intro}</Text>

      <Text variant="heading" color="heading" size={20} lineHeight={25} accessibilityRole="header" style={styles.section}>{t.sectionData}</Text>
      <SettingsRow testID="PrivacyData.exports" icon="download" title={t.exportTitle} subtitle={t.exportSubtitle} tone="white" onPress={() => navigation.navigate("DataExports")} />
      <View style={styles.gap} />
      <SettingsRow testID="PrivacyData.blocked" icon="person" title={t.blockedTitle} subtitle={t.blockedSubtitle} tone="white" onPress={() => navigation.navigate("BlockedUsers")} />
      <View style={styles.gap} />
      <SettingsRow testID="PrivacyData.permissions" icon="lock" title={helpStrings.permissions.title} subtitle={helpStrings.permissions.intro.split(".")[0] ?? ""} tone="white" onPress={() => navigation.navigate("AppPermissions")} />

      <Text variant="heading" color="heading" size={20} lineHeight={25} accessibilityRole="header" style={styles.section}>{t.sectionInfo}</Text>
      <SettingsRow testID="PrivacyData.legal" icon="documentOutline" title={t.legalTitle} subtitle={t.legalSubtitle} tone="white" onPress={() => navigation.navigate("LegalCenter")} />
      <View style={styles.gap} />
      <SettingsRow testID="PrivacyData.tickets" icon="chatHelp" title={t.ticketsTitle} subtitle={t.ticketsSubtitle} tone="white" onPress={() => navigation.navigate("SupportTickets")} />

      <Text variant="heading" color="heading" size={20} lineHeight={25} accessibilityRole="header" style={styles.section}>{t.sectionDanger}</Text>
      <SettingsRow testID="PrivacyData.delete" icon="trash" title={t.deleteTitle} subtitle={t.deleteSubtitle} tone="white" destructive onPress={() => navigation.navigate("DeleteAccount")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginBottom: 4 },
  section: { marginTop: 22, marginBottom: 8 },
  gap: { height: 8 },
});
