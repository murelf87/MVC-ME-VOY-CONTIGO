import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "@/ui";

export interface SectionTitleProps {
  title: string;
  /** Texto de la acción de la derecha («Ver todos», «Editar»). Sin él no hay acción. */
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Cuerpo y alto de línea del título de sección de la lámina 33 («Mis pagos», «Método de pago», «Últimos cobros»). */
export const SECTION_TITLE_SIZE = 23;
export const SECTION_TITLE_LINE = 28;

/**
 * Título de sección con acción a la derecha, alineados por la línea base (como en 33a, 33b y 34b: título de 23 pt en
 * negrita y acción de 20 pt). La acción tiene zona táctil de 44 pt aunque el texto sea más pequeño.
 */
export function SectionTitle({ title, actionLabel, onAction, testID, style }: SectionTitleProps): React.JSX.Element {
  return (
    <View testID={testID} style={[styles.row, style]}>
      <View style={styles.titleBox}>
        <Text variant="title" color="heading" size={SECTION_TITLE_SIZE} lineHeight={SECTION_TITLE_LINE} letterSpacing={-0.25} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {actionLabel !== undefined && onAction !== undefined ? (
        <Pressable
          testID={testID !== undefined ? `${testID}.action` : undefined}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel}, ${title}`}
          onPress={onAction}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 6 }}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <Text variant="subtitle" color="link" weight="medium" size={20} lineHeight={24} letterSpacing={-0.2}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  titleBox: { flex: 1, paddingRight: 12 },
  pressed: { opacity: 0.6 },
});
