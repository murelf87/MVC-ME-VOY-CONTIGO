import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors, sizes } from "@/theme";
import { Text } from "./Text";

export type StatusTone = "blue" | "green" | "amber" | "orange" | "red" | "gray";

interface ToneSpec {
  background: string;
  foreground: string;
  border?: string;
}

/** Colores medidos en `colors.pill` (34b «Cobrado», 38a «Pendiente»…). */
const tones: Record<StatusTone, ToneSpec> = {
  blue: { background: colors.pill.blue.bg, foreground: colors.pill.blue.fg },
  green: { background: colors.pill.green.bg, foreground: colors.pill.green.fg },
  amber: { background: colors.pill.amber.bg, foreground: colors.pill.amber.fg },
  orange: { background: colors.pill.orange.bg, foreground: colors.pill.orange.fg },
  red: { background: colors.pill.red.bg, foreground: colors.pill.red.fg },
  gray: { background: colors.pill.gray.bg, foreground: colors.pill.gray.fg },
};

export interface StatusPillProps {
  label: string;
  tone?: StatusTone;
  /** Icono a la izquierda (p. ej. el visto de «En 12 min»). */
  icon?: IconName;
  /** `md` = 31 pt (listas); `sm` = 24 pt (junto a un título). */
  size?: "md" | "sm";
  /** Solo contorno, sin relleno (16 «Propuesta»). */
  outlined?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Píldora de estado: Pendiente · Cobrado · Pagado · Cancelada · «En 12 min» · «Fuera de provincia» · «Propuesta». */
export function StatusPill({ label, tone = "blue", icon, size = "md", outlined = false, testID, style }: StatusPillProps): React.JSX.Element {
  const t = tones[tone];
  const small = size === "sm";
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.pill,
        small ? styles.sm : styles.md,
        outlined
          ? { backgroundColor: "transparent", borderWidth: 1, borderColor: t.foreground }
          : { backgroundColor: t.background },
        style,
      ]}
    >
      {icon !== undefined ? (
        <View style={styles.icon}>
          <Icon name={icon} size={small ? 14 : 18} color={t.foreground} />
        </View>
      ) : null}
      <Text variant="rowTextStrong" color={t.foreground} size={small ? 14 : 16} lineHeight={small ? 18 : 21} letterSpacing={-0.2} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", borderRadius: 999 },
  md: { minHeight: sizes.statusPill, paddingHorizontal: 13 },
  sm: { minHeight: 24, paddingHorizontal: 10 },
  icon: { marginRight: 5 },
});
