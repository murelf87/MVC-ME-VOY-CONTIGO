import React from "react";
import { Platform, Text as RNText, type StyleProp, type TextProps as RNTextProps, type TextStyle } from "react-native";
import {
  MAX_FONT_SIZE_MULTIPLIER,
  fontFamilyFor,
  scaleFontSize,
  textColor,
  typography,
  useFontScaleFactor,
  type FontWeightName,
  type TextColorKey,
  type TextVariant,
} from "@/theme";

export interface TextProps extends Omit<RNTextProps, "style"> {
  /** Variante tipográfica del tema (por defecto `body`). */
  variant?: TextVariant;
  /** Clave semántica de color (`heading`, `muted`, `error`…) o un color literal. Por defecto `body`. */
  color?: TextColorKey | (string & {});
  /** Cambia solo el peso respetando tamaño e interlineado de la variante. */
  weight?: FontWeightName;
  /** Cambia el tamaño; el interlineado se escala proporcionalmente salvo que se indique `lineHeight`. */
  size?: number;
  lineHeight?: number;
  /** pt */
  letterSpacing?: number;
  align?: TextStyle["textAlign"];
  underline?: boolean;
  style?: StyleProp<TextStyle>;
}

const androidNoPadding: TextStyle | null = Platform.OS === "android" ? { includeFontPadding: false } : null;

function resolveColor(color: TextProps["color"]): string {
  if (color === undefined) return textColor.body;
  return color in textColor ? textColor[color as TextColorKey] : color;
}

/**
 * Único componente de texto de la app. Aplica fuente por peso (sin `fontWeight`), tamaño e interlineado del tema y
 * limita el escalado del sistema a ×1,3 para no romper la maquetación.
 */
export function Text({
  variant = "body",
  color,
  weight,
  size,
  lineHeight,
  letterSpacing,
  align,
  underline,
  style,
  maxFontSizeMultiplier = MAX_FONT_SIZE_MULTIPLIER,
  children,
  ...rest
}: TextProps): React.JSX.Element {
  const v = typography[variant];
  /** «Tamaño de letra» de Ajustes (1 = Normal: idéntico a las láminas). */
  const factor = useFontScaleFactor();
  const fontSize = size ?? v.fontSize;
  const baseLineHeight = lineHeight ?? (size !== undefined ? Math.round((v.lineHeight * size) / v.fontSize) : v.lineHeight);
  const baseLetterSpacing = letterSpacing ?? (size !== undefined ? Math.round((v.letterSpacing * size) / v.fontSize * 100) / 100 : v.letterSpacing);
  const computed: TextStyle = {
    fontFamily: weight !== undefined ? fontFamilyFor(weight) : v.fontFamily,
    fontSize: scaleFontSize(fontSize, factor),
    lineHeight: scaleFontSize(baseLineHeight, factor),
    letterSpacing: factor === 1 ? baseLetterSpacing : Math.round(baseLetterSpacing * factor * 100) / 100,
    color: resolveColor(color),
  };
  if (align !== undefined) computed.textAlign = align;
  if (underline === true) computed.textDecorationLine = "underline";
  return (
    <RNText {...rest} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[computed, androidNoPadding, style]}>
      {children}
    </RNText>
  );
}
