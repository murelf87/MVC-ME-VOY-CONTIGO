import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, IconTile, type IconName, type IconTileTone } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "./Text";

/**
 * `info` (azul), `success` (verde), `warning` (melocotón/naranja: 08, 15, 22), `error` (rosa/rojo: 04, 16),
 * `notice` (ámbar: 22 «Sin señal», 36a «Destino fuera de provincia»).
 */
export type BannerKind = "info" | "success" | "warning" | "error" | "notice";

/**
 * Presets de tamaño medidos en las láminas (las franjas no son iguales entre pantallas):
 * `xs` 22 «El cambio de ruta se aplicará…» (44,5 pt) · `sm` 04 «Código incorrecto» (62,5 pt) ·
 * `md` 22 «Ana propone una nueva parada» (63,5 pt) · `lg` 16b «¡Solicitud aceptada!» (74 pt).
 */
export type BannerSize = "xs" | "sm" | "md" | "lg";

interface SizeSpec {
  tile: number;
  glyph: number;
  title: number;
  message: number;
  paddingVertical: number;
  paddingLeft: number;
  /** Separación entre el disco del icono y el texto. */
  gap: number;
  minHeight: number;
}

const sizeSpecs: Record<BannerSize, SizeSpec> = {
  xs: { tile: 24, glyph: 15, title: 15, message: 14.5, paddingVertical: 10, paddingLeft: 13, gap: 13, minHeight: 44 },
  sm: { tile: 30, glyph: 18, title: 17, message: 17, paddingVertical: 16, paddingLeft: 15, gap: 15, minHeight: 62 },
  md: { tile: 37, glyph: 23, title: 19.5, message: 16.5, paddingVertical: 12, paddingLeft: 10, gap: 13, minHeight: 63 },
  lg: { tile: 50, glyph: 30, title: 24, message: 17, paddingVertical: 12, paddingLeft: 28, gap: 16, minHeight: 74 },
};

interface KindSpec {
  background: string;
  title: string;
  message: string;
  tile: IconTileTone;
  glyph: IconName;
}

const kinds: Record<BannerKind, KindSpec> = {
  info: { background: colors.info.bg, title: colors.heading, message: colors.text.deep, tile: "solidBlue", glyph: "infoMark" },
  success: { background: colors.success.bg, title: colors.success.strong, message: colors.text.body, tile: "solidGreen", glyph: "checkBold" },
  warning: { background: colors.warning.bgSoft, title: colors.warning.title, message: colors.heading, tile: "solidOrange", glyph: "exclaim" },
  error: { background: colors.error.bg, title: colors.error.strong, message: colors.error.text, tile: "solidRed", glyph: "exclaim" },
  notice: { background: colors.notice.bg, title: colors.notice.title, message: colors.notice.detail, tile: "solidAmber", glyph: "exclaim" },
};

export interface BannerProps {
  kind?: BannerKind;
  /** Línea en negrita (opcional). */
  title?: string;
  /** Texto de la franja. */
  message?: string;
  /** Contenido libre en lugar de `message`. */
  children?: React.ReactNode;
  /** Sustituye al icono de la clase. */
  icon?: IconName;
  /** Preset de tamaño (por defecto `md`). Ver {@link BannerSize}. */
  size?: BannerSize;
  /** Ajustes finos por pantalla (pt) sobre el preset. */
  tileSize?: number;
  titleSize?: number;
  messageSize?: number;
  /** Cambia el tono del disco del icono (p. ej. `slate` en la franja informativa de la 22). */
  tileTone?: IconTileTone;
  /** Chevron a la derecha (la franja entera es pulsable si hay `onPress`). */
  chevron?: boolean;
  onPress?: () => void;
  /** Texto de acción a la derecha (enlace). */
  actionLabel?: string;
  onAction?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Franja de aviso con icono: información, éxito, advertencia, error o atención. */
export function Banner({
  kind = "info",
  title,
  message,
  children,
  icon,
  size = "md",
  tileSize,
  titleSize,
  messageSize,
  tileTone,
  chevron = false,
  onPress,
  actionLabel,
  onAction,
  accessibilityLabel,
  testID,
  style,
}: BannerProps): React.JSX.Element {
  const k = kinds[kind];
  const spec = sizeSpecs[size];
  const tile = tileSize ?? spec.tile;
  const glyph = tileSize !== undefined ? Math.round(tileSize * 0.6) : spec.glyph;
  const titleFont = titleSize ?? spec.title;
  const messageFont = messageSize ?? spec.message;
  const body = (
    <>
      <IconTile name={icon ?? k.glyph} tone={tileTone ?? k.tile} size={tile} iconSize={glyph} />
      <View style={[styles.text, { marginLeft: spec.gap }]}>
        {title !== undefined ? (
          <Text variant="rowTitle" color={k.title} size={titleFont} lineHeight={Math.round(titleFont * 1.18)} letterSpacing={-0.02 * titleFont}>
            {title}
          </Text>
        ) : null}
        {children !== undefined ? (
          children
        ) : message !== undefined ? (
          <Text variant="body" color={k.message} size={messageFont} lineHeight={Math.round(messageFont * 1.3)} letterSpacing={-0.01 * messageFont}>
            {message}
          </Text>
        ) : null}
      </View>
      {actionLabel !== undefined && onAction !== undefined ? (
        <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onAction} hitSlop={8} style={styles.action}>
          <Text variant="rowTextStrong" color="link" underline size={16}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
      {chevron ? <Icon name="chevronRight" size={22} color={colors.text.deep} /> : null}
    </>
  );
  const base: ViewStyle = {
    backgroundColor: k.background,
    borderRadius: radii.lg,
    paddingVertical: spec.paddingVertical,
    paddingLeft: spec.paddingLeft,
    paddingRight: 14,
    minHeight: spec.minHeight,
    flexDirection: "row",
    alignItems: "center",
  };
  const live = kind === "error" || kind === "warning" ? "assertive" : "polite";
  if (onPress !== undefined) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? [title, message].filter(Boolean).join(". ")}
        onPress={onPress}
        style={({ pressed }) => [base, pressed ? { opacity: 0.85 } : null, style]}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View
      testID={testID}
      accessible={accessibilityLabel !== undefined || children === undefined}
      accessibilityRole="alert"
      accessibilityLabel={accessibilityLabel ?? ([title, message].filter(Boolean).join(". ") || undefined)}
      accessibilityLiveRegion={live}
      style={[base, style]}
    >
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  text: { flex: 1 },
  action: { marginLeft: 10 },
});
