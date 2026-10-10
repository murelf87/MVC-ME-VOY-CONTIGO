/**
 * Pestañas en píldora de 38 («Pendientes (5) | Aprobados | Rechazados») y 39 («Todas (12) | Canceladas (5) | Devueltas (3)»):
 * la activa va en azul pleno con texto blanco y es algo más ancha; las demás, en azul claro.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colors } from "@/theme";
import { Text } from "@/ui";

export interface PillTab<T extends string> {
  value: T;
  label: string;
  /** Contador entre paréntesis tras la etiqueta; `null`/ausente = sin contador. */
  badge?: number | null;
}

export interface PillTabsProps<T extends string> {
  tabs: readonly PillTab<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  /** Alto de las pestañas en pt (46 en 38a; 43 en 39a). */
  height?: number;
  testID?: string;
}

/** Peso de la pestaña activa frente a las demás (38a: 137,5 pt frente a 113 y 109,5; 39a: 138 frente a 107 y 115). */
const ACTIVE_WEIGHT = 1.25;
const HEIGHT = 46;

export function tabText(tab: { label: string; badge?: number | null }): string {
  return tab.badge !== undefined && tab.badge !== null ? `${tab.label} (${tab.badge})` : tab.label;
}

export function PillTabs<T extends string>({ tabs, value, onChange, accessibilityLabel, height = HEIGHT, testID = "PillTabs" }: PillTabsProps<T>): React.JSX.Element {
  return (
    <View testID={testID} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={styles.row}>
      {tabs.map((tab, index) => {
        const active = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            testID={`${testID}.opt-${tab.value}`}
            accessibilityRole="tab"
            accessibilityLabel={tabText(tab)}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(tab.value)}
            style={({ pressed }) => [
              styles.tab,
              { minHeight: height, flexGrow: active ? ACTIVE_WEIGHT : 1, flexBasis: 0 },
              index > 0 ? styles.gap : null,
              active ? styles.active : styles.inactive,
              pressed && !active ? styles.pressed : null,
            ]}
          >
            <Text
              variant="tabLabel"
              color={active ? colors.onPrimary : "heading"}
              weight="medium"
              size={17}
              lineHeight={20}
              letterSpacing={-0.2}
              align="center"
              numberOfLines={2}
            >
              {tabText(tab)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch" },
  tab: { borderRadius: 16, paddingHorizontal: 6, paddingVertical: 8, alignItems: "center", justifyContent: "center" },
  gap: { marginLeft: 5 },
  active: { backgroundColor: colors.primary },
  inactive: { backgroundColor: colors.bg.tint },
  pressed: { backgroundColor: colors.bg.tintStrong },
});
