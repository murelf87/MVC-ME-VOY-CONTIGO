import React from "react";
import { BottomSheet, Button, LoadingBlock } from "@/ui";
import type { LiveInCarState } from "@/api/types";
import { strings } from "@/i18n";
import { useInCar } from "../hooks/useInCar";
import { usePickupCode } from "../hooks/usePickupCode";
import { liveStrings } from "../strings";
import { LoadError } from "./LoadError";
import { PickupCodeCard } from "./PickupCodeCard";

export interface PickupCodeSheetProps {
  visible: boolean;
  onClose: () => void;
  bookingId: string;
  driverName: string;
  testID?: string;
}

function Body({ bookingId, state, driverName, testID }: { bookingId: string; state: LiveInCarState; driverName: string; testID?: string }): React.JSX.Element | null {
  const controller = usePickupCode(bookingId, state.pickupCode, { tripStatus: state.tripStatus, phase: state.phase });
  return <PickupCodeCard controller={controller} state={state.pickupCode} driverName={driverName} testID={testID} />;
}

/**
 * Hoja con el código de recogida para «Esperando el coche» (lámina 21): carga el estado del código solo mientras está
 * abierta y lo genera (o lo ofrece regenerar) con la misma lógica que la pantalla «En el coche».
 */
export function PickupCodeSheet({ visible, onClose, bookingId, driverName, testID }: PickupCodeSheetProps): React.JSX.Element {
  const inCar = useInCar(bookingId, { enabled: visible });
  const state = inCar.state;
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={liveStrings.codeEntry.sheetTitle}
      testID={testID}
      footer={<Button label={liveStrings.common.close} variant="outline" chevron={false} onPress={onClose} testID={testID !== undefined ? `${testID}.close` : undefined} />}
    >
      {state !== undefined ? (
        <Body bookingId={bookingId} state={state} driverName={driverName} testID={testID !== undefined ? `${testID}.card` : undefined} />
      ) : inCar.query.isError ? (
        <LoadError error={inCar.query.error} onRetry={() => void inCar.query.refetch()} testID={testID !== undefined ? `${testID}.error` : undefined} />
      ) : (
        <LoadingBlock label={strings.common.loading} />
      )}
    </BottomSheet>
  );
}
