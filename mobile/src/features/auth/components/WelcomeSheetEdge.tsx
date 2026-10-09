import React from "react";
import Svg, { Path } from "react-native-svg";
import { colors } from "@/theme";

/** Alto del borde curvo (pt). */
export const SHEET_EDGE_HEIGHT = 20;

/**
 * Borde superior de la hoja blanca de la bienvenida (lámina 01): baja suavemente desde los lados (≈ 5 pt más alta) y
 * queda plana en el tramo central, con las esquinas redondeadas. Perfil medido sobre la lámina a 393 pt de ancho.
 * Se dibuja sobre la ilustración y deja el resto de la hoja en blanco.
 */
export function WelcomeSheetEdge({ width }: { width: number }): React.JSX.Element {
  return (
    <Svg
      width={width}
      height={SHEET_EDGE_HEIGHT}
      viewBox="0 0 393 20"
      preserveAspectRatio="none"
      aria-hidden
    >
      <Path
        d="M0 20 V12 C0 9.4 1.9 7.8 4.4 8.1 C45 9.2 70 13.35 115 13.35 H270 C320 13.35 345 9.2 388.6 8.1 C391.1 7.8 393 9.4 393 12 V20 Z"
        fill={colors.bg.screen}
      />
    </Svg>
  );
}
