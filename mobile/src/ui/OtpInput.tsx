import React from "react";
import { Platform, Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, fontFamilies, radii } from "@/theme";

/** Alto de las casillas del código SMS (04: 59 pt) y separación dentro de un grupo / entre grupos de 3 (7 / 14 pt). */
const BOX_HEIGHT = 59;
const GAP = 7;
const GROUP_GAP = 14;
import { Text } from "./Text";

export interface OtpInputProps {
  /** Código escrito hasta ahora (solo dígitos). */
  value: string;
  onChange: (value: string) => void;
  /** Se llama cuando se completan todos los dígitos. */
  onComplete?: (code: string) => void;
  /** Número de casillas (6 en la verificación por SMS). */
  length?: number;
  /** Casillas por grupo; con 6 casillas se agrupan de 3 en 3 como en la 04. `0` = sin grupos. */
  groupSize?: number;
  /** Marca las casillas en rojo (código incorrecto). */
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Código de un solo uso en casillas (04). Un único `TextInput` oculto recibe el teclado numérico, el autocompletado de
 * SMS (`one-time-code` / `sms-otp`) y el pegado; las casillas son solo presentación y se enfocan al tocarlas.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  groupSize = length === 6 ? 3 : 0,
  error = false,
  disabled = false,
  autoFocus = false,
  accessibilityLabel = "Código de verificación",
  testID,
  style,
}: OtpInputProps): React.JSX.Element {
  const inputRef = React.useRef<TextInput>(null);
  const [focused, setFocused] = React.useState(false);

  const handleChange = (text: string): void => {
    const digits = text.replace(/\D/g, "").slice(0, length);
    onChange(digits);
    if (digits.length === length) onComplete?.(digits);
  };

  const active = Math.min(value.length, length - 1);
  return (
    <View style={style}>
      <Pressable
        accessible={false}
        onPress={() => inputRef.current?.focus()}
        style={styles.row}
        testID={testID !== undefined ? `${testID}.boxes` : undefined}
      >
        {Array.from({ length }, (_, i) => {
          const digit = value[i];
          const isActive = focused && i === active && !disabled;
          return (
            <View
              key={i}
              style={[
                styles.box,
                {
                  marginLeft: i === 0 ? 0 : groupSize > 0 && i % groupSize === 0 ? GROUP_GAP : GAP,
                  borderColor: error ? colors.error.border : isActive ? colors.primary : colors.border.tint,
                  borderWidth: isActive || error ? 2 : 1.5,
                  backgroundColor: error ? colors.error.bg : colors.bg.tint,
                },
              ]}
            >
              {digit !== undefined ? (
                <Text variant="kpi" color="strong" size={29} lineHeight={34} letterSpacing={0} weight="bold">
                  {digit}
                </Text>
              ) : null}
            </View>
          );
        })}
      </Pressable>
      <TextInput
        ref={inputRef}
        testID={testID}
        value={value}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!disabled}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
        textContentType="oneTimeCode"
        maxLength={length}
        caretHidden
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={`${length} dígitos`}
        style={styles.hidden}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "center" },
  box: {
    flex: 1,
    maxWidth: 46,
    height: BOX_HEIGHT,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  hidden: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: BOX_HEIGHT,
    opacity: 0,
    fontFamily: fontFamilies.regular,
    fontSize: 16,
  },
});

export interface PickupCodeProps {
  /** Código de recogida (4 caracteres, 23). */
  code: string;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Código de recogida en casillas grandes (23: «7 4 1 6»). Se anuncia como una sola cadena a lectores de pantalla. */
export function PickupCode({ code, accessibilityLabel, testID, style }: PickupCodeProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? `Código de recogida: ${code.split("").join(" ")}`}
      style={[pickupStyles.row, style]}
    >
      {code.split("").map((char, i) => (
        <View key={i} style={pickupStyles.box}>
          <Text variant="code" color="heading" size={46} lineHeight={54} letterSpacing={0}>
            {char}
          </Text>
        </View>
      ))}
    </View>
  );
}

const pickupStyles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "center" },
  box: {
    width: 58,
    height: 60,
    marginHorizontal: 7,
    borderRadius: radii.md,
    backgroundColor: colors.bg.tintStrong,
    alignItems: "center",
    justifyContent: "center",
  },
});
