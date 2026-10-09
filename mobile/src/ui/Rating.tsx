import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { formatRating } from "@/i18n";
import { Text } from "./Text";

export interface RatingStarsProps {
  /** Valor actual, 0–5 (enteros). */
  value: number;
  /** Si falta, las estrellas son de solo lectura. */
  onChange?: (value: number) => void;
  /** Tamaño de cada estrella en pt (por defecto 40, como en 24). */
  size?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Cinco estrellas: azules de contorno si están vacías, ámbar rellenas si están elegidas (24 «Valora tu viaje»). */
export function RatingStars({ value, onChange, size = 40, testID, style }: RatingStarsProps): React.JSX.Element {
  const interactive = onChange !== undefined;
  return (
    <View
      testID={testID}
      accessibilityRole={interactive ? "adjustable" : "image"}
      accessibilityLabel="Valoración"
      accessibilityValue={{ min: 0, max: 5, now: value, text: `${value} de 5` }}
      accessibilityActions={interactive ? [{ name: "increment" }, { name: "decrement" }] : undefined}
      onAccessibilityAction={(event) => {
        if (onChange === undefined) return;
        if (event.nativeEvent.actionName === "increment") onChange(Math.min(5, value + 1));
        if (event.nativeEvent.actionName === "decrement") onChange(Math.max(0, value - 1));
      }}
      style={[styles.row, style]}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        const star = <Icon name={filled ? "star" : "starOutline"} size={size} color={filled ? colors.amber.star : colors.primary} />;
        return interactive ? (
          <Pressable
            key={n}
            testID={testID !== undefined ? `${testID}.${n}` : undefined}
            accessibilityRole="button"
            accessibilityLabel={n === 1 ? "1 estrella" : `${n} estrellas`}
            onPress={() => onChange(n)}
            hitSlop={4}
            style={styles.star}
          >
            {star}
          </Pressable>
        ) : (
          <View key={n} style={styles.star}>
            {star}
          </View>
        );
      })}
    </View>
  );
}

export interface RatingBadgeProps {
  /** Valoración media (null = todavía sin valoraciones). */
  average: number | null;
  count: number;
  /** Añade la palabra «valoraciones» tras el contador (12 «4,8 (32 valoraciones)»). */
  withLabel?: boolean;
  /** Tamaño de letra en pt (por defecto 17). */
  size?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** «★ 4,8 (32)». Sin valoraciones muestra «Nuevo» (nunca inventa una media). */
export function RatingBadge({ average, count, withLabel = false, size = 17, testID, style }: RatingBadgeProps): React.JSX.Element {
  if (average === null || count === 0) {
    return (
      <View testID={testID} style={[styles.badge, style]}>
        <Text variant="rowText" color="subtle" size={size}>
          Nuevo
        </Text>
      </View>
    );
  }
  const countText = withLabel ? `(${count} ${count === 1 ? "valoración" : "valoraciones"})` : `(${count})`;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`Valoración ${formatRating(average)} sobre 5, ${count} ${count === 1 ? "valoración" : "valoraciones"}`}
      style={[styles.badge, style]}
    >
      <Icon name="star" size={Math.round(size * 1.15)} color={colors.amber.star} />
      <Text variant="body" color="strong" size={size} lineHeight={Math.round(size * 1.3)} weight="medium" style={styles.value}>
        {formatRating(average)}
      </Text>
      <Text variant="body" color="muted" size={size} lineHeight={Math.round(size * 1.3)} style={styles.count}>
        {countText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "center" },
  star: { marginHorizontal: 5 },
  badge: { flexDirection: "row", alignItems: "center" },
  value: { marginLeft: 5 },
  count: { marginLeft: 6 },
});
