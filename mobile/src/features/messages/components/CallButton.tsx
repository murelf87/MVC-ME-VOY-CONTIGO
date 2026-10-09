/**
 * «Llamar a Ana» (lámina 26): píldora blanca de 46 pt con contorno azul de 2 pt, teléfono y texto azul en negrita, a la
 * derecha, justo encima de la barra de redacción. Al pulsarla la pantalla pregunta al servidor si se puede llamar ahora
 * (mientras tanto muestra «Comprobando…» y no admite otro toque).
 */
import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Spinner, Text } from "@/ui";

export interface CallButtonProps {
  label: string;
  /** Comprobando con el servidor. */
  busy?: boolean;
  busyLabel: string;
  onPress: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function CallButton({ label, busy = false, busyLabel, onPress, testID = "BookingChat.call", style }: CallButtonProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={busy ? busyLabel : label}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null, style]}
    >
      <View style={styles.content}>
        {busy ? <Spinner size="sm" /> : <Icon name="phone" size={25} color={colors.primary} />}
        <Text variant="subtitle" weight="bold" color="primary" size={20} lineHeight={24} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.text}>
          {busy ? busyLabel : label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "flex-end",
    minWidth: 188,
    maxWidth: "100%",
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.bg.white,
    paddingHorizontal: 22,
    justifyContent: "center",
  },
  pressed: { backgroundColor: colors.bg.tintSoft },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  text: { marginLeft: 13, flexShrink: 1 },
});
