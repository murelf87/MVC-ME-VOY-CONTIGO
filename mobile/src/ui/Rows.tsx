import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "./Text";
import { surfaces, type SurfaceTone } from "./tones";

// ── Divider ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DividerProps {
  /** `o` centrado entre dos líneas (04). */
  label?: string;
  inset?: number;
  style?: StyleProp<ViewStyle>;
}

/** Línea separadora fina; con `label` dibuja «── o ──». */
export function Divider({ label, inset = 0, style }: DividerProps): React.JSX.Element {
  if (label !== undefined) {
    return (
      <View style={[styles.labelled, { marginHorizontal: inset }, style]} aria-hidden>
        <View style={styles.line} />
        <Text variant="body" color="muted" size={17} style={styles.labelText}>
          {label}
        </Text>
        <View style={styles.line} />
      </View>
    );
  }
  return <View style={[styles.divider, { marginHorizontal: inset }, style]} aria-hidden />;
}

// ── SectionHeader ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface SectionHeaderProps {
  title: string;
  /** Texto de la acción a la derecha («Ver todos», «Editar», «Añadir»). */
  actionLabel?: string;
  onAction?: () => void;
  /** Icono delante del texto de acción (p. ej. `add` para «+ Añadir» de 31). */
  actionIcon?: IconName;
  /** `pill`: acción dentro de una píldora tintada (31 «+ Añadir»). */
  actionStyle?: "link" | "pill";
  /** Subtítulo corto bajo el título. */
  caption?: string;
  /** `heading` (19 pt) o `title` (24 pt, como «Mis destinos» de 31). */
  level?: "heading" | "title";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Título de sección con acción opcional alineada a la derecha. */
export function SectionHeader({
  title,
  actionLabel,
  onAction,
  actionIcon,
  actionStyle = "link",
  caption,
  level = "heading",
  testID,
  style,
}: SectionHeaderProps): React.JSX.Element {
  return (
    <View testID={testID} style={[styles.sectionRow, style]}>
      <View style={styles.sectionText}>
        <Text variant={level === "title" ? "title" : "heading"} color="heading" size={level === "title" ? 23 : 21} accessibilityRole="header">
          {title}
        </Text>
        {caption !== undefined ? (
          <Text variant="rowText" color="muted">
            {caption}
          </Text>
        ) : null}
      </View>
      {actionLabel !== undefined && onAction !== undefined ? (
        <Pressable
          testID={testID !== undefined ? `${testID}.action` : undefined}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          hitSlop={8}
          style={({ pressed }) => [
            styles.action,
            actionStyle === "pill" ? styles.actionPill : null,
            pressed ? { opacity: 0.6 } : null,
          ]}
        >
          {actionIcon !== undefined ? <Icon name={actionIcon} size={20} color={colors.primary} /> : null}
          <Text variant="subtitle" color={actionStyle === "pill" ? "primary" : "link"} size={18} lineHeight={22} weight="medium" style={actionIcon !== undefined ? styles.actionLabel : undefined}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── KeyValueRow ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface KeyValueRowProps {
  label: string;
  /** Valor a la derecha. */
  value: string;
  /** Línea secundaria bajo la etiqueta («Ejemplo orientativo (6 km)»). */
  caption?: string;
  /** Fila de total: barra azul clara con letra mayor y en negrita (16 «Total · Por definir»). */
  emphasis?: boolean;
  /** Etiqueta «ilustrativo» tras el valor. */
  tag?: string;
  /** Muestra un `?` pulsable (15 «Gestión MVC · Por definir»). */
  onHelp?: () => void;
  helpAccessibilityLabel?: string;
  /** Color del valor (por defecto `strong`). */
  valueColor?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Fila «etiqueta … valor» para desgloses de importes, resúmenes de viaje y fichas. */
export function KeyValueRow({
  label,
  value,
  caption,
  emphasis = false,
  tag,
  onHelp,
  helpAccessibilityLabel = "Más información",
  valueColor,
  testID,
  style,
}: KeyValueRowProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${label}: ${value}${tag !== undefined ? ` (${tag})` : ""}`}
      style={[styles.kv, emphasis ? styles.kvEmphasis : null, style]}
    >
      <View style={styles.kvLabel}>
        <Text variant={emphasis ? "heading" : "body"} color={emphasis ? "heading" : "muted"} size={emphasis ? 22 : 17} weight={emphasis ? "bold" : "regular"}>
          {label}
        </Text>
        {caption !== undefined ? (
          <Text variant="rowText" color="subtle" size={13.5}>
            {caption}
          </Text>
        ) : null}
      </View>
      <Text variant="bodyStrong" color={valueColor ?? (emphasis ? "heading" : "strong")} size={emphasis ? 22 : 17} weight={emphasis ? "bold" : "semibold"} align="right">
        {value}
      </Text>
      {tag !== undefined ? (
        <Text variant="caption" color="subtle" style={styles.kvTag}>
          {tag}
        </Text>
      ) : null}
      {onHelp !== undefined ? (
        <Pressable accessibilityRole="button" accessibilityLabel={helpAccessibilityLabel} onPress={onHelp} hitSlop={10} style={styles.kvHelp}>
          <Icon name="help" size={24} color={colors.gray.help} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ── ListRow ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Contenido a la izquierda: `<IconTile/>`, `<Avatar/>`… */
  leading?: React.ReactNode;
  /** `chevron` (por defecto si hay `onPress`), `none` o un nodo propio (interruptor, píldora…). */
  trailing?: "chevron" | "none" | React.ReactNode;
  /** Texto de valor antes del chevron («Normal», «Por definir»). */
  value?: string;
  onPress?: () => void;
  /** Fondo de la fila-tarjeta (por defecto `blue`). `none` = fila plana sin fondo. */
  tone?: SurfaceTone | "none";
  /** Título y chevron en rojo (34 «Eliminar cuenta»). */
  destructive?: boolean;
  disabled?: boolean;
  /** Tamaño del título en pt (por defecto 19). */
  titleSize?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Fila de lista tipo tarjeta: icono/foto + título + subtítulo + valor/chevron (29, 33, 34, 27…). */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  value,
  onPress,
  tone = "blue",
  destructive = false,
  disabled = false,
  titleSize = 19,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ListRowProps): React.JSX.Element {
  const effectiveTrailing = trailing ?? (onPress !== undefined ? "chevron" : "none");
  const surface = tone === "none" ? undefined : surfaces[tone];
  const titleColor = destructive ? colors.error.text : colors.heading;
  const content = (
    <>
      {leading !== undefined ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.rowText}>
        <Text variant="rowTitle" color={titleColor} size={titleSize} lineHeight={Math.round(titleSize * 1.25)} numberOfLines={2}>
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text variant="body" color="muted" size={16.5} lineHeight={21} numberOfLines={3}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value !== undefined ? (
        <Text variant="body" color="muted" size={17} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {effectiveTrailing === "chevron" ? (
        <Icon name="chevronRight" size={26} color={destructive ? colors.error.solid : colors.primary} />
      ) : effectiveTrailing === "none" ? null : (
        <View style={styles.trailingNode}>{effectiveTrailing}</View>
      )}
    </>
  );
  const base = (pressed: boolean): ViewStyle => ({
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.lg,
    backgroundColor: surface === undefined ? "transparent" : pressed ? surface.pressed : surface.background,
    borderWidth: surface === undefined ? 0 : 1,
    borderColor: surface?.border,
    opacity: disabled ? 0.5 : 1,
  });
  if (onPress === undefined) {
    return (
      <View testID={testID} accessible={accessibilityLabel !== undefined} accessibilityLabel={accessibilityLabel} style={[base(false), style]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join(". ")}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [base(pressed), style]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  divider: { height: 1, backgroundColor: colors.border.divider },
  labelled: { flexDirection: "row", alignItems: "center" },
  line: { flex: 1, height: 1, backgroundColor: colors.gray.line },
  labelText: { marginHorizontal: 14 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40 },
  sectionText: { flex: 1, paddingRight: 12 },
  action: { flexDirection: "row", alignItems: "center", minHeight: 36 },
  actionPill: { backgroundColor: colors.bg.tintStrong, borderRadius: radii.md, paddingHorizontal: 14, minHeight: 40 },
  actionLabel: { marginLeft: 6 },
  kv: { flexDirection: "row", alignItems: "center", minHeight: 34, paddingVertical: 4 },
  kvEmphasis: { backgroundColor: colors.bg.tintStrong, borderRadius: radii.md, paddingHorizontal: 14, minHeight: 48, marginTop: 2 },
  kvLabel: { flex: 1, paddingRight: 10 },
  kvTag: { marginLeft: 6 },
  kvHelp: { marginLeft: 10 },
  leading: { marginRight: 14 },
  rowText: { flex: 1 },
  value: { marginLeft: 10, marginRight: 4 },
  trailingNode: { marginLeft: 10 },
});
