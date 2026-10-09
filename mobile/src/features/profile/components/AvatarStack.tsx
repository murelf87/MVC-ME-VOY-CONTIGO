/**
 * Fila de avatares de una tarjeta de viaje (lámina 30): hasta tres fotos de 47,5 pt con 8,75 pt entre ellas. Con más
 * personas se solapan (paso de 34 pt) y la última pastilla indica cuántas más hay («+2»).
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "@/theme";
import { Avatar, Text } from "@/ui";
import type { CardPerson } from "../model/tripCards";
import { profileStrings } from "../strings";

const SIZE = 47.5;
const GAP = 8.75;
const OVERLAP_PITCH = 34;
const MAX_SPACED = 3;
const MAX_OVERLAPPED = 5;

export interface AvatarStackProps {
  people: readonly CardPerson[];
  size?: number;
  testID?: string;
}

export function AvatarStack({ people, size = SIZE, testID }: AvatarStackProps): React.JSX.Element | null {
  if (people.length === 0) return null;
  const spaced = people.length <= MAX_SPACED;
  const visible = spaced ? people : people.slice(0, MAX_OVERLAPPED);
  const extra = people.length - visible.length;
  const label = profileStrings.myTrips.cardRiders(people.map((person) => person.name).filter((name) => name !== ""));
  return (
    <View testID={testID} accessible accessibilityLabel={label !== "" ? label : undefined} style={styles.row}>
      {visible.map((person, index) => (
        <View
          key={person.key}
          style={[styles.item, spaced ? { marginLeft: index === 0 ? 0 : GAP } : { marginLeft: index === 0 ? 0 : OVERLAP_PITCH - size }, !spaced ? styles.ringed : null]}
        >
          <Avatar source={person.photoUrl} name={person.name !== "" ? person.name : undefined} size={size} />
        </View>
      ))}
      {extra > 0 ? (
        <View style={[styles.more, { width: size, height: size, borderRadius: size / 2, marginLeft: OVERLAP_PITCH - size }]}>
          <Text variant="rowTitle" weight="bold" color="primary" size={16}>
            {`+${extra}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  item: { borderRadius: 40 },
  ringed: { borderWidth: 2, borderColor: colors.bg.white, backgroundColor: colors.bg.white },
  more: { alignItems: "center", justifyContent: "center", backgroundColor: colors.bg.tintStrong, borderWidth: 2, borderColor: colors.bg.white },
});
