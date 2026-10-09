import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";
import { opsStrings } from "../strings";

const K = opsStrings.pickup.keypad;

const ROWS: readonly (readonly string[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
];

export interface NumericKeypadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  disabled?: boolean;
  testID?: string;
}

interface KeyProps {
  testID: string;
  label: string;
  onPress: () => void;
  disabled: boolean;
  children: React.ReactNode;
}

function Key({ testID, label, onPress, disabled, children }: KeyProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.key, pressed ? styles.keyPressed : null, disabled ? styles.keyDisabled : null]}
    >
      {children}
    </Pressable>
  );
}

/**
 * Teclado numérico propio para el código de recogida: teclas grandes (≥ 56 pt), siempre en el mismo sitio, sin el teclado
 * del sistema tapando la pantalla. Con las manos en el volante o al lado del coche acierta mejor que un teclado pequeño.
 */
export function NumericKeypad({ onDigit, onBackspace, onClear, disabled = false, testID = "NumericKeypad" }: NumericKeypadProps): React.JSX.Element {
  return (
    <View testID={testID} style={styles.pad}>
      {ROWS.map((row) => (
        <View key={row.join("")} style={styles.row}>
          {row.map((digit) => (
            <Key key={digit} testID={`${testID}.${digit}`} label={K.digit(digit)} disabled={disabled} onPress={() => onDigit(digit)}>
              <Text variant="kpi" color="heading" size={28} lineHeight={32} letterSpacing={0}>
                {digit}
              </Text>
            </Key>
          ))}
        </View>
      ))}
      <View style={styles.row}>
        <Key testID={`${testID}.clear`} label={K.clearAll} disabled={disabled} onPress={onClear}>
          <Text variant="rowTextStrong" color="primary" size={15} lineHeight={18}>
            {K.clear}
          </Text>
        </Key>
        <Key testID={`${testID}.0`} label={K.digit("0")} disabled={disabled} onPress={() => onDigit("0")}>
          <Text variant="kpi" color="heading" size={28} lineHeight={32} letterSpacing={0}>
            0
          </Text>
        </Key>
        <Key testID={`${testID}.backspace`} label={K.backspace} disabled={disabled} onPress={onBackspace}>
          <Icon name="arrowLeft" size={26} color={colors.primary} />
        </Key>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { alignSelf: "center", width: "100%", maxWidth: 360 },
  row: { flexDirection: "row", marginBottom: 10 },
  key: {
    flex: 1,
    minHeight: 58,
    marginHorizontal: 5,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.tint,
    borderWidth: 1,
    borderColor: colors.border.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  keyPressed: { backgroundColor: colors.bg.tintPressed },
  keyDisabled: { opacity: 0.5 },
});
