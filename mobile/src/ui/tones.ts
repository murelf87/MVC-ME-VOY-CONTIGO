/**
 * Tonos de superficie compartidos por tarjetas, filas y avisos. Los fondos salen de los muestreos de las láminas
 * (ver theme/colors.ts); los contornos y fondos pulsados son derivados (`colors.surface.*`): las láminas apenas los dibujan.
 */
import { colors } from "@/theme";

export type SurfaceTone = "white" | "blue" | "blueStrong" | "green" | "amber" | "orange" | "red" | "gray";

export interface SurfaceColors {
  background: string;
  border: string;
  /** Fondo al pulsar. */
  pressed: string;
}

export const surfaces: Record<SurfaceTone, SurfaceColors> = {
  white: { background: colors.bg.white, border: colors.border.default, pressed: colors.bg.tintSoft },
  blue: { background: colors.bg.tint, border: colors.border.soft, pressed: colors.bg.tintPressed },
  blueStrong: { background: colors.bg.tintStrong, border: colors.surface.blueStrongEdge, pressed: colors.surface.blueStrongEdge },
  green: { background: colors.success.bg, border: colors.surface.greenEdge, pressed: colors.surface.greenPressed },
  amber: { background: colors.amber.bg, border: colors.surface.amberEdge, pressed: colors.surface.amberPressed },
  orange: { background: colors.warning.bg, border: colors.surface.orangeEdge, pressed: colors.surface.orangePressed },
  red: { background: colors.error.bg, border: colors.surface.redEdge, pressed: colors.surface.redPressed },
  gray: { background: colors.bg.gray, border: colors.surface.grayEdge, pressed: colors.surface.grayPressed },
};
