import React from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors, fontFamilies, radii, scaleFontSize, sizes, useFontScaleFactor } from "@/theme";
import { strings } from "@/i18n";
import { Text } from "./Text";

export type FieldVariant = "labeled" | "compact";

/** «Tamaño de letra» de Ajustes aplicado al texto que se escribe (con factor 1 = Normal no se añade nada). */
function scaledInputStyle(labeled: boolean, factor: number): TextStyle | null {
  if (factor === 1) return null;
  const s = (n: number): number => scaleFontSize(n, factor);
  return labeled
    ? { fontSize: s(22), lineHeight: s(26), height: s(26), letterSpacing: Math.round(-0.4 * factor * 100) / 100 }
    : { fontSize: s(17), lineHeight: s(22), height: s(26) };
}

interface FrameProps {
  variant: FieldVariant;
  focused?: boolean;
  error?: boolean;
  disabled?: boolean;
  /** Alto mínimo de la variante compacta (pt). */
  height?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/** Marco común de los campos: borde azul claro de 1 pt, foco azul de 2 pt, error rojo, desactivado gris. */
function FieldFrame({ variant, focused, error, disabled, height, style, children }: FrameProps): React.JSX.Element {
  const borderColor = error ? colors.error.border : focused ? colors.primary : colors.border.default;
  return (
    <View
      style={[
        styles.frame,
        variant === "labeled" ? styles.frameLabeled : styles.frameCompact,
        {
          borderColor,
          borderWidth: focused || error ? 1.5 : 1,
          backgroundColor: disabled ? colors.bg.gray : error ? colors.error.bg : colors.bg.white,
        },
        variant === "compact" && height !== undefined ? { minHeight: height } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

function FieldMessage({ error, helper }: { error?: string; helper?: string }): React.JSX.Element | null {
  if (error !== undefined && error !== "") {
    return (
      <View style={styles.message} accessibilityLiveRegion="polite">
        <Icon name="alertCircle" size={16} color={colors.error.text} />
        <Text variant="rowText" color="error" style={styles.messageText}>
          {error}
        </Text>
      </View>
    );
  }
  if (helper !== undefined && helper !== "") {
    return (
      <View style={styles.message}>
        <Text variant="rowText" color="subtle">
          {helper}
        </Text>
      </View>
    );
  }
  return null;
}

export interface TextFieldProps {
  /** Etiqueta interior (variante `labeled`, como la lámina 03). */
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  /** `labeled` = etiqueta + valor en dos líneas (68 pt). `compact` = una línea de 44 pt (09/10). */
  variant?: FieldVariant;
  /** Alto de la variante compacta en pt (por defecto 44; 09 «Sevilla», 10 horas y 37 «Hoy» miden 39–40). */
  height?: number;
  placeholder?: string;
  leadingIcon?: IconName;
  /** Contenido a la derecha (p. ej. un chevron o un botón). */
  trailing?: React.ReactNode;
  /** Variante compacta: muestra un aspa para borrar cuando hay texto (10). */
  clearable?: boolean;
  /** Mensaje de error (rojo, bajo el campo). Su presencia marca el campo como erróneo. */
  error?: string;
  /** Ayuda bajo el campo. */
  helper?: string;
  disabled?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: TextInputProps["autoCapitalize"];
  autoComplete?: TextInputProps["autoComplete"];
  autoCorrect?: boolean;
  textContentType?: TextInputProps["textContentType"];
  secureTextEntry?: boolean;
  maxLength?: number;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  inputRef?: React.Ref<TextInput>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Campo de texto de una línea con etiqueta interior (como 03) o compacto (como 09/10). */
export function TextField({
  label,
  value,
  onChangeText,
  variant = "labeled",
  height,
  placeholder,
  leadingIcon,
  trailing,
  clearable = false,
  error,
  helper,
  disabled = false,
  keyboardType,
  autoCapitalize,
  autoComplete,
  autoCorrect,
  textContentType,
  secureTextEntry,
  maxLength,
  returnKeyType,
  onSubmitEditing,
  onFocus,
  onBlur,
  inputRef,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: TextFieldProps): React.JSX.Element {
  const [focused, setFocused] = React.useState(false);
  const fontFactor = useFontScaleFactor();
  const hasError = error !== undefined && error !== "";
  const labeled = variant === "labeled";
  const showClear = clearable && value.length > 0 && !disabled;

  return (
    <View style={style}>
      <FieldFrame variant={variant} focused={focused} error={hasError} disabled={disabled} height={height}>
        {leadingIcon !== undefined ? (
          <View style={[styles.leading, labeled ? null : styles.leadingCompact]}>
            <Icon name={leadingIcon} size={24} color={labeled ? colors.icon.field : colors.heading} />
          </View>
        ) : null}
        <View style={styles.body}>
          {labeled && label !== undefined ? (
            <Text variant="label" color="muted" size={19.2} lineHeight={22} numberOfLines={1}>
              {label}
            </Text>
          ) : null}
          <TextInput
            ref={inputRef}
            testID={testID}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.text.placeholder}
            editable={!disabled}
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            autoComplete={autoComplete}
            autoCorrect={autoCorrect}
            textContentType={textContentType}
            secureTextEntry={secureTextEntry}
            maxLength={maxLength}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            onFocus={() => {
              setFocused(true);
              onFocus?.();
            }}
            onBlur={() => {
              setFocused(false);
              onBlur?.();
            }}
            accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
            accessibilityHint={accessibilityHint}
            accessibilityState={{ disabled }}
            maxFontSizeMultiplier={1.3}
            style={[
              styles.input,
              labeled ? styles.inputLabeled : styles.inputCompact,
              scaledInputStyle(labeled, fontFactor),
              disabled ? { color: colors.text.disabled } : null,
            ]}
          />
        </View>
        {showClear ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.a11y.clearField}
            onPress={() => onChangeText("")}
            hitSlop={10}
            style={styles.trailing}
            testID={testID !== undefined ? `${testID}.clear` : undefined}
          >
            <Icon name="close" size={22} color={colors.text.muted} />
          </Pressable>
        ) : null}
        {trailing !== undefined ? <View style={styles.trailing}>{trailing}</View> : null}
      </FieldFrame>
      <FieldMessage error={error} helper={helper} />
    </View>
  );
}

export interface TextAreaProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Límite de caracteres; si se indica se muestra el contador «0/500» bajo el campo (35). */
  maxLength?: number;
  /** Altura mínima en pt (por defecto 112). */
  minHeight?: number;
  error?: string;
  helper?: string;
  disabled?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Campo de texto multilínea con contador de caracteres. */
export function TextArea({
  value,
  onChangeText,
  placeholder,
  maxLength,
  minHeight = sizes.textArea,
  error,
  helper,
  disabled = false,
  onFocus,
  onBlur,
  accessibilityLabel,
  testID,
  style,
}: TextAreaProps): React.JSX.Element {
  const [focused, setFocused] = React.useState(false);
  const fontFactor = useFontScaleFactor();
  const hasError = error !== undefined && error !== "";
  return (
    <View style={style}>
      <View
        style={[
          styles.area,
          {
            minHeight,
            borderColor: hasError ? colors.error.border : focused ? colors.primary : colors.border.default,
            borderWidth: focused || hasError ? 1.5 : 1,
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
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          accessibilityLabel={accessibilityLabel ?? placeholder}
          maxFontSizeMultiplier={1.3}
          style={[
            styles.areaInput,
            fontFactor === 1 ? null : { fontSize: scaleFontSize(17, fontFactor), lineHeight: scaleFontSize(22, fontFactor) },
            { minHeight: minHeight - 28 },
          ]}
        />
      </View>
      {maxLength !== undefined ? (
        <View style={styles.counter}>
          <Text variant="rowText" color="subtle" align="right" accessibilityLabel={`${value.length} de ${maxLength} caracteres`}>
            {value.length}/{maxLength}
          </Text>
        </View>
      ) : null}
      <FieldMessage error={error} helper={helper} />
    </View>
  );
}

export interface SelectFieldProps {
  label?: string;
  /** Texto del valor elegido; si es `undefined` o vacío se muestra `placeholder`. */
  valueLabel?: string;
  placeholder?: string;
  variant?: FieldVariant;
  leadingIcon?: IconName;
  /** Variante compacta: valor en azul de título y negrita (09 «Sevilla», «Con plazas»; 37 «Hoy»). */
  emphasis?: boolean;
  /** Variante compacta: alto en pt (por defecto 44). */
  height?: number;
  /** Variante compacta: tamaño del valor en pt (por defecto 17; 20 con `emphasis`; 09 «Con plazas» y 37 «Hoy» miden ≈ 17). */
  valueSize?: number;
  /** Abre el selector (hoja inferior, diálogo…). */
  onPress: () => void;
  error?: string;
  helper?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Campo de selección: mismo aspecto que `TextField` pero pulsable, con chevron hacia abajo (03 «Provincia», 10 horas). */
export function SelectField({
  label,
  valueLabel,
  placeholder,
  variant = "labeled",
  leadingIcon,
  emphasis = false,
  height,
  valueSize,
  onPress,
  error,
  helper,
  disabled = false,
  accessibilityLabel,
  testID,
  style,
}: SelectFieldProps): React.JSX.Element {
  const hasError = error !== undefined && error !== "";
  const hasValue = valueLabel !== undefined && valueLabel !== "";
  const labeled = variant === "labeled";
  return (
    <View style={style}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? [label, hasValue ? valueLabel : placeholder].filter(Boolean).join(", ")}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
      >
        {({ pressed }) => (
          <FieldFrame variant={variant} focused={pressed} error={hasError} disabled={disabled} height={height}>
            {leadingIcon !== undefined ? (
              <View style={[styles.leading, labeled ? null : styles.leadingCompact]}>
                <Icon name={leadingIcon} size={24} color={labeled ? colors.icon.field : colors.heading} />
              </View>
            ) : null}
            <View style={styles.body}>
              {labeled && label !== undefined ? (
                <Text variant="label" color="muted" size={19.2} lineHeight={22} numberOfLines={1}>
                  {label}
                </Text>
              ) : null}
              <Text
                variant={labeled ? "lead" : "body"}
                color={hasValue ? (emphasis ? "heading" : "strong") : "placeholder"}
                weight={emphasis && hasValue ? "semibold" : undefined}
                size={labeled ? undefined : (valueSize ?? (emphasis ? 20 : undefined))}
                numberOfLines={1}
                style={labeled ? styles.selectValue : undefined}
              >
                {hasValue ? valueLabel : (placeholder ?? "")}
              </Text>
            </View>
            <View style={styles.trailing}>
              <Icon name="chevronDown" size={24} color={colors.primary} />
            </View>
          </FieldFrame>
        )}
      </Pressable>
      <FieldMessage error={error} helper={helper} />
    </View>
  );
}

/** Agrupa un número español de móvil en bloques de tres (`612345678` → `612 345 678`); no toca números con prefijo `+`. */
export function formatPhoneInput(raw: string): string {
  if (raw.trim().startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "").slice(0, 9);
  return digits.replace(/(\d{3})(?=\d)/g, "$1 ");
}

export interface PhoneFieldProps extends Omit<TextFieldProps, "keyboardType" | "autoComplete" | "textContentType" | "leadingIcon" | "variant"> {
  /** Etiqueta (por defecto «Número de móvil»). */
  label?: string;
}

/** Campo «Número de móvil» (03): teclado numérico, relleno automático de teléfono y agrupación `612 345 678`. */
export function PhoneField({ label = "Número de móvil", onChangeText, ...rest }: PhoneFieldProps): React.JSX.Element {
  return (
    <TextField
      {...rest}
      label={label}
      leadingIcon="phone"
      keyboardType="phone-pad"
      autoComplete="tel"
      textContentType="telephoneNumber"
      onChangeText={(text) => onChangeText(formatPhoneInput(text))}
    />
  );
}

const styles = StyleSheet.create({
  frame: { flexDirection: "row", alignItems: "center" },
  /** Radio 16 pt medido en 03 (campos de 68 pt). */
  frameLabeled: { minHeight: sizes.field, paddingLeft: 14, paddingRight: 16, borderRadius: 16 },
  frameCompact: { minHeight: sizes.fieldCompact, paddingLeft: 14, paddingRight: 12, borderRadius: radii.lg },
  leading: { width: 24, marginRight: 21, alignItems: "center", justifyContent: "center" },
  leadingCompact: { marginRight: 12 },
  body: { flex: 1, justifyContent: "center" },
  trailing: { marginLeft: 8, alignItems: "center", justifyContent: "center", minWidth: 24 },
  input: { padding: 0, margin: 0, color: colors.text.strong, fontFamily: fontFamilies.medium },
  inputLabeled: { fontSize: 22, lineHeight: 26, height: 26, letterSpacing: -0.4, marginTop: 3, marginBottom: 0 },
  inputCompact: { fontSize: 17, lineHeight: 22, height: 26, fontFamily: fontFamilies.regular },
  selectValue: { marginTop: 3 },
  message: { flexDirection: "row", alignItems: "center", marginTop: 6, paddingHorizontal: 6 },
  messageText: { marginLeft: 6, flex: 1 },
  area: { borderRadius: radii.lg, padding: 14 },
  areaInput: {
    padding: 0,
    margin: 0,
    fontFamily: fontFamilies.regular,
    fontSize: 17,
    lineHeight: 22,
    color: colors.text.strong,
  },
  counter: { marginTop: 6, paddingRight: 4 },
});
