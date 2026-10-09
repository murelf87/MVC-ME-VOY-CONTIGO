import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { strings } from "@/i18n";
import { colors } from "@/theme";
import { BottomSheet, Button, OfflineBanner, Text } from "@/ui";
import type { SignalKind } from "../model/signal";
import { liveStrings } from "../strings";

const copy = liveStrings.signal;

export interface SignalStripProps {
  kind: SignalKind;
  /** «hace 5 s», ya con el tiempo transcurrido sumado; `null` si nunca hubo posición. */
  age: string | null;
  /** Texto informativo cuando todavía no hay posición ni se espera (viaje sin iniciar): «Ana aún no ha salido». */
  idleText?: string;
  onInfo: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Estado de la señal del coche bajo el mapa. Con posición reciente: «Última actualización: hace 5 s» (lámina 21). Con
 * posición vieja o sin ella: «Sin señal · Última posición: hace 2 min» (aviso de la lámina 22). NUNCA llama «en directo» a
 * una posición vieja.
 */
export function SignalStrip({ kind, age, idleText, onInfo, testID, style }: SignalStripProps): React.JSX.Element {
  if (kind === "stale" && age !== null) {
    return <OfflineBanner testID={testID} title={copy.staleTitle} detail={copy.staleDetail(age)} onInfo={onInfo} style={style} />;
  }
  if (kind === "none" && idleText === undefined) {
    return <OfflineBanner testID={testID} title={copy.noneTitle} detail={copy.noneDetail} onInfo={onInfo} style={style} />;
  }
  const text = kind === "none" ? (idleText ?? copy.noneDetail) : kind === "approximate" ? copy.approximateAge(age ?? copy.age.now) : copy.liveAge(age ?? copy.age.now);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={strings.a11y.moreInfo}
      onPress={onInfo}
      style={({ pressed }) => [styles.strip, pressed ? { opacity: 0.85 } : null, style]}
    >
      <View style={styles.disc}>
        <Icon name="infoMark" size={15} color={colors.onPrimary} />
      </View>
      <Text variant="body" color="deep" size={16.5} lineHeight={20} numberOfLines={2} style={styles.text}>
        {text}
      </Text>
    </Pressable>
  );
}

export interface SignalInfoSheetProps {
  visible: boolean;
  kind: SignalKind;
  onClose: () => void;
  testID?: string;
}

/** Hoja que explica cómo funciona el seguimiento y cuándo se dice «Sin señal». */
export function SignalInfoSheet({ visible, kind, onClose, testID }: SignalInfoSheetProps): React.JSX.Element {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={copy.infoTitle}
      testID={testID}
      footer={<Button label={copy.infoClose} variant="primary" chevron={false} onPress={onClose} testID={testID !== undefined ? `${testID}.ok` : undefined} />}
    >
      <Text variant="body" color="deep" size={16.5} lineHeight={22}>
        {copy.infoLive}
      </Text>
      <Text variant="body" color="deep" size={16.5} lineHeight={22} style={styles.paragraph}>
        {copy.infoStale}
      </Text>
      {kind === "approximate" ? (
        <Text variant="body" color="deep" size={16.5} lineHeight={22} style={styles.paragraph}>
          {copy.infoApproximate}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  strip: { minHeight: 40, borderRadius: 12, backgroundColor: colors.bg.tint, flexDirection: "row", alignItems: "center", paddingVertical: 7, paddingLeft: 17.5, paddingRight: 12 },
  disc: { width: 25, height: 25, borderRadius: 12.5, backgroundColor: colors.info.tile, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, marginLeft: 11.5 },
  paragraph: { marginTop: 12 },
});
