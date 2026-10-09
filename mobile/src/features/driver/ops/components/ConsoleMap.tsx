import React, { useMemo } from "react";
import { StyleSheet } from "react-native";
import { MvcMap, type MapMarkerSpec, type MapPoint, type MapRouteSpec } from "@/maps";
import { MapCard, type MapCardStatus } from "@/ui";
import type { ConsoleMapModel } from "../logic/console";
import type { LngLat } from "../logic/geo";
import { opsStrings } from "../strings";

const S = opsStrings.console.map;

export interface ConsoleMapProps {
  model: ConsoleMapModel;
  /** Ruta del viaje `[lng, lat][]`; vacía si todavía no ha llegado. */
  route: readonly LngLat[];
  /** Cambia cuando hay que volver a encuadrar (otro viaje, cambia el número de recogidas, aparece el coche). */
  fitKey: string;
  height?: number;
  status?: MapCardStatus;
  onRetry?: () => void;
  testID?: string;
}

/** Mapa de la consola: el coche del conductor («Tú»), las recogidas pendientes y la ruta del viaje (lámina 21). */
export function ConsoleMap({ model, route, fitKey, height = 240, status = "ready", onRetry, testID = "ConsoleMap" }: ConsoleMapProps): React.JSX.Element {
  const markers = useMemo<MapMarkerSpec[]>(() => {
    const list: MapMarkerSpec[] = model.pickups.map(
      (pickup): MapMarkerSpec => ({
        id: `pickup-${pickup.bookingId}`,
        kind: "destination",
        position: { lat: pickup.lat, lng: pickup.lng },
        chip: { title: pickup.name, subtitle: pickup.time ?? pickup.place, tone: "brand", side: "right" },
        accessibilityLabel: pickup.time ? `Recogida de ${pickup.name} en ${pickup.place} a las ${pickup.time}` : `Recogida de ${pickup.name} en ${pickup.place}`,
      }),
    );
    if (model.car) {
      list.push({
        id: "car",
        kind: "car",
        variant: "live",
        position: { lat: model.car.lat, lng: model.car.lng },
        chip: { title: S.you, subtitle: model.car.stale ? "sin señal" : S.youSub, tone: model.car.stale ? "warning" : "brand", side: "right" },
        accessibilityLabel: model.car.stale ? "Tu posición, sin señal" : "Tu posición",
      });
    }
    return list;
  }, [model]);

  const routes = useMemo<MapRouteSpec[]>(() => {
    if (route.length < 2) return [];
    const points: MapPoint[] = route.map(([lng, lat]) => ({ lat, lng }));
    return [{ id: "trip-route", kind: "route", points }];
  }, [route]);

  const fit = useMemo(() => (model.points.length > 0 ? model.points : ("content" as const)), [model.points]);
  const selected = model.pickups.find((pickup) => pickup.isNext);

  return (
    <MapCard height={height} radius={0} status={status} unavailableTitle={S.unavailableTitle} unavailableMessage={S.unavailableMessage} onRetry={onRetry} testID={testID}>
      <MvcMap
        style={styles.map}
        markers={markers}
        routes={routes}
        fit={fit}
        fitKey={fitKey}
        selectedMarkerId={selected ? `pickup-${selected.bookingId}` : null}
        recenter
        accessibilityLabel={S.a11y}
        testID={`${testID}.map`}
      />
    </MapCard>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
