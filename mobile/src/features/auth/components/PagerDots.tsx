import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "@/theme";

export interface PagerDotsProps {
  /** Número de puntos (4 en el alta: bienvenida, perfil, cuenta, verificación). */
  count: number;
  /** Índice del paso actual (0 = el primero). */
  active: number;
  /** Texto para lectores de pantalla («Paso 1 de 4»). */
  accessibilityLabel: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Medidas de la lámina 01 (centros a 25,25 pt unos de otros): punto activo de 12,5 pt, inactivos de 12 pt, separación 13 pt. */
const ACTIVE = 12.5;
const IDLE = 12;
const GAP = 13;

/** Indicador de paso de la bienvenida: un punto azul y los demás en azul claro. Solo informa (no se pulsa). */
export function PagerDots({ count, active, accessibilityLabel, testID, style }: PagerDotsProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 1, max: count, now: active + 1 }}
      style={[styles.row, style]}
    >
      {Array.from({ length: count }, (_, index) => {
        const isActive = index === active;
        const size = isActive ? ACTIVE : IDLE;
        return (
          <View
            key={index}
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              marginLeft: index === 0 ? 0 : GAP,
              backgroundColor: isActive ? colors.primary : colors.bg.tintStrong,
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: ACTIVE },
});
