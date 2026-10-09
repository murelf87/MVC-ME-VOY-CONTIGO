/**
 * Tarjeta blanca de borde azul claro de las pantallas del panel (lámina 40), con título e icono opcionales, y la fila de
 * enlace a otra herramienta del panel. Mismo lenguaje visual que la tarjeta «Configuración de tarifas (propuesta)».
 */
import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";

export interface PanelCardProps {
  title?: string;
  icon?: IconName;
  /** Contenido a la derecha del título (píldora de estado…). */
  right?: React.ReactNode;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function PanelCard({ title, icon, right, children, style, testID }: PanelCardProps): React.JSX.Element {
  return (
    <View testID={testID} style={[styles.card, style]}>
      {title !== undefined ? (
        <View style={styles.titleRow}>
          {icon !== undefined ? <Icon name={icon} size={25} color={colors.heading} /> : null}
          <Text variant="rowTitle" size={16.4} lineHeight={22} color={colors.heading} numberOfLines={2} style={[styles.title, icon !== undefined ? styles.titleWithIcon : null]} accessibilityRole="header">
            {title}
          </Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export interface LinkRowProps {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Fila pulsable de la lista «Más herramientas»: icono, título, explicación corta y chevron (≥ 56 pt). */
export function LinkRow({ icon, title, subtitle, onPress, testID, disabled = false, style }: LinkRowProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle !== undefined ? `${title}. ${subtitle}` : title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.link, pressed ? styles.linkPressed : null, disabled ? styles.disabled : null, style]}
    >
      <View style={styles.linkIcon}>
        <Icon name={icon} size={24} color={colors.heading} />
      </View>
      <View style={styles.linkTexts}>
        <Text variant="rowTitle" size={16.3} lineHeight={21} color={colors.heading} numberOfLines={1}>
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text variant="rowText" size={14} lineHeight={18} color={colors.text.muted} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Icon name="chevronRight" size={22} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.white,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 16,
    paddingTop: 10,
    paddingBottom: 12,
    paddingHorizontal: 13,
  },
  titleRow: { minHeight: 28, flexDirection: "row", alignItems: "center", marginBottom: 6 },
  title: { flex: 1 },
  titleWithIcon: { marginLeft: 11 },
  link: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg.white,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 16,
    paddingVertical: 8,
    paddingLeft: 13,
    paddingRight: 12,
  },
  linkPressed: { backgroundColor: colors.bg.tintSoft },
  disabled: { opacity: 0.5 },
  linkIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.tile.blue, alignItems: "center", justifyContent: "center" },
  linkTexts: { flex: 1, marginLeft: 12, marginRight: 6 },
});
