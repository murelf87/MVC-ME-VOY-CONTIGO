import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";

export interface DecisionBarProps {
  acceptLabel: string;
  rejectLabel: string;
  /** Etiquetas para lectores de pantalla («Aceptar a Miguel»); por defecto, el propio texto. */
  acceptAccessibilityLabel?: string;
  rejectAccessibilityLabel?: string;
  /** Una de las dos acciones se está enviando. */
  pending: "accept" | "reject" | null;
  /** Aceptar no está permitido ahora (sin plaza en el tramo, viaje cerrado…). Rechazar sigue disponible. */
  acceptDisabled?: boolean;
  /** Otra decisión se está enviando: ninguna de las dos acciones está disponible hasta que termine. */
  disabled?: boolean;
  onAccept: () => void;
  onReject: () => void;
  testID: string;
}

/** «Aceptar ›» (verde) y «Rechazar ›» (rosa) de la lámina 20, lado a lado. */
export function DecisionBar({
  acceptLabel,
  rejectLabel,
  acceptAccessibilityLabel,
  rejectAccessibilityLabel,
  pending,
  acceptDisabled = false,
  disabled = false,
  onAccept,
  onReject,
  testID,
}: DecisionBarProps): React.JSX.Element {
  const busy = pending !== null || disabled;
  return (
    <View style={styles.bar}>
      <DecisionButton
        tone="accept"
        label={acceptLabel}
        accessibilityLabel={acceptAccessibilityLabel ?? acceptLabel}
        loading={pending === "accept"}
        disabled={busy || acceptDisabled}
        onPress={onAccept}
        testID={`${testID}.accept`}
      />
      <DecisionButton
        tone="reject"
        label={rejectLabel}
        accessibilityLabel={rejectAccessibilityLabel ?? rejectLabel}
        loading={pending === "reject"}
        disabled={busy}
        onPress={onReject}
        testID={`${testID}.reject`}
      />
    </View>
  );
}

interface DecisionButtonProps {
  tone: "accept" | "reject";
  label: string;
  accessibilityLabel: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}

const TONES = {
  accept: {
    background: colors.success.button,
    pressed: colors.success.buttonPressed,
    disc: "#0A6B4D",
    glyph: "check",
    label: colors.onPrimary,
    chevron: colors.onPrimary,
  },
  reject: {
    background: colors.soft.red.bg,
    pressed: colors.soft.red.pressed,
    disc: colors.soft.red.icon,
    glyph: "close",
    label: colors.soft.red.fg,
    chevron: colors.soft.red.icon,
  },
} as const;

function DecisionButton({ tone, label, accessibilityLabel, loading, disabled, onPress, testID }: DecisionButtonProps): React.JSX.Element {
  const t = TONES[tone];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed ? t.pressed : t.background },
        disabled && !loading ? styles.disabled : null,
      ]}
    >
      <View style={[styles.disc, { backgroundColor: t.disc }]}>
        {loading ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <Icon name={t.glyph} size={tone === "accept" ? 26 : 25} color={colors.onPrimary} />}
      </View>
      <Text variant="button" color={t.label} size={23} lineHeight={28} letterSpacing={-0.6} numberOfLines={1} style={styles.label}>
        {label}
      </Text>
      <Icon name="chevronRight" size={26} color={t.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", columnGap: 9.5 },
  button: {
    flex: 1,
    height: 67.5,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 17,
    paddingRight: 8,
    borderRadius: radii.lg,
  },
  disabled: { opacity: 0.45 },
  disc: { width: 39, height: 39, borderRadius: 19.5, alignItems: "center", justifyContent: "center" },
  label: { flex: 1, marginLeft: 16 },
});
