import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "@/theme";
import { Text } from "./Text";

export interface NumberedListProps {
  items: readonly string[];
  /** Tamaño del texto en pt (por defecto 19). */
  size?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Lista de pasos con círculo gris azulado numerado (06 «1 Busca un lugar con buena luz»…). */
export function NumberedList({ items, size = 19, testID, style }: NumberedListProps): React.JSX.Element {
  return (
    <View testID={testID} accessibilityRole="list" style={style}>
      {items.map((item, index) => (
        <View key={`${index}-${item}`} accessible accessibilityLabel={`${index + 1}. ${item}`} style={[styles.row, index > 0 ? styles.gap : null]}>
          <View style={styles.circle}>
            <Text variant="bodyStrong" weight="bold" color="inverse" size={15} lineHeight={18} letterSpacing={0}>
              {index + 1}
            </Text>
          </View>
          <Text variant="body" color="body" size={size} lineHeight={Math.round(size * 1.2)} style={styles.text}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", minHeight: 28 },
  gap: { marginTop: 10 },
  circle: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.gray.step, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, marginLeft: 14 },
});
