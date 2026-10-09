import React from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "@/theme";
import { Text } from "@/ui";
import type { StopView } from "../logic/tripDetail";
import { browseStrings } from "../strings";

const copy = browseStrings.tripDetail;

/** Línea de paradas con horarios (12): punto lleno = origen/destino, anillo = parada opcional. */
export function StopTimeline({ stops, testID = "StopTimeline" }: { stops: readonly StopView[]; testID?: string }): React.JSX.Element {
  return (
    <View testID={testID} style={styles.wrap}>
      {stops.map((stop, index) => (
        <View key={stop.seq} style={styles.row} accessible accessibilityLabel={`${copy.stopA11y(stop.label, stop.time)}${stop.note !== null ? `. ${stop.note}` : ""}`}>
          <View style={styles.rail}>
            <View style={[styles.line, index === 0 ? styles.lineHidden : null]} />
            <View style={[styles.dot, stop.optional ? styles.dotRing : stop.kind === "last" ? styles.dotEnd : styles.dotFull]} />
            <View style={[styles.line, index === stops.length - 1 ? styles.lineHidden : null]} />
          </View>
          <View style={styles.label}>
            <Text variant="rowTitle" color="heading" size={17} lineHeight={22} numberOfLines={1}>
              {stop.label}
              {stop.optional ? <Text variant="rowText" color="muted" size={14}>{` ${copy.optional}`}</Text> : null}
            </Text>
          </View>
          <Text variant="rowTitle" color="heading" size={17} style={styles.time}>{stop.time}</Text>
          <Text variant="rowText" color={stop.highlight ? "link" : "muted"} size={14} lineHeight={18} style={styles.note} numberOfLines={2}>{stop.note ?? ""}</Text>
        </View>
      ))}
    </View>
  );
}

const DOT = 14;
const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 4 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 40, gap: 8 },
  rail: { width: DOT, alignSelf: "stretch", alignItems: "center" },
  line: { flex: 1, width: 2, backgroundColor: colors.primary },
  lineHidden: { backgroundColor: "transparent" },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  dotFull: { backgroundColor: colors.primary },
  dotEnd: { backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.bg.white, boxShadow: `0 0 0 2px ${colors.primary}` },
  dotRing: { backgroundColor: colors.bg.white, borderWidth: 2.5, borderColor: colors.primary },
  label: { flex: 1.5 },
  time: { width: 50, textAlign: "right" },
  note: { flex: 1.2, textAlign: "right" },
});
