import React from "react";
import { StyleSheet, View } from "react-native";
import { Avatar, RatingBadge, StatusPill, Text } from "@/ui";
import { stopLabel, type PassengerRowView } from "../logic/console";
import { opsStrings } from "../strings";

const P = opsStrings.pickup.passenger;

export interface PickupPassengerHeaderProps {
  row: PassengerRowView;
  testID?: string;
}

/** Quién sube al coche (23: foto, nombre con valoración y dos líneas debajo) con su estado a la derecha. */
export function PickupPassengerHeader({ row, testID = "PickupPassengerHeader" }: PickupPassengerHeaderProps): React.JSX.Element {
  const { passenger } = row;
  const place = stopLabel(row.pickup);
  return (
    <View testID={testID} style={styles.row} accessible accessibilityLabel={`${passenger.firstName}. ${row.statusLabel}. ${P.boardsAt(place)}`}>
      <Avatar source={passenger.photoUrl} name={passenger.displayName} size={60} />
      <View style={styles.text}>
        <View style={styles.nameRow}>
          <Text variant="titleSm" color="heading" size={22} lineHeight={26} numberOfLines={1} style={styles.name}>
            {passenger.firstName}
          </Text>
          <RatingBadge average={passenger.ratingAverage} count={passenger.ratingCount} size={16} />
        </View>
        <Text variant="rowText" color="muted" size={15.5} lineHeight={19} numberOfLines={1}>
          {P.boardsAt(place)}
        </Text>
        {row.etaToPickup ? (
          <Text variant="rowText" color="muted" size={15.5} lineHeight={19} numberOfLines={1}>
            {P.planned(row.etaToPickup.time)}
          </Text>
        ) : null}
      </View>
      <StatusPill label={row.statusLabel} tone={row.tone} size="sm" testID={testID !== undefined ? `${testID}.status` : undefined} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  text: { flex: 1, marginLeft: 14, marginRight: 8 },
  nameRow: { flexDirection: "row", alignItems: "center" },
  name: { flexShrink: 1, marginRight: 8 },
});
