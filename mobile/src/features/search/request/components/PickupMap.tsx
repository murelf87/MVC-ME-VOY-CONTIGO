/**
 * Mapa de «Punto de recogida» (13): ruta del conductor hasta el punto elegido (azul), trayecto a pie (puntos) y los
 * puntos propuestos A/B, con la leyenda de la lámina y el botón «centrar en mi ubicación». El mapa no hace red: recibe el
 * modelo ya calculado (`buildPickupMap`).
 */
import React from "react";
import { StyleSheet } from "react-native";
import { MapLegend, MvcMap, type MapPoint } from "@/maps";
import type { PickupMapModel } from "../logic/pickup";
import { requestStrings } from "../strings";

const copy = requestStrings.pickup;

const LEGEND = [
  { icon: "car", label: copy.legendCar },
  { icon: "walk", label: copy.legendWalk },
] as const;

export interface PickupMapProps {
  model: PickupMapModel;
  /** Cambia cuando hay que reencuadrar (otro punto elegido, otro origen, llegan las propuestas). */
  fitKey: string;
  userLocation: MapPoint | null;
  onRecenter: () => void;
  /** Alto que tapa la hoja inferior (el mapa se extiende bajo sus esquinas redondeadas). */
  bottomOverlap: number;
  testID?: string;
}

export function PickupMap({ model, fitKey, userLocation, onRecenter, bottomOverlap, testID = "PickupPoint.map" }: PickupMapProps): React.JSX.Element {
  const focus = userLocation !== null ? [...model.focus, userLocation] : model.focus;
  return (
    <MvcMap
      testID={testID}
      accessibilityLabel={copy.mapLabel}
      style={styles.map}
      fit={focus.length > 0 ? focus : "content"}
      fitKey={fitKey}
      edgePadding={{ top: 84, bottom: bottomOverlap + 8, left: 24, right: 24 }}
      markers={model.markers}
      routes={model.routes}
      userLocation={userLocation}
      recenter
      onRecenter={onRecenter}
    >
      <MapLegend position="topLeft" items={LEGEND} style={styles.legend} testID={`${testID}.legend`} />
    </MvcMap>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  legend: { top: 8, left: 15 },
});
