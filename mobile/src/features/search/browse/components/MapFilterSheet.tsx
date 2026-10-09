import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BottomSheet, Button, RadioRow, Text } from "@/ui";
import { DEFAULT_WITHIN_HOURS, WITHIN_HOURS_OPTIONS, type MapFilter } from "../logic/mapCars";
import { browseStrings } from "../strings";

const copy = browseStrings.mapHome;

/** Lo que cambia esta hoja; la categoría tiene sus propios chips en el mapa. */
export type MapFilterChoice = Pick<MapFilter, "onlyWithSeats" | "withinHours">;

export interface MapFilterSheetProps {
  visible: boolean;
  value: MapFilterChoice;
  onApply: (choice: MapFilterChoice) => void;
  onClose: () => void;
  testID?: string;
}

const DEFAULT_CHOICE: MapFilterChoice = { onlyWithSeats: false, withinHours: DEFAULT_WITHIN_HOURS };

/**
 * «Filtrar coches»: plazas (todos los coches, con los completos en gris, o solo los que tienen plazas libres) y franja de
 * salida (próximas 3, 6, 12, 24 o 48 horas). Se edita un borrador y solo «Ver coches» lo aplica; «Quitar filtros» vuelve a lo
 * habitual.
 */
export function MapFilterSheet({ visible, value, onApply, onClose, testID = "MapFilterSheet" }: MapFilterSheetProps): React.JSX.Element | null {
  const [draft, setDraft] = useState<MapFilterChoice>(value);

  // Cada vez que se abre, el borrador parte de lo que está aplicado.
  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  const isDefault = draft.onlyWithSeats === DEFAULT_CHOICE.onlyWithSeats && draft.withinHours === DEFAULT_CHOICE.withinHours;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={copy.filterSheetTitle}
      subtitle={copy.filterSheetSubtitle}
      testID={testID}
      footer={
        <View style={styles.footer}>
          <Button label={copy.filterApply} onPress={() => onApply(draft)} testID={`${testID}.apply`} />
          <Button
            label={copy.filterReset}
            variant="ghost"
            chevron={false}
            disabled={isDefault}
            onPress={() => setDraft(DEFAULT_CHOICE)}
            testID={`${testID}.reset`}
            style={styles.reset}
          />
        </View>
      }
    >
      <Text variant="heading" color="heading" accessibilityRole="header" style={styles.heading}>
        {copy.filterSeatsHeading}
      </Text>
      <View style={styles.group}>
        <RadioRow
          label={copy.filterSeats}
          selected={!draft.onlyWithSeats}
          onSelect={() => setDraft((current) => ({ ...current, onlyWithSeats: false }))}
          testID={`${testID}.seats.any`}
        />
        <Text variant="caption" color="subtle" style={styles.hint}>
          {copy.filterSeatsAnyDescription}
        </Text>
        <RadioRow
          label={copy.filterSeatsOnlyLabel}
          selected={draft.onlyWithSeats}
          onSelect={() => setDraft((current) => ({ ...current, onlyWithSeats: true }))}
          testID={`${testID}.seats.only`}
        />
        <Text variant="caption" color="subtle" style={styles.hint}>
          {copy.filterSeatsOnlyDescription}
        </Text>
      </View>

      <Text variant="heading" color="heading" accessibilityRole="header" style={styles.heading}>
        {copy.filterWhenHeading}
      </Text>
      <View style={styles.group}>
        {WITHIN_HOURS_OPTIONS.map((hours) => (
          <RadioRow
            key={hours}
            label={copy.filterHours(hours)}
            selected={draft.withinHours === hours}
            onSelect={() => setDraft((current) => ({ ...current, withinHours: hours }))}
            testID={`${testID}.hours.${hours}`}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  heading: { marginTop: 8, marginBottom: 10 },
  group: { gap: 8, marginBottom: 6 },
  hint: { marginLeft: 6, marginTop: -2, marginBottom: 4 },
  footer: { gap: 4 },
  reset: { marginTop: 2 },
});
