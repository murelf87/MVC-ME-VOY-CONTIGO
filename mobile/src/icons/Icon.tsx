import React from "react";
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
// Importación por familia (no desde el barril): así solo se empaquetan las tres tipografías de iconos que se usan.
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { colors } from "@/theme";
import { glyphs, type IconName } from "./glyphs";

export interface IconProps {
  name: IconName;
  /** pt. Por defecto 24. */
  size?: number;
  /** Color; por defecto el azul de acción. */
  color?: string;
  /** Si se indica, el icono es un elemento accesible (rol imagen) con esa etiqueta; si no, se oculta a lectores de pantalla. */
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<TextStyle>;
}

/** Icono vectorial de la app. Los iconos decorativos (junto a un texto) no deben llevar etiqueta. */
export function Icon({
  name,
  size = 24,
  color = colors.primary,
  accessibilityLabel,
  testID,
  style,
}: IconProps): React.JSX.Element {
  const ref = glyphs[name];
  let glyph: React.JSX.Element;
  switch (ref.set) {
    case "ion":
      glyph = <Ionicons name={ref.glyph} size={size} color={color} style={style} />;
      break;
    case "mci":
      glyph = <MaterialCommunityIcons name={ref.glyph} size={size} color={color} style={style} />;
      break;
    case "mi":
      glyph = <MaterialIcons name={ref.glyph} size={size} color={color} style={style} />;
      break;
  }
  const accessible = accessibilityLabel !== undefined;
  const wrapperStyle: StyleProp<ViewStyle> = styles.box;
  return (
    <View
      testID={testID}
      style={[wrapperStyle, { width: size, height: size }]}
      accessible={accessible}
      accessibilityRole={accessible ? "image" : undefined}
      accessibilityLabel={accessibilityLabel}
      aria-hidden={!accessible}
    >
      {glyph}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
});

