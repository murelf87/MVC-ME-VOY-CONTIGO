/**
 * Franja informativa bajo las tarjetas de la pestaña Tarifas (lámina 40): candado en un disco azul claro y la nota que
 * manda el servidor («Los cambios de tarifas afectan solo a futuras reservas. No se modifican reservas confirmadas.»).
 * La lámina corta la frase tras «solo»: se respeta ese salto cuando el texto del servidor contiene el punto de corte.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import { opsStrings } from "../strings";

export interface NoticeBannerProps {
  text: string;
  testID: string;
}

/** Inserta el salto de línea de la lámina antes de «a futuras reservas» (si el texto lo lleva). */
export function breakApplyNote(text: string): string {
  const marker = opsStrings.tariffs.applyNoteBreakBefore;
  const at = text.indexOf(` ${marker}`);
  return at <= 0 ? text : `${text.slice(0, at)}\n${text.slice(at + 1)}`;
}

export function NoticeBanner({ text, testID }: NoticeBannerProps): React.JSX.Element {
  return (
    <View style={styles.banner} testID={testID} accessible accessibilityRole="text" accessibilityLabel={text}>
      <View style={styles.disc} aria-hidden>
        <Icon name="lock" size={19} color={colors.text.link} />
      </View>
      <Text variant="rowText" size={14.6} lineHeight={18} color={colors.text.link} style={styles.text}>
        {breakApplyNote(text)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginTop: 7,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: colors.info.bg,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingLeft: 11.25,
    paddingRight: 10,
  },
  disc: {
    width: 34.5,
    height: 34.5,
    borderRadius: 17.25,
    backgroundColor: colors.surface.blueStrongEdge,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, marginLeft: 9.25 },
});
