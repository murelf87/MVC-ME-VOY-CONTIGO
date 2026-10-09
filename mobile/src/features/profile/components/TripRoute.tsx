/**
 * Trayecto de una tarjeta de «Mis viajes» (lámina 30): dos paradas con su hora a la derecha y a la izquierda el trazo
 * azul (anillo de salida, conector y anillo de llegada). La tarjeta semanal separa las filas 36 pt y la de viaje 31 pt
 * (así las dibuja la lámina); el texto se mide en cada una.
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "@/theme";
import { Text } from "@/ui";
import type { CardEndpoint } from "../model/tripCards";

export type TripRouteVariant = "weekly" | "trip";

interface Spec {
  pitch: number;
  label: number;
  time: number;
}

const SPECS: Record<TripRouteVariant, Spec> = {
  weekly: { pitch: 36, label: 18.8, time: 19.9 },
  trip: { pitch: 31, label: 18.2, time: 18.3 },
};

const RING = 20;

export interface TripRouteProps {
  from: CardEndpoint;
  to: CardEndpoint;
  variant: TripRouteVariant;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function TripRoute({ from, to, variant, testID, style }: TripRouteProps): React.JSX.Element {
  const spec = SPECS[variant];
  return (
    <View testID={testID} style={[styles.root, { height: spec.pitch * 2 }, style]}>
      <View style={[styles.connector, { top: spec.pitch / 2 + RING / 2 - 1, height: spec.pitch - RING + 2 }]} />
      <View style={[styles.ringOut, { top: spec.pitch / 2 - RING / 2 }]} />
      <View style={[styles.ringIn, { top: spec.pitch * 1.5 - RING / 2 - 0.25 }]} />
      <Stop endpoint={from} spec={spec} />
      <Stop endpoint={to} spec={spec} />
    </View>
  );
}

function Stop({ endpoint, spec }: { endpoint: CardEndpoint; spec: Spec }): React.JSX.Element {
  return (
    <View style={[styles.stop, { height: spec.pitch }]}>
      <Text variant="body" color="body" size={spec.label} lineHeight={Math.round(spec.label * 1.25)} numberOfLines={1} style={styles.label}>
        {endpoint.label}
      </Text>
      <Text variant="body" color="body" size={spec.time} lineHeight={Math.round(spec.time * 1.25)} style={styles.time}>
        {endpoint.time}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingLeft: 62.5, paddingRight: 16 },
  stop: { flexDirection: "row", alignItems: "center" },
  label: { flex: 1, minWidth: 0 },
  time: { marginLeft: 12 },
  connector: { position: "absolute", left: 30, width: 3, backgroundColor: colors.primary },
  /** Anillo de salida: contorno de 3,5 pt y centro blanco. */
  ringOut: {
    position: "absolute",
    left: 21.5,
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3.5,
    borderColor: colors.primary,
    backgroundColor: colors.bg.white,
  },
  /** Anillo de llegada: azul macizo con un hueco blanco pequeño. */
  ringIn: {
    position: "absolute",
    left: 21.5,
    width: RING + 0.5,
    height: RING + 0.5,
    borderRadius: (RING + 0.5) / 2,
    borderWidth: 5.75,
    borderColor: colors.primary,
    backgroundColor: colors.bg.white,
  },
});
