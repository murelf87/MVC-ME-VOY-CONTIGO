import React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenHeader, type ScreenHeaderProps } from "@/ui";

/**
 * Lo que las láminas 09–12 suben la cabecera respecto a la de las demás pantallas: el título queda justo bajo la isla
 * dinámica (centro a ≈ 67 pt del borde en un iPhone con isla, no a ≈ 81 pt).
 */
const HEADER_LIFT = 13.5;
/** Solo los móviles con isla o muesca grande (margen seguro ≥ 47 pt) tienen sitio para subirla sin rozar la barra de estado. */
const MIN_INSET_FOR_LIFT = 47;

/**
 * Cabecera de las pantallas de exploración (mapa, recorrido, resultados y detalle). Úsala con `<Screen topInset={false} …>`:
 * aplica ella misma el margen seguro superior, menos lo que la lámina sube el título.
 */
export function BrowseHeader(props: ScreenHeaderProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const lift = insets.top >= MIN_INSET_FOR_LIFT ? HEADER_LIFT : 0;
  return (
    <View style={[styles.wrap, { paddingTop: insets.top - lift }]}>
      <ScreenHeader {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "stretch" },
});
