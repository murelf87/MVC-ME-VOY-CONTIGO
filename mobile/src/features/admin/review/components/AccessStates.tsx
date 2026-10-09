/**
 * Estados de acceso y de error del panel: comprobando el acceso, «Sin permiso» (RBAC), error de carga y sin conexión.
 * Lo que el rol no puede ver NO se muestra; cuando el servidor lo deniega (403) se pinta aquí, con una salida clara
 * («Ir al inicio del panel»), nunca un botón que falla en silencio.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { EmptyState, ErrorStateCard, Skeleton } from "@/ui";
import type { AdminErrorView } from "../logic/errors";
import { reviewStrings } from "../strings";

export function CheckingAccess({ testID = "AccessGate.checking" }: { testID?: string }): React.JSX.Element {
  return (
    <View testID={testID} accessible accessibilityLabel={reviewStrings.access.checkingTitle} accessibilityState={{ busy: true }} style={styles.checking}>
      <Skeleton height={46} radius={16} />
      <Skeleton height={42} radius={14} style={styles.gap} />
      <Skeleton height={190} radius={18} style={styles.gap} />
    </View>
  );
}

export interface NoPermissionProps {
  message: string;
  title?: string;
  /** Si se indica, ofrece «Ir al inicio del panel». */
  onGoHome?: () => void;
  testID?: string;
}

export function NoPermission({ message, title = reviewStrings.access.deniedTitle, onGoHome, testID = "NoPermission" }: NoPermissionProps): React.JSX.Element {
  return (
    <EmptyState
      testID={testID}
      icon="lock"
      title={title}
      message={message}
      actionLabel={onGoHome !== undefined ? reviewStrings.access.goHome : undefined}
      onAction={onGoHome}
    />
  );
}

export interface PanelErrorProps {
  error: AdminErrorView;
  /** Vuelve a pedir lo que falló (solo si tiene sentido reintentar). */
  onRetry?: () => void;
  onGoHome?: () => void;
  testID?: string;
}

/** Error de carga de una pantalla entera: sin permiso, sin conexión, no encontrado o fallo del servidor. */
export function PanelError({ error, onRetry, onGoHome, testID = "PanelError" }: PanelErrorProps): React.JSX.Element {
  if (error.kind === "forbidden") {
    return <NoPermission testID={testID} title={error.title} message={error.message} onGoHome={onGoHome} />;
  }
  if (error.kind === "offline") {
    return (
      <ErrorStateCard
        testID={testID}
        tone="amber"
        icon="offline"
        iconTone="solidAmber"
        title={reviewStrings.common.offlineTitle}
        message={error.message}
        actionLabel={onRetry !== undefined ? reviewStrings.common.retry : undefined}
        onAction={onRetry}
      />
    );
  }
  if (error.kind === "notFound") {
    return (
      <EmptyState
        testID={testID}
        icon="search"
        title={error.title}
        message={error.message}
        actionLabel={onGoHome !== undefined ? reviewStrings.access.goHome : undefined}
        onAction={onGoHome}
      />
    );
  }
  return (
    <ErrorStateCard
      testID={testID}
      tone="red"
      icon="alertCircle"
      iconTone="solidRed"
      title={error.title}
      message={error.message}
      actionLabel={error.retryable && onRetry !== undefined ? reviewStrings.common.retry : undefined}
      onAction={error.retryable ? onRetry : undefined}
    />
  );
}

const styles = StyleSheet.create({
  checking: { paddingTop: 12 },
  gap: { marginTop: 12 },
});
