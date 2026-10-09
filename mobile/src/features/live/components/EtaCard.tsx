import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import type { EtaView } from "../model/eta";
import { liveStrings } from "../strings";

export interface EtaCardProps {
  /** `null` = aún no hay llegada calculable («Calculando la llegada…»). */
  eta: EtaView | null;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Tarjeta azul «Llegada estimada · 07:25 · 8 min · 2,4 km» de la lámina 21. */
export function EtaCard({ eta, testID, style }: EtaCardProps): React.JSX.Element {
  if (eta === null) {
    return (
      <View testID={testID} accessible accessibilityLabel={liveStrings.eta.calculating} style={[styles.card, styles.cardEmpty, style]}>
        <Icon name="clockFilled" size={26} color={colors.primary} />
        <Text variant="lead" color="deep" size={20} style={styles.emptyText}>
          {liveStrings.eta.calculating}
        </Text>
      </View>
    );
  }
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${eta.label} ${eta.time}. ${eta.line}`}
      style={[styles.card, style]}
    >
      <View style={styles.labelRow}>
        <Icon name="clockFilled" size={25} color={colors.onPrimary} />
        <Text variant="lead" weight="medium" color={colors.onPrimary} size={23} lineHeight={28} style={styles.label}>
          {eta.label}
        </Text>
      </View>
      <Text variant="kpiLg" color={colors.onPrimary} size={76} lineHeight={64} align="center" letterSpacing={-1} style={styles.time}>
        {eta.time}
      </Text>
      <Text variant="lead" weight="medium" color={colors.onPrimary} size={23} lineHeight={24} align="center" style={styles.line}>
        {eta.line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { height: 136.5, borderRadius: 14, backgroundColor: colors.primary, paddingTop: 11, alignItems: "stretch" },
  cardEmpty: { height: 72, backgroundColor: colors.bg.tint, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingTop: 0 },
  emptyText: { marginLeft: 10 },
  labelRow: { height: 28, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  label: { marginLeft: 12 },
  time: { height: 64 },
  line: { marginTop: 2.5, height: 24 },
});
