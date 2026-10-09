import React from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { images } from "@/assets";
import type { LiveVehicle } from "@/api/types";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { vehicleImageKey, vehicleLine } from "../model/vehicle";
import { liveStrings } from "../strings";

export interface VehiclePhotoProps {
  vehicle: Pick<LiveVehicle, "make" | "model" | "color">;
  width: number;
  height: number;
  testID?: string;
}

/**
 * Imagen del coche. El contrato no trae foto: solo se enseña una ilustración empaquetada cuando representa exactamente
 * ese modelo y color; si no, un icono de coche. Nunca se pinta la foto de otro vehículo.
 */
export function VehiclePhoto({ vehicle, width, height, testID }: VehiclePhotoProps): React.JSX.Element {
  const key = vehicleImageKey(vehicle);
  if (key === null) {
    return (
      <View
        testID={testID}
        accessible
        accessibilityRole="image"
        accessibilityLabel={liveStrings.vehicle.carA11y}
        style={[styles.fallback, { width, height }]}
      >
        <Icon name="car" size={Math.round(Math.min(width, height) * 0.62)} color={colors.gray.icon} />
      </View>
    );
  }
  const asset = images.cars.seatLeon;
  return (
    <Image
      testID={testID}
      source={asset.source}
      contentFit="contain"
      accessibilityLabel={liveStrings.vehicle.photoA11y(vehicleLine(vehicle))}
      accessibilityIgnoresInvertColors
      style={{ width, height }}
    />
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center", borderRadius: radii.md, backgroundColor: colors.bg.tint },
});
