import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { SupportCategory } from "@/api/types";
import { Icon, type IconName } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import { SUPPORT_CATEGORIES } from "../logic/support";
import { helpStrings } from "../strings";

/** Icono y tamaño por tipo (36b: coche 36,5 × 32 · tarjeta 36 × 28,5 · persona 31 × 34). */
const TILE_ICONS: Record<SupportCategory, { icon: IconName; size: number }> = {
  trip_issue: { icon: "car", size: 50 },
  payment_issue: { icon: "card", size: 41 },
  account_profile: { icon: "person", size: 38.5 },
};

export interface CategoryTilesProps {
  value: SupportCategory | null;
  onChange: (category: SupportCategory) => void;
  /** Mensaje de validación (rojo, bajo las baldosas). */
  error?: string;
  disabled?: boolean;
  testID?: string;
}

/** Tres baldosas «Problema en un viaje · Problema de pago · Mi perfil y cuenta» (grupo de radio). */
export function CategoryTiles({ value, onChange, error, disabled = false, testID = "CategoryTiles" }: CategoryTilesProps): React.JSX.Element {
  return (
    <View>
      <View accessibilityRole="radiogroup" accessibilityLabel={helpStrings.help.categoryGroupA11y} style={styles.row} testID={testID}>
        {SUPPORT_CATEGORIES.map((category) => {
          const selected = value === category;
          const meta = TILE_ICONS[category];
          return (
            <Pressable
              key={category}
              testID={`${testID}.${category}`}
              accessibilityRole="radio"
              accessibilityLabel={helpStrings.help.categories[category]}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(category)}
              style={({ pressed }) => [
                styles.tile,
                selected ? styles.tileSelected : null,
                pressed && !selected ? styles.tilePressed : null,
                error !== undefined && !selected ? styles.tileError : null,
              ]}
            >
              <View style={styles.iconBox}>
                <Icon name={meta.icon} size={meta.size} color={selected ? colors.primary : colors.text.link} />
              </View>
              <Text
                variant="rowTitle"
                color={selected ? "heading" : "deep"}
                weight={selected ? "bold" : "medium"}
                size={18}
                lineHeight={22}
                align="center"
                style={styles.label}
              >
                {helpStrings.help.categoryTiles[category]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error !== undefined ? (
        <View style={styles.error} accessibilityLiveRegion="polite" testID={`${testID}.error`}>
          <Icon name="alertCircle" size={16} color={colors.error.text} />
          <Text variant="rowText" color="error" style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", columnGap: 9.5 },
  tile: {
    flex: 1,
    minHeight: 121,
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.bg.tintSoft,
    backgroundColor: colors.bg.tintSoft,
    paddingTop: 14,
    paddingBottom: 13,
    paddingHorizontal: 6,
  },
  tileSelected: { borderColor: colors.primary, backgroundColor: colors.bg.tintStrong },
  tilePressed: { backgroundColor: colors.bg.tintPressed, borderColor: colors.bg.tintPressed },
  tileError: { borderColor: colors.error.borderSoft },
  iconBox: { height: 40, alignItems: "center", justifyContent: "center" },
  label: { marginTop: 7 },
  error: { flexDirection: "row", alignItems: "center", marginTop: 8, paddingHorizontal: 4 },
  errorText: { marginLeft: 6, flex: 1 },
});
