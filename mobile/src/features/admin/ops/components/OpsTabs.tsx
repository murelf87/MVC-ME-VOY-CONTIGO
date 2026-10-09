/**
 * Pestañas del panel (lámina 40): cuatro píldoras de 39 pt con la activa en azul pleno. Las anchuras siguen la
 * proporción de la lámina (88 · 101,5 · 83,5 · 84) y se reparten el ancho disponible.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colors } from "@/theme";
import { Text } from "@/ui";
import type { OpsTab } from "../model/permissions";
import { opsStrings } from "../strings";

const WEIGHTS: Readonly<Record<OpsTab, number>> = { tariffs: 88, operations: 101.5, alerts: 83.5, audit: 84 };
const ORDER: readonly OpsTab[] = ["tariffs", "operations", "alerts", "audit"];

export interface OpsTabsProps {
  value: OpsTab;
  onChange: (tab: OpsTab) => void;
  /** Contador opcional sobre una pestaña (alertas abiertas). */
  badges?: Partial<Record<OpsTab, number>>;
  testID: string;
}

export function OpsTabs({ value, onChange, badges, testID }: OpsTabsProps): React.JSX.Element {
  return (
    <View style={styles.row} accessibilityRole="tablist" accessibilityLabel={opsStrings.tabs.a11yLabel} testID={testID}>
      {ORDER.map((tab) => {
        const selected = tab === value;
        const badge = badges?.[tab] ?? 0;
        const label = opsStrings.tabs[tab];
        return (
          <Pressable
            key={tab}
            testID={`${testID}.${tab}`}
            accessibilityRole="tab"
            accessibilityLabel={badge > 0 ? `${label}, ${badge}` : label}
            accessibilityState={{ selected }}
            onPress={() => onChange(tab)}
            style={[styles.tab, { flexGrow: WEIGHTS[tab], flexBasis: 0 }, selected ? styles.tabActive : styles.tabIdle]}
          >
            <Text variant="tabLabel" size={13.8} lineHeight={17} color={selected ? colors.text.inverse : colors.text.link} numberOfLines={1}>
              {label}
            </Text>
            {badge > 0 ? (
              <View style={[styles.badge, selected ? styles.badgeOnActive : styles.badgeOnIdle]}>
                <Text variant="caption" size={11} lineHeight={13} weight="bold" color={selected ? colors.primary : colors.text.inverse}>
                  {badge > 99 ? "99+" : String(badge)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", paddingHorizontal: 12.5, columnGap: 4.5 },
  tab: { height: 39, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", columnGap: 5 },
  tabActive: { backgroundColor: colors.primary },
  tabIdle: { backgroundColor: colors.bg.chip },
  badge: { minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  badgeOnActive: { backgroundColor: colors.text.inverse },
  badgeOnIdle: { backgroundColor: colors.error.solid },
});
