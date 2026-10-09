import React from "react";
import { StyleSheet, View } from "react-native";
import type { LiveConsolePassenger } from "@/api/types";
import { formatTime } from "@/i18n";
import { Avatar, ListRow, Text } from "@/ui";
import { stopLabel } from "../logic/console";
import { opsStrings } from "../strings";

const C = opsStrings.pickup.chooser;

export interface PickupChooserProps {
  passengers: readonly LiveConsolePassenger[];
  onChoose: (bookingId: string) => void;
  testID?: string;
}

/** «¿A quién recoges?»: cuando se abre sin saber qué reserva (aviso, enlace) se elige al pasajero que sube. */
export function PickupChooser({ passengers, onChoose, testID = "PickupChooser" }: PickupChooserProps): React.JSX.Element {
  return (
    <View testID={testID}>
      <Text variant="heading" color="heading" size={22} lineHeight={27} accessibilityRole="header">
        {C.title}
      </Text>
      <Text variant="body" color="muted" size={16.5} lineHeight={21} style={styles.subtitle}>
        {C.subtitle}
      </Text>
      {passengers.map((p) => {
        const place = stopLabel(p.pickup);
        const time = p.etaToPickup ? formatTime(p.etaToPickup.at) : null;
        return (
          <ListRow
            key={p.bookingId}
            testID={`${testID}.${p.bookingId}`}
            leading={<Avatar source={p.passenger.photoUrl} name={p.passenger.displayName} size={52} />}
            title={p.passenger.firstName}
            subtitle={time ? `${C.boardsAt(place)} · ${time}` : C.boardsAt(place)}
            onPress={() => onChoose(p.bookingId)}
            style={styles.row}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: 4, marginBottom: 12 },
  row: { marginTop: 10 },
});
