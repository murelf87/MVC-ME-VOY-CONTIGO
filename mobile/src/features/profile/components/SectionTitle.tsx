/**
 * Título de sección de las láminas 29–31 («Mis roles en MVC», «Mis datos», «Reserva semanal», «Próximo viaje»): negrita
 * marino de ≈ 24,5 pt. La sangría la pone cada pantalla (29 → 19,5 pt; 30 → 26 pt).
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "@/ui";

export interface SectionTitleProps {
  title: string;
  /** Contenido a la derecha del título (acción «Añadir», «Editar»…). */
  right?: React.ReactNode;
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SectionTitle({ title, right, size = 24.5, style, testID }: SectionTitleProps): React.JSX.Element {
  return (
    <View style={[styles.row, style]}>
      <Text variant="title" weight="bold" color="strong" size={size} lineHeight={28} accessibilityRole="header" testID={testID} style={styles.title}>
        {title}
      </Text>
      {right !== undefined && right !== null ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", minHeight: 28 },
  title: { flexShrink: 1 },
  right: { marginLeft: "auto", paddingLeft: 12 },
});
