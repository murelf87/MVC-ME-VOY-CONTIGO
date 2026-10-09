import React from "react";
import { Animated, Easing, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors, hexAlpha, radii, sizes } from "@/theme";
import { Text } from "./Text";

// ── Checkbox ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Texto de la casilla (o usa `children` para texto enriquecido con enlaces, como 03). */
  label?: string;
  children?: React.ReactNode;
  disabled?: boolean;
  /** Marca la casilla en rojo (p. ej. consentimiento obligatorio sin aceptar). */
  error?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Casilla cuadrada de 30 pt con visto blanco (03 «Acepto la Política de Privacidad…», 07, 31, 40). */
export function Checkbox({
  checked,
  onChange,
  label,
  children,
  disabled = false,
  error = false,
  accessibilityLabel,
  testID,
  style,
}: CheckboxProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={[styles.checkRow, style]}
    >
      <View
        style={[
          styles.checkBox,
          checked
            ? { backgroundColor: disabled ? colors.primaryDisabled : colors.primary, borderColor: "transparent" }
            : { backgroundColor: colors.bg.white, borderColor: error ? colors.error.border : colors.control.border },
        ]}
      >
        {checked ? <Icon name="checkBold" size={22} color={colors.onPrimary} /> : null}
      </View>
      {children !== undefined ? (
        <View style={styles.checkLabel}>{children}</View>
      ) : label !== undefined ? (
        <Text variant="body" color="muted" size={17.5} style={styles.checkLabel}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ── Radio ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `soft`: anillo pálido sin marcar y anillo + punto marcado (16b «Apple Pay | Tarjeta»).
 * `strong`: anillo azul sin marcar y disco azul con hueco blanco marcado (28 «Motivo de la cancelación»).
 */
export type RadioLook = "soft" | "strong";

export interface RadioProps {
  selected: boolean;
  /** Diámetro en pt (por defecto 24, medido en 28). */
  size?: number;
  look?: RadioLook;
  disabled?: boolean;
  testID?: string;
}

/** Control de radio (solo el círculo; no es interactivo por sí mismo — úsalo dentro de `RadioRow` o de una tarjeta pulsable). */
export function Radio({ selected, size = sizes.radio, look = "soft", disabled = false, testID }: RadioProps): React.JSX.Element {
  const accent = disabled ? colors.primaryDisabled : colors.primary;
  if (look === "strong") {
    return (
      <View
        testID={testID}
        style={[
          styles.radio,
          { width: size, height: size, borderRadius: size / 2 },
          selected ? { backgroundColor: accent } : { borderColor: accent, borderWidth: 2.5 },
        ]}
      >
        {selected ? <View style={{ width: size * 0.38, height: size * 0.38, borderRadius: size * 0.19, backgroundColor: colors.bg.white }} /> : null}
      </View>
    );
  }
  const ring = disabled ? colors.border.default : selected ? colors.primary : colors.control.border;
  return (
    <View
      testID={testID}
      style={[styles.radio, { width: size, height: size, borderRadius: size / 2, borderColor: ring, borderWidth: selected ? 2.5 : 1.5 }]}
    >
      {selected ? <View style={{ width: size * 0.46, height: size * 0.46, borderRadius: size * 0.23, backgroundColor: accent }} /> : null}
    </View>
  );
}

export interface RadioRowProps {
  label: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Fila de opción única (28 «Motivo de la cancelación»): fondo azul claro, radio azul a la izquierda y etiqueta azul si está marcada. */
export function RadioRow({ label, selected, onSelect, disabled = false, accessibilityLabel, testID, style }: RadioRowProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.radioRow,
        { backgroundColor: selected || pressed ? colors.bg.tintStrong : colors.bg.tint },
        style,
      ]}
    >
      <Radio selected={selected} look="strong" disabled={disabled} />
      <Text variant="body" color={selected ? "heading" : "body"} size={18.5} style={styles.radioLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

// ── Switch ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Color de la pista encendida: verde (por defecto, 18/34/40) o azul (27). */
  tone?: "green" | "blue";
  disabled?: boolean;
  accessibilityLabel: string;
  testID?: string;
}

const TRACK_W = 56;
const TRACK_H = 34;
const THUMB = 28;
const PAD = 3;

/** Interruptor de las láminas (pista verde/azul al activarse, pomo blanco). Anima el cambio. */
export function Switch({ value, onValueChange, tone = "green", disabled = false, accessibilityLabel, testID }: SwitchProps): React.JSX.Element {
  const progress = React.useRef(new Animated.Value(value ? 1 : 0)).current;
  React.useEffect(() => {
    Animated.timing(progress, { toValue: value ? 1 : 0, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [value, progress]);
  const on = tone === "green" ? colors.control.switchOnGreen : colors.primary;
  const trackColor = progress.interpolate({ inputRange: [0, 1], outputRange: [colors.control.switchOff, on] });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [PAD, TRACK_W - THUMB - PAD] });
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      hitSlop={6}
      style={disabled ? styles.disabled : null}
    >
      <Animated.View style={[styles.track, { backgroundColor: trackColor }]}>
        <Animated.View style={[styles.thumb, { transform: [{ translateX }] }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  checkRow: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  checkBox: {
    width: sizes.checkbox - 1,
    height: sizes.checkbox - 1,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: { flex: 1, marginLeft: 18 },
  radio: { alignItems: "center", justifyContent: "center" },
  radioRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    borderRadius: radii.sm + 2,
  },
  radioLabel: { marginLeft: 14, flex: 1 },
  track: { width: TRACK_W, height: TRACK_H, borderRadius: TRACK_H / 2, justifyContent: "center" },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.bg.white,
    boxShadow: `0px 1px 3px ${hexAlpha(colors.brand.navy, 0.28)}`,
  },
  disabled: { opacity: 0.5 },
});
