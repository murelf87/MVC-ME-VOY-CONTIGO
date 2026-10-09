import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";

export interface InfoStripProps {
  icon: IconName;
  /** Texto de la franja. Una lista = un párrafo por elemento (cada uno se parte en líneas por su cuenta). */
  text: string | readonly string[];
  /** Diámetro del disco del icono (pt). */
  disc?: number;
  iconSize?: number;
  textSize?: number;
  lineHeight?: number;
  /** Altura mínima de la franja. */
  minHeight?: number;
  /** `start` = el disco queda arriba, junto a las primeras líneas. */
  discAlign?: "center" | "start";
  accessibilityRole?: "text" | "alert";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Franja informativa de la lámina 20 («Gestiona solicitudes estando detenido.», «La aceptación debe ser mutua…»): fondo
 * azul claro, disco azul con el icono a la izquierda y texto en el azul de títulos.
 */
export function InfoStrip({
  icon,
  text,
  disc = 47.5,
  iconSize = 30,
  textSize = 18.5,
  lineHeight = 23,
  minHeight = 55,
  discAlign = "center",
  accessibilityRole = "text",
  testID,
  style,
}: InfoStripProps): React.JSX.Element {
  const paragraphs = typeof text === "string" ? [text] : text;
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole={accessibilityRole}
      accessibilityLabel={paragraphs.join(" ")}
      style={[styles.strip, { minHeight }, style]}
    >
      <View
        style={[
          styles.disc,
          { width: disc, height: disc, borderRadius: disc / 2 },
          discAlign === "start" ? styles.discStart : null,
        ]}
      >
        <Icon name={icon} size={iconSize} color={colors.primary} />
      </View>
      <View style={styles.text}>
        {paragraphs.map((paragraph, index) => (
          <Text key={`p-${index}`} variant="body" color="heading" size={textSize} lineHeight={lineHeight} letterSpacing={-0.3}>
            {paragraph}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    paddingLeft: 11,
    paddingRight: 12,
    borderRadius: radii.lg,
    backgroundColor: colors.info.bg,
  },
  disc: { backgroundColor: colors.bg.tintStrong, alignItems: "center", justifyContent: "center" },
  discStart: { alignSelf: "flex-start" },
  text: { flex: 1, marginLeft: 15 },
});
