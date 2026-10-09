import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { colors, radii } from "@/theme";
import { copyToClipboard } from "@/platform";
import { BottomSheet, Button, Text, showToast } from "@/ui";
import { helpStrings } from "../strings";

export interface MobileSheetProps {
  visible: boolean;
  /** Número con formato («+34 600 123 456») o `null` si la cuenta no lo tiene. */
  phone: string | null;
  onClose: () => void;
  /** Abre el Centro de ayuda en «Mi perfil y cuenta» (el cambio de número lo gestiona el equipo). */
  onRequestChange: () => void;
}

/**
 * «Mi móvil»: el número con el que se entra en MVC. El cambio de número NO tiene endpoint en el contrato de la app
 * (lo gestiona `auth`/soporte), así que la hoja lo dice con honestidad y lleva a pedirlo al equipo desde el Centro de ayuda.
 */
export function MobileSheet({ visible, phone, onClose, onRequestChange }: MobileSheetProps): React.JSX.Element {
  const copy = useCallback(async () => {
    if (phone === null) return;
    const ok = await copyToClipboard(phone.replace(/\s+/g, ""));
    showToast({ message: ok ? helpStrings.mobileSheet.copied : helpStrings.common.loadErrorTitle, kind: ok ? "success" : "error" });
  }, [phone]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={helpStrings.mobileSheet.title} testID="MobileSheet">
      <Text variant="body" color="muted" size={16.5} lineHeight={21}>
        {helpStrings.mobileSheet.intro}
      </Text>
      <View style={styles.numberBox} accessible accessibilityLabel={`${helpStrings.settings.phoneTitle}: ${phone ?? helpStrings.settings.phoneUnknown}`}>
        <Text variant="titleSm" color="heading" size={26} lineHeight={30} testID="MobileSheet.number">
          {phone ?? helpStrings.settings.phoneUnknown}
        </Text>
      </View>
      {phone !== null ? (
        <Button label={helpStrings.mobileSheet.copy} variant="outline" chevron={false} leadingIcon="copy" onPress={() => void copy()} testID="MobileSheet.copy" />
      ) : null}
      <View style={styles.changeCard}>
        <Text variant="heading" color="heading" size={18} lineHeight={22}>
          {helpStrings.mobileSheet.changeTitle}
        </Text>
        <Text variant="body" color="muted" size={16} lineHeight={21} style={styles.changeText}>
          {helpStrings.mobileSheet.changeMessage}
        </Text>
        <Button
          label={helpStrings.mobileSheet.changeAction}
          variant="tint"
          size="sm"
          chevron={false}
          onPress={onRequestChange}
          testID="MobileSheet.requestChange"
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  numberBox: {
    marginVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 64,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.tint,
    borderWidth: 1,
    borderColor: colors.border.soft,
  },
  changeCard: {
    marginTop: 16,
    marginBottom: 8,
    padding: 16,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.white,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  changeText: { marginTop: 4, marginBottom: 14 },
});
