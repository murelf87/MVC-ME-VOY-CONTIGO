import React from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { radii, shadows, type ShadowKey } from "@/theme";
import { surfaces, type SurfaceTone } from "./tones";

export interface CardProps {
  /** Color de superficie. `blue` = tarjeta azul clara estándar de las láminas. */
  tone?: SurfaceTone;
  /** Relleno interior en pt (por defecto 16). */
  padding?: number;
  /** Radio de esquina (por defecto 14). */
  radius?: number;
  /** Dibuja el contorno de 1 pt (por defecto `true`). */
  bordered?: boolean;
  shadow?: ShadowKey;
  /** Si se indica, toda la tarjeta es pulsable. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/** Contenedor redondeado con fondo tintado (el «bloque» básico de las láminas). `TintCard` es un alias. */
export function Card({
  tone = "blue",
  padding = 16,
  radius = radii.lg,
  bordered = true,
  shadow = "none",
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
  children,
}: CardProps): React.JSX.Element {
  const s = surfaces[tone];
  const base: ViewStyle = {
    backgroundColor: s.background,
    borderRadius: radius,
    padding,
    borderWidth: bordered ? 1 : 0,
    borderColor: s.border,
    boxShadow: shadows[shadow],
  };
  if (onPress === undefined) {
    return (
      <View testID={testID} style={[base, style]}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [base, pressed ? { backgroundColor: s.pressed } : null, style]}
    >
      {children}
    </Pressable>
  );
}

/** Alias semántico: tarjeta tintada (`tone="blue"` por defecto). */
export const TintCard = Card;
