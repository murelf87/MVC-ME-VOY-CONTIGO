/** 16: «Método de pago» — dos tarjetas con radio (Apple Pay / Google Pay y Tarjeta). Un método no disponible sale gris. */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ChargeMethodKind } from "@/api/types";
import { Icon, type IconName } from "@/icons";
import { colors, radii } from "@/theme";
import { Radio, Text } from "@/ui";
import type { MethodOptionModel } from "../logic/statusModel";
import { requestStrings } from "../strings";

const copy = requestStrings.status;

const ICON: Record<ChargeMethodKind, IconName> = { apple_pay: "apple", google_pay: "smartphone", card: "card" };

export interface MethodPickerProps {
  options: readonly MethodOptionModel[];
  selected: ChargeMethodKind;
  onSelect: (kind: ChargeMethodKind) => void;
  /** Etiqueta de la tarjeta guardada elegida («Visa •••• 4242»), si la hay. */
  savedLabel?: string | null;
  testID?: string;
}

export function MethodPicker({ options, selected, onSelect, savedLabel, testID }: MethodPickerProps): React.JSX.Element {
  return (
    <View testID={testID} accessibilityRole="radiogroup" style={styles.wrap}>
      <Text variant="heading" color="heading" size={19} lineHeight={24} style={styles.title}>
        {copy.methodTitle}
      </Text>
      <View style={styles.row}>
        {options.map((option) => {
          const on = option.kind === selected;
          const label = option.kind === "card" && savedLabel ? savedLabel : option.label;
          return (
            <Pressable
              key={option.kind}
              testID={`${testID ?? "MethodPicker"}.${option.kind}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: !option.available }}
              accessibilityLabel={option.available ? label : `${label}. ${copy.methodUnavailable}`}
              onPress={() => onSelect(option.kind)}
              style={[styles.card, on ? styles.cardOn : null]}
            >
              <Radio selected={on} size={22} look="strong" disabled={!option.available} />
              <Icon name={ICON[option.kind]} size={option.kind === "card" ? 28 : 26} color={option.available ? colors.primary : colors.text.disabled} />
              <Text variant="rowTitle" color={option.available ? "strong" : colors.text.disabled} size={option.kind === "card" ? 17 : 19} lineHeight={22} numberOfLines={1} style={styles.label}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14 },
  title: { marginBottom: 8 },
  row: { flexDirection: "row", gap: 10 },
  card: {
    flex: 1,
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: colors.bg.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
    paddingHorizontal: 12,
  },
  cardOn: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.bg.tintSoft },
  label: { flexShrink: 1 },
});
