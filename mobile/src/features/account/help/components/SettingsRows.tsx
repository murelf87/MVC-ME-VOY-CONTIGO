import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors, radii } from "@/theme";
import { Avatar, Text, surfaces } from "@/ui";
import { helpStrings } from "../strings";

/**
 * Medidas de la lámina 35b (Ajustes), tomadas sobre la imagen aprobada (pt, pantalla de 393 pt). Las láminas dibujan cada
 * fila con unos milímetros de diferencia, así que cada fila lleva sus propios números sobre una base común.
 */
const SCREEN_X = 14;
const CHEVRON_CENTER_X = 358.5;
const CHEVRON = 26;
/** El chevron queda centrado en x = 358,5 (la tarjeta termina en 379). */
const CARD_RIGHT_PADDING = 379 - (CHEVRON_CENTER_X + CHEVRON / 2);

/** Colores medidos en 35b que no tienen un nombre propio en el tema. */
export const settingsColors = {
  /** Títulos de las filas de dos líneas (#1020C8…#1827D2). */
  titleDeep: "#1424C8",
  /** Iconos azules de las filas (#0638FC; coincide con `text.link`). */
  glyph: colors.text.link,
  /** Nombre del perfil (#000880). */
  name: "#00088A",
  /** Rojo vivo de «Eliminar cuenta» y «Cerrar sesión» (#FB1014…#FD0B0C). */
  danger: "#FB1014",
  /** Fondo de la tarjeta de «Eliminar cuenta» (#FEEFEE). */
  dangerCard: "#FEEFEE",
} as const;

export interface SettingsRowMetrics {
  /** Alto mínimo de la tarjeta. */
  height: number;
  titleSize: number;
  titleColor: string;
  subtitleSize: number;
  /** Espacio entre título y subtítulo. */
  subtitleGap: number;
  /** x del centro del icono, medida desde el borde izquierdo de la pantalla. */
  glyphX: number;
  /** x donde empieza el texto, medida desde el borde izquierdo de la pantalla. */
  textX: number;
}

/** Fila con título y subtítulo («Mi móvil», «Notificaciones», «Tamaño de letra»). */
export const TWO_LINE_ROW: SettingsRowMetrics = {
  height: 70,
  titleSize: 19,
  titleColor: settingsColors.titleDeep,
  subtitleSize: 16.5,
  subtitleGap: 1.5,
  glyphX: 48.6,
  textX: 88.5,
};

/** Fila de una sola línea («Privacidad y datos», «Permisos de la app»). */
export const ONE_LINE_ROW: SettingsRowMetrics = {
  height: 56,
  titleSize: 20,
  titleColor: colors.heading,
  subtitleSize: 16.5,
  subtitleGap: 1.5,
  glyphX: 45,
  textX: 89.5,
};

export type SettingsRowTone = "blue" | "white" | "danger";

export interface SettingsRowProps {
  /** Icono del registro. Alternativa: `glyph` (dibujo propio). */
  icon?: IconName;
  iconSize?: number;
  glyph?: React.ReactNode;
  title: string;
  subtitle?: string;
  /** Tarjeta azul (por defecto), blanca con contorno o roja («Eliminar cuenta»). */
  tone?: SettingsRowTone;
  /** Sobrescribe medidas de la base (`TWO_LINE_ROW` si hay subtítulo, `ONE_LINE_ROW` si no). */
  metrics?: Partial<SettingsRowMetrics>;
  /** Desplaza el texto o el icono respecto al centro de la tarjeta (las láminas no los centran siempre). */
  textOffsetY?: number;
  glyphOffsetY?: number;
  /** Título e icono en rojo. */
  destructive?: boolean;
  onPress?: () => void;
  /** Sustituye al chevron (interruptor, indicador de progreso…) o lo quita (`"none"`). */
  trailing?: React.ReactNode | "none";
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

function surfaceFor(tone: SettingsRowTone): { background: string; border: string; pressed: string; borderWidth: number } {
  if (tone === "danger") {
    return { background: settingsColors.dangerCard, border: colors.error.borderSoft, pressed: surfaces.red.pressed, borderWidth: 1.5 };
  }
  if (tone === "white") return { background: surfaces.white.background, border: surfaces.white.border, pressed: surfaces.white.pressed, borderWidth: 1.5 };
  return { background: surfaces.blue.background, border: surfaces.blue.background, pressed: surfaces.blue.pressed, borderWidth: 0 };
}

/** Fila de «Ajustes»: icono + título + (subtítulo) + chevron, con las medidas de la lámina 35b. */
export function SettingsRow({
  icon,
  iconSize = 30,
  glyph,
  title,
  subtitle,
  tone = "blue",
  metrics,
  textOffsetY = 0,
  glyphOffsetY = 0,
  destructive = false,
  onPress,
  trailing,
  disabled = false,
  accessibilityLabel,
  testID,
}: SettingsRowProps): React.JSX.Element {
  const base = subtitle !== undefined ? TWO_LINE_ROW : ONE_LINE_ROW;
  const m: SettingsRowMetrics = { ...base, ...(destructive ? { titleColor: settingsColors.danger } : null), ...metrics };
  const surface = surfaceFor(tone);
  const leadingWidth = m.textX - SCREEN_X - surface.borderWidth;
  const glyphLeft = m.glyphX - SCREEN_X - surface.borderWidth;
  const glyphBox = Math.max(iconSize, 34);
  const glyphColor = destructive ? settingsColors.danger : settingsColors.glyph;
  const trailingNode =
    trailing === "none" ? null : trailing !== undefined ? (
      trailing
    ) : onPress !== undefined ? (
      <Icon name="chevronRight" size={CHEVRON} color={destructive ? settingsColors.danger : colors.heading} />
    ) : null;

  const content = (
    <>
      <View style={[styles.leading, { width: leadingWidth }]}>
        <View style={[styles.glyph, { marginLeft: glyphLeft - glyphBox / 2, width: glyphBox, transform: [{ translateY: glyphOffsetY }] }]}>
          {glyph ?? (icon !== undefined ? <Icon name={icon} size={iconSize} color={glyphColor} /> : null)}
        </View>
      </View>
      <View style={[styles.text, { top: textOffsetY }]}>
        <Text variant="rowTitle" color={m.titleColor} size={m.titleSize} lineHeight={Math.round(m.titleSize * 1.25)} numberOfLines={2}>
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text
            variant="body"
            color="muted"
            size={m.subtitleSize}
            lineHeight={Math.round(m.subtitleSize * 1.27)}
            numberOfLines={3}
            style={{ marginTop: m.subtitleGap }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailingNode !== null ? <View style={styles.trailing}>{trailingNode}</View> : null}
    </>
  );

  const rowStyle = (pressed: boolean) => [
    styles.row,
    {
      minHeight: m.height,
      paddingRight: CARD_RIGHT_PADDING - surface.borderWidth,
      borderWidth: surface.borderWidth,
      borderColor: surface.border,
      backgroundColor: pressed ? surface.pressed : surface.background,
      opacity: disabled ? 0.5 : 1,
    },
  ];

  if (onPress === undefined) {
    return (
      <View testID={testID} accessible={accessibilityLabel !== undefined} accessibilityLabel={accessibilityLabel} style={rowStyle(false)}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(". ")}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => rowStyle(pressed)}
    >
      {content}
    </Pressable>
  );
}

export interface ProfileCardProps {
  name: string;
  roleLine: string;
  photoUrl: string | null;
  onPress: () => void;
  testID?: string;
}

/** Cabecera de perfil de «Ajustes»: foto de 89 pt, nombre en negrita, rol y chevron (35b). */
export function ProfileCard({ name, roleLine, photoUrl, onPress, testID }: ProfileCardProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={helpStrings.settings.profileA11y(name, roleLine)}
      onPress={onPress}
      style={({ pressed }) => [styles.profile, { backgroundColor: pressed ? surfaces.blue.pressed : surfaces.blue.background }]}
    >
      <Avatar source={photoUrl} name={name} size={89} />
      <View style={styles.profileText}>
        <Text variant="title" color={settingsColors.name} size={26} lineHeight={30} numberOfLines={1}>
          {name}
        </Text>
        <Text variant="body" color="muted" size={19} lineHeight={24} numberOfLines={1} style={styles.role}>
          {roleLine}
        </Text>
      </View>
      <Icon name="chevronRight" size={CHEVRON} color={colors.heading} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", borderRadius: radii.lg },
  leading: { alignSelf: "stretch", justifyContent: "center" },
  glyph: { alignItems: "center", justifyContent: "center" },
  text: { flex: 1, paddingVertical: 8 },
  trailing: { marginLeft: 8 },
  profile: {
    minHeight: 95.5,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 3,
    paddingRight: CARD_RIGHT_PADDING,
    borderRadius: radii.lg,
  },
  profileText: { flex: 1, marginLeft: 16, paddingTop: 2 },
  role: { marginTop: 3.5 },
});
