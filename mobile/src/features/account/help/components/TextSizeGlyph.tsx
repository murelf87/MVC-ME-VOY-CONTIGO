import React from "react";
import { StyleSheet, Text as RNText, View } from "react-native";
import { colors, fontFamilyFor } from "@/theme";

/** Medidas del icono «ᴀA» de la lámina 35b (30,5 × 21,5 pt): una «A» pequeña con barra superior y una «A» grande. */
const WIDTH = 31;
const HEIGHT = 22;

export interface TextSizeGlyphProps {
  color?: string;
}

/**
 * Icono de «Tamaño de letra». La librería de iconos no tiene este dibujo, así que se compone con la tipografía de la
 * app. Es decorativo (la fila ya dice «Tamaño de letra») y NO escala con el tamaño de letra elegido: es un icono.
 */
export function TextSizeGlyph({ color = colors.text.link }: TextSizeGlyphProps): React.JSX.Element {
  const family = fontFamilyFor("bold");
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.box}>
      <View style={[styles.bar, { backgroundColor: color }]} />
      <RNText allowFontScaling={false} style={[styles.small, { color, fontFamily: family }]}>
        A
      </RNText>
      <RNText allowFontScaling={false} style={[styles.big, { color, fontFamily: family }]}>
        A
      </RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: WIDTH, height: HEIGHT },
  bar: { position: "absolute", left: 1, top: 10.2, width: 9.5, height: 2.2, borderRadius: 1 },
  small: { position: "absolute", left: 0, top: 8.6, width: 11.5, fontSize: 14.5, lineHeight: 15, textAlign: "center" },
  big: { position: "absolute", right: 0, top: -3.6, width: 18.5, fontSize: 30, lineHeight: 30, textAlign: "center" },
});
