/**
 * Fila-tarjeta de 15 («Tu plaza», «Punto de recogida», «Destino»): icono, título azul, hasta tres líneas y chevron.
 * Cada fila abre algo (cambiar días, otro punto, otra bajada), así que siempre es un botón.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, IconTile, type IconName } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";

export interface InfoRowProps {
  icon: IconName;
  title: string;
  lines: readonly string[];
  onPress: () => void;
  accessibilityHint?: string;
  testID?: string;
}

export function InfoRow({ icon, title, lines, onPress, accessibilityHint, testID }: InfoRowProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, ...lines].join(". ")}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <IconTile name={icon} tone="blue" size={42} iconSize={25} />
      <View style={styles.text}>
        <Text variant="rowTitle" color="heading" size={19} lineHeight={23}>
          {title}
        </Text>
        {lines.map((line, index) => (
          <Text key={`${index}:${line}`} variant="body" color="body" size={18.5} lineHeight={21.5} numberOfLines={2}>
            {line}
          </Text>
        ))}
      </View>
      <Icon name="chevronRight" size={26} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border.soft,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 10,
  },
  pressed: { backgroundColor: colors.bg.tintSoft },
  text: { flex: 1, marginLeft: 14, marginRight: 6 },
});
