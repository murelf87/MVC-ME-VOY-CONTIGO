import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { Text, surfaces } from "@/ui";
import { colors, radii } from "@/theme";

export interface LocationCardProps {
  /** «Usar mi ubicación (opcional)». */
  title: string;
  /** «Te sugerimos tu municipio actual.» */
  subtitle: string;
  onPress: () => void;
  /** Mientras se pide el permiso y se lee el GPS: el botón se bloquea y el pin cede el sitio a un indicador. */
  loading?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Tarjeta «Usar mi ubicación» de la lámina 10: disco azul con el pin, título en azul ultramarino, frase de apoyo y
 * chevron. Es un botón: pedir el permiso y ubicar a la persona es decisión de quien la usa.
 */
export function LocationCard({ title, subtitle, onPress, loading = false, testID, style }: LocationCardProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityState={{ disabled: loading, busy: loading }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null, style]}
    >
      <View style={styles.tile}>
        {loading ? <ActivityIndicator color={colors.primary} /> : <Icon name="pin" size={27} color={colors.primary} />}
      </View>
      <View style={styles.text}>
        <Text variant="rowTitle" color="heading" size={19.5} lineHeight={24} letterSpacing={-0.3} numberOfLines={1}>
          {title}
        </Text>
        <Text variant="body" color="muted" size={16.5} lineHeight={21} numberOfLines={2} style={styles.subtitle}>
          {subtitle}
        </Text>
      </View>
      <Icon name="chevronRight" size={26} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 94,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 10,
    paddingRight: 12,
    borderRadius: radii.lg,
    backgroundColor: surfaces.blue.background,
  },
  pressed: { backgroundColor: surfaces.blue.pressed },
  tile: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.border.tint,
  },
  text: { flex: 1, marginLeft: 15, marginRight: 8 },
  subtitle: { marginTop: 3 },
});
