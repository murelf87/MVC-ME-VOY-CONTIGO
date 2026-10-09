import React, { useState } from "react";
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors, fontFamilies, radii, scaleFontSize, useFontScaleFactor } from "@/theme";
import { Text } from "@/ui";

export interface ComposeFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  maxLength: number;
  /** Alto mínimo del marco (36b: 95,5 pt). */
  minHeight?: number;
  error?: string;
  disabled?: boolean;
  accessibilityLabel: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Campo multilínea con contador «0/500» (36b). Sustituye a `TextArea` del kit porque la lámina lleva el texto más
 * pegado al borde y un contador de 18 pt a la derecha. El tamaño de letra de Ajustes se aplica igual que en el kit.
 */
export function ComposeField({
  value,
  onChangeText,
  placeholder,
  maxLength,
  minHeight = 95.5,
  error,
  disabled = false,
  accessibilityLabel,
  testID,
  style,
}: ComposeFieldProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const factor = useFontScaleFactor();
  const hasError = error !== undefined && error !== "";
  return (
    <View style={style}>
      <View
        style={[
          styles.frame,
          {
            minHeight,
            borderColor: hasError ? colors.error.border : focused ? colors.primary : colors.border.default,
            backgroundColor: disabled ? colors.bg.gray : hasError ? colors.error.bg : colors.bg.white,
          },
        ]}
      >
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.text.placeholder}
          multiline
          textAlignVertical="top"
          editable={!disabled}
          maxLength={maxLength}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={accessibilityLabel}
          maxFontSizeMultiplier={1.3}
          style={[
            styles.input,
            { fontSize: scaleFontSize(16.8, factor), lineHeight: scaleFontSize(22, factor), minHeight: minHeight - 22 },
          ]}
        />
      </View>
      <View style={styles.counterRow}>
        {hasError ? (
          <View style={styles.error} accessibilityLiveRegion="polite" testID={testID !== undefined ? `${testID}.error` : undefined}>
            <Icon name="alertCircle" size={16} color={colors.error.text} />
            <Text variant="rowText" color="error" style={styles.errorText}>
              {error}
            </Text>
          </View>
        ) : (
          <View style={styles.errorSpacer} />
        )}
        <Text
          variant="body"
          color={value.length >= maxLength ? "error" : "subtle"}
          size={17.9}
          lineHeight={22}
          accessibilityLabel={`${value.length} de ${maxLength} caracteres`}
          testID={testID !== undefined ? `${testID}.counter` : undefined}
        >
          {value.length}/{maxLength}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radii.lg, borderWidth: 1.5, paddingTop: 9, paddingBottom: 11, paddingLeft: 17, paddingRight: 14 },
  input: { padding: 0, margin: 0, fontFamily: fontFamilies.regular, color: colors.text.strong },
  counterRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 2, paddingRight: 4.5 },
  error: { flex: 1, flexDirection: "row", alignItems: "center", paddingTop: 3, paddingLeft: 4 },
  errorSpacer: { flex: 1 },
  errorText: { marginLeft: 6, flex: 1 },
});
