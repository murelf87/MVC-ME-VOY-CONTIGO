/**
 * Cabecera de las pantallas del panel (lámina 40): chevron de volver, «Panel MVC» y la sección debajo, y el disco
 * con la inicial de la persona del personal (abre «Tu acceso al panel»). Alto fijo de 60 pt bajo el margen seguro.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import { opsStrings } from "../strings";

export const OPS_HEADER_HEIGHT = 60;

export interface OpsHeaderProps {
  title: string;
  subtitle: string;
  initials: string;
  onBack?: () => void;
  onAvatarPress?: () => void;
  testID: string;
}

export function OpsHeader({ title, subtitle, initials, onBack, onAvatarPress, testID }: OpsHeaderProps): React.JSX.Element {
  return (
    <View style={styles.root} testID={testID}>
      {onBack !== undefined ? (
        <Pressable
          testID={`${testID}.back`}
          accessibilityRole="button"
          accessibilityLabel={opsStrings.header.back}
          onPress={onBack}
          style={styles.back}
        >
          <Icon name="back" size={33} color={colors.heading} />
        </Pressable>
      ) : null}
      <View style={styles.center} pointerEvents="none">
        <Text variant="title" color="heading" size={25.5} lineHeight={30} align="center" numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        <Text variant="subtitle" color="heading" size={20.6} lineHeight={26} align="center" numberOfLines={1} style={styles.subtitle}>
          {subtitle}
        </Text>
      </View>
      <Pressable
        testID={`${testID}.avatar`}
        accessibilityRole="button"
        accessibilityLabel={opsStrings.header.avatarLabel}
        onPress={onAvatarPress}
        disabled={onAvatarPress === undefined}
        style={styles.avatarHit}
      >
        <View style={styles.avatar}>
          <Text variant="titleSm" color="heading" size={18} lineHeight={22}>
            {initials}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { height: OPS_HEADER_HEIGHT },
  back: { position: "absolute", left: 4.25, top: -8, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  center: { position: "absolute", left: 52, right: 52, top: -2, alignItems: "center" },
  subtitle: { marginTop: -1 },
  avatarHit: { position: "absolute", left: 335, top: -9.5, width: 49, height: 49, alignItems: "center", justifyContent: "center" },
  avatar: {
    width: 43,
    height: 43,
    borderRadius: 21.5,
    backgroundColor: colors.bg.avatarTile,
    alignItems: "center",
    justifyContent: "center",
  },
});
