/** 16: «Tu plaza queda reservada provisionalmente durante 14:52». La cifra la lleva el servidor; aquí solo se pinta. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";
import { requestStrings } from "../strings";

const copy = requestStrings.status;

export interface HoldCountdownCardProps {
  text: string;
  seconds: number;
  testID?: string;
}

export function HoldCountdownCard({ text, seconds, testID }: HoldCountdownCardProps): React.JSX.Element {
  const low = seconds <= 120;
  return (
    <View testID={testID} style={styles.card} accessible accessibilityRole="timer" accessibilityLabel={copy.holdA11y(seconds)}>
      <View style={styles.clock}>
        <Icon name="clock" size={44} color={colors.primary} />
      </View>
      <View style={styles.body}>
        <Text variant="body" color="body" size={19} lineHeight={24}>
          {copy.holdTitle}
        </Text>
        <Text variant="display" color={low ? colors.error.text : "heading"} size={40} lineHeight={46} align="center" style={styles.time}>
          {text}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg.tint,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border.soft,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  clock: { width: 52, alignItems: "center" },
  body: { flex: 1, marginLeft: 14 },
  time: { marginTop: 2 },
});
