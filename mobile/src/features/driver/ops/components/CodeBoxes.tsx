import React from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "@/theme";
import { Text } from "@/ui";

/** Casillas del código de recogida (04: 59 pt de alto; 7 pt dentro del grupo y 14 pt entre grupos de 3). */
const BOX_HEIGHT = 59;
const GAP = 7;
const GROUP_GAP = 14;

export interface CodeBoxesProps {
  value: string;
  length?: number;
  /** Casillas por grupo (3 → «123 456»). */
  groupSize?: number;
  /** Resalta la casilla que se escribe ahora. Se apaga con la petición en curso. */
  active?: boolean;
  /** Frase completa para lectores de pantalla («Código de recogida: 1 2 3. Faltan 3 cifras.»). */
  accessibilityLabel: string;
  testID?: string;
}

/**
 * Casillas del código de recogida, SOLO de presentación: el conductor teclea con `NumericKeypad` (teclas grandes, sin el
 * teclado del sistema tapando la pantalla). Se anuncia como un único texto para que VoiceOver/TalkBack no lean seis
 * casillas sueltas.
 */
export function CodeBoxes({ value, length = 6, groupSize = 3, active = true, accessibilityLabel, testID }: CodeBoxesProps): React.JSX.Element {
  const next = Math.min(value.length, length - 1);
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={styles.row}
    >
      {Array.from({ length }, (_, i) => {
        const digit = value[i];
        const isNext = active && i === next && value.length < length;
        return (
          <View
            key={i}
            testID={testID !== undefined ? `${testID}.box${i}` : undefined}
            style={[
              styles.box,
              {
                marginLeft: i === 0 ? 0 : groupSize > 0 && i % groupSize === 0 ? GROUP_GAP : GAP,
                borderColor: isNext ? colors.primary : colors.border.tint,
                borderWidth: isNext ? 2 : 1.5,
              },
            ]}
          >
            {digit !== undefined ? (
              <Text variant="kpi" color="strong" size={29} lineHeight={34} letterSpacing={0} weight="bold">
                {digit}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "center" },
  box: {
    flex: 1,
    maxWidth: 50,
    height: BOX_HEIGHT,
    borderRadius: 10,
    backgroundColor: colors.bg.tintStrong,
    alignItems: "center",
    justifyContent: "center",
  },
});
