import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { strings } from "@/i18n";
import { Banner, ErrorStateCard, OfflineBanner, Skeleton, SkeletonList } from "@/ui";
import { describeMoneyError, type MoneyErrorContext } from "../moneyErrors";
import { moneyStrings } from "../strings";

// ── Error de carga ───────────────────────────────────────────────────────────────────────────────────────────────

export interface LoadErrorProps {
  error: unknown;
  /** Título propio de la pantalla («No hemos podido cargar tus pagos»); se usa cuando el error no es de red. */
  heading?: string;
  onRetry: () => void;
  context?: MoneyErrorContext;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Error al cargar una pantalla entera (sin datos que enseñar). Sin conexión se dice con esas palabras y se ofrece
 * «Reintentar»; con el servidor caído o un error de petición se explica en lenguaje llano. Nunca se enseña el mensaje del
 * servidor ni un código técnico.
 */
export function LoadError({ error, heading, onRetry, context = "load", testID, style }: LoadErrorProps): React.JSX.Element {
  const view = describeMoneyError(error, context);
  if (view.offline) {
    return (
      <ErrorStateCard
        testID={testID}
        style={style}
        tone="blue"
        icon="offline"
        iconTone="solidBlue"
        title={strings.connectivity.offlineTitle}
        message={`${heading ?? view.title}. ${strings.connectivity.serverErrorHint}`}
        actionLabel={moneyStrings.retry}
        onAction={onRetry}
      />
    );
  }
  return (
    <ErrorStateCard
      testID={testID}
      style={style}
      tone="red"
      icon="exclaim"
      iconTone="solidRose"
      title={heading ?? view.title}
      message={view.message}
      actionLabel={view.retryable || heading !== undefined ? moneyStrings.retry : undefined}
      onAction={onRetry}
    />
  );
}

// ── Datos que se muestran aunque la última actualización falló ───────────────────────────────────────────────────

export interface StaleNoteProps {
  /** La última petición falló por falta de red. */
  offline: boolean;
  /** Hay datos, pero la última actualización falló por otro motivo. */
  failedToRefresh: boolean;
  onRetry: () => void;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Aviso sobre datos ya cargados: «Sin conexión · Mostrando los últimos datos guardados» o «No hemos podido actualizar…».
 * No dice cuándo se actualizó por última vez porque la caché no lo garantiza entre arranques.
 */
export function StaleNote({ offline, failedToRefresh, onRetry, testID, style }: StaleNoteProps): React.JSX.Element | null {
  if (offline) {
    return (
      <OfflineBanner
        testID={testID}
        style={style}
        detail="Mostrando los últimos datos guardados"
        retryLabel={moneyStrings.retry}
        onRetry={onRetry}
      />
    );
  }
  if (failedToRefresh) {
    return (
      <Banner
        testID={testID}
        style={style}
        kind="warning"
        size="xs"
        icon="alertCircle"
        message={moneyStrings.overview.refreshFailed}
        actionLabel={moneyStrings.retry}
        onAction={onRetry}
      />
    );
  }
  return null;
}

// ── Esqueletos ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Esqueleto de la pantalla 33: dos tarjetas de resumen y filas de movimiento. */
export function OverviewSkeleton({ testID, cards = 1 }: { testID: string; cards?: 1 | 2 }): React.JSX.Element {
  return (
    <View testID={testID} accessible accessibilityLabel={strings.common.loading} accessibilityState={{ busy: true }}>
      {Array.from({ length: cards }, (_, index) => (
        <Skeleton key={index} height={cards === 2 ? 113 : 122} radius={18} style={index > 0 ? styles.gap : null} />
      ))}
      <Skeleton height={26} width="44%" radius={8} style={styles.section} />
      <SkeletonList count={2} variant="row" />
    </View>
  );
}

/** Esqueleto de una lista de filas con avatar. */
export function RowsSkeleton({ testID, count = 4 }: { testID: string; count?: number }): React.JSX.Element {
  return <SkeletonList testID={testID} count={count} variant="row" />;
}

const styles = StyleSheet.create({
  gap: { marginTop: 8 },
  section: { marginTop: 24, marginBottom: 6 },
});
