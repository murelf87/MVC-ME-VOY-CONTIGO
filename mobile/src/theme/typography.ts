/**
 * Tipografía de MVC · Me voy contigo: convierte la escala de datos puros de `typeScale.ts` en estilos de React Native.
 *
 * Importante: se usa UNA familia por peso (`RobotoCondensed_500Medium`…) y nunca `fontWeight`, para que ni iOS ni
 * Android ni la web inventen negritas sintéticas.
 */
import { Platform } from "react-native";
import {
  MAX_FONT_SIZE_MULTIPLIER,
  fontFaceNames,
  typeScale,
  type FontFaceKey,
  type FontWeightName,
  type TextVariant,
} from "./typeScale";

export type { FontWeightName, TextVariant };
export { MAX_FONT_SIZE_MULTIPLIER };

/** Pila de reserva en web: solo se ve si la fuente falla (con `FontDisplay.BLOCK` la app espera a la fuente). */
const webFallback = ', Roboto, "Helvetica Neue", Arial, sans-serif';

function family(name: string): string {
  return Platform.OS === "web" ? `${name}${webFallback}` : name;
}

/** Nombres exactos con los que `useAppFonts` registra cada archivo de fuente. */
export const fontFamilies: Record<FontFaceKey, string> = {
  regular: family(fontFaceNames.regular),
  medium: family(fontFaceNames.medium),
  semibold: family(fontFaceNames.semibold),
  bold: family(fontFaceNames.bold),
  display: family(fontFaceNames.display),
};

export type FontFamilyKey = FontFaceKey;

/** Familia para un peso de la cara de lectura. */
export function fontFamilyFor(weight: FontWeightName): string {
  return fontFamilies[weight];
}

export interface TextVariantStyle {
  readonly fontFamily: string;
  /** pt */
  readonly fontSize: number;
  /** pt */
  readonly lineHeight: number;
  /** pt (≈ em × tamaño) */
  readonly letterSpacing: number;
}

function toStyle(face: FontFaceKey, size: number, lineHeight: number, letterSpacingEm: number): TextVariantStyle {
  return {
    fontFamily: fontFamilies[face],
    fontSize: size,
    lineHeight,
    letterSpacing: Math.round(letterSpacingEm * size * 100) / 100,
  };
}

/** Escala tipográfica en estilos de React Native (ver `typeScale.ts` para dónde se midió cada variante). */
export const typography = Object.fromEntries(
  (Object.keys(typeScale) as TextVariant[]).map((key) => {
    const spec = typeScale[key];
    return [key, toStyle(spec.face, spec.size, spec.lineHeight, spec.letterSpacingEm)] as const;
  }),
) as Record<TextVariant, TextVariantStyle>;
