import React from "react";
import { ErrorStateCard, OfflineBanner } from "@/ui";
import { describePublishError } from "../logic/errors";
import { publishStrings } from "../strings";

const copy = publishStrings.common;

export interface LoadFailureProps {
  /** Error de la consulta (o `null` si solo se sabe que falló). */
  error: unknown;
  /** Título propio («No hemos podido cargar tus solicitudes»). */
  title?: string;
  onRetry: () => void;
  testID: string;
}

/** Fallo al cargar una pantalla: sin conexión (franja ámbar con «Reintentar») o error con su explicación y un botón. */
export function LoadFailure({ error, title, onRetry, testID }: LoadFailureProps): React.JSX.Element {
  const view = describePublishError(error);
  if (view.offline) {
    return <OfflineBanner testID={testID} title={copy.offlineTitle} detail={copy.offlineDetail} retryLabel={copy.retry} onRetry={onRetry} />;
  }
  return (
    <ErrorStateCard
      testID={testID}
      tone="red"
      icon="exclaim"
      iconTone="solidRose"
      title={title ?? copy.loadError}
      message={view.message === "" ? copy.loadErrorDetail : view.message}
      actionLabel={copy.retry}
      onAction={onRetry}
    />
  );
}
