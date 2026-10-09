import React from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenHeader, type ScreenHeaderProps } from "@/ui";

/**
 * Las láminas 17 a 20 colocan el título 8 pt más arriba que el resto de la app (centro a ≈ 73 pt con la isla dinámica).
 * Se sube la cabecera lo que cabe sin invadir la barra de estado: nada en móviles con poco margen superior.
 */
const LIFT_MAX = 8;
/** Margen superior mínimo que se respeta intacto (por encima, se puede subir). */
const LIFT_FLOOR = 24;

export function useHeaderLift(): number {
  const insets = useSafeAreaInsets();
  return -Math.min(LIFT_MAX, Math.max(0, insets.top - LIFT_FLOOR));
}

/** `ScreenHeader` con la elevación de las láminas 17–20. Se pasa en `<Screen header={…}/>`. */
export function DriverHeader(props: ScreenHeaderProps): React.JSX.Element {
  const lift = useHeaderLift();
  return (
    <View style={{ marginTop: lift }}>
      <ScreenHeader {...props} />
    </View>
  );
}
