import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { formatRating } from "@/i18n";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import { liveStrings } from "../strings";

export interface RatingInlineProps {
  /** Media de valoraciones; `null` = aún sin valoraciones (se dice «Nuevo»: nunca se inventa una media). */
  average: number | null;
  /** Tamaño de letra del valor (pt). La estrella mide ≈ 0,78 de ese tamaño. */
  size?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** «★ 4,8» tal y como la dibujan las láminas 21 y 23 (sin el número de valoraciones). */
export function RatingInline({ average, size = 22, testID, style }: RatingInlineProps): React.JSX.Element {
  if (average === null) {
    return (
      <View testID={testID} style={[styles.row, style]}>
        <Text variant="rowText" color="subtle" size={Math.round(size * 0.8)}>
          {liveStrings.driver.newDriver}
        </Text>
      </View>
    );
  }
  const value = formatRating(average);
  return (
    <View testID={testID} accessible accessibilityLabel={liveStrings.driver.ratingA11y(value)} style={[styles.row, style]}>
      <Icon name="star" size={Math.round(size * 0.78)} color={colors.amber.star} />
      <Text variant="body" weight="bold" color="strong" size={size} lineHeight={Math.round(size * 1.2)} style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  value: { marginLeft: 7 },
});
