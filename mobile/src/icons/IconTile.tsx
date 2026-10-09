import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "@/theme";
import { Icon } from "./Icon";
import type { IconName } from "./glyphs";

/** Combinaciones fondo/icono que usan las láminas. `solid*` = icono blanco sobre color pleno. */
export type IconTileTone =
  | "blue"
  | "white"
  | "green"
  | "amber"
  | "orange"
  | "red"
  | "gray"
  | "slate"
  | "solidBlue"
  | "solidGreen"
  | "solidRed"
  | "solidRose"
  | "solidCoral"
  | "solidOrange"
  | "solidAmber";

interface ToneStyle {
  background: string;
  icon: string;
  border?: string;
}

const tones: Record<IconTileTone, ToneStyle> = {
  blue: { background: colors.tile.blue, icon: colors.primary },
  white: { background: colors.bg.white, icon: colors.primary, border: colors.border.soft },
  green: { background: colors.tile.green, icon: colors.tile.greenIcon },
  amber: { background: colors.tile.amber, icon: colors.tile.amberIcon },
  orange: { background: colors.tile.orange, icon: colors.warning.solid },
  red: { background: colors.tile.red, icon: colors.error.solid },
  gray: { background: colors.tile.gray, icon: colors.gray.icon },
  slate: { background: colors.info.tile, icon: colors.onPrimary },
  solidBlue: { background: colors.primary, icon: colors.onPrimary },
  solidGreen: { background: colors.success.solid, icon: colors.onPrimary },
  solidRed: { background: colors.error.solid, icon: colors.onPrimary },
  /** Rosa y coral de las tarjetas de error de la 36a («No hay plazas», «Pago rechazado»). */
  solidRose: { background: colors.error.rose, icon: colors.onPrimary },
  solidCoral: { background: colors.error.coral, icon: colors.onPrimary },
  solidOrange: { background: colors.warning.solid, icon: colors.onPrimary },
  solidAmber: { background: colors.amber.solid, icon: colors.onPrimary },
};

export interface IconTileProps {
  name: IconName;
  tone?: IconTileTone;
  /** Lado del cuadro/diámetro en pt. Por defecto 48. */
  size?: number;
  shape?: "circle" | "square";
  /** Tamaño del glifo; por defecto la mitad del lado. */
  iconSize?: number;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Icono sobre baldosa redonda o cuadrada tintada (filas de lista, tarjetas, KPI). */
export function IconTile({
  name,
  tone = "blue",
  size = 48,
  shape = "circle",
  iconSize,
  accessibilityLabel,
  testID,
  style,
}: IconTileProps): React.JSX.Element {
  const t = tones[tone];
  const radius = shape === "circle" ? size / 2 : Math.round(size * 0.3);
  return (
    <View
      testID={testID}
      style={[
        styles.base,
        { width: size, height: size, borderRadius: radius, backgroundColor: t.background },
        t.border !== undefined ? { borderWidth: 1, borderColor: t.border } : null,
        style,
      ]}
    >
      <Icon name={name} size={iconSize ?? Math.round(size * 0.5)} color={t.icon} accessibilityLabel={accessibilityLabel} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
});
