/**
 * Filtros de las listas del panel: fila de píldoras con una activa (estado de una alerta, tipo de acción de la auditoría…)
 * y botón de filtro con desplegable. Mismo aspecto que las pestañas del panel (activa: azul pleno; inactiva: azul claro).
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

export interface FilterChipsProps<T extends string> {
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

export function FilterChips<T extends string>({ options, value, onChange, accessibilityLabel, testID, style }: FilterChipsProps<T>): React.JSX.Element {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[styles.scroll, style]}
      contentContainerStyle={styles.row}
      testID={testID}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={`${testID}.${option.value}`}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            hitSlop={{ top: 4, bottom: 4 }}
            style={[styles.chip, selected ? styles.chipActive : styles.chipIdle]}
          >
            <Text variant="tabLabel" size={13.8} lineHeight={17} color={selected ? colors.text.inverse : colors.text.link} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export interface FilterButtonProps {
  label: string;
  /** Icono a la izquierda (embudo para «Filtros»). */
  icon?: IconName;
  /** Contador de filtros aplicados (burbuja). */
  badge?: number;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/** Botón de filtro con borde azul claro («Todas las reglas ⌄», «Filtros · 2»). */
export function FilterButton({ label, icon, badge = 0, onPress, accessibilityLabel, testID, style }: FilterButtonProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={badge > 0 ? `${accessibilityLabel}, ${badge}` : accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null, style]}
    >
      {icon !== undefined ? <Icon name={icon} size={18} color={colors.primary} /> : null}
      <Text variant="tabLabel" size={14} lineHeight={18} color={colors.heading} numberOfLines={1} style={styles.buttonLabel}>
        {label}
      </Text>
      {badge > 0 ? (
        <View style={styles.badge}>
          <Text variant="caption" size={11} lineHeight={13} weight="bold" color={colors.text.inverse}>
            {badge}
          </Text>
        </View>
      ) : (
        <Icon name="chevronDown" size={18} color={colors.primary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { columnGap: 6, paddingRight: 4 },
  chip: { height: 36, minWidth: 64, borderRadius: 14, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.primary },
  chipIdle: { backgroundColor: colors.bg.chip },
  button: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.white,
    paddingHorizontal: 12,
  },
  buttonPressed: { backgroundColor: colors.bg.tintSoft },
  buttonLabel: { flexShrink: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});
