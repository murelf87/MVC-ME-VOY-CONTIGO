/**
 * Fila de acción de una hoja inferior: icono azul, título, descripción opcional y chevron, sobre fondo azul claro. Es la
 * misma fila que dibuja `OptionSheet` del kit; se usa suelta cuando la hoja necesita además un texto o un estado propio
 * (hoja «Adjuntar», aporte del viaje…), porque `OptionSheet` solo admite título y opciones.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors, radii } from "@/theme";
import { Spinner, Text } from "@/ui";

export interface SheetActionRowProps {
  icon: IconName;
  label: string;
  description?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Muestra un indicador en lugar del chevron (acción en curso). */
  busy?: boolean;
  destructive?: boolean;
  testID?: string;
}

export function SheetActionRow({ icon, label, description, onPress, disabled = false, busy = false, destructive = false, testID }: SheetActionRowProps): React.JSX.Element {
  const tint = destructive ? colors.error.text : colors.heading;
  const iconColor = destructive ? colors.error.solid : colors.primary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[label, description].filter(Boolean).join(". ")}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.bg.tintStrong : colors.bg.tint }, disabled ? styles.disabled : null]}
    >
      <View style={styles.lead}>
        <Icon name={icon} size={26} color={iconColor} />
      </View>
      <View style={styles.text}>
        <Text variant="rowTitle" color={tint} size={18} lineHeight={22}>
          {label}
        </Text>
        {description !== undefined ? (
          <Text variant="body" color="muted" size={15.5} lineHeight={20}>
            {description}
          </Text>
        ) : null}
      </View>
      {busy ? <Spinner size="sm" /> : <Icon name="chevronRight" size={24} color={iconColor} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 60, flexDirection: "row", alignItems: "center", borderRadius: radii.lg, paddingVertical: 12, paddingHorizontal: 16, marginTop: 8 },
  lead: { marginRight: 14 },
  text: { flex: 1, paddingRight: 8 },
  disabled: { opacity: 0.5 },
});
