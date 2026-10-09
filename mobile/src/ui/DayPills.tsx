import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { Weekday } from "@/api/types/common";
import { colors, radii, sizes } from "@/theme";
import { WEEKDAY_KEYS, weekdayInitials, weekdayLabel } from "@/i18n";
import { Text } from "./Text";

export interface DayPillsProps {
  /** Días seleccionados. */
  value: readonly Weekday[];
  /** Si falta, las píldoras son de solo lectura (14): los días no elegidos se ven en gris apagado. */
  onChange?: (next: Weekday[]) => void;
  /** Días que no se pueden elegir (se muestran apagados y no responden). */
  disabledDays?: readonly Weekday[];
  /** `circle` (10, selector) o `square` (14, resumen de la plaza semanal). */
  shape?: "circle" | "square";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Fila «L M X J V S D». Los días van siempre de lunes a domingo; `onChange` devuelve la selección ordenada. */
export function DayPills({ value, onChange, disabledDays = [], shape = "circle", testID, style }: DayPillsProps): React.JSX.Element {
  const interactive = onChange !== undefined;
  return (
    <View testID={testID} style={[styles.row, style]} accessibilityRole={interactive ? "none" : "text"}>
      {WEEKDAY_KEYS.map((day, index) => {
        const selected = value.includes(day);
        const disabled = disabledDays.includes(day);
        const toggle = (): void => {
          if (onChange === undefined || disabled) return;
          const next = selected ? value.filter((d) => d !== day) : [...value, day];
          onChange(WEEKDAY_KEYS.filter((d) => next.includes(d)));
        };
        const muted = !selected && (!interactive || disabled);
        const background = selected ? colors.primary : muted ? colors.daypill.mutedBg : colors.bg.chip;
        const textColor = selected ? colors.onPrimary : muted ? colors.daypill.mutedText : colors.text.body;
        return (
          <Pressable
            key={day}
            testID={testID !== undefined ? `${testID}.${day}` : undefined}
            accessibilityRole={interactive ? "checkbox" : "text"}
            accessibilityLabel={`${weekdayLabel(day, "long")}${selected ? ", seleccionado" : ""}`}
            accessibilityState={interactive ? { checked: selected, disabled } : undefined}
            disabled={!interactive || disabled}
            onPress={toggle}
            hitSlop={4}
            style={[
              styles.pill,
              shape === "circle" ? styles.circle : styles.square,
              { backgroundColor: background },
            ]}
          >
            <Text variant="bodyStrong" color={textColor} size={19} lineHeight={22} weight="semibold">
              {weekdayInitials[index]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Las láminas 10 y 14 dibujan siete píldoras de 41 pt con paso constante de 47 pt (separación de 6 pt) y la fila
 * centrada; en pantallas estrechas las píldoras se encogen (`flex: 1`, máximo 41 pt) en lugar de salirse.
 */
const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  pill: { flex: 1, maxWidth: sizes.dayPill, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  circle: { borderRadius: sizes.dayPill / 2 },
  square: { borderRadius: radii.md },
});
