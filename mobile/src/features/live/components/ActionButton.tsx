import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";

export interface ActionButtonProps {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "outline";
  leadingIcon?: IconName;
  /** Flecha `›` a la derecha (por defecto sí). */
  chevron?: boolean;
  /** Alto en pt (las láminas 21 y 23 usan 55). */
  height?: number;
  /** Tamaño de letra del texto (pt). */
  fontSize?: number;
  fontWeight?: "medium" | "semibold" | "bold";
  iconSize?: number;
  /** Reserva a la derecha para la flecha: el texto se centra en el resto. */
  gutter?: number;
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Botón ancho de las pantallas en directo, con las medidas de las láminas 21 y 23 (55 pt de alto, texto centrado en el
 * hueco que deja la flecha). Es un botón normal: rol, estado desactivado/cargando y objetivo táctil ≥ 44 pt.
 */
export function ActionButton({
  label,
  onPress,
  variant = "primary",
  leadingIcon,
  chevron = true,
  height = 55,
  fontSize = 21,
  fontWeight = "semibold",
  iconSize = 28,
  gutter = 48,
  loading = false,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ActionButtonProps): React.JSX.Element {
  const primary = variant === "primary";
  const blocked = disabled || loading;
  const foreground = blocked ? colors.text.disabled : primary ? colors.onPrimary : colors.heading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          height,
          backgroundColor: blocked && primary ? colors.bg.disabled : primary ? (pressed ? colors.primaryPressed : colors.primary) : pressed ? colors.bg.tint : colors.bg.white,
          borderWidth: primary ? 0 : 1.5,
          borderColor: blocked ? colors.border.default : colors.primary,
        },
        style,
      ]}
    >
      <View style={[styles.content, { paddingRight: chevron ? gutter : 0 }]}>
        {loading ? (
          <ActivityIndicator color={foreground} />
        ) : (
          <>
            {leadingIcon !== undefined ? <Icon name={leadingIcon} size={iconSize} color={foreground} /> : null}
            <Text variant="button" weight={fontWeight} color={foreground} size={fontSize} lineHeight={Math.round(fontSize * 1.2)} numberOfLines={1} style={leadingIcon !== undefined ? styles.label : null}>
              {label}
            </Text>
          </>
        )}
      </View>
      {chevron && !loading ? <Icon name="chevronRight" size={26} color={foreground} style={styles.chevron} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: 14, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  content: { flex: 1, alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "center", paddingLeft: 12 },
  label: { marginLeft: 14, flexShrink: 1 },
  chevron: { position: "absolute", right: 14 },
});
