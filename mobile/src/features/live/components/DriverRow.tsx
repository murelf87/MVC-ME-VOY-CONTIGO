import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { LiveVehicle, PublicUser } from "@/api/types";
import { Avatar, IconButton, Text } from "@/ui";
import { colors } from "@/theme";
import { vehicleLine } from "../model/vehicle";
import { liveStrings } from "../strings";
import { PlateChip } from "./PlateChip";
import { RatingInline } from "./RatingInline";
import { VehiclePhoto } from "./VehiclePhoto";

export interface DriverRowProps {
  driver: PublicUser;
  vehicle: LiveVehicle;
  /**
   * `hero` (lámina 21): foto de 92,5 pt, nombre grande y foto del coche con la matrícula a la derecha.
   * `compact` (lámina 23): foto de 63 pt, matrícula y botón redondo de llamar.
   */
  variant: "hero" | "compact";
  /** Solo `compact`: pulsar el teléfono. Sin él no se dibuja el botón. */
  onCall?: () => void;
  callBusy?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Persona que conduce: foto, nombre, valoración, coche y matrícula. */
export function DriverRow({ driver, vehicle, variant, onCall, callBusy = false, testID, style }: DriverRowProps): React.JSX.Element {
  const line = vehicleLine(vehicle);
  if (variant === "hero") {
    return (
      <View testID={testID} style={[styles.heroRow, style]}>
        <Avatar source={driver.photoUrl} name={driver.displayName} size={92.5} testID={testID !== undefined ? `${testID}.avatar` : undefined} />
        <View style={styles.heroInfo}>
          <View style={styles.heroNameLine}>
            <Text variant="title" color="heading" size={25} lineHeight={30} numberOfLines={1} style={styles.heroName}>
              {driver.firstName}
            </Text>
            <RatingInline average={driver.ratingAverage} size={22.5} style={styles.heroRating} testID={testID !== undefined ? `${testID}.rating` : undefined} />
          </View>
          <Text variant="body" color="deep" size={17} lineHeight={22} numberOfLines={1} style={styles.heroLine}>
            {line}
          </Text>
        </View>
        <View style={styles.heroRight}>
          <VehiclePhoto vehicle={vehicle} width={107} height={49} testID={testID !== undefined ? `${testID}.photo` : undefined} />
          <PlateChip plate={vehicle.plate} size="lg" style={styles.heroPlate} testID={testID !== undefined ? `${testID}.plate` : undefined} />
        </View>
      </View>
    );
  }
  return (
    <View testID={testID} style={[styles.compactRow, style]}>
      <Avatar source={driver.photoUrl} name={driver.displayName} size={63} testID={testID !== undefined ? `${testID}.avatar` : undefined} />
      <View style={styles.compactInfo}>
        <View style={styles.compactNameLine}>
          <Text variant="title" color="heading" size={20.5} lineHeight={26} numberOfLines={1}>
            {driver.firstName}
          </Text>
          <RatingInline average={driver.ratingAverage} size={19} style={styles.compactRating} testID={testID !== undefined ? `${testID}.rating` : undefined} />
        </View>
        <Text variant="body" color="deep" size={16} lineHeight={20} numberOfLines={1} style={styles.compactLine}>
          {line}
        </Text>
      </View>
      <PlateChip plate={vehicle.plate} size="md" style={styles.compactPlate} testID={testID !== undefined ? `${testID}.plate` : undefined} />
      {onCall !== undefined ? (
        <IconButton
          icon="phone"
          variant="outline"
          shape="rounded"
          size={47.5}
          iconSize={26}
          color={colors.heading}
          accessibilityLabel={liveStrings.inCar.call(driver.firstName)}
          disabled={callBusy}
          onPress={onCall}
          style={styles.compactCall}
          testID={testID !== undefined ? `${testID}.call` : undefined}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: "row", alignItems: "flex-start", paddingRight: 7.5 },
  heroInfo: { flex: 1, marginLeft: 16, marginTop: 12.5 },
  heroNameLine: { flexDirection: "row", alignItems: "center" },
  heroName: { flexShrink: 1 },
  heroRating: { marginLeft: 17 },
  heroLine: { marginTop: 14.5 },
  heroRight: { marginLeft: 8, alignItems: "flex-end", marginTop: 2 },
  heroPlate: { marginTop: 6 },
  compactRow: { flexDirection: "row", alignItems: "flex-start", paddingLeft: 7.5, paddingRight: 7 },
  compactInfo: { flex: 1, marginLeft: 12, marginTop: 5.5 },
  compactNameLine: { flexDirection: "row", alignItems: "center" },
  compactRating: { marginLeft: 20 },
  compactLine: { marginTop: 3 },
  compactPlate: { marginTop: 27.5, marginLeft: 6 },
  compactCall: { marginTop: 8, marginLeft: 14 },
});
