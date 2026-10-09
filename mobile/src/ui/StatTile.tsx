import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, IconTile, type IconName, type IconTileTone } from "@/icons";
import { colors, hexAlpha, radii } from "@/theme";
import { Text } from "./Text";

export interface StatTileProps {
  icon: IconName;
  iconTone?: IconTileTone;
  /** Cifra principal («42», «520 €»). */
  value: string;
  /** Etiqueta («Viajes activos»). */
  label: string;
  /** Variación junto a la etiqueta: flecha verde ↗ o roja ↘ y texto («+12%»). */
  trend?: { direction: "up" | "down"; text: string };
  /** Pie en gris pequeño («Datos ilustrativos»). */
  caption?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Baldosa de indicador del panel de administración (37): icono, cifra, etiqueta y variación. */
export function StatTile({ icon, iconTone = "blue", value, label, trend, caption, testID, style }: StatTileProps): React.JSX.Element {
  const trendColor = trend?.direction === "up" ? colors.success.solid : colors.error.solid;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${label}: ${value}${trend !== undefined ? `, ${trend.direction === "up" ? "sube" : "baja"} ${trend.text}` : ""}${caption !== undefined ? `. ${caption}` : ""}`}
      style={[styles.tile, style]}
    >
      <IconTile name={icon} tone={iconTone} size={50} shape="square" iconSize={30} style={styles.icon} />
      <View style={styles.column}>
        <Text variant="kpi" color="heading" size={26} lineHeight={30} letterSpacing={0}>
          {value}
        </Text>
        <Text variant="body" color="body" size={15} lineHeight={19} letterSpacing={-0.15} numberOfLines={2}>
          {label}
        </Text>
        {trend !== undefined ? (
          <View style={styles.trend}>
            <Icon name={trend.direction === "up" ? "trendUp" : "trendDown"} size={18} color={trendColor} />
            <Text variant="rowTextStrong" color={trendColor} size={15.5} style={styles.trendText}>
              {trend.text}
            </Text>
          </View>
        ) : null}
        {caption !== undefined ? (
          <Text variant="caption" color="muted" size={13} lineHeight={16} letterSpacing={-0.1} style={styles.caption}>
            {caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Medidas de la 37a: tarjeta de 168 × 101 pt, icono de 50 pt a 9 pt de la esquina, cifra de 26 pt, etiqueta de 15 pt. */
const styles = StyleSheet.create({
  tile: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.bg.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.soft,
    paddingTop: 9,
    paddingBottom: 12,
    paddingLeft: 9,
    paddingRight: 6,
    minHeight: 101,
  },
  icon: { boxShadow: `0px 2px 8px ${hexAlpha(colors.shadow, 0.1)}` },
  column: { flex: 1, marginLeft: 8.5, marginTop: 4 },
  trend: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  trendText: { marginLeft: 3 },
  caption: { marginTop: 8 },
});
