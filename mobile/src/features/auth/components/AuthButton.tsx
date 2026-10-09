import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";

export interface AuthButtonProps {
  label: string;
  onPress: () => void;
  /** `primary` (azul pleno) o `outline` (borde azul sobre blanco). */
  variant?: "primary" | "outline";
  /** Muestra un indicador de progreso en lugar del texto y bloquea la pulsación. */
  loading?: boolean;
  disabled?: boolean;
  /** Chevron `›` a la derecha (por defecto sí, como en las láminas 01–04). */
  chevron?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Alto del botón de las láminas 01–04 (59,5 pt; el botón estándar del kit mide 53). */
export const AUTH_BUTTON_HEIGHT = 59.5;

/**
 * Botón grande del alta (láminas 01–04). Es el botón estándar con las medidas propias de estas láminas: etiqueta de
 * 25 pt (cap de 17,5 pt medido; el botón del kit usa 22 pt), chevron de 29 pt y esquinas de 18 pt. Mismos colores y
 * mismos estados (pulsado, desactivado, cargando) que `Button`.
 */
export function AuthButton({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  chevron = true,
  accessibilityHint,
  testID,
  style,
}: AuthButtonProps): React.JSX.Element {
  const primary = variant === "primary";
  const blocked = disabled || loading;
  const foreground = disabled ? colors.text.disabled : primary ? colors.onPrimary : colors.primary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        disabled
          ? { backgroundColor: colors.bg.disabled }
          : primary
            ? { backgroundColor: pressed ? colors.primaryPressed : colors.primary }
            : { backgroundColor: pressed ? colors.bg.tint : colors.bg.white, borderWidth: 1.5, borderColor: colors.primary },
        style,
      ]}
    >
      <Text
        variant="button"
        color={foreground}
        size={25}
        lineHeight={30}
        letterSpacing={0.55}
        numberOfLines={1}
        style={loading ? styles.hidden : null}
      >
        {label}
      </Text>
      {chevron ? (
        <View style={[styles.chevron, loading ? styles.hidden : null]} pointerEvents="none">
          <Icon name="chevronRight" size={29} color={foreground} />
        </View>
      ) : null}
      {loading ? (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color={foreground} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: AUTH_BUTTON_HEIGHT,
    borderRadius: radii.xl,
    paddingHorizontal: 30,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  chevron: { position: "absolute", top: 0, bottom: 0, right: 15, justifyContent: "center" },
  spinner: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  hidden: { opacity: 0 },
});
