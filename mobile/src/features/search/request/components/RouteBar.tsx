/**
 * Barra del trayecto («Sevilla Centro → Universidad») de 14 y 15: coche + origen del viaje, flecha y la categoría del
 * destino con su icono. Solo presenta; el texto lo compone `routeBar()` de la lógica.
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { TripCategory } from "@/api/types";
import { Icon, IconTile } from "@/icons";
import { colors, radii } from "@/theme";
import { Text, tripCategoryIcon } from "@/ui";
import { requestStrings } from "../strings";

export interface RouteBarProps {
  from: string;
  to: string;
  category: TripCategory;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function RouteBar({ from, to, category, testID = "RouteBar", style }: RouteBarProps): React.JSX.Element {
  return (
    <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={requestStrings.a11y.routeBar(from, to)} style={[styles.bar, style]}>
      <IconTile name="car" tone="blue" size={38} iconSize={24} />
      <Text variant="rowTitle" color="strong" size={19.5} lineHeight={24} numberOfLines={1} style={styles.from}>
        {from}
      </Text>
      <View style={styles.arrow}>
        <Icon name="arrowRight" size={24} color={colors.heading} />
      </View>
      <Text variant="rowTitle" color="strong" size={19.5} lineHeight={24} numberOfLines={1} style={styles.to}>
        {to}
      </Text>
      <IconTile name={tripCategoryIcon[category]} tone="blue" size={38} iconSize={24} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 48,
    borderRadius: radii.xl,
    backgroundColor: colors.bg.tint,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
  },
  from: { flexShrink: 1, flexGrow: 1, flexBasis: 0, marginLeft: 10 },
  arrow: { marginHorizontal: 8 },
  to: { flexShrink: 1, flexGrow: 1, flexBasis: 0, marginRight: 8 },
});
