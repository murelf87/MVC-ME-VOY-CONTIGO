import React from "react";
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "./Text";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** Texto o número junto a la etiqueta (p. ej. el contador «(5)» de 38). */
  badge?: string | number;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * `segmented`: contenedor tintado con la opción activa en azul pleno a ras del borde (10 «Semanal | Puntual»).
 * `outline`: contenedor blanco con borde y la opción activa a ras (34b «Soy pasajero | Soy conductor»).
 * `pills`: píldoras sueltas (25 «Todos · Mis reservas · Grupos», 27 «Todas · Viajes · Mensajes · Pagos»).
 * `buttons`: dos botones grandes con icono (09 «Busco coche | Ofrezco plazas»).
 */
export type SegmentedVariant = "segmented" | "outline" | "pills" | "buttons";

/** Tamaño de las píldoras: `md` (25: etiqueta de 18,5 pt) o `sm` (27: cuatro píldoras con icono en una fila, etiqueta de 13,5 pt). */
export type PillSize = "md" | "sm";

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: SegmentedVariant;
  /** Solo `pills`: tamaño de las píldoras (por defecto `md`). */
  pillSize?: PillSize;
  /** Permite desplazar horizontalmente si las opciones no caben (solo `pills`). */
  scrollable?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Selector de una opción entre varias. Accesible como lista de pestañas (`tablist`/`tab`). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  variant = "segmented",
  pillSize = "md",
  scrollable = false,
  accessibilityLabel,
  testID,
  style,
}: SegmentedProps<T>): React.JSX.Element {
  const items = options.map((option) => {
    const selected = option.value === value;
    return (
      <SegmentItem
        key={option.value}
        option={option}
        selected={selected}
        variant={variant}
        pillSize={pillSize}
        onPress={() => onChange(option.value)}
        testID={option.testID ?? (testID !== undefined ? `${testID}.${option.value}` : undefined)}
      />
    );
  });

  const containerStyle: StyleProp<ViewStyle> =
    variant === "segmented"
      ? styles.segmentedContainer
      : variant === "outline"
        ? styles.outlineContainer
        : variant === "buttons"
          ? styles.buttonsContainer
          : pillSize === "sm"
            ? styles.pillsContainerSm
            : styles.pillsContainer;

  if (variant === "pills" && scrollable) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}
        contentContainerStyle={[pillSize === "sm" ? styles.pillsContainerSm : styles.pillsContainer, style]}
        testID={testID}
      >
        {items}
      </ScrollView>
    );
  }
  return (
    <View testID={testID} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={[containerStyle, style]}>
      {items}
    </View>
  );
}

interface ItemProps<T extends string> {
  option: SegmentedOption<T>;
  selected: boolean;
  variant: SegmentedVariant;
  pillSize: PillSize;
  onPress: () => void;
  testID?: string;
}

function SegmentItem<T extends string>({ option, selected, variant, pillSize, onPress, testID }: ItemProps<T>): React.JSX.Element {
  const label = option.badge !== undefined ? `${option.label} (${option.badge})` : option.label;
  const solid = selected;
  // Tinta de las opciones sin seleccionar (medida en 10, 34b, 09 y 27): marino en `segmented`, azul de título en `outline` y `buttons`.
  let foreground: string = colors.primary;
  if (solid) foreground = colors.onPrimary;
  else if (variant === "segmented") foreground = colors.text.body;
  else if (variant === "outline" || variant === "buttons") foreground = colors.heading;

  const itemStyle = (pressed: boolean): StyleProp<ViewStyle> => {
    switch (variant) {
      case "segmented":
      case "outline":
        return [
          variant === "segmented" ? styles.segment : styles.segmentOutline,
          solid ? { backgroundColor: colors.primary } : pressed ? { backgroundColor: colors.bg.tintStrong } : null,
        ];
      case "pills":
        return [
          pillSize === "sm" ? styles.pillSm : styles.pill,
          { backgroundColor: solid ? colors.primary : pressed ? colors.bg.tintPressed : colors.bg.chip },
        ];
      case "buttons":
        return [
          styles.bigButton,
          solid
            ? { backgroundColor: colors.primary, borderColor: colors.primary }
            : { backgroundColor: pressed ? colors.bg.tint : colors.bg.white, borderColor: colors.border.default },
        ];
    }
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="tab"
      accessibilityLabel={option.accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => itemStyle(pressed)}
    >
      {option.icon !== undefined ? (
        <View style={pillSize === "sm" && variant === "pills" ? styles.iconSm : styles.icon}>
          <Icon name={option.icon} size={iconSizeFor(variant, pillSize)} color={foreground} />
        </View>
      ) : null}
      <Text
        variant={variant === "buttons" ? "rowTitle" : "bodyStrong"}
        color={foreground}
        size={labelSizeFor(variant, pillSize)}
        weight="medium"
        letterSpacing={variant === "buttons" ? -0.35 : pillSize === "sm" && variant === "pills" ? -0.25 : -0.2}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Tamaño del icono por variante (medido en 10: la silueta del calendario ocupa ≈ 21 pt). */
function iconSizeFor(variant: SegmentedVariant, pillSize: PillSize): number {
  if (variant === "buttons") return 26;
  if (variant === "pills") return pillSize === "sm" ? 20 : 22;
  return 28;
}

function labelSizeFor(variant: SegmentedVariant, pillSize: PillSize): number {
  if (variant === "buttons") return 17;
  if (variant === "pills") return pillSize === "sm" ? 13.5 : 18.5;
  return 19;
}

const styles = StyleSheet.create({
  /** La opción activa llena el contenedor hasta el borde (10 y 34b): sin relleno interior. */
  segmentedContainer: { flexDirection: "row", backgroundColor: colors.bg.chip, borderRadius: radii.lg, overflow: "hidden" },
  outlineContainer: {
    flexDirection: "row",
    backgroundColor: colors.bg.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
    overflow: "hidden",
  },
  /** Separación entre píldoras medida en 25 (≈ 10 pt) y 27 (≈ 6 pt). */
  pillsContainer: { flexDirection: "row", alignItems: "center", gap: 10 },
  pillsContainerSm: { flexDirection: "row", alignItems: "center", gap: 6 },
  buttonsContainer: { flexDirection: "row", gap: 9 },
  segment: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.lg,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  segmentOutline: {
    flex: 1,
    minHeight: 46,
    borderRadius: radii.lg - 1,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  pillSm: {
    minHeight: 38,
    borderRadius: 19,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  bigButton: {
    flex: 1,
    minHeight: 43,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  icon: { marginRight: 9 },
  iconSm: { marginRight: 6 },
});
