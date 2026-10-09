import React from "react";
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { MapCar } from "@/api/types";
import { Icon, IconTile } from "@/icons";
import { colors, radii, shadows } from "@/theme";
import { IconButton, Text } from "@/ui";
import { carRouteText, departureText, positionNote, seatsText } from "../logic/mapCars";
import { browseStrings } from "../strings";

const copy = browseStrings.mapHome.carPanel;

export interface CarPanelProps {
  /** Coches de la zona tocada, ya ordenados (primero los que tienen plazas). */
  cars: readonly MapCar[];
  /** Instante actual (ms) para decidir «Sale a las…» / «Salió a las…». */
  nowMs: number;
  onOpenTrip: (car: MapCar) => void;
  onClose: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Tarjeta sobre el mapa con los coches de la zona tocada. Cada fila abre el detalle del viaje. Las posiciones son siempre
 * aproximadas y la tarjeta lo dice: nunca se enseña el punto exacto de un coche a quien no participa en el viaje.
 */
export function CarPanel({ cars, nowMs, onOpenTrip, onClose, testID = "CarPanel", style }: CarPanelProps): React.JSX.Element {
  const several = cars.length > 1;
  return (
    <View testID={testID} style={[styles.card, style]} accessibilityViewIsModal={false}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="rowTitle" color="heading" size={17} accessibilityRole="header">
            {copy.title(cars.length)}
          </Text>
          {several ? (
            <Text variant="rowText" color="muted" size={14}>
              {copy.subtitleCluster}
            </Text>
          ) : null}
        </View>
        <IconButton
          icon="close"
          size={44}
          iconSize={24}
          color={colors.text.muted}
          accessibilityLabel={copy.close}
          onPress={onClose}
          testID={`${testID}.close`}
        />
      </View>
      <ScrollView style={several ? styles.listScroll : undefined} showsVerticalScrollIndicator={false} bounces={false}>
        {cars.map((car, index) => (
          <CarRow key={car.tripId} car={car} nowMs={nowMs} first={index === 0} onPress={() => onOpenTrip(car)} testID={`${testID}.car.${index}`} />
        ))}
      </ScrollView>
      <Text variant="caption" color="subtle" style={styles.note}>
        {copy.positionNote}
      </Text>
    </View>
  );
}

interface CarRowProps {
  car: MapCar;
  nowMs: number;
  first: boolean;
  onPress: () => void;
  testID: string;
}

function CarRow({ car, nowMs, first, onPress, testID }: CarRowProps): React.JSX.Element {
  const route = carRouteText(car);
  const seats = seatsText(car);
  const time = departureText(car, nowMs);
  const note = positionNote(car);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={copy.rowA11y(route, seats, time)}
      onPress={onPress}
      style={({ pressed }) => [styles.row, first ? null : styles.rowGap, pressed ? styles.rowPressed : null]}
    >
      <IconTile name="car" tone={car.full ? "gray" : "blue"} size={44} iconSize={24} />
      <View style={styles.rowText}>
        <Text variant="rowTitle" color="heading" size={16} numberOfLines={1}>
          {route}
        </Text>
        <Text variant="rowText" color={car.full ? "muted" : "body"} size={14.5} numberOfLines={1}>
          {`${seats} · ${time}`}
        </Text>
        {note !== null ? (
          <Text variant="caption" color={note === "live" ? "success" : "subtle"} numberOfLines={1}>
            {note === "live" ? copy.live : copy.positionStale}
          </Text>
        ) : null}
      </View>
      <Icon name="chevronRight" size={24} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.white,
    borderRadius: radii.xl,
    paddingTop: 6,
    paddingBottom: 10,
    paddingHorizontal: 12,
    boxShadow: shadows.float,
  },
  header: { flexDirection: "row", alignItems: "center", paddingLeft: 4 },
  headerText: { flex: 1 },
  listScroll: { maxHeight: 190 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 64,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.tint,
    borderWidth: 1,
    borderColor: colors.border.soft,
  },
  rowGap: { marginTop: 8 },
  rowPressed: { backgroundColor: colors.bg.tintPressed },
  rowText: { flex: 1, marginLeft: 12, marginRight: 6 },
  note: { marginTop: 8, marginLeft: 4 },
});
