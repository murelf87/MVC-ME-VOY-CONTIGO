/**
 * Fila grande de «Mi perfil» (lámina 29, «Mis datos»): baldosa azul clara de ≈ 82 pt con el icono azul a la izquierda,
 * título azul intenso, subtítulo gris azulado y chevron. Toda la fila es pulsable.
 */
import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";

export interface ProfileRowProps {
  icon: IconName;
  /** Tamaño del glifo: cada icono de la lámina ocupa un alto distinto (persona 36, coche 29, candado 37). */
  iconSize?: number;
  title: string;
  subtitle: string;
  /** Contenido a la derecha del subtítulo (sustituye al chevron: «Activar»…). */
  trailing?: React.ReactNode;
  onPress: () => void;
  accessibilityHint?: string;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

export function ProfileRow({ icon, iconSize = 36, title, subtitle, trailing, onPress, accessibilityHint, testID, style }: ProfileRowProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null, style]}
    >
      <View style={styles.iconBox}>
        <Icon name={icon} size={iconSize} color={colors.primary} />
      </View>
      <View style={styles.texts}>
        <Text variant="rowTitle" weight="bold" color="deep" size={21.9} lineHeight={26} numberOfLines={1}>
          {title}
        </Text>
        <Text variant="rowText" color="subtle" size={17.9} lineHeight={22} numberOfLines={2} style={styles.subtitle}>
          {subtitle}
        </Text>
      </View>
      {trailing ?? <Icon name="chevronRight" size={28} color={colors.primary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    backgroundColor: colors.bg.tint,
    paddingLeft: 14,
    paddingRight: 14,
    paddingVertical: 8,
  },
  pressed: { backgroundColor: colors.bg.tintPressed },
  iconBox: { width: 54, alignItems: "center", justifyContent: "center" },
  texts: { flex: 1, marginLeft: 19, marginRight: 8 },
  subtitle: { marginTop: 1.4 },
});
