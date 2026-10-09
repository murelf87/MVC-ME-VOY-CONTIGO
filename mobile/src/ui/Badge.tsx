import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "@/theme";
import { Text } from "./Text";

export type CountBadgeTone = "error" | "primary" | "success" | "neutral";

const toneColors: Record<CountBadgeTone, string> = {
  /** 25 «2» / «3»: círculo rojo con cifra blanca. */
  error: colors.error.solid,
  primary: colors.primary,
  success: colors.success.solid,
  neutral: colors.gray.icon,
};

export interface CountBadgeProps {
  count: number;
  /** Tope visible: por encima se muestra «99+». */
  max?: number;
  tone?: CountBadgeTone;
  /** `md` = 25 pt (lista de mensajes, 25); `sm` = 18 pt (barra inferior, botones de icono). */
  size?: "sm" | "md";
  /** Dibuja solo un punto, sin cifra. */
  dot?: boolean;
  /** Si es `true` (por defecto) no se dibuja nada cuando `count` es 0 o negativo. */
  hideWhenZero?: boolean;
  /** Si se indica, el distintivo es accesible con esa etiqueta; si no, lo describe el elemento que lo contiene. */
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Distintivo circular con un contador (mensajes sin leer, avisos pendientes). */
export function CountBadge({
  count,
  max = 99,
  tone = "error",
  size = "md",
  dot = false,
  hideWhenZero = true,
  accessibilityLabel,
  testID,
  style,
}: CountBadgeProps): React.JSX.Element | null {
  if (hideWhenZero && count <= 0 && !dot) return null;
  const diameter = size === "md" ? 25 : 18;
  const text = count > max ? `${max}+` : String(Math.max(0, Math.trunc(count)));
  const accessible = accessibilityLabel !== undefined;
  const base: ViewStyle = {
    backgroundColor: toneColors[tone],
    minWidth: dot ? diameter / 2 : diameter,
    height: dot ? diameter / 2 : diameter,
    borderRadius: diameter,
    paddingHorizontal: dot ? 0 : text.length > 1 ? 6 : 0,
  };
  return (
    <View
      testID={testID}
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={accessible ? "yes" : "no-hide-descendants"}
      style={[styles.base, base, style]}
    >
      {dot ? null : (
        <Text variant="rowTextStrong" color="inverse" weight="bold" size={size === "md" ? 15 : 12} lineHeight={size === "md" ? 18 : 14} letterSpacing={0}>
          {text}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
});
