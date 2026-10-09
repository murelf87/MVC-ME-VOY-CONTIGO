import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";

export interface PillStepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  decrementLabel: string;
  incrementLabel: string;
  /** Frase accesible del valor actual («3 plazas disponibles»). */
  valueLabel: string;
  disabled?: boolean;
  testID: string;
}

/**
 * Contador «− 3 +» de la lámina 17 («Plazas disponibles»): píldora blanca con dos teclas azul claro y la cifra en el centro.
 * Se detiene en `min` y `max` (la tecla se atenúa). Es un `adjustable` para lectores de pantalla.
 */
export function PillStepper({
  value,
  min,
  max,
  onChange,
  decrementLabel,
  incrementLabel,
  valueLabel,
  disabled = false,
  testID,
}: PillStepperProps): React.JSX.Element {
  const canDecrement = !disabled && value > min;
  const canIncrement = !disabled && value < max;
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={valueLabel}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment" && canIncrement) onChange(value + 1);
        if (event.nativeEvent.actionName === "decrement" && canDecrement) onChange(value - 1);
      }}
      style={styles.pill}
    >
      <Key
        icon="remove"
        label={decrementLabel}
        enabled={canDecrement}
        onPress={() => onChange(value - 1)}
        testID={`${testID}.decrement`}
      />
      <Text variant="kpi" color="strong" size={29} lineHeight={34} letterSpacing={-0.4} align="center" style={styles.value}>
        {String(value)}
      </Text>
      <Key icon="add" label={incrementLabel} enabled={canIncrement} onPress={() => onChange(value + 1)} testID={`${testID}.increment`} />
    </View>
  );
}

interface KeyProps {
  icon: "add" | "remove";
  label: string;
  enabled: boolean;
  onPress: () => void;
  testID: string;
}

function Key({ icon, label, enabled, onPress, testID }: KeyProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessible={false}
      importantForAccessibility="no"
      accessibilityElementsHidden
      accessibilityLabel={label}
      disabled={!enabled}
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      style={({ pressed }) => [styles.key, pressed ? styles.keyPressed : null, !enabled ? styles.keyOff : null]}
    >
      <Icon name={icon} size={30} color={enabled ? colors.primary : colors.text.disabled} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    width: 163.5,
    height: 53.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.bg.white,
    borderRadius: radii.lg,
    paddingLeft: 11.5,
    paddingRight: 7.5,
  },
  key: {
    width: 41.5,
    height: 42.5,
    borderRadius: radii.md - 2,
    backgroundColor: colors.bg.tintStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  keyPressed: { backgroundColor: colors.surface.blueStrongEdge },
  keyOff: { opacity: 0.55 },
  value: { minWidth: 28 },
});
