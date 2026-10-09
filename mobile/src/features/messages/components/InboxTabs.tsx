/**
 * Pestañas «Todos · Mis reservas · Grupos» de la bandeja (lámina 25): tres píldoras de 46 pt con 12 pt entre ellas.
 * La lámina las dibuja de 109 / 129 / 102 pt; aquí reparten el ancho con esas MISMAS proporciones (no con el ancho del
 * texto), de modo que la fila se ve igual con cualquier tipografía. Con letra grande el texto se reduce hasta un 80 %.
 */
import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "@/theme";
import { Text } from "@/ui";

export interface InboxTabOption<T extends string> {
  value: T;
  label: string;
  /** Peso relativo del ancho (anchos de la lámina en pt). */
  weight: number;
  /** Etiqueta accesible (incluye el número de no leídos si lo hay). */
  accessibilityLabel?: string;
}

export interface InboxTabsProps<T extends string> {
  options: readonly InboxTabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function InboxTabs<T extends string>({ options, value, onChange, accessibilityLabel, testID = "Inbox.tabs", style }: InboxTabsProps<T>): React.JSX.Element {
  return (
    <View testID={testID} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={[styles.row, style]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={`${testID}.${option.value}`}
            accessibilityRole="tab"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.pill,
              { flexGrow: option.weight },
              selected ? styles.pillOn : styles.pillOff,
              pressed ? { opacity: 0.85 } : null,
            ]}
          >
            <Text
              variant="subtitle"
              weight="medium"
              color={selected ? "inverse" : "primary"}
              size={20}
              lineHeight={24}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              align="center"
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", columnGap: 12 },
  /** Píldora de 46 pt de alto (y 167,5 → 213,5). `flexBasis: 0` + `flexGrow` = ancho proporcional al de la lámina. */
  pill: {
    flexBasis: 0,
    flexShrink: 1,
    height: 46,
    minWidth: 0,
    paddingHorizontal: 8,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  pillOn: { backgroundColor: colors.primary },
  pillOff: { backgroundColor: colors.bg.chip },
});
