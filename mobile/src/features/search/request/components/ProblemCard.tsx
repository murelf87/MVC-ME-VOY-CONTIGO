/**
 * Estado de problema de una pantalla del paquete: sin conexión o error del servidor, siempre con una salida («Reintentar»
 * o, si no tiene sentido reintentar —el viaje ya no existe, la solicitud no es tuya—, volver a buscar). El texto sale de
 * `describeRequestError`: dice qué pasó sin culpar a la persona.
 */
import React from "react";
import { ErrorStateCard } from "@/ui";
import { isTerminalForRequest, describeRequestError } from "../logic/errors";
import { requestStrings } from "../strings";

export interface ProblemCardProps {
  error: unknown;
  offline: boolean;
  onRetry: () => void;
  /** Salida cuando el error es definitivo (no sirve reintentar). */
  exitLabel?: string;
  onExit?: () => void;
  testID?: string;
}

export function ProblemCard({ error, offline, onRetry, exitLabel, onExit, testID = "ProblemCard" }: ProblemCardProps): React.JSX.Element {
  const copy = requestStrings.common;
  if (offline) {
    return (
      <ErrorStateCard
        tone="amber"
        icon="offline"
        iconTone="solidAmber"
        title={copy.offlineTitle}
        message={copy.offlineDetail}
        actionLabel={copy.retry}
        onAction={onRetry}
        testID={testID}
      />
    );
  }
  const description = describeRequestError(error);
  const terminal = isTerminalForRequest(error) && exitLabel !== undefined && onExit !== undefined;
  return (
    <ErrorStateCard
      tone="red"
      icon="exclaim"
      iconTone="solidRed"
      title={description.title}
      message={description.message}
      actionLabel={terminal ? exitLabel : copy.retry}
      onAction={terminal ? onExit : onRetry}
      testID={testID}
    />
  );
}
