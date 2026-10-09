import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors, sizes } from "@/theme";
import { Text } from "./Text";

export type StepState = "reached" | "complete" | "upcoming";

export interface StepProgressProps {
  /** Etiquetas de los pasos, p. ej. `["Solicitud", "Aceptada", "Pago", "Confirmada"]`. */
  steps: readonly string[];
  /**
   * Índice del paso actual. Como en la lámina 16, el paso actual se pinta relleno con un visto, los anteriores como
   * anillo azul y los posteriores como disco gris. Usa `states` para controlar cada paso.
   */
  current?: number;
  /** Estado explícito de cada paso (sustituye a `current`). */
  states?: readonly StepState[];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const D = sizes.progressDot;
const D_IDLE = sizes.progressDotIdle;
const LINE = 2.5;

/** Indicador de pasos Solicitud → Aceptada → Pago → Confirmada (16b). */
export function StepProgress({ steps, current = 0, states, testID, style }: StepProgressProps): React.JSX.Element {
  const resolved: StepState[] = steps.map((_, i) => {
    if (states !== undefined) return states[i] ?? "upcoming";
    return i < current ? "reached" : i === current ? "complete" : "upcoming";
  });
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Paso ${Math.min(current + 1, steps.length)} de ${steps.length}: ${steps[Math.min(current, steps.length - 1)] ?? ""}`}
      style={[styles.row, style]}
    >
      {steps.map((label, i) => {
        const state = resolved[i] ?? "upcoming";
        const next = resolved[i + 1];
        const lineActive = next !== undefined && next !== "upcoming";
        return (
          <View key={`${label}-${i}`} style={styles.step}>
            <View style={styles.dotRow}>
              <View style={styles.lineSlot}>{i > 0 ? <View style={[styles.line, { backgroundColor: state !== "upcoming" ? colors.primary : colors.gray.line }]} /> : null}</View>
              <View style={[styles.dot, dotStyle(state)]}>
                {state === "complete" ? <Icon name="checkBold" size={21} color={colors.onPrimary} /> : null}
              </View>
              <View style={styles.lineSlot}>{i < steps.length - 1 ? <View style={[styles.line, { backgroundColor: lineActive ? colors.primary : colors.gray.line }]} /> : null}</View>
            </View>
            <Text variant="rowText" color={state === "upcoming" ? colors.text.stepIdle : "heading"} size={15} weight="regular" align="center" numberOfLines={1} style={styles.label}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function dotStyle(state: StepState): ViewStyle {
  switch (state) {
    case "complete":
      return { width: D, height: D, borderRadius: D / 2, backgroundColor: colors.primary };
    case "reached":
      return { width: D, height: D, borderRadius: D / 2, backgroundColor: colors.bg.white, borderWidth: 2.5, borderColor: colors.primary };
    case "upcoming":
      return { width: D_IDLE, height: D_IDLE, borderRadius: D_IDLE / 2, backgroundColor: colors.gray.ring };
  }
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  step: { flex: 1, alignItems: "center" },
  dotRow: { flexDirection: "row", alignItems: "center", alignSelf: "stretch", height: D },
  lineSlot: { flex: 1, height: LINE, justifyContent: "center" },
  line: { height: LINE },
  dot: { alignItems: "center", justifyContent: "center" },
  label: { marginTop: 6 },
});
