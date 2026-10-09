/** 16: «Ejemplo de pago · Importe por definir» / «Resumen del pago» — aportación, gestión MVC y total. Solo pinta. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";
import type { SummaryModel } from "../logic/statusModel";

export interface PaymentSummaryCardProps {
  model: SummaryModel;
  testID?: string;
}

export function PaymentSummaryCard({ model, testID }: PaymentSummaryCardProps): React.JSX.Element {
  const a11y = [model.heading, ...model.rows.map((r) => `${r.label}: ${r.value}`), `${model.fee.label}: ${model.fee.value}`, `${model.total.label}: ${model.total.value}`].join(". ");
  return (
    <View testID={testID} accessible accessibilityLabel={a11y} style={styles.card}>
      <Text variant="heading" color="heading" size={18} lineHeight={22} style={styles.heading}>
        {model.heading}
      </Text>
      {model.rows.map((row) => (
        <Line key={row.key} label={row.label} value={row.value} strong />
      ))}
      <Line label={model.fee.label} value={model.fee.value} strong={model.fee.value !== "—"} />
      <View style={styles.total}>
        <Text variant="heading" color="heading" size={20} lineHeight={24}>
          {model.total.label}
        </Text>
        <Text variant="heading" color="heading" size={20} lineHeight={24} align="right">
          {model.total.value}
        </Text>
      </View>
    </View>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong: boolean }): React.JSX.Element {
  return (
    <View style={styles.line}>
      <Text variant="body" color="body" size={17} lineHeight={22} style={styles.lineLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text variant={strong ? "heading" : "body"} color="strong" size={17} lineHeight={22} align="right">
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 14,
    backgroundColor: colors.bg.tint,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.soft,
    overflow: "hidden",
  },
  heading: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 5 },
  lineLabel: { flex: 1, marginRight: 8 },
  total: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.bg.tintStrong,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
