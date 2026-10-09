import React from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { describeError } from "@/api";
import { strings } from "@/i18n";
import { ErrorStateCard } from "@/ui";

export interface LoadErrorProps {
  error: unknown;
  onRetry: () => void;
  /** Si la reserva o el recurso no existe (404) no tiene sentido reintentar: se ofrece este botón alternativo. */
  fallbackLabel?: string;
  onFallback?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Tarjeta de error de carga con «Reintentar» (solo si merece la pena) y, si se pasa, una salida alternativa. */
export function LoadError({ error, onRetry, fallbackLabel, onFallback, testID, style }: LoadErrorProps): React.JSX.Element {
  const described = describeError(error);
  const offline = described.kind === "offline";
  const canRetry = described.retryable || described.kind === "offline";
  const useFallback = !canRetry && fallbackLabel !== undefined && onFallback !== undefined;
  return (
    <ErrorStateCard
      testID={testID}
      style={style}
      title={described.title}
      message={described.message}
      tone={offline ? "blue" : "red"}
      icon={offline ? "offline" : "exclaim"}
      iconTone={offline ? "solidBlue" : "solidRed"}
      actionLabel={useFallback ? fallbackLabel : canRetry ? strings.common.retry : undefined}
      onAction={useFallback ? onFallback : canRetry ? onRetry : undefined}
    />
  );
}
