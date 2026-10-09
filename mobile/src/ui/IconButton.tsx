import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors, shadows } from "@/theme";
import { Text } from "./Text";

export type IconButtonVariant = "plain" | "outline" | "solid" | "tint" | "floating";

export interface IconButtonProps {
  icon: IconName;
  /** Obligatorio: un botón sin texto necesita nombre accesible. */
  accessibilityLabel: string;
  onPress?: () => void;
  variant?: IconButtonVariant;
  /** Lado en pt (por defecto 48). */
  size?: number;
  iconSize?: number;
  /** Color del icono; por defecto el del tipo de botón. */
  color?: string;
  /** `circle` (por defecto) o `rounded` (cuadrado de esquinas redondeadas, como el botón de llamar de 23). */
  shape?: "circle" | "rounded";
  /** Contador (p. ej. mensajes sin leer). */
  badge?: number;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Botón redondo con un icono (llamar, centrar ubicación, ⋮, cerrar…). Zona táctil mínima de 44 pt. */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = "plain",
  size = 48,
  iconSize,
  color,
  shape = "circle",
  badge,
  disabled = false,
  testID,
  style,
}: IconButtonProps): React.JSX.Element {
  const glyph = iconSize ?? Math.round(size * 0.5);
  const radius = shape === "circle" ? size / 2 : Math.round(size * 0.3);
  const iconColor =
    color ?? (variant === "solid" ? colors.onPrimary : disabled ? colors.text.disabled : colors.primary);
  const bg = (pressed: boolean): ViewStyle => {
    switch (variant) {
      case "solid":
        return { backgroundColor: pressed ? colors.primaryPressed : colors.primary };
      case "tint":
        return { backgroundColor: pressed ? colors.surface.blueStrongEdge : colors.bg.tintStrong };
      case "outline":
        return {
          backgroundColor: pressed ? colors.bg.tint : colors.bg.white,
          borderWidth: 1.5,
          borderColor: colors.primary,
        };
      case "floating":
        return { backgroundColor: colors.bg.white, boxShadow: shadows.float };
      case "plain":
        return { backgroundColor: pressed ? colors.bg.tint : "transparent" };
    }
  };
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={size < 44 ? Math.ceil((44 - size) / 2) : undefined}
      style={({ pressed }) => [styles.base, { width: size, height: size, borderRadius: radius }, bg(pressed), style]}
    >
      <Icon name={icon} size={glyph} color={iconColor} />
      {badge !== undefined && badge > 0 ? (
        <View style={styles.badge} pointerEvents="none">
          <Text variant="captionStrong" color={colors.onPrimary} size={11} lineHeight={14}>
            {badge > 99 ? "99+" : String(badge)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.error.solid,
    alignItems: "center",
    justifyContent: "center",
  },
});
