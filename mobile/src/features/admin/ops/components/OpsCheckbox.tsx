/** Casilla de las reglas de alerta (lámina 40): 20 pt, esquinas de 6 pt, azul pleno con el visto blanco. La fila entera es pulsable (≥ 44 pt). */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";

export interface OpsCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Texto bajo la etiqueta (por ejemplo, «Sin fuente de datos»). */
  note?: string;
  /** Filas de 28,5 pt como en la lámina 40 (el área táctil se amplía con `hitSlop` hasta 44 pt). */
  compact?: boolean;
  testID: string;
}

export function OpsCheckbox({ checked, onChange, label, disabled = false, accessibilityLabel, note, compact = false, testID }: OpsCheckboxProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      hitSlop={compact ? { top: 8, bottom: 8 } : undefined}
      style={compact ? styles.rowCompact : styles.row}
    >
      <View style={[styles.box, checked ? styles.boxOn : styles.boxOff, disabled && !checked ? styles.dim : null]}>
        {checked ? <Icon name="checkBold" size={15} color={colors.text.inverse} /> : null}
      </View>
      <View style={styles.texts}>
        <Text variant="rowText" size={14.6} lineHeight={18} color={colors.text.muted}>
          {label}
        </Text>
        {note !== undefined ? (
          <Text variant="caption" size={12} lineHeight={15} color={colors.text.subtle}>
            {note}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: "row", alignItems: "center" },
  rowCompact: { height: 28.5, flexDirection: "row", alignItems: "center" },
  box: { width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: colors.primary },
  boxOff: { backgroundColor: colors.bg.white, borderWidth: 1.5, borderColor: colors.control.border },
  dim: { opacity: 0.5 },
  texts: { marginLeft: 13, flex: 1 },
});
