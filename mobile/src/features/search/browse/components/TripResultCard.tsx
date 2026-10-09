import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Avatar, Button, Text } from "@/ui";
import type { ResultCardView } from "../logic/tripResults";
import { browseStrings } from "../strings";

const copy = browseStrings.tripResults;

export interface TripResultCardProps {
  view: ResultCardView;
  onOpen: () => void;
  testID: string;
}

/** Tarjeta de un coche en «Coches disponibles»: conductor, plazas, dónde te recoge y a qué hora llegas. */
export function TripResultCard({ view, onOpen, testID }: TripResultCardProps): React.JSX.Element {
  return (
    <View style={styles.card} testID={testID}>
      <Pressable accessibilityRole="button" accessibilityLabel={view.a11y} onPress={onOpen} style={styles.body}>
        <Avatar source={view.photoUrl} name={view.driverName} size={62} />
        <View style={styles.text}>
          <View style={styles.head}>
            <View style={styles.headLeft}>
              <Text variant="rowTitle" color="heading" size={21} lineHeight={25} numberOfLines={1} style={styles.name}>{view.driverName}</Text>
              {view.rating !== null ? (
                <View style={styles.rating}>
                  <Icon name="star" size={16} color={colors.amber.star} />
                  <Text variant="caption" color="body" size={15}>{`${view.rating} (${view.ratingCount})`}</Text>
                </View>
              ) : null}
            </View>
            <Text variant="rowTitle" color="link" size={18} weight="bold">{view.seats}</Text>
          </View>
          <View style={styles.line}>
            <Icon name="car" size={20} color={colors.primary} />
            <View style={styles.lineText}>
              <Text variant="rowTitle" color="heading" size={16.5} numberOfLines={1}>{view.from}</Text>
              <Text variant="rowText" color="muted" size={14.5} numberOfLines={1}>{view.pickup}</Text>
            </View>
          </View>
          <View style={styles.line}>
            <Icon name="school" size={20} color={colors.primary} />
            <View style={styles.lineText}>
              <Text variant="rowTitle" color="heading" size={16.5} numberOfLines={1}>{view.to}</Text>
              <Text variant="rowText" color="muted" size={14.5} numberOfLines={1}>{view.arrive}</Text>
            </View>
          </View>
          {view.extras.length > 0 ? (
            <Text variant="caption" color="muted" numberOfLines={2}>{view.extras.join(" · ")}</Text>
          ) : null}
        </View>
        <Icon name="chevronRight" size={24} color={colors.primary} style={styles.chev} />
      </Pressable>
      <Button size="sm" label={copy.viewTrip} onPress={onOpen} testID={`${testID}.view`} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bg.tint, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border.soft, padding: 10, gap: 8 },
  body: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  text: { flex: 1, gap: 6 },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  headLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flexShrink: 1 },
  chev: { alignSelf: "center" },
  rating: { flexDirection: "row", alignItems: "center", gap: 3 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  lineText: { flex: 1 },
});
