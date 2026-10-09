/**
 * Piezas de los campos de la tarifa (lámina 40a/40b): caja de texto de 35 pt, caja de selección «Por definir ⌄»
 * y la etiqueta/sufijo que las acompañan. Medidas tomadas de la lámina (1 pt = 2 px del recorte a 393 pt).
 */
import React from "react";
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors, fontFamilies, scaleFontSize, useFontScaleFactor } from "@/theme";
import { Text } from "@/ui";

export const FIELD_HEIGHT = 35;
const FIELD_RADIUS = 10;

export interface FieldLabelProps {
  text: string;
  /** Tamaño de letra en pt (la lámina usa 15,7 en 40a y 12,9 en las etiquetas largas de 40b). */
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FieldLabel({ text, size = 15.6, style, testID }: FieldLabelProps): React.JSX.Element {
  return (
    <View style={[styles.label, style]}>
      <Text variant="label" size={size} lineHeight={19} color={colors.text.muted} numberOfLines={1} testID={testID}>
        {text}
      </Text>
    </View>
  );
}

export interface InputBoxProps {
  value: string;
  onChangeText: (text: string) => void;
  accessibilityLabel: string;
  testID: string;
  placeholder?: string;
  /** El marcador se dibuja con la misma tinta que un valor (40b «Por definir» en la cuota Premium). */
  placeholderStrong?: boolean;
  keyboardType?: "decimal-pad" | "numeric" | "default";
  maxLength?: number;
  error?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onFocus?: () => void;
  onBlur?: () => void;
}

/** Caja de texto de la lámina: 35 pt de alto, borde azul claro de 1,5 pt, valor a 15 pt del borde en medium 19,5 pt. */
export function InputBox({
  value,
  onChangeText,
  accessibilityLabel,
  testID,
  placeholder,
  placeholderStrong = false,
  keyboardType = "decimal-pad",
  maxLength,
  error = false,
  disabled = false,
  style,
  onFocus,
  onBlur,
}: InputBoxProps): React.JSX.Element {
  const [focused, setFocused] = React.useState(false);
  const factor = useFontScaleFactor();
  const borderColor = error ? colors.error.border : focused ? colors.primary : colors.border.default;
  return (
    <View
      style={[
        styles.box,
        { borderColor, backgroundColor: disabled ? colors.bg.gray : error ? colors.error.bg : colors.bg.white },
        style,
      ]}
    >
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderStrong ? colors.text.strong : colors.text.placeholder}
        editable={!disabled}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        maxFontSizeMultiplier={1.3}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        style={[styles.input, { fontSize: scaleFontSize(19.5, factor), height: scaleFontSize(26, factor) }, disabled ? { color: colors.text.disabled } : null]}
      />
    </View>
  );
}

export interface SelectBoxProps {
  /** Texto del valor; `null` = «Por definir». */
  valueText: string | null;
  pendingText: string;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID: string;
  disabled?: boolean;
  error?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Caja de selección de la lámina 40a: «Por definir» + chevron. Abre la hoja donde se define el valor. */
export function SelectBox({ valueText, pendingText, onPress, accessibilityLabel, accessibilityHint, testID, disabled = false, error = false, style }: SelectBoxProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: 5, bottom: 5 }}
      style={[styles.box, styles.select, { borderColor: error ? colors.error.border : colors.border.default }, style]}
    >
      <Text variant="lead" size={19} lineHeight={24} color={disabled ? colors.text.disabled : colors.text.strong} numberOfLines={1} style={styles.selectText}>
        {valueText ?? pendingText}
      </Text>
      <Icon name="chevronDown" size={19} color={colors.primary} />
    </Pressable>
  );
}

export interface SuffixProps {
  text: string;
  width: number;
  paddingLeft: number;
}

/** «€ / km», «€ / mes», «€»: texto fijo a la derecha de la caja. */
export function Suffix({ text, width, paddingLeft }: SuffixProps): React.JSX.Element {
  return (
    <View style={[styles.suffix, { width, paddingLeft }]}>
      <Text variant="label" size={16.5} lineHeight={20} color={colors.text.muted} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** Mensaje de error de un campo, bajo él. */
export function FieldError({ message, testID }: { message: string; testID: string }): React.JSX.Element {
  return (
    <Text variant="caption" size={12.5} lineHeight={16} color={colors.error.text} style={styles.error} testID={testID} accessibilityRole="alert">
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: { height: 19, justifyContent: "center" },
  box: {
    height: FIELD_HEIGHT,
    borderRadius: FIELD_RADIUS,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.white,
    justifyContent: "center",
  },
  input: { padding: 0, margin: 0, paddingHorizontal: 14.5, color: colors.text.strong, fontFamily: fontFamilies.medium },
  select: { flexDirection: "row", alignItems: "center", paddingLeft: 14, paddingRight: 9 },
  selectText: { flex: 1 },
  suffix: { height: FIELD_HEIGHT, justifyContent: "center" },
  error: { marginTop: 3 },
});
