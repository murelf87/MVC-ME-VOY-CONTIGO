/** Esqueleto de la hoja de «Punto de recogida» mientras llegan las propuestas: dos tarjetas con su gota, texto y radio. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { radii, colors } from "@/theme";
import { Skeleton } from "@/ui";
import { requestStrings } from "../strings";

function CardSkeleton(): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Skeleton width={40} height={48} radius={20} />
      <View style={styles.lines}>
        <Skeleton width="62%" height={18} radius={6} />
        <Skeleton width="48%" height={16} radius={6} style={styles.line} />
        <Skeleton width="72%" height={14} radius={6} style={styles.line} />
      </View>
      <Skeleton width={24} height={24} circle />
    </View>
  );
}

export function PickupSkeleton({ testID = "PickupPoint.skeleton" }: { testID?: string }): React.JSX.Element {
  return (
    <View testID={testID} accessible accessibilityLabel={requestStrings.common.loadingLabel} accessibilityState={{ busy: true }} style={styles.root}>
      <CardSkeleton />
      <CardSkeleton />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 3 },
  card: {
    minHeight: 89,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 15,
    paddingRight: 14,
    paddingVertical: 10,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border.soft,
    gap: 21,
  },
  lines: { flex: 1 },
  line: { marginTop: 8 },
});
