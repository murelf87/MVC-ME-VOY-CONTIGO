/**
 * Pestañas «Próximos (2) · En curso (1) · Historial» de «Mis viajes» (lámina 30): una sola barra azul clarísima de
 * ≈ 50 pt con la pestaña activa como píldora azul y un separador fino entre las otras. Anchos proporcionales a los de la
 * lámina (128 · 120 · 119 pt) para que se vea igual con cualquier tipografía.
 */
import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "@/theme";
import { Text } from "@/ui";
import { TRIP_TABS, type TripTab } from "../model/tripCards";
import { profileStrings } from "../strings";
import { lamina } from "./palette";

const WEIGHTS: Record<TripTab, number> = { upcoming: 128, in_progress: 120, history: 119 };

export interface TripTabsProps {
  value: TripTab;
  labels: Record<TripTab, string>;
  onChange: (tab: TripTab) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function TripTabs({ value, labels, onChange, testID = "MyTrips.tabs", style }: TripTabsProps): React.JSX.Element {
  const selectedIndex = TRIP_TABS.indexOf(value);
  return (
    <View testID={testID} accessibilityRole="tablist" accessibilityLabel={profileStrings.myTrips.tabsLabel} style={[styles.bar, style]}>
      {TRIP_TABS.map((tab, index) => {
        const selected = tab === value;
        const showDivider = index > 0 && index !== selectedIndex && index - 1 !== selectedIndex;
        return (
          <Pressable
            key={tab}
            testID={`${testID}.${tab}`}
            accessibilityRole="tab"
            accessibilityLabel={labels[tab]}
            accessibilityState={{ selected }}
            onPress={() => onChange(tab)}
            style={[styles.tab, { flexGrow: WEIGHTS[tab] }]}
          >
            {selected ? <View style={styles.pill} /> : null}
            {showDivider ? <View style={styles.divider} /> : null}
            <Text variant="tabLabel" weight="semibold" color={selected ? "inverse" : "heading"} size={17} lineHeight={22} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} align="center" style={styles.label}>
              {labels[tab]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", height: 50.5, borderRadius: 14, backgroundColor: lamina.tabsBar },
  tab: { flexBasis: 0, flexShrink: 1, minWidth: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  pill: { position: "absolute", left: 1, right: 1, top: 0.5, bottom: 1, borderRadius: 13, backgroundColor: colors.primary },
  divider: { position: "absolute", left: 0, top: 11, bottom: 11, width: 1.5, backgroundColor: lamina.tabsDivider },
  label: { zIndex: 1 },
});
