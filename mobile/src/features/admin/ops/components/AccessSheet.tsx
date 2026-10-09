/**
 * «Tu acceso al panel»: hoja que abre el avatar de la cabecera. Dice quién eres, qué roles de personal tienes y qué puedes
 * hacer en cada área (lo que lee el servidor en `GET /v1/admin/me`; mientras no responde, lo deducido de tus roles) y
 * lleva al inicio del panel. El servidor vuelve a comprobar cada acción.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { AdminPermission } from "@/api/types";
import { colors } from "@/theme";
import { BottomSheet, Button, StatusPill, Text, type StatusTone } from "@/ui";
import type { OpsAccess } from "../model/permissions";
import { opsStrings } from "../strings";

const TONES: Record<AdminPermission, StatusTone> = { write: "green", read: "blue", none: "gray" };

export interface AccessSheetProps {
  visible: boolean;
  access: OpsAccess;
  onClose: () => void;
  onGoHome: () => void;
}

interface AreaLine {
  key: string;
  label: string;
  level: AdminPermission;
  /** Texto de la píldora si no es el estándar del nivel. */
  pill?: string;
}

export function AccessSheet({ visible, access, onClose, onGoHome }: AccessSheetProps): React.JSX.Element {
  const a = opsStrings.access;
  const lines: AreaLine[] = [
    { key: "tariffs", label: a.areas.tariffs, level: access.permissions.tariffs },
    { key: "operations", label: a.areas.operations, level: access.permissions.operations },
    { key: "alerts", label: a.areas.alerts, level: access.permissions.alerts },
    { key: "audit", label: a.areas.audit, level: access.permissions.audit },
    { key: "legal", label: a.areas.legal, level: access.permissions.legal },
    { key: "support", label: a.areas.support, level: access.permissions.support },
    { key: "payouts", label: a.areas.payouts, level: access.payouts ? "write" : "none", pill: access.payouts ? a.payoutsYes : a.payoutsNo },
  ];
  const roles = access.roles.length === 0 ? a.noRoles : access.roles.map((role) => a.roleLabels[role]).join(" · ");
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={a.sheetTitle}
      subtitle={access.displayName ?? undefined}
      testID="OpsAccessSheet"
      footer={<Button label={opsStrings.access.goHome} chevron={false} onPress={onGoHome} testID="OpsAccessSheet.home" />}
    >
      <Text variant="body" color="muted" size={15.5} lineHeight={20} testID="OpsAccessSheet.intro">
        {a.sheetSubtitle}
      </Text>
      <Text variant="rowTitle" color="heading" size={17} style={styles.sectionTitle}>
        {a.rolesLabel}
      </Text>
      <Text variant="body" color="body" style={styles.roles} testID="OpsAccessSheet.roles">
        {roles}
      </Text>
      <View accessibilityRole="list" style={styles.list}>
        {lines.map((line) => (
          <View key={line.key} testID={`OpsAccessSheet.area.${line.key}`} accessible accessibilityLabel={`${line.label}: ${line.pill ?? a.levels[line.level]}`} style={styles.line}>
            <Text variant="body" color={line.level === "none" ? "subtle" : "body"} size={16} lineHeight={20} style={styles.lineLabel} numberOfLines={2}>
              {line.label}
            </Text>
            <StatusPill label={line.pill ?? a.levels[line.level]} tone={TONES[line.level]} size="sm" />
          </View>
        ))}
      </View>
      <Text variant="caption" color="subtle" size={13.5} lineHeight={18} style={styles.note} testID="OpsAccessSheet.note">
        {access.confirmed ? a.confirmedFromServer : a.deducedFromRoles}
      </Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { marginTop: 16 },
  roles: { marginTop: 4 },
  list: { marginTop: 12 },
  line: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.border.divider,
    paddingVertical: 6,
  },
  lineLabel: { flex: 1, paddingRight: 10 },
  note: { marginTop: 14 },
});
