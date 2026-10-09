import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";

export interface PlaceFieldRowProps {
  label: string;
  /** Lugar elegido (texto); `null` muestra el `placeholder`. */
  value: string | null;
  placeholder: string;
  /** Alto accesible de toda la fila: «Origen: Dos Hermanas. Cambiar». */
  accessibilityLabel: string;
  clearLabel: string;
  error?: string;
  onPress: () => void;
  onClear: () => void;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/** Campo de lugar de «Define tu recorrido» (origen o destino): etiqueta en azul, caja pulsable con «×» para borrar. */
export function PlaceFieldRow({ label, value, placeholder, accessibilityLabel, clearLabel, error, onPress, onClear, testID, style }: PlaceFieldRowProps): React.JSX.Element {
  return (
    <View style={style}>
      <Text variant="title" color="heading" size={21} lineHeight={26} accessibilityRole="header">{label}</Text>
      <View style={[styles.box, error !== undefined ? styles.boxError : null]}>
        <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={styles.main} testID={testID}>
          <Text variant="body" size={18} lineHeight={22} color={value !== null ? colors.heading : colors.text.muted} numberOfLines={1} style={styles.value}>
            {value ?? placeholder}
          </Text>
        </Pressable>
        {value !== null ? (
          <Pressable accessibilityRole="button" accessibilityLabel={clearLabel} onPress={onClear} hitSlop={6} style={styles.clear} testID={`${testID}.clear`}>
            <Icon name="close" size={22} color={colors.text.muted} />
          </Pressable>
        ) : null}
      </View>
      {error !== undefined ? (
        <Text variant="caption" color="error" accessibilityRole="alert" style={styles.error} testID={`${testID}.error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 6, minHeight: 50, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border.default, backgroundColor: colors.bg.white, flexDirection: "row", alignItems: "center" },
  boxError: { borderColor: colors.error.border, backgroundColor: colors.error.bg },
  main: { flex: 1, minHeight: 50, justifyContent: "center", paddingLeft: 14 },
  value: { flexShrink: 1 },
  clear: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  error: { marginTop: 4 },
});
