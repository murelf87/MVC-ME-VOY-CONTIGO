import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors, radii, sizes, type TextVariant } from "@/theme";
import { Text } from "./Text";

export type ButtonVariant =
  | "primary"
  | "outline"
  | "success"
  | "danger"
  | "dangerOutline"
  | "tint"
  | "successSoft"
  | "dangerSoft"
  | "ghost"
  | "link";

export type ButtonSize = "md" | "sm" | "xs";

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icono a la izquierda del texto (12 «Solicitar plaza», 21 «Ver ruta en el mapa»). */
  leadingIcon?: IconName;
  /** Chevron `›` a la derecha (por defecto sí en todas las variantes salvo `ghost` y `link`). */
  chevron?: boolean;
  /** Muestra un indicador de progreso en lugar del texto y bloquea la pulsación. */
  loading?: boolean;
  disabled?: boolean;
  /** Ajusta el ancho al contenido en vez de ocupar todo el ancho. */
  inline?: boolean;
  /** Radio mayor de la bienvenida (01): 18 pt en lugar de 14. */
  rounded?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

interface VariantColors {
  background: string;
  pressed: string;
  foreground: string;
  border?: string;
  /** Color del icono inicial cuando difiere de la etiqueta (38a: visto verde / aspa roja sobre etiqueta oscura). */
  icon?: string;
}

const variants: Record<ButtonVariant, VariantColors> = {
  primary: { background: colors.primary, pressed: colors.primaryPressed, foreground: colors.onPrimary },
  outline: { background: colors.bg.white, pressed: colors.bg.tint, foreground: colors.primary, border: colors.primary },
  success: { background: colors.success.button, pressed: colors.success.buttonPressed, foreground: colors.onPrimary },
  danger: { background: colors.error.solid, pressed: colors.error.solidPressed, foreground: colors.onPrimary },
  dangerOutline: { background: colors.bg.white, pressed: colors.error.bg, foreground: colors.error.solid, border: colors.error.border },
  tint: { background: colors.bg.tintStrong, pressed: colors.surface.blueStrongEdge, foreground: colors.primary },
  successSoft: { background: colors.soft.green.bg, pressed: colors.soft.green.pressed, foreground: colors.soft.green.fg, icon: colors.soft.green.icon },
  dangerSoft: { background: colors.soft.red.bg, pressed: colors.soft.red.pressed, foreground: colors.soft.red.fg, icon: colors.soft.red.icon },
  ghost: { background: "transparent", pressed: colors.bg.tint, foreground: colors.primary },
  link: { background: "transparent", pressed: "transparent", foreground: colors.text.link },
};

interface SizeSpec {
  height: number;
  radius: number;
  paddingX: number;
  label: TextVariant;
  icon: number;
  chevron: number;
  chevronRight: number;
}

const sizeSpecs: Record<ButtonSize, SizeSpec> = {
  md: { height: sizes.button, radius: radii.lg, paddingX: 22, label: "button", icon: 28, chevron: 26, chevronRight: 14 },
  sm: { height: sizes.buttonSm, radius: radii.md, paddingX: 16, label: "buttonSm", icon: 22, chevron: 20, chevronRight: 10 },
  xs: { height: sizes.buttonXs, radius: radii.md, paddingX: 12, label: "buttonXs", icon: 18, chevron: 16, chevronRight: 6 },
};

/** Botón de la app. Todas las variantes tienen estados pulsado, desactivado y cargando. */
export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  leadingIcon,
  chevron,
  loading = false,
  disabled = false,
  inline = false,
  rounded = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps): React.JSX.Element {
  const isText = variant === "ghost" || variant === "link";
  const showChevron = chevron ?? !isText;
  const blocked = disabled || loading;
  const spec = sizeSpecs[size];
  const v = variants[variant];
  const foreground = disabled ? colors.text.disabled : v.foreground;

  const containerStyle = (pressed: boolean): ViewStyle => {
    if (isText) {
      return {
        minHeight: spec.height,
        alignSelf: inline ? "flex-start" : "center",
        backgroundColor: pressed && variant === "ghost" ? v.pressed : "transparent",
        borderRadius: spec.radius,
        paddingHorizontal: variant === "link" ? 4 : spec.paddingX,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed && variant === "link" ? 0.6 : 1,
      };
    }
    return {
      height: spec.height,
      alignSelf: inline ? "flex-start" : "stretch",
      minWidth: inline ? 0 : undefined,
      paddingHorizontal: spec.paddingX + (showChevron && !inline ? 8 : 0),
      borderRadius: rounded ? radii.xl : spec.radius,
      backgroundColor: disabled ? colors.bg.disabled : pressed ? v.pressed : v.background,
      borderWidth: v.border !== undefined && !disabled ? 1.5 : 0,
      borderColor: v.border,
      alignItems: "center",
      justifyContent: "center",
    };
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      hitSlop={size === "xs" ? 8 : undefined}
      style={({ pressed }) => [containerStyle(pressed), style]}
    >
      <View style={styles.content}>
        {leadingIcon !== undefined ? (
          <View style={[styles.leading, loading ? styles.hidden : null]}>
            <Icon name={leadingIcon} size={spec.icon} color={disabled ? colors.text.disabled : (v.icon ?? foreground)} />
          </View>
        ) : null}
        <Text
          variant={spec.label}
          color={foreground}
          numberOfLines={1}
          underline={variant === "link"}
          style={loading ? styles.hidden : null}
        >
          {label}
        </Text>
      </View>
      {showChevron ? (
        <View style={[styles.chevron, { right: spec.chevronRight }, loading ? styles.hidden : null]} pointerEvents="none">
          <Icon name="chevronRight" size={spec.chevron} color={disabled ? colors.text.disabled : foreground} />
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
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  leading: { marginRight: 14 },
  chevron: { position: "absolute", top: 0, bottom: 0, justifyContent: "center" },
  spinner: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  hidden: { opacity: 0 },
});
