/**
 * Hoja «Adjuntar» del chat. El servidor del chat solo admite texto y ubicación (no fotos ni notas de voz: comms §12), así
 * que solo hay dos acciones: compartir mi ubicación actual (una vez) o compartir el punto de recogida de la reserva.
 */
import React from "react";
import { BottomSheet } from "@/ui";
import { messagesStrings } from "../strings";
import { SheetActionRow } from "./SheetActionRow";

const copy = messagesStrings.chat;

export interface AttachSheetProps {
  visible: boolean;
  onClose: () => void;
  onShareMyLocation: () => void;
  onSharePickup: () => void;
  /** La reserva tiene punto de recogida que compartir. */
  pickupAvailable: boolean;
  /** Buscando la posición actual. */
  locating: boolean;
  testID?: string;
}

export function AttachSheet({ visible, onClose, onShareMyLocation, onSharePickup, pickupAvailable, locating, testID = "BookingChat.attach" }: AttachSheetProps): React.JSX.Element | null {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={copy.attachTitle} subtitle={copy.attachSubtitle} testID={testID}>
      <SheetActionRow
        testID={`${testID}.myLocation`}
        icon="locate"
        label={locating ? copy.attachLocating : copy.attachMyLocation}
        description={copy.attachMyLocationHint}
        busy={locating}
        onPress={onShareMyLocation}
      />
      {pickupAvailable ? (
        <SheetActionRow testID={`${testID}.pickup`} icon="pin" label={copy.attachPickup} disabled={locating} onPress={onSharePickup} />
      ) : null}
    </BottomSheet>
  );
}
