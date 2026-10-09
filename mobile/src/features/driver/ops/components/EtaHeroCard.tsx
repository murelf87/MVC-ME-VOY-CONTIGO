import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";

export interface EtaHeroCardProps {
  /** «Siguiente recogida» · «Salida prevista». */
  label: string;
  /** Hora grande («07:25»). */
  time: string;
  /** «8 min · 2,4 km». */
  detail?: string | null;
  /** «Laura · Montequinto». */
  caption?: string | null;
  /** Aviso bajo la hora («Hora aproximada»). */
  note?: string | null;
  accessibilityLabel: string;
  testID?: string;
}

/**
 * Tarjeta azul de la hora estimada (lámina 21 «Llegada estimada 07:25 · 8 min · 2,4 km»), versión del conductor: la hora
 * de la SIGUIENTE recogida o, con el viaje sin iniciar, la hora de salida.
 */
export function EtaHeroCard({ label, time, detail, caption, note, accessibilityLabel, testID }: EtaHeroCardProps): React.JSX.Element {
  return (
    <View testID={testID} accessible accessibilityRole="summary" accessibilityLabel={accessibilityLabel} style={styles.card}>
      <View style={styles.labelRow}>
        <Icon name="clockFilled" size={26} color={colors.onPrimary} />
        <Text variant="subtitle" color={colors.onPrimary} weight="medium" size={20} lineHeight={24} style={styles.label}>
          {label}
        </Text>
      </View>
      <Text variant="kpiLg" color={colors.onPrimary} size={60} lineHeight={64} letterSpacing={0} align="center" style={styles.time}>
        {time}
      </Text>
      {detail ? (
        <Text variant="subtitle" color={colors.onPrimary} weight="medium" size={20} lineHeight={24} align="center">
          {detail}
        </Text>
      ) : null}
      {caption ? (
        <Text variant="body" color={colors.onPrimary} size={17} lineHeight={21} align="center" numberOfLines={1} style={styles.caption}>
          {caption}
        </Text>
      ) : null}
      {note ? (
        <Text variant="rowText" color={colors.onPrimary} size={14.5} lineHeight={18} align="center" style={styles.note}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  label: { marginLeft: 10 },
  time: { marginTop: 2 },
  caption: { marginTop: 8, opacity: 0.92 },
  note: { marginTop: 4, opacity: 0.85 },
});
