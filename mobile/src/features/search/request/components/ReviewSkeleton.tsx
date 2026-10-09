/** Esqueleto de «Revisa tu solicitud» mientras llegan el viaje y el presupuesto (misma estructura que la pantalla). */
import React from "react";
import { StyleSheet, View } from "react-native";
import { radii } from "@/theme";
import { Skeleton } from "@/ui";
import { requestStrings } from "../strings";

export function ReviewSkeleton({ testID = "ReviewRequest.skeleton" }: { testID?: string }): React.JSX.Element {
  return (
    <View testID={testID} accessible accessibilityLabel={requestStrings.common.loadingLabel} accessibilityState={{ busy: true }}>
      <Skeleton height={48} radius={radii.xl} />
      <Skeleton height={26} width="62%" style={styles.gap} />
      <Skeleton height={126} radius={radii.xl} style={styles.gap} />
      <Skeleton height={74} radius={radii.xl} style={styles.gap} />
      <Skeleton height={74} radius={radii.xl} style={styles.tight} />
      <Skeleton height={58} radius={radii.xl} style={styles.tight} />
      <Skeleton height={172} radius={radii.xl} style={styles.gap} />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 14 },
  tight: { marginTop: 4 },
});
