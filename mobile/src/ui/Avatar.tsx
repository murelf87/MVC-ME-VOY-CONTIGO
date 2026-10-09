import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Image, type ImageSource } from "expo-image";
import { Icon, type IconName } from "@/icons";
import { avatarSizes, colors, hexAlpha, shadows, type AvatarSize } from "@/theme";
import { strings } from "@/i18n";
import { Text } from "./Text";

export interface AvatarProps {
  /** Foto (`{ uri }`, `require(...)` o URL). Sin foto se muestran las iniciales de `name`. */
  source?: ImageSource | number | string | null;
  /** Nombre de la persona: iniciales de reserva y etiqueta accesible. */
  name?: string;
  /** Nombre de tamaño del tema (`sm` 36, `md` 45, `lg` 62, `xl` 75, `xxl` 90, `hero` 112) o diámetro en pt. */
  size?: AvatarSize | number;
  /** Insignia verde de verificado en la esquina inferior derecha. */
  verified?: boolean;
  /** Insignia de acción en la esquina inferior derecha («camera» como en 03/05, o cualquier icono). */
  badge?: "camera" | IconName;
  /**
   * `solid` (03): disco azul con borde blanco e icono de cámara en blanco, para fotos pequeñas.
   * `ring` (05): disco blanco con anillo azul claro, sombra e icono azul, para la foto grande de perfil.
   */
  badgeVariant?: "solid" | "ring";
  onBadgePress?: () => void;
  badgeAccessibilityLabel?: string;
  /** Desenfoca la foto (07: «Comprobación privada» no se muestra a otros). */
  blurred?: boolean;
  /** Anillo blanco con sombra (foto grande de perfil). */
  ring?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

function initialsOf(name: string | undefined): string {
  if (name === undefined) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0]?.charAt(0) ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

/** Foto de perfil circular con iniciales de reserva e insignias (cámara / verificado). */
export function Avatar({
  source,
  name,
  size = "md",
  verified = false,
  badge,
  badgeVariant = "solid",
  onBadgePress,
  badgeAccessibilityLabel,
  blurred = false,
  ring = false,
  testID,
  style,
}: AvatarProps): React.JSX.Element {
  const diameter = typeof size === "number" ? size : avatarSizes[size];
  const [failed, setFailed] = React.useState(false);
  const showImage = source !== undefined && source !== null && source !== "" && !failed;
  const verifiedSize = Math.max(18, Math.round(diameter * 0.34));
  const badgeIcon: IconName | undefined = badge === "camera" ? "camera" : badge;
  const action = actionBadgeGeometry(diameter, badgeVariant);

  return (
    <View
      testID={testID}
      accessible={name !== undefined}
      accessibilityRole="image"
      accessibilityLabel={name !== undefined ? `${strings.a11y.avatar}: ${name}` : undefined}
      style={[{ width: diameter, height: diameter }, style]}
    >
      <View
        style={[
          styles.circle,
          { width: diameter, height: diameter, borderRadius: diameter / 2 },
          ring ? styles.ring : null,
        ]}
      >
        {showImage ? (
          <Image
            source={source}
            contentFit="cover"
            blurRadius={blurred ? 24 : 0}
            onError={() => setFailed(true)}
            style={{ width: diameter, height: diameter }}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text variant="titleSm" color="primary" size={Math.round(diameter * 0.38)} lineHeight={Math.round(diameter * 0.46)} letterSpacing={0}>
            {initialsOf(name)}
          </Text>
        )}
      </View>
      {verified ? (
        <View style={[styles.corner, { width: verifiedSize, height: verifiedSize, borderRadius: verifiedSize / 2, backgroundColor: colors.success.solid }]}>
          <Icon name="check" size={Math.round(verifiedSize * 0.7)} color={colors.onPrimary} />
        </View>
      ) : badgeIcon !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={badgeAccessibilityLabel ?? (badge === "camera" ? "Cambiar foto" : undefined)}
          disabled={onBadgePress === undefined}
          onPress={onBadgePress}
          hitSlop={8}
          style={[
            styles.action,
            action.box,
            badgeVariant === "ring" ? styles.actionRing : styles.actionSolid,
          ]}
        >
          <Icon name={badgeIcon} size={action.glyph} color={badgeVariant === "ring" ? colors.primary : colors.onPrimary} />
        </Pressable>
      ) : null}
    </View>
  );
}

interface ActionBadgeGeometry {
  box: ViewStyle;
  glyph: number;
}

/**
 * Medidas de la insignia de acción, proporcionales al avatar (03: foto de 103 pt, disco de ≈ 38 pt incluido el borde
 * blanco, centro sobre la circunferencia a 42°; 05: foto de ≈ 216 pt, disco de 63 pt a ≈ 39°).
 */
function actionBadgeGeometry(diameter: number, variant: "solid" | "ring"): ActionBadgeGeometry {
  const solid = variant === "solid";
  const outer = solid ? Math.max(28, Math.round(diameter * 0.37)) : Math.max(36, Math.round(diameter * 0.29));
  const angle = ((solid ? 42 : 39) * Math.PI) / 180;
  const r = diameter / 2;
  return {
    box: {
      width: outer,
      height: outer,
      borderRadius: outer / 2,
      left: Math.round(r * (1 + Math.cos(angle)) - outer / 2),
      top: Math.round(r * (1 + Math.sin(angle)) - outer / 2),
    },
    glyph: Math.round(outer * (solid ? 0.52 : 0.5)),
  };
}

const styles = StyleSheet.create({
  circle: { overflow: "hidden", backgroundColor: colors.bg.tintStrong, alignItems: "center", justifyContent: "center" },
  ring: { borderWidth: 3, borderColor: colors.bg.white, boxShadow: `0px 2px 8px ${hexAlpha(colors.shadow, 0.18)}` },
  action: { position: "absolute", alignItems: "center", justifyContent: "center" },
  actionSolid: { backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.bg.white },
  actionRing: { backgroundColor: colors.bg.white, borderWidth: 2.5, borderColor: colors.border.ring, boxShadow: shadows.float },
  corner: {
    position: "absolute",
    right: -2,
    bottom: -2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.bg.white,
  },
});
