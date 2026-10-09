import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "@/theme";
import { Text } from "@/ui";
import { plateText } from "../model/vehicle";
import { liveStrings } from "../strings";

export interface PlateChipProps {
  plate: string;
  /** `lg`: lámina 21 (≈ 99 × 32,5 pt). `md`: lámina 23 (≈ 81 × 27,5 pt). */
  size?: "lg" | "md";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const SPEC = {
  lg: { minWidth: 99, height: 32.5, font: 21, radius: 9, paddingX: 12 },
  md: { minWidth: 81, height: 27.5, font: 16.5, radius: 8, paddingX: 9 },
} as const;

/** Matrícula del coche en una pastilla con contorno. Solo se pinta si el servidor la envió (participantes del viaje). */
export function PlateChip({ plate, size = "lg", testID, style }: PlateChipProps): React.JSX.Element {
  const spec = SPEC[size];
  const text = plateText(plate);
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={liveStrings.vehicle.plateA11y(text)}
      style={[styles.base, { minWidth: spec.minWidth, height: spec.height, borderRadius: spec.radius, paddingHorizontal: spec.paddingX }, style]}
    >
      <Text variant="rowTitle" weight="medium" color="strong" size={spec.font} lineHeight={Math.round(spec.font * 1.2)} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg.white,
    borderWidth: 1.5,
    borderColor: colors.border.tint,
  },
});
