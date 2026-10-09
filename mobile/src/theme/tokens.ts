import { colors } from "./colors";
import { avatarSizes, layout, radii, shadows, sizes, spacing } from "./layout";
import { MAX_FONT_SIZE_MULTIPLIER, fontFamilies, typography } from "./typography";

/** Objeto de tema completo (solo claro). */
export const theme = {
  colors,
  typography,
  fontFamilies,
  spacing,
  radii,
  layout,
  sizes,
  avatarSizes,
  shadows,
  maxFontSizeMultiplier: MAX_FONT_SIZE_MULTIPLIER,
} as const;

export type Theme = typeof theme;
