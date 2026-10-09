import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { images } from "@/assets";
import type { Role } from "@/api/types";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import { authPalette } from "./palette";
import { authStrings } from "../strings";

export interface RoleCardProps {
  role: Role;
  selected: boolean;
  onPress: () => void;
  /** Muestra el borde en rojo (no se ha elegido ningún perfil). */
  invalid?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Medidas de la lámina 02 (pt, relativas al borde exterior de la tarjeta). */
export const ROLE_CARD = {
  height: 219,
  radius: 16,
  border: 2,
  /** Ilustración: elipse con transparencia, centrada a 112,4 pt del borde superior y a 12,25 del izquierdo. */
  artLeft: 12.25,
  artCenterY: 112.4,
  badgeRing: 72,
  badgeDisc: 58,
  badgeTop: 19.25,
  badgeRight: 15.75,
  textLeft: 182.25,
  titleTop: 98,
  titleSize: 27,
  textWidth: 158,
  descSize: 19.5,
  descLineHeight: 23,
} as const;

const tones = {
  passenger: {
    fill: authPalette.roleBlueFill,
    stroke: colors.primary,
    disc: colors.primary,
    icon: "passenger" as const,
    chevron: colors.primary,
    image: images.roles.passenger,
    scale: 159.5 / 293,
  },
  driver: {
    fill: authPalette.roleGreenFill,
    stroke: colors.success.solid,
    disc: colors.success.solid,
    icon: "car" as const,
    chevron: colors.success.solid,
    image: images.roles.driver,
    scale: 162.5 / 298,
  },
} as const;

/**
 * Tarjeta de perfil de la lámina 02 («Soy pasajero» azul, «Soy conductor» verde). Es una casilla: se puede elegir una o
 * las dos. Sin elegir (como en la lámina) lleva el chevron `›`; elegida añade un marco más grueso y un círculo con
 * marca de verificación.
 */
export function RoleCard({ role, selected, onPress, invalid = false, testID, style }: RoleCardProps): React.JSX.Element {
  const tone = tones[role];
  const copy = authStrings.role;
  const title = role === "passenger" ? copy.passengerTitle : copy.driverTitle;
  const text = role === "passenger" ? copy.passengerText : copy.driverText;
  const artWidth = tone.image.width * tone.scale;
  const artHeight = tone.image.height * tone.scale;
  const stroke = invalid && !selected ? colors.error.solid : tone.stroke;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={`${title}. ${text}`}
      accessibilityState={{ checked: selected }}
      accessibilityHint={selected ? copy.selected : copy.notSelected}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: tone.fill, borderColor: stroke, opacity: pressed ? 0.92 : 1 },
        style,
      ]}
    >
      {selected ? (
        <View pointerEvents="none" style={[styles.selectionFrame, { borderColor: stroke }]} />
      ) : null}

      <Image
        source={tone.image.source}
        contentFit="fill"
        style={{
          position: "absolute",
          left: ROLE_CARD.artLeft - ROLE_CARD.border,
          top: ROLE_CARD.artCenterY - artHeight / 2 - ROLE_CARD.border,
          width: artWidth,
          height: artHeight,
        }}
        aria-hidden
        accessibilityIgnoresInvertColors
        testID={testID !== undefined ? `${testID}.art` : undefined}
      />

      <View
        pointerEvents="none"
        style={[
          styles.badgeRing,
          {
            top: ROLE_CARD.badgeTop - ROLE_CARD.border,
            right: ROLE_CARD.badgeRight - ROLE_CARD.border,
            width: ROLE_CARD.badgeRing,
            height: ROLE_CARD.badgeRing,
            borderRadius: ROLE_CARD.badgeRing / 2,
          },
        ]}
      >
        <View
          style={{
            width: ROLE_CARD.badgeDisc,
            height: ROLE_CARD.badgeDisc,
            borderRadius: ROLE_CARD.badgeDisc / 2,
            backgroundColor: tone.disc,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={tone.icon} size={34} color={colors.onPrimary} />
        </View>
      </View>

      <View style={styles.textBlock}>
        <Text
          variant="title"
          color="heading"
          size={ROLE_CARD.titleSize}
          lineHeight={ROLE_CARD.titleSize + 4}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text
          variant="subtitle"
          color="muted"
          size={ROLE_CARD.descSize}
          lineHeight={ROLE_CARD.descLineHeight}
          style={styles.desc}
        >
          {text}
        </Text>
      </View>

      <View style={styles.trailing} pointerEvents="none">
        {selected ? (
          <View style={[styles.check, { backgroundColor: tone.disc }]}>
            <Icon name="checkBold" size={20} color={colors.onPrimary} />
          </View>
        ) : (
          <Icon name="chevronRight" size={30} color={tone.chevron} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: ROLE_CARD.height,
    borderRadius: ROLE_CARD.radius,
    borderWidth: ROLE_CARD.border,
    paddingLeft: ROLE_CARD.textLeft - ROLE_CARD.border,
    paddingTop: ROLE_CARD.titleTop,
    paddingBottom: 14,
    paddingRight: 8,
  },
  selectionFrame: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderRadius: ROLE_CARD.radius - ROLE_CARD.border,
  },
  badgeRing: {
    position: "absolute",
    backgroundColor: colors.bg.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.brand.navy,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  textBlock: { width: ROLE_CARD.textWidth },
  desc: { marginTop: 6 },
  trailing: { position: "absolute", right: 14, bottom: 14 },
  check: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});
