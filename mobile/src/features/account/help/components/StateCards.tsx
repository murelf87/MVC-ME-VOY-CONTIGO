import React from "react";
import { StyleSheet, View } from "react-native";
import { ErrorStateCard, EmptyState, OfflineBanner, SkeletonList, type ErrorStateCardProps } from "@/ui";
import { helpStrings } from "../strings";

export interface LoadErrorProps {
  title?: string;
  message?: string;
  /** Sin conexión (cambia el icono y el tono: no es un fallo del servidor). */
  offline?: boolean;
  onRetry: () => void;
  testID?: string;
}

/** Tarjeta de «no hemos podido cargar» con «Reintentar» (siempre ofrece salida). */
export function LoadError({ title, message, offline = false, onRetry, testID }: LoadErrorProps): React.JSX.Element {
  const common: Pick<ErrorStateCardProps, "actionLabel" | "onAction" | "testID"> = {
    actionLabel: helpStrings.common.retry,
    onAction: onRetry,
    testID,
  };
  if (offline) {
    return (
      <ErrorStateCard
        {...common}
        tone="amber"
        icon="offline"
        iconTone="solidAmber"
        title={helpStrings.common.offlineTitle}
        message={helpStrings.common.offlineMessage}
      />
    );
  }
  return (
    <ErrorStateCard
      {...common}
      tone="red"
      icon="exclaim"
      iconTone="solidRose"
      title={title ?? helpStrings.common.loadErrorTitle}
      message={message ?? helpStrings.common.loadErrorMessage}
    />
  );
}

export interface GuestNoticeProps {
  message?: string;
  onSignIn: () => void;
  testID?: string;
}

/** Invitado (sin cuenta): explica por qué hace falta y ofrece crearla o entrar. */
export function GuestNotice({ message, onSignIn, testID }: GuestNoticeProps): React.JSX.Element {
  return (
    <EmptyState
      testID={testID}
      icon="person"
      variant="card"
      title={helpStrings.common.guestTitle}
      message={message ?? helpStrings.common.guestMessage}
      actionLabel={helpStrings.common.guestAction}
      onAction={onSignIn}
    />
  );
}

/** Franja de «sin conexión» con el texto estándar de este paquete (datos de la última carga). */
export function OfflineNotice({ testID }: { testID?: string }): React.JSX.Element {
  return <OfflineBanner testID={testID} title={helpStrings.common.offlineTitle} detail={helpStrings.common.offlineDetail} />;
}

/** Esqueleto de lista con margen (primera carga). */
export function ListSkeleton({ count = 3, testID }: { count?: number; testID?: string }): React.JSX.Element {
  return (
    <View style={styles.skeleton}>
      <SkeletonList count={count} variant="card" testID={testID} />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { marginTop: 8 },
});
