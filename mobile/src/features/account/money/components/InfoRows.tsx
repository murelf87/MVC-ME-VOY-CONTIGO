import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors } from "@/theme";
import { Text, surfaces } from "@/ui";
import { ink } from "./metrics";

// ── «Comisión de la plataforma · Por definir» ───────────────────────────────────────────────────────────────────

export interface CommissionRowProps {
  label: string;
  /** «Por definir» mientras no haya comisión aprobada, o el porcentaje. */
  value: string;
  /** `a` = 33b (icono en x 26,5) · `b` = 34b (icono en x 33,5). */
  variant?: "a" | "b";
  onPress: () => void;
  accessibilityHint?: string;
  testID: string;
}

/**
 * Fila azul de la lámina 33b y 34b: círculo «?», «Comisión de la plataforma», valor y chevron. Abre una hoja que explica
 * que la comisión aún no está definida (o su porcentaje).
 */
export function CommissionRow({ label, value, variant = "a", onPress, accessibilityHint, testID }: CommissionRowProps): React.JSX.Element {
  const iconLeft = variant === "a" ? 12 : 19;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.commission, { backgroundColor: pressed ? surfaces.blue.pressed : surfaces.blue.background, borderColor: surfaces.blue.border }]}
    >
      <View style={{ marginLeft: iconLeft }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Icon name="help" size={31} color={colors.primary} />
      </View>
      <Text variant="subtitle" color="heading" size={19.5} lineHeight={24} letterSpacing={-0.2} numberOfLines={1} style={[styles.commissionLabel, { marginLeft: variant === "a" ? 13 : 13 }]}>
        {label}
      </Text>
      <Text variant="subtitle" color="heading" size={19.5} lineHeight={24} letterSpacing={-0.2} numberOfLines={1} style={styles.commissionValue}>
        {value}
      </Text>
      <View style={styles.commissionChevron} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Icon name="chevronRight" size={26} color={colors.primary} />
      </View>
    </Pressable>
  );
}

// ── Enlaces: «Historial de pagos y recibos», «Facturas y justificantes», «Liquidación mensual» ──────────────────

export interface LinkRowProps {
  label: string;
  icon: IconName;
  onPress: () => void;
  accessibilityHint?: string;
  testID: string;
}

/** Fila blanca con contorno de la lámina 33b: icono azul, texto y chevron. */
export function LinkRow({ label, icon, onPress, accessibilityHint, testID }: LinkRowProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.link, { backgroundColor: pressed ? colors.bg.tintSoft : colors.bg.white }]}
    >
      <View style={styles.linkIcon} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Icon name={icon} size={36} color={colors.primary} />
      </View>
      <Text variant="subtitle" color="heading" size={19.5} lineHeight={24} letterSpacing={-0.2} numberOfLines={1} style={styles.linkLabel}>
        {label}
      </Text>
      <View style={styles.linkChevron} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Icon name="chevronRight" size={26} color={colors.primary} />
      </View>
    </Pressable>
  );
}

export interface GroupLink {
  key: string;
  label: string;
  icon: IconName;
  /** Valor corto a la derecha del texto (no lo usa la lámina; se deja vacío). */
  onPress: () => void;
  testID: string;
}

/** Tarjeta única con tres enlaces separados por líneas finas (lámina 33a: «Liquidación mensual», «Comisión MVC · Por definir», «Facturas y justificantes»). */
export function LinkGroup({ links, testID }: { links: readonly GroupLink[]; testID?: string }): React.JSX.Element {
  return (
    <View testID={testID} style={styles.group}>
      {links.map((link, index) => (
        <Pressable
          key={link.key}
          testID={link.testID}
          accessibilityRole="link"
          accessibilityLabel={link.label}
          onPress={link.onPress}
          style={({ pressed }) => [styles.groupRow, { backgroundColor: pressed ? colors.bg.tintSoft : "transparent" }]}
        >
          <View style={styles.groupIcon} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Icon name={link.icon} size={link.icon === "help" ? 31 : 34} color={colors.primary} />
          </View>
          <Text variant="subtitle" color="heading" weight="medium" size={19.5} lineHeight={24} letterSpacing={-0.2} numberOfLines={1} style={styles.groupLabel}>
            {link.label}
          </Text>
          <View style={styles.groupChevron} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Icon name="chevronRight" size={26} color={colors.primary} />
          </View>
          {index < links.length - 1 ? <View style={styles.groupDivider} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  commission: { minHeight: 54.5, borderWidth: 1, borderRadius: 16, flexDirection: "row", alignItems: "center", paddingRight: 5 },
  commissionLabel: { flex: 1 },
  commissionValue: { marginLeft: 8, marginRight: 6, textAlign: "right" },
  commissionChevron: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },

  link: { minHeight: 52.5, borderWidth: 1, borderRadius: 16, borderColor: ink.linkBorder, flexDirection: "row", alignItems: "center", paddingRight: 5 },
  linkIcon: { width: 36, height: 36, marginLeft: 10, alignItems: "center", justifyContent: "center" },
  linkLabel: { flex: 1, marginLeft: 22 },
  linkChevron: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },

  group: { borderWidth: 1, borderRadius: 16, borderColor: ink.linkBorder, backgroundColor: colors.bg.white, overflow: "hidden" },
  groupRow: { minHeight: 41, flexDirection: "row", alignItems: "center", paddingRight: 8 },
  groupIcon: { width: 34, height: 34, marginLeft: 18, alignItems: "center", justifyContent: "center" },
  groupLabel: { flex: 1, marginLeft: 18 },
  groupChevron: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  groupDivider: { position: "absolute", left: 12, right: 12, bottom: 0, height: 1, backgroundColor: colors.border.divider },
});
