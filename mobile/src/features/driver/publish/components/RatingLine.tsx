import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { formatRating } from "@/i18n";
import { colors } from "@/theme";
import { Text } from "@/ui";
import { publishStrings } from "../strings";

export interface RatingLineProps {
  average: number | null;
  count: number;
  testID?: string;
}

/** «4,8 ★ (12)» como en la lámina 20 (cifra, estrella y número de valoraciones). Sin valoraciones: «Nuevo». */
export function RatingLine({ average, count, testID }: RatingLineProps): React.JSX.Element {
  if (average === null || count <= 0) {
    return (
      <Text testID={testID} variant="body" color="deep" size={20} lineHeight={26}>
        {publishStrings.requests.ratingNew}
      </Text>
    );
  }
  const value = formatRating(average);
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={publishStrings.requestDetail.ratingLine(value, count)}
      style={styles.row}
    >
      <Text variant="body" color="deep" size={21.5} lineHeight={26} letterSpacing={-0.3}>
        {value}
      </Text>
      <View style={styles.star}>
        <Icon name="star" size={25} color={colors.amber.star} />
      </View>
      <Text variant="body" color="deep" size={21.5} lineHeight={26} letterSpacing={-0.3}>
        {`(${count})`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  star: { marginHorizontal: 6 },
});
