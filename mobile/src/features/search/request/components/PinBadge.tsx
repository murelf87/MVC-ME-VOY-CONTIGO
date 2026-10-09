/**
 * Gota con la letra del punto de recogida (A azul, B verde) de las tarjetas de «Puntos de recogida propuestos» (13).
 * Es el mismo dibujo de gota que el marcador del mapa, sin el punto con halo de abajo.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors } from "@/theme";
import { Text } from "@/ui";

/** Contorno de la gota: cabeza de 28 pt y punta; ocupa x 4–32, y 3–40 de un lienzo de 36 × 43. */
const DROP_PATH = "M18 40C13.33 34.28 4 26.02 4 15.31C4 8.21 10.25 3 18 3C25.75 3 32 8.21 32 15.31C32 26.02 22.67 34.28 18 40Z";
/** Medido en la lámina 13a (el pin B de la lista es #057753…#0F7B4B). */
const GREEN = "#0A7A52";

export type PinTone = "blue" | "green";

export interface PinBadgeProps {
  letter: string;
  tone: PinTone;
  /** Ancho en pt; el alto sale de la proporción de la lámina (≈ 1,2 × ancho). */
  width?: number;
  testID?: string;
}

export function pinFill(tone: PinTone): string {
  return tone === "blue" ? colors.primary : GREEN;
}

export function PinBadge({ letter, tone, width = 40, testID }: PinBadgeProps): React.JSX.Element {
  const height = Math.round(width * 1.2);
  const headHeight = height * (28 / 37);
  return (
    <View testID={testID} style={{ width, height }} aria-hidden>
      <Svg width={width} height={height} viewBox="4 3 28 37" preserveAspectRatio="none">
        <Path d={DROP_PATH} fill={pinFill(tone)} />
      </Svg>
      <View style={[styles.letter, { height: headHeight }]}>
        <Text variant="heading" color={colors.onPrimary} size={Math.round(width * 0.55)} lineHeight={Math.round(width * 0.62)} align="center">
          {letter}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  letter: { position: "absolute", left: 0, right: 0, top: 0, alignItems: "center", justifyContent: "center" },
});
