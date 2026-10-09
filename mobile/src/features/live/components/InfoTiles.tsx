import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import type { EtaView } from "../model/eta";
import { liveStrings } from "../strings";

export interface EtaTileProps {
  eta: EtaView | null;
  /** «Faltan 15 min · 6,8 km». */
  remaining: string | null;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Baldosa «Llegada estimada · 08:20 · Faltan 15 min · 6,8 km» de la lámina 23. */
export function EtaTile({ eta, remaining, testID, style }: EtaTileProps): React.JSX.Element {
  const label = eta === null ? liveStrings.eta.estimated : eta.label;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={eta === null ? `${label}. ${liveStrings.inCar.etaCalculating}` : `${label} ${eta.time}${remaining !== null ? `. ${remaining}` : ""}`}
      style={[styles.eta, style]}
    >
      <Icon name="clock" size={32} color={colors.primary} style={styles.etaIcon} />
      <View style={styles.etaTexts}>
        <Text variant="rowText" color="deep" size={14.8} lineHeight={16}>
          {label}
        </Text>
        <Text variant="kpi" color="heading" size={33} lineHeight={34} style={styles.etaTime}>
          {eta === null ? "--:--" : eta.time}
        </Text>
      </View>
      <Text variant="body" color="deep" size={17.5} lineHeight={22} numberOfLines={1} style={styles.etaRemaining}>
        {remaining ?? (eta === null ? liveStrings.inCar.etaCalculating : eta.line)}
      </Text>
    </View>
  );
}

export interface ShareTileProps {
  /** `true` si ya hay un enlace activo: se dice «(enlace activo)» en vez de «(privado)». */
  active: boolean;
  onPress: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Baldosa «Compartir viaje (privado)» (lámina 23): abre la pantalla para crear o revocar el enlace. */
export function ShareTile({ active, onPress, testID, style }: ShareTileProps): React.JSX.Element {
  const sub = active ? liveStrings.inCar.shareActive : liveStrings.inCar.sharePrivate;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${liveStrings.inCar.shareTitle} ${sub}`}
      accessibilityHint={liveStrings.inCar.shareA11y}
      onPress={onPress}
      style={({ pressed }) => [styles.share, pressed ? { backgroundColor: colors.bg.tint } : null, style]}
    >
      <Icon name="share" size={34} color={colors.primary} />
      <View style={styles.shareTexts}>
        <Text variant="rowTitle" weight="bold" color="heading" size={15.5} lineHeight={20}>
          {liveStrings.inCar.shareTitle}
        </Text>
        <Text variant="rowText" color="deep" size={16} lineHeight={20}>
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  eta: { height: 86, borderRadius: 14, backgroundColor: colors.bg.tint, borderWidth: 1, borderColor: colors.border.soft },
  etaIcon: { position: "absolute", left: 10.5, top: 21 },
  etaTexts: { position: "absolute", left: 63, top: 7 },
  etaTime: { marginTop: -0.5 },
  etaRemaining: { position: "absolute", left: 11.5, right: 6, top: 59 },
  share: { height: 85, borderRadius: 14, backgroundColor: colors.bg.white, borderWidth: 1.5, borderColor: colors.primary, flexDirection: "row", alignItems: "center", paddingLeft: 10.5, paddingRight: 6 },
  shareTexts: { marginLeft: 10, flex: 1 },
});
