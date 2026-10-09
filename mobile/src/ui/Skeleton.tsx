import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, radii } from "@/theme";
import { strings } from "@/i18n";
import { Text } from "./Text";
import { useReducedMotion } from "./useReducedMotion";

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  /** Círculo de `height` pt de diámetro (avatar). */
  circle?: boolean;
  style?: StyleProp<ViewStyle>;
}

const useNativeDriver = Platform.OS !== "web";

/** Bloque gris que late suavemente mientras cargan los datos. Es decorativo: se oculta a los lectores de pantalla. */
export function Skeleton({ width = "100%", height = 16, radius = radii.sm, circle = false, style }: SkeletonProps): React.JSX.Element {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) {
      opacity.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver }),
        Animated.timing(opacity, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, opacity]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: circle ? height / 2 : radius, backgroundColor: colors.bg.skeleton, opacity }, style]}
    />
  );
}

export interface SkeletonTextProps {
  lines?: number;
  /** Alto de cada línea (pt). */
  lineHeight?: number;
  /** Ancho de la última línea (fracción del total). */
  lastLineWidth?: DimensionValue;
  style?: StyleProp<ViewStyle>;
}

/** Párrafo de líneas de carga. */
export function SkeletonText({ lines = 3, lineHeight = 14, lastLineWidth = "60%", style }: SkeletonTextProps): React.JSX.Element {
  return (
    <View style={style}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          height={lineHeight}
          width={index === lines - 1 && lines > 1 ? lastLineWidth : "100%"}
          style={index > 0 ? styles.lineGap : null}
        />
      ))}
    </View>
  );
}

export interface SkeletonListProps {
  /** Número de filas (por defecto 4). */
  count?: number;
  /** `row` = avatar + dos líneas (bandeja, viajes); `card` = tarjeta alta (resultados de búsqueda). */
  variant?: "row" | "card";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Lista de filas de carga con la etiqueta accesible «Cargando…» y estado ocupado. */
export function SkeletonList({ count = 4, variant = "row", testID, style }: SkeletonListProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={strings.common.loading}
      accessibilityState={{ busy: true }}
      style={style}
    >
      {Array.from({ length: count }, (_, index) =>
        variant === "row" ? (
          <View key={index} style={styles.row}>
            <Skeleton circle height={56} width={56} />
            <View style={styles.rowBody}>
              <Skeleton height={16} width="45%" />
              <Skeleton height={13} width="75%" style={styles.lineGap} />
              <Skeleton height={13} width="60%" style={styles.lineGap} />
            </View>
          </View>
        ) : (
          <View key={index} style={styles.card}>
            <View style={styles.cardHead}>
              <Skeleton circle height={48} width={48} />
              <View style={styles.rowBody}>
                <Skeleton height={16} width="50%" />
                <Skeleton height={13} width="70%" style={styles.lineGap} />
              </View>
            </View>
            <Skeleton height={13} width="90%" style={styles.cardLine} />
            <Skeleton height={13} width="65%" style={styles.lineGap} />
          </View>
        ),
      )}
    </View>
  );
}

export interface SpinnerProps {
  size?: "sm" | "lg";
  color?: string;
  accessibilityLabel?: string;
  testID?: string;
}

/** Indicador de actividad con los colores de la marca. */
export function Spinner({ size = "lg", color = colors.primary, accessibilityLabel = strings.common.loading, testID }: SpinnerProps): React.JSX.Element {
  return (
    <ActivityIndicator
      testID={testID}
      size={size === "lg" ? "large" : "small"}
      color={color}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

export interface LoadingBlockProps {
  /** Texto bajo el indicador (por defecto «Cargando…»). */
  label?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Bloque centrado con indicador y texto: carga de una pantalla entera. */
export function LoadingBlock({ label = strings.common.loading, testID, style }: LoadingBlockProps): React.JSX.Element {
  return (
    <View testID={testID} accessible accessibilityLabel={label} accessibilityState={{ busy: true }} style={[styles.loading, style]}>
      <Spinner />
      <Text variant="body" color="muted" align="center" style={styles.loadingText}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lineGap: { marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  rowBody: { flex: 1, marginLeft: 14 },
  card: {
    backgroundColor: colors.bg.tint,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.soft,
    padding: 16,
    marginBottom: 12,
  },
  cardHead: { flexDirection: "row", alignItems: "center" },
  cardLine: { marginTop: 14 },
  loading: { alignItems: "center", justifyContent: "center", paddingVertical: 40 },
  loadingText: { marginTop: 12 },
});
