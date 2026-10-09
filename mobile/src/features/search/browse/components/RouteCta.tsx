import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";

export interface RouteCtaProps {
  label: string;
  onPress: () => void;
  /** Mientras se comprueba el recorrido: el botón se bloquea y enseña un indicador de progreso. */
  busy?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * «Buscar compañeros ›» de la lámina 10: botón principal de 64 pt con el texto a 27 pt y la lupa a la izquierda. El
 * sistema de diseño tiene un botón de 53 pt con 22 pt de texto; esta lámina lo dibuja más grande.
 */
export function RouteCta({ label, onPress, busy = false, testID, style }: RouteCtaProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.cta, { backgroundColor: pressed ? colors.primaryPressed : colors.primary }, style]}
    >
      <View style={[styles.content, busy ? styles.hidden : null]}>
        <Icon name="search" size={30} color={colors.onPrimary} />
        <Text variant="button" color={colors.onPrimary} size={27} lineHeight={32} letterSpacing={-0.4} numberOfLines={1} style={styles.label}>
          {label}
        </Text>
      </View>
      <View style={[styles.chevron, busy ? styles.hidden : null]}>
        <Icon name="chevronRight" size={26} color={colors.onPrimary} />
      </View>
      {busy ? (
        <View style={styles.spinner}>
          <ActivityIndicator color={colors.onPrimary} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cta: {
    height: 64,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  label: { marginLeft: 25 },
  chevron: { position: "absolute", top: 0, bottom: 0, right: 15, justifyContent: "center", pointerEvents: "none" },
  spinner: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", pointerEvents: "none" },
  hidden: { opacity: 0 },
});
