import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text, surfaces } from "@/ui";
import { lineTop } from "./metrics";

export interface NextPayoutCardProps {
  title: string;
  /** «Por definir» mientras no haya calendario; la fecha prevista o «En proceso» cuando lo diga el servidor. */
  value: string;
  /** Importe del abono si lo hay (`12,00 €`); no se muestra con el calendario sin definir. */
  amountText?: string | null;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
}

const SIZE = 21;
const LINE = 24;

/**
 * Tarjeta «Próximo abono · Por definir» de la lámina 34b (76 pt de alto, calendario de 50 pt, texto desde x 122,5, título
 * con la línea base a 338 y valor a 365,5). La «i» abre la explicación: la fecha prevista no es un abono confirmado.
 */
export function NextPayoutCard({ title, value, amountText, onPress, accessibilityLabel, testID }: NextPayoutCardProps): React.JSX.Element {
  const titleTop = lineTop(30, SIZE, LINE);
  const valueTop = lineTop(57.5, SIZE, LINE);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: pressed ? surfaces.blue.pressed : surfaces.blue.background, borderColor: surfaces.blue.border }]}
    >
      <View style={styles.icon} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Icon name="calendarGrid" size={50} color={colors.heading} />
      </View>
      <View style={{ paddingLeft: 107.5, paddingTop: titleTop - 1, paddingRight: 52, paddingBottom: 12 }}>
        <Text variant="heading" weight="bold" color="deep" size={SIZE} lineHeight={LINE} letterSpacing={-0.2} numberOfLines={1}>
          {title}
        </Text>
        <Text
          variant="heading"
          weight="bold"
          color="link"
          size={SIZE}
          lineHeight={LINE}
          letterSpacing={-0.2}
          numberOfLines={1}
          style={{ marginTop: valueTop - (titleTop + LINE) }}
        >
          {amountText !== undefined && amountText !== null ? `${value} · ${amountText}` : value}
        </Text>
      </View>
      <View style={styles.info} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Icon name="infoOutline" size={30} color={colors.text.deep} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 76, borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  icon: { position: "absolute", left: 23.75, top: 11.25, width: 50, height: 50, alignItems: "center", justifyContent: "center" },
  info: { position: "absolute", right: 11.25, top: 22, width: 30, height: 30, alignItems: "center", justifyContent: "center" },
});
