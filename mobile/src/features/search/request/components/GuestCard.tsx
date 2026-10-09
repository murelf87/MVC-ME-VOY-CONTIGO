/**
 * Tarjeta para quien explora sin cuenta: lo que se puede hacer con una cuenta (ver los puntos de recogida, elegir días,
 * enviar la solicitud) y el botón para crearla. Sin culpar a nadie y sin cerrar la puerta a seguir mirando.
 */
import React from "react";
import { ErrorStateCard } from "@/ui";
import { requestStrings } from "../strings";

export interface GuestCardProps {
  onCreateAccount: () => void;
  testID?: string;
}

export function GuestCard({ onCreateAccount, testID = "GuestCard" }: GuestCardProps): React.JSX.Element {
  const copy = requestStrings.common;
  return (
    <ErrorStateCard
      tone="blue"
      icon="info"
      iconTone="solidBlue"
      title={copy.guestTitle}
      message={copy.guestMessage}
      actionLabel={copy.guestAction}
      onAction={onCreateAccount}
      testID={testID}
    />
  );
}
