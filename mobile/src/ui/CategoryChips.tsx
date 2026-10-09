import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { TripCategory } from "@/api/types/common";
import { Icon, type IconName } from "@/icons";
import { colors, radii } from "@/theme";
import { strings } from "@/i18n";
import { Text } from "./Text";

export const tripCategoryOrder: readonly TripCategory[] = ["work", "university", "fp_academies", "hospital", "sport", "other"];

export const tripCategoryIcon: Record<TripCategory, IconName> = {
  work: "briefcase",
  university: "school",
  fp_academies: "wrench",
  hospital: "hospital",
  sport: "run",
  other: "moreHorizontal",
};

export interface CategoryChipsProps {
  /** Categoría activa; `null`/`undefined` = ninguna. */
  value?: TripCategory | null;
  /** Si falta, los chips no responden (solo lectura). */
  onChange?: (category: TripCategory) => void;
  categories?: readonly TripCategory[];
  /** `row`: círculos con etiqueta debajo en una fila (09). `tiles`: baldosas rectangulares en cuadrícula (18). */
  layout?: "row" | "tiles";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Categorías de trayecto: Trabajo · Universidad · FP · Hospital · Deporte · Otros. */
export function CategoryChips({
  value,
  onChange,
  categories = tripCategoryOrder,
  layout = "row",
  testID,
  style,
}: CategoryChipsProps): React.JSX.Element {
  return (
    <View testID={testID} accessibilityRole="radiogroup" style={[layout === "row" ? styles.row : styles.tiles, style]}>
      {categories.map((category, index) => {
        const selected = value === category;
        const label = strings.categories[category];
        const wide = layout === "tiles" && index >= 4;
        return (
          <Pressable
            key={category}
            testID={testID !== undefined ? `${testID}.${category}` : undefined}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ selected, disabled: onChange === undefined }}
            disabled={onChange === undefined}
            onPress={() => onChange?.(category)}
            style={({ pressed }) =>
              layout === "row"
                ? styles.rowItem
                : [
                    wide ? styles.tileWide : styles.tile,
                    { backgroundColor: selected ? colors.primary : pressed ? colors.bg.tintStrong : colors.bg.tint },
                  ]
            }
          >
            {layout === "row" ? (
              <>
                <View style={[styles.circle, { backgroundColor: selected ? colors.primary : colors.bg.tintStrong }]}>
                  <Icon name={tripCategoryIcon[category]} size={28} color={selected ? colors.onPrimary : colors.primary} />
                </View>
                <View style={styles.rowLabelBox}>
                  <Text
                    variant="tabLabel"
                    color={selected ? "primary" : "heading"}
                    weight={selected ? "semibold" : "medium"}
                    align="center"
                    size={13.5}
                    letterSpacing={-0.3}
                  >
                    {label}
                  </Text>
                </View>
              </>
            ) : (
              <View style={wide ? styles.wideContent : styles.tileContent}>
                <Icon name={tripCategoryIcon[category]} size={wide ? 26 : 28} color={selected ? colors.onPrimary : colors.primary} />
                <Text
                  variant="rowTitle"
                  color={selected ? colors.onPrimary : colors.heading}
                  size={16}
                  weight="medium"
                  style={wide ? styles.wideLabel : styles.tileLabel}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  /** Seis celdas iguales (≈ 56 pt en la 09): el círculo mide 48 pt y la etiqueta puede rebasar un poco la celda («Universidad»). */
  rowItem: { flex: 1, alignItems: "center" },
  circle: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  /**
   * Caja un poco más ancha que la celda para que «Universidad» (≈ 59 pt) no se corte en celdas de ≈ 56 pt. Es una `View`
   * y el texto no usa `numberOfLines`: en web, un `Text` con `numberOfLines` queda limitado al ancho de su padre y se
   * trunca con «…» aunque el margen negativo lo ensanche.
   */
  rowLabelBox: { marginTop: 3, alignSelf: "stretch", marginHorizontal: -6 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { width: "22.4%", flexGrow: 1, minHeight: 72, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  tileWide: { flexBasis: "46%", flexGrow: 1, minHeight: 50, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  tileContent: { alignItems: "center" },
  tileLabel: { marginTop: 4 },
  wideContent: { flexDirection: "row", alignItems: "center" },
  wideLabel: { marginLeft: 12 },
});
