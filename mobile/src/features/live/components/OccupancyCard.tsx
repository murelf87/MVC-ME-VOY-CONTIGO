import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { LiveOccupancy } from "@/api/types";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Avatar, Text } from "@/ui";
import { occupantColumns, type OccupantColumn } from "../model/occupancy";
import { liveStrings } from "../strings";
import { livePalette } from "./palette";

const copy = liveStrings.inCar;

export interface OccupancyCardProps {
  occupancy: LiveOccupancy;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

function roleLabel(column: Extract<OccupantColumn, { kind: "person" }>): string {
  switch (column.role) {
    case "driver":
      return copy.driverRole;
    case "you":
      return copy.you;
    case "passenger":
      return copy.passenger;
  }
}

/** «En el coche · 2 de 3 plazas ocupadas» con quien va dentro (lámina 23). Quien no comparte su perfil sale como «1 pasajero». */
export function OccupancyCard({ occupancy, testID, style }: OccupancyCardProps): React.JSX.Element {
  const columns = occupantColumns(occupancy);
  const id = (suffix: string): string | undefined => (testID !== undefined ? `${testID}.${suffix}` : undefined);
  return (
    <View testID={testID} style={[styles.card, style]}>
      <View style={styles.header} accessible accessibilityRole="header" accessibilityLabel={`${copy.occupancyTitle}. ${copy.occupancyLine(occupancy.occupied, occupancy.capacity)}`}>
        <Icon name="people" size={38} color={colors.primary} />
        <View style={styles.headerTexts}>
          <Text variant="heading" weight="bold" color="heading" size={19} lineHeight={24}>
            {copy.occupancyTitle}
          </Text>
          <Text variant="body" color="deep" size={17.4} lineHeight={22}>
            {copy.occupancyLine(occupancy.occupied, occupancy.capacity)}
          </Text>
        </View>
      </View>
      <View style={styles.members}>
        {columns.map((column) =>
          column.kind === "person" ? (
            <View key={column.key} style={styles.column} testID={id(`member.${column.role}`)} accessible accessibilityLabel={`${column.user.firstName}, ${roleLabel(column)}`}>
              <Avatar source={column.user.photoUrl} name={column.user.displayName} size={63} />
              <Text variant="rowTitle" weight="bold" color="heading" size={15.5} lineHeight={20} numberOfLines={1} align="center" style={styles.name}>
                {column.user.firstName}
              </Text>
              <Text variant="rowText" color="deep" size={15} lineHeight={18} numberOfLines={1} align="center">
                {roleLabel(column)}
              </Text>
            </View>
          ) : (
            <View key={column.key} style={styles.column} testID={id("member.hidden")} accessible accessibilityLabel={copy.hiddenPassengers(column.count)}>
              <View style={styles.hiddenAvatar}>
                <Icon name="person" size={32} color={livePalette.hiddenAvatarIcon} />
              </View>
              <Text variant="rowText" color="deep" size={14.5} lineHeight={20} numberOfLines={1} align="center" style={styles.name}>
                {copy.hiddenPassengers(column.count)}
              </Text>
            </View>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, backgroundColor: colors.bg.tintSoft, paddingTop: 11, paddingBottom: 8, borderWidth: 1, borderColor: colors.border.soft },
  header: { flexDirection: "row", alignItems: "center", paddingLeft: 10.5, paddingRight: 12, minHeight: 46 },
  headerTexts: { marginLeft: 12, flex: 1 },
  members: { flexDirection: "row", flexWrap: "wrap", marginTop: 11 },
  column: { width: "33.333%", alignItems: "center", paddingBottom: 3 },
  name: { marginTop: 3 },
  hiddenAvatar: { width: 63, height: 63, borderRadius: 31.5, backgroundColor: livePalette.hiddenAvatar, alignItems: "center", justifyContent: "center" },
});
