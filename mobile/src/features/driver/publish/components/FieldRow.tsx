import React from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { Icon } from "@/icons";
import { colors, fontFamilies, radii, scaleFontSize, useFontScaleFactor } from "@/theme";
import { Text } from "@/ui";

export interface FieldRowProps {
  /** Etiqueta a la izquierda («Marca», «Modelo», «Matrícula»). */
  label: string;
  value: string;
  placeholder?: string;
  /** Selector: toda la fila se pulsa (abre una hoja de opciones) y lleva chevron. Sin esto es un campo de texto. */
  onPress?: () => void;
  onChangeText?: (text: string) => void;
  maxLength?: number;
  autoCapitalize?: TextInputProps["autoCapitalize"];
  autoCorrect?: boolean;
  returnKeyType?: TextInputProps["returnKeyType"];
  onSubmitEditing?: () => void;
  onBlur?: () => void;
  inputRef?: React.Ref<TextInput>;
  /** Texto de error bajo el campo. */
  error?: string | null;
  disabled?: boolean;
  accessibilityHint?: string;
  testID: string;
}

const LABEL_WIDTH = 84;
/** El campo mide 37 pt (lámina 17); con 4 pt de margen táctil arriba y abajo llega a 45 pt. */
const HIT_SLOP = { top: 4, bottom: 4, left: 0, right: 0 } as const;

/**
 * Fila «etiqueta a la izquierda + campo blanco» de la lámina 17 («Marca ›», «Modelo ›», «Matrícula»). Como selector se
 * comporta como un botón; como campo de texto escribe en línea. El error sale bajo el campo, en rojo y con icono.
 */
export function FieldRow({
  label,
  value,
  placeholder,
  onPress,
  onChangeText,
  maxLength,
  autoCapitalize = "characters",
  autoCorrect = false,
  returnKeyType,
  onSubmitEditing,
  onBlur,
  inputRef,
  error,
  disabled = false,
  accessibilityHint,
  testID,
}: FieldRowProps): React.JSX.Element {
  const factor = useFontScaleFactor();
  const innerRef = React.useRef<TextInput | null>(null);
  const attachRef = React.useCallback(
    (node: TextInput | null) => {
      innerRef.current = node;
      if (typeof inputRef === "function") inputRef(node);
      else if (inputRef !== undefined && inputRef !== null) (inputRef as React.MutableRefObject<TextInput | null>).current = node;
    },
    [inputRef],
  );
  const hasError = error !== undefined && error !== null && error !== "";
  const selector = onPress !== undefined;
  const fieldStyle = [styles.field, hasError ? styles.fieldError : null, disabled ? styles.fieldDisabled : null];

  return (
    <View style={styles.row}>
      <View style={styles.line}>
        <View style={styles.labelBox}>
          <Text variant="rowTitle" color="deep" size={19.5} lineHeight={24} letterSpacing={-0.3} numberOfLines={1}>
            {label}
          </Text>
        </View>
        {selector ? (
          <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={[label, value !== "" ? value : placeholder].filter(Boolean).join(", ")}
            accessibilityHint={accessibilityHint}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onPress}
            hitSlop={HIT_SLOP}
            style={({ pressed }) => [fieldStyle, pressed ? styles.fieldPressed : null]}
          >
            <Text
              variant="lead"
              color={value !== "" ? "strong" : "placeholder"}
              size={19.5}
              lineHeight={24}
              letterSpacing={-0.3}
              numberOfLines={1}
              style={styles.fieldText}
            >
              {value !== "" ? value : (placeholder ?? "")}
            </Text>
            <Icon name="chevronRight" size={26} color={colors.primary} />
          </Pressable>
        ) : (
          <Pressable
            accessible={false}
            disabled={disabled}
            onPress={() => innerRef.current?.focus()}
            hitSlop={HIT_SLOP}
            style={fieldStyle}
          >
            <TextInput
              ref={attachRef}
              testID={testID}
              value={value}
              onChangeText={onChangeText}
              placeholder={placeholder}
              placeholderTextColor={colors.text.placeholder}
              editable={!disabled}
              maxLength={maxLength}
              autoCapitalize={autoCapitalize}
              autoCorrect={autoCorrect}
              returnKeyType={returnKeyType}
              onSubmitEditing={onSubmitEditing}
              onBlur={onBlur}
              accessibilityLabel={label}
              accessibilityHint={accessibilityHint}
              accessibilityState={{ disabled }}
              maxFontSizeMultiplier={1.3}
              style={[
                styles.input,
                { fontSize: scaleFontSize(19.5, factor), lineHeight: scaleFontSize(24, factor), height: scaleFontSize(26, factor) },
              ]}
            />
          </Pressable>
        )}
      </View>
      {hasError ? (
        <View style={styles.errorLine} accessibilityLiveRegion="polite">
          <Icon name="alertCircle" size={18} color={colors.error.solid} />
          <Text variant="caption" color="error" size={14} lineHeight={18} style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignSelf: "stretch" },
  line: { flexDirection: "row", alignItems: "center" },
  labelBox: { width: LABEL_WIDTH, paddingRight: 4 },
  field: {
    flex: 1,
    height: 37,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg.white,
    borderRadius: radii.md,
    paddingLeft: 10.5,
    paddingRight: 6,
    borderWidth: 1,
    borderColor: "transparent",
  },
  fieldPressed: { backgroundColor: colors.bg.tintSoft },
  fieldError: { borderColor: colors.error.solid },
  fieldDisabled: { opacity: 0.55 },
  fieldText: { flex: 1 },
  input: {
    flex: 1,
    padding: 0,
    margin: 0,
    color: colors.text.strong,
    fontFamily: fontFamilies.medium,
    letterSpacing: -0.3,
  },
  errorLine: { flexDirection: "row", alignItems: "center", marginTop: 4, marginLeft: LABEL_WIDTH },
  errorText: { marginLeft: 6, flex: 1 },
});
