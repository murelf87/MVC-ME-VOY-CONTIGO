/**
 * Botones suaves de decisión de 38a: «✓ Aprobar» (verde claro) y «✕ Rechazar» (rojo claro) y el de «Pedir otra captura»
 * (azul claro). Mismo alto (44,5 pt) y esquinas que los de la lámina; el color del texto y del icono cumplen contraste AA.
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";

export type SoftActionKind = "approve" | "reject" | "retry";

interface KindSpec {
  background: string;
  pressed: string;
  foreground: string;
  icon: string;
  glyph: IconName;
}

const kinds: Record<SoftActionKind, KindSpec> = {
  approve: { background: colors.soft.green.bg, pressed: colors.soft.green.pressed, foreground: colors.soft.green.fg, icon: colors.soft.green.icon, glyph: "check" },
  reject: { background: colors.pill.red.bg, pressed: colors.soft.red.pressed, foreground: colors.soft.red.fg, icon: colors.soft.red.icon, glyph: "close" },
  retry: { background: colors.bg.tintStrong, pressed: colors.surface.blueStrongEdge, foreground: colors.primary, icon: colors.primary, glyph: "refresh" },
};

export interface SoftActionButtonProps {
  kind: SoftActionKind;
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function SoftActionButton({ kind, label, onPress, loading = false, disabled = false, accessibilityLabel, testID, style }: SoftActionButtonProps): React.JSX.Element {
  const spec = kinds[kind];
  const blocked = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [styles.base, { backgroundColor: pressed ? spec.pressed : spec.background }, disabled && !loading ? styles.disabled : null, style]}
    >
      {loading ? (
        <ActivityIndicator color={spec.foreground} />
      ) : (
        <View style={styles.content}>
          <Icon name={spec.glyph} size={26} color={spec.icon} />
          <Text variant="button" color={spec.foreground} size={21} lineHeight={25} letterSpacing={-0.3} numberOfLines={1} style={styles.label}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { height: 44.5, borderRadius: 12, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  label: { marginLeft: 12 },
  disabled: { opacity: 0.5 },
});
