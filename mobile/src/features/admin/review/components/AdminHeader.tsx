/**
 * Cabecera común de las pantallas del panel: «Panel MVC» + segunda línea de la sección y el avatar con la inicial de la
 * persona de personal (37a, 38a, 39a), que abre «Mi acceso al panel».
 *
 * Usa `ScreenHeader` (chevron de volver y título centrado) y le pone el avatar de las láminas: disco de 44 pt con su
 * borde derecho a ≈ 13 pt del borde de la pantalla.
 */
import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { colors } from "@/theme";
import { ScreenHeader, Text } from "@/ui";
import { reviewStrings } from "../strings";

export interface AdminHeaderProps {
  /** Segunda línea («Usuarios y revisión»). */
  subtitle: string;
  /** Inicial del avatar (viene de `GET /v1/admin/me`). */
  initial: string;
  /** Nombre completo para la etiqueta accesible del avatar. */
  staffName: string | null;
  onAvatarPress: () => void;
  onBack?: () => void;
  hideBack?: boolean;
  testID?: string;
}

const AVATAR = 44;

export function AdminHeader({ subtitle, initial, staffName, onAvatarPress, onBack, hideBack, testID = "AdminHeader" }: AdminHeaderProps): React.JSX.Element {
  const avatar = (
    <Pressable
      testID={`${testID}.avatar`}
      accessibilityRole="button"
      accessibilityLabel={reviewStrings.common.staffAvatarA11y(staffName ?? initial)}
      onPress={onAvatarPress}
      hitSlop={4}
      style={({ pressed }) => [styles.avatar, pressed ? styles.pressed : null]}
    >
      <Text variant="titleSm" color="heading" size={22} lineHeight={26}>
        {initial}
      </Text>
    </Pressable>
  );
  return <ScreenHeader testID={testID} title={reviewStrings.common.panelTitle} subtitle={subtitle} onBack={onBack} hideBack={hideBack} right={avatar} />;
}

const styles = StyleSheet.create({
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    marginRight: -5,
    backgroundColor: colors.bg.avatarTile,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.8 },
});
