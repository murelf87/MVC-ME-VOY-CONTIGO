/**
 * Hoja del conductor (15): vehículo, mensaje opcional (≤ 300 caracteres) y enlace al viaje. El mensaje viaja con la
 * solicitud y lo ve el conductor; nada de esto cuesta ni compromete nada.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { BottomSheet, Button, Text, TextArea } from "@/ui";
import { MESSAGE_MAX } from "../logic/reviewModel";
import { requestStrings } from "../strings";

const copy = requestStrings.review;

export interface DriverSheetProps {
  visible: boolean;
  name: string;
  vehicle: string;
  plateHint: string | null;
  /** Mensaje ya guardado. */
  message: string;
  onSave: (message: string) => void;
  onSeeTrip: () => void;
  onClose: () => void;
  testID?: string;
}

export function DriverSheet({ visible, name, vehicle, plateHint, message, onSave, onSeeTrip, onClose, testID = "DriverSheet" }: DriverSheetProps): React.JSX.Element {
  const [draft, setDraft] = useState(message);
  useEffect(() => {
    if (visible) setDraft(message);
  }, [visible, message]);

  const trimmed = draft.trim();
  const unchanged = trimmed === message.trim();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={copy.messageTitle(name)}
      subtitle={copy.messageHint}
      testID={testID}
      footer={
        <View>
          <Button
            label={copy.messageSave}
            chevron={false}
            disabled={unchanged}
            onPress={() => onSave(trimmed)}
            testID={`${testID}.save`}
          />
          {message.trim() !== "" ? (
            <Button
              label={copy.messageRemove}
              variant="ghost"
              chevron={false}
              onPress={() => onSave("")}
              testID={`${testID}.remove`}
              style={styles.second}
            />
          ) : null}
        </View>
      }
    >
      <View style={styles.vehicle} accessible accessibilityLabel={`${copy.driverSheetVehicle}: ${vehicle}${plateHint !== null ? `, matrícula terminada en ${plateHint}` : ""}`}>
        <Icon name="car" size={24} color={colors.primary} />
        <View style={styles.vehicleText}>
          <Text variant="rowTitle" color="strong" size={17.5} lineHeight={22}>
            {vehicle}
          </Text>
          {plateHint !== null ? (
            <Text variant="caption" color="subtle" size={14}>
              {`···· ${plateHint}`}
            </Text>
          ) : null}
        </View>
      </View>
      <TextArea
        value={draft}
        onChangeText={setDraft}
        placeholder={copy.messagePlaceholder}
        maxLength={MESSAGE_MAX}
        minHeight={104}
        accessibilityLabel={copy.messageTitle(name)}
        testID={`${testID}.input`}
        style={styles.area}
      />
      <Button label={copy.driverSheetSeeTrip} variant="ghost" chevron={false} onPress={onSeeTrip} testID={`${testID}.seeTrip`} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  vehicle: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  vehicleText: { marginLeft: 12, flex: 1 },
  area: { marginBottom: 6 },
  second: { marginTop: 4 },
});
