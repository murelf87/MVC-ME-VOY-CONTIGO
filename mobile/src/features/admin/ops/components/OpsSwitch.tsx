/**
 * Interruptor del panel (lámina 40): pista de 45×27 pt, verde cuando está activo, con el pulgar blanco. `locked`
 * lo deja encendido y bloqueado a propósito (restricciones de producto) sin atenuarlo: la lámina lo dibuja pleno.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colors } from "@/theme";

export interface OpsSwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  /** Bloqueado por regla de producto: no se atenúa y, al pulsarlo, avisa por `onLockedPress`. */
  locked?: boolean;
  onLockedPress?: () => void;
  testID: string;
}

export function OpsSwitch({ value, onValueChange, accessibilityLabel, disabled = false, locked = false, onLockedPress, testID }: OpsSwitchProps): React.JSX.Element {
  const inactive = disabled && !locked;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: disabled || locked }}
      disabled={disabled && !locked}
      onPress={() => {
        if (locked) onLockedPress?.();
        else onValueChange(!value);
      }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={styles.hit}
    >
      <View style={[styles.track, value ? styles.on : styles.off, inactive ? styles.dim : null]}>
        <View style={[styles.thumb, value ? styles.thumbOn : styles.thumbOff]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { width: 45, height: 27, justifyContent: "center" },
  track: { width: 45, height: 27, borderRadius: 13.5, justifyContent: "center" },
  on: { backgroundColor: colors.control.switchOnGreen },
  off: { backgroundColor: colors.control.switchOff },
  dim: { opacity: 0.5 },
  thumb: {
    position: "absolute",
    top: 3,
    width: 21,
    height: 21,
    borderRadius: 10.5,
    backgroundColor: colors.bg.white,
    boxShadow: "0px 1px 2px rgba(10, 26, 96, 0.25)",
  },
  thumbOn: { left: 21 },
  thumbOff: { left: 3 },
});
