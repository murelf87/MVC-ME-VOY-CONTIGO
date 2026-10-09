import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";
import type { OccupancyView } from "../logic/requests";
import { publishStrings } from "../strings";

export interface OccupancyStripProps {
  occupancy: OccupancyView;
  testID?: string;
}

const DOT = 25;
const IN_RANGE_LINK = "#0D6A6C";
const OUT_DOT = "#A7B4C8";
const OUT_LINK = "#A0ADC1";

/**
 * «Plazas ocupadas en tu ruta» (lámina 20): un punto por parada (verde en el tramo que pide el pasajero, gris fuera de él),
 * unidos por tramos, y debajo «Mairena → Sevilla» y «1 / 3 plazas». Las plazas son las ocupadas SIN contar esta solicitud.
 */
export function OccupancyStrip({ occupancy, testID }: OccupancyStripProps): React.JSX.Element {
  const copy = publishStrings.requests;
  return (
    <View testID={testID} accessible accessibilityLabel={occupancy.accessibilityLabel} style={styles.block}>
      <View style={styles.header}>
        <Icon name="person" size={24} color={colors.primary} />
        <Text variant="rowTitle" color="heading" size={20} lineHeight={24} letterSpacing={-0.3} style={styles.title}>
          {copy.occupancyTitle}
        </Text>
      </View>

      {occupancy.dots.length > 0 ? (
        <View style={styles.strip} aria-hidden>
          {occupancy.dots.map((active, index) => (
            <React.Fragment key={`dot-${index}`}>
              {index > 0 ? <View style={[styles.link, { backgroundColor: occupancy.links[index - 1] === true ? IN_RANGE_LINK : OUT_LINK }]} /> : null}
              <View style={[styles.dot, { backgroundColor: active ? colors.success.solid : OUT_DOT }]} />
            </React.Fragment>
          ))}
        </View>
      ) : (
        <View style={styles.stripSpacer} />
      )}

      <View style={styles.footer}>
        <Text variant="body" color="deep" size={19.5} lineHeight={24} letterSpacing={-0.3} numberOfLines={1} style={styles.range}>
          {occupancy.rangeText}
        </Text>
        {occupancy.seatsText !== "" ? (
          <Text variant="rowTitle" color="heading" size={20} lineHeight={24} letterSpacing={-0.3}>
            {occupancy.seatsText}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    paddingTop: 11.5,
    paddingBottom: 10.5,
    paddingHorizontal: 12.5,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.tint,
  },
  header: { flexDirection: "row", alignItems: "center" },
  title: { marginLeft: 8, flex: 1 },
  strip: { flexDirection: "row", alignItems: "center", marginTop: 14, marginBottom: 11, paddingHorizontal: 27.5 },
  stripSpacer: { height: 25, marginTop: 14, marginBottom: 11 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  link: { flex: 1, height: 4, borderRadius: 2 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 9 },
  range: { flexShrink: 1, marginRight: 12 },
});
