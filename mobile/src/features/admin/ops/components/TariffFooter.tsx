/**
 * Pie fijo de la pestaña Tarifas (lámina 40): «Guardar borrador» con el icono de documento, el candado gris y la nota de
 * auditoría («Registro en auditoría privada de MVC.»). El botón queda con contorno mientras no hay cambios y pasa a
 * relleno cuando los hay; pulsarlo sin cambios avisa en lugar de callar.
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import { opsStrings } from "../strings";

export interface TariffFooterProps {
  /** Texto del servidor (`auditNote`), sin el punto final. */
  auditNote: string;
  saving: boolean;
  dirty: boolean;
  /** Sin permiso de escritura no hay botón: queda solo la nota. */
  canWrite: boolean;
  onSave: () => void;
  testID: string;
}

export function TariffFooter({ auditNote, saving, dirty, canWrite, onSave, testID }: TariffFooterProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const s = opsStrings.tariffs;
  const filled = dirty || saving;
  const note = auditNote.trim().replace(/\.$/, "");
  return (
    <View style={[styles.root, { paddingBottom: Math.max(insets.bottom - 9.5, 12) }]} testID={testID}>
      {canWrite ? (
        <Pressable
          testID={`${testID}.save`}
          accessibilityRole="button"
          accessibilityLabel={s.saveA11y}
          accessibilityState={{ busy: saving, disabled: saving }}
          disabled={saving}
          onPress={onSave}
          style={({ pressed }) => [styles.button, filled ? styles.buttonFilled : styles.buttonOutline, pressed ? styles.pressed : null]}
        >
          {saving ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <>
              <Icon name="documentOutline" size={26} color={filled ? colors.onPrimary : colors.primary} />
              <Text variant="buttonSm" weight="semibold" size={19.9} lineHeight={24} color={filled ? colors.onPrimary : colors.heading} numberOfLines={1} style={styles.label}>
                {s.save}
              </Text>
            </>
          )}
        </Pressable>
      ) : (
        <View style={styles.readOnly} testID={`${testID}.readOnly`}>
          <Text variant="rowText" size={14} lineHeight={18} color={colors.text.muted}>
            {opsStrings.noPermission.readOnlyTariffs}
          </Text>
        </View>
      )}
      <View style={styles.lock} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon name="lock" size={19} color={colors.text.strong} />
      </View>
      <Text variant="rowText" size={14} lineHeight={19} color={colors.text.muted} style={styles.note} testID={`${testID}.note`}>
        {`${note}.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: "row", alignItems: "center", paddingTop: 10, paddingLeft: 2, paddingRight: 6, backgroundColor: colors.bg.screen },
  button: {
    width: 191.5,
    height: 49,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 14,
  },
  buttonOutline: { backgroundColor: colors.bg.white, borderWidth: 1.5, borderColor: colors.primary },
  buttonFilled: { backgroundColor: colors.primary, borderWidth: 1.5, borderColor: colors.primary },
  pressed: { opacity: 0.85 },
  label: { marginTop: -1 },
  readOnly: { width: 191.5, minHeight: 49, justifyContent: "center" },
  lock: {
    marginLeft: 12.5,
    width: 35,
    height: 35,
    borderRadius: 17.5,
    backgroundColor: colors.bg.disabled,
    alignItems: "center",
    justifyContent: "center",
  },
  note: { flex: 1, marginLeft: 10 },
});
