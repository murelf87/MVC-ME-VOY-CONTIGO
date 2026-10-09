import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";
import type { RequirementRow as RequirementRowModel, RequirementTone } from "../logic/readiness";

export interface RequirementRowProps {
  row: RequirementRowModel;
  onPress: () => void;
  testID: string;
}

interface ToneStyle {
  /** Color del disco con el visto / aviso de la línea de estado. */
  disc: string;
  /** Color del texto de estado. */
  text: string;
  glyph: "checkBold" | "exclaim" | "clock";
}

const TONES: Record<RequirementTone, ToneStyle> = {
  success: { disc: colors.success.solid, text: colors.text.body, glyph: "checkBold" },
  neutral: { disc: colors.gray.icon, text: colors.text.muted, glyph: "clock" },
  warning: { disc: colors.warning.solid, text: colors.warning.textStrong, glyph: "exclaim" },
  danger: { disc: colors.error.solid, text: colors.error.text, glyph: "exclaim" },
};

/**
 * Fila de requisito de la lámina 17 («Permiso de conducir · ✓ Documento subido ›»): disco blanco con el icono, título,
 * línea de estado con un visto verde (o el aviso que corresponda) y chevron. Toda la fila lleva a la pantalla que lo
 * resuelve; si falta algo, a la derecha aparece el verbo de la acción («Subir», «Corregir»…).
 */
export function RequirementRow({ row, onPress, testID }: RequirementRowProps): React.JSX.Element {
  const tone = TONES[row.tone];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={row.actionLabel !== null ? `${row.accessibilityLabel}. ${row.actionLabel}` : row.accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.disc}>
        <Icon name={row.icon} size={36} color={colors.primary} />
      </View>
      <View style={styles.text}>
        <Text variant="rowTitle" color="deep" size={19.5} lineHeight={24} letterSpacing={-0.3} numberOfLines={2}>
          {row.title}
        </Text>
        <View style={styles.status}>
          <View style={[styles.statusDisc, { backgroundColor: tone.disc }]}>
            <Icon name={tone.glyph} size={tone.glyph === "checkBold" ? 16 : 15} color={colors.onPrimary} />
          </View>
          <Text variant="body" color={tone.text} size={17} lineHeight={21} letterSpacing={-0.3} numberOfLines={2} style={styles.statusText}>
            {row.detail}
          </Text>
        </View>
      </View>
      {row.actionLabel !== null ? (
        <Text variant="rowTextStrong" color="link" size={16} lineHeight={20} style={styles.action}>
          {row.actionLabel}
        </Text>
      ) : null}
      <Icon name="chevronRight" size={28} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 10,
    paddingRight: 12,
    paddingVertical: 8,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.tint,
  },
  rowPressed: { backgroundColor: colors.bg.tintPressed },
  disc: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.bg.white,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, marginLeft: 17, paddingRight: 6 },
  status: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  statusDisc: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statusText: { marginLeft: 9, flexShrink: 1 },
  action: { marginRight: 6 },
});
