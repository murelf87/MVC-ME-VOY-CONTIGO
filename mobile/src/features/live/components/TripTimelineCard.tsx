import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { LiveTimelineStop } from "@/api/types";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import { connectorIsActive, timelineRows, type TimelineRow } from "../model/timeline";
import { liveStrings } from "../strings";

const DOT = 23.5;
const ROW = 35.5;
const ROW_CAPTION = 52;

export interface TripTimelineCardProps {
  stops: readonly LiveTimelineStop[];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

function Dot({ state }: { state: TimelineRow["state"] }): React.JSX.Element {
  if (state === "done") return <View style={[styles.dot, { backgroundColor: colors.primary }]} />;
  if (state === "current") return <View style={[styles.dot, { borderWidth: 6, borderColor: colors.primary, backgroundColor: colors.bg.white }]} />;
  return <View style={[styles.dot, { borderWidth: 3, borderColor: colors.gray.ring, backgroundColor: colors.bg.white }]} />;
}

/** «Tu trayecto»: de tu recogida a tu destino con la hora estimada de cada parada y «En curso» donde estás (lámina 23). */
export function TripTimelineCard({ stops, testID, style }: TripTimelineCardProps): React.JSX.Element {
  const rows = timelineRows(stops);
  return (
    <View testID={testID} style={[styles.card, style]}>
      <View style={styles.header} accessible accessibilityRole="header" accessibilityLabel={liveStrings.inCar.tripTitle}>
        <Icon name="route" size={25} color={colors.primary} />
        <Text variant="heading" weight="bold" color="heading" size={18.8} lineHeight={24} style={styles.title}>
          {liveStrings.inCar.tripTitle}
        </Text>
      </View>
      {rows.map((row, index) => {
        const last = index === rows.length - 1;
        const height = row.caption !== null ? ROW_CAPTION : ROW;
        return (
          <View
            key={row.key}
            style={[styles.row, { height }]}
            accessible
            accessibilityLabel={[row.title, row.time, row.caption].filter((part): part is string => part !== null && part !== "").join(", ")}
            testID={testID !== undefined ? `${testID}.stop.${index}` : undefined}
          >
            <View style={styles.rail}>
              {!last ? <View style={[styles.connector, { backgroundColor: connectorIsActive(row.state) ? colors.primary : colors.gray.line, height: height }]} /> : null}
              <View style={styles.dotWrap}>
                <Dot state={row.state} />
              </View>
            </View>
            <View style={styles.texts}>
              <Text variant="body" color="deep" size={16.7} lineHeight={22} numberOfLines={1}>
                {row.title}
              </Text>
              {row.caption !== null ? (
                <Text variant="rowText" color="subtle" size={14.9} lineHeight={18} style={styles.caption}>
                  {row.caption}
                </Text>
              ) : null}
            </View>
            <Text variant="body" color="deep" size={17} lineHeight={22} style={styles.time}>
              {row.time}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, backgroundColor: colors.bg.tintSoft, paddingTop: 10, paddingBottom: 7, borderWidth: 1, borderColor: colors.border.soft },
  header: { height: 25, flexDirection: "row", alignItems: "center", paddingLeft: 10.5, marginBottom: 0 },
  title: { marginLeft: 9 },
  row: { flexDirection: "row", paddingLeft: 9 },
  rail: { width: 25, marginRight: 8 },
  dotWrap: { position: "absolute", top: 17.75 - DOT / 2, left: 0, width: DOT, height: DOT },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  connector: { position: "absolute", left: DOT / 2 - 1.5, top: 17.75, width: 3, zIndex: 0 },
  texts: { flex: 1, paddingTop: 6.75 },
  caption: { marginTop: 1.5 },
  time: { paddingTop: 6.75, paddingRight: 6, marginLeft: 8 },
});
