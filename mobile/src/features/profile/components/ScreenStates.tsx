/**
 * Estados que comparten todas las pantallas del slice: cargando (esqueleto), error con «Reintentar» y falta de conexión.
 * Mantienen la voz y la forma de las demás pantallas de la app (`ErrorStateCard`, `OfflineBanner`, `SkeletonList`).
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { describeError } from "@/api";
import { strings } from "@/i18n";
import { ErrorStateCard, OfflineBanner, SkeletonList } from "@/ui";
import { profileStrings } from "../strings";

const copy = profileStrings.common;

export interface ListSkeletonProps {
  testID: string;
  count?: number;
  variant?: "row" | "card";
  style?: StyleProp<ViewStyle>;
}

/** Esqueleto de carga: se anuncia a los lectores de pantalla como «cargando». */
export function ListSkeleton({ testID, count = 3, variant = "card", style }: ListSkeletonProps): React.JSX.Element {
  return (
    <View testID={testID} accessible accessibilityLabel={strings.common.loading} accessibilityLiveRegion="polite" style={[styles.block, style]}>
      <SkeletonList count={count} variant={variant} />
    </View>
  );
}

export interface LoadFailureProps {
  testID: string;
  title: string;
  error: unknown;
  /** Texto de apoyo si el error no trae uno propio. */
  fallbackMessage?: string;
  onRetry: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Tarjeta de error con el motivo real (en español) y «Reintentar». */
export function LoadFailure({ testID, title, error, fallbackMessage, onRetry, style }: LoadFailureProps): React.JSX.Element {
  const described = error !== null && error !== undefined ? describeError(error) : null;
  return (
    <View style={[styles.block, style]}>
      <ErrorStateCard
        testID={testID}
        tone="red"
        icon="alertCircle"
        title={title}
        message={described?.message ?? fallbackMessage ?? strings.connectivity.serverErrorHint}
        actionLabel={copy.retry}
        onAction={onRetry}
      />
    </View>
  );
}

export interface OfflineNoticeProps {
  testID: string;
  /** Qué se está mostrando mientras tanto («Mostramos lo último que teníamos…»). */
  detail?: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Franja de «Sin conexión»: lo ya cargado se conserva y se ofrece reintentar. */
export function OfflineNotice({ testID, detail, onRetry, style }: OfflineNoticeProps): React.JSX.Element {
  return (
    <OfflineBanner
      testID={testID}
      title={strings.connectivity.offlineTitle}
      {...(detail !== undefined ? { detail } : {})}
      {...(onRetry !== undefined ? { retryLabel: copy.retry, onRetry } : {})}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  block: { paddingHorizontal: 13.5 },
});
