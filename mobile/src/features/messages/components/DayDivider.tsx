/**
 * Separador de día del chat («Ayer», «Vie, 2 oct»): una píldora azul clara centrada. Si todos los mensajes son de hoy
 * (como en la lámina 26) no se dibuja ninguno.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "@/theme";
import { Text } from "@/ui";

export interface DayDividerProps {
  label: string;
  testID?: string;
}

export const DayDivider = React.memo(function DayDivider({ label, testID }: DayDividerProps): React.JSX.Element {
  return (
    <View style={styles.row} testID={testID} accessibilityRole="header" accessible accessibilityLabel={label}>
      <View style={styles.pill}>
        <Text variant="rowTextStrong" color="muted" size={14.5} lineHeight={18}>
          {label}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { alignItems: "center", paddingVertical: 4 },
  pill: { minHeight: 28, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.bg.chip, alignItems: "center", justifyContent: "center" },
});
