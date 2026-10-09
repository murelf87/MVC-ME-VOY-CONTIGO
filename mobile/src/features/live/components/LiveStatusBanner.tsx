import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import type { WaitingKind } from "../model/phase";
import { liveStrings } from "../strings";
import { livePalette } from "./palette";

export interface LiveStatusBannerProps {
  kind: WaitingKind;
  title: string;
  message: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

interface KindStyle {
  background: string;
  tile: string;
  icon: IconName;
  iconColor: string;
  title: string;
  message: string;
}

const KINDS: Record<WaitingKind, KindStyle> = {
  enRoute: { background: colors.success.bg, tile: livePalette.carTile, icon: "car", iconColor: colors.heading, title: colors.text.deep, message: colors.text.deep },
  arriving: { background: colors.success.bg, tile: livePalette.carTile, icon: "car", iconColor: colors.heading, title: colors.text.deep, message: colors.text.deep },
  atPickup: { background: colors.success.bg, tile: colors.success.solid, icon: "checkBold", iconColor: colors.onPrimary, title: colors.success.strong, message: colors.success.text },
  scheduled: { background: colors.bg.tint, tile: colors.bg.tintStrong, icon: "clock", iconColor: colors.primary, title: colors.text.deep, message: colors.text.deep },
  cancelled: { background: colors.error.bg, tile: colors.error.solid, icon: "exclaim", iconColor: colors.onPrimary, title: colors.error.strong, message: colors.error.text },
};

/** Franja de estado de «Esperando el coche»: «Ana está en camino · Llegada en unos 8 min» (lámina 21). */
export function LiveStatusBanner({ kind, title, message, testID, style }: LiveStatusBannerProps): React.JSX.Element {
  const spec = KINDS[kind];
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${liveStrings.inCar.waitingBannerA11y}. ${title}. ${message}`}
      style={[styles.base, { backgroundColor: spec.background }, style]}
    >
      <View style={[styles.tile, { backgroundColor: spec.tile }]}>
        <Icon name={spec.icon} size={34} color={spec.iconColor} />
      </View>
      <View style={styles.texts}>
        <Text variant="titleSm" weight="bold" size={21} lineHeight={26} color={spec.title} letterSpacing={-0.2}>
          {title}
        </Text>
        <Text variant="body" size={20} lineHeight={25} color={spec.message} style={styles.message}>
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 68.5, borderRadius: 16, flexDirection: "row", alignItems: "center", paddingVertical: 3.75, paddingLeft: 13.5, paddingRight: 12 },
  tile: { width: 61, height: 61, borderRadius: 30.5, alignItems: "center", justifyContent: "center" },
  texts: { flex: 1, marginLeft: 20.5 },
  message: { marginTop: 1 },
});
