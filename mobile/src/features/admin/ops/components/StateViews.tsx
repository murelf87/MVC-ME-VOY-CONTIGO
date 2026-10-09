/**
 * Estados comunes de las pantallas del panel: «Sin permiso» (403 del servidor o rol sin acceso), error de carga con
 * «Reintentar», y avisos de datos desactualizados / sin conexión cuando ya hay algo que mostrar.
 */
import React from "react";
import { describeError } from "@/api";
import { Banner, ErrorStateCard, OfflineBanner } from "@/ui";
import { opsStrings } from "../strings";

export function isForbiddenError(error: Error | null): boolean {
  return error !== null && describeError(error).status === 403;
}

export interface NoPermissionStateProps {
  /** Nombre de la sección, para «Tu rol no da acceso a «Auditoría»». */
  section?: string;
  message?: string;
  testID: string;
}

export function NoPermissionState({ section, message, testID }: NoPermissionStateProps): React.JSX.Element {
  const text = message ?? (section !== undefined ? opsStrings.noPermission.sectionMessage(section) : opsStrings.noPermission.message);
  return <ErrorStateCard testID={testID} tone="amber" icon="lock" iconTone="solidAmber" title={opsStrings.noPermission.title} message={text} />;
}

export interface QueryErrorStateProps {
  error: Error | null;
  onRetry: () => void;
  section?: string;
  testID: string;
}

/** Error de la PRIMERA carga (sin datos): «Sin permiso» si es un 403; si no, la explicación del error y «Reintentar». */
export function QueryErrorState({ error, onRetry, section, testID }: QueryErrorStateProps): React.JSX.Element {
  const info = describeError(error);
  if (info.status === 403) return <NoPermissionState section={section} testID={`${testID}.noPermission`} />;
  const offline = info.kind === "offline";
  return (
    <ErrorStateCard
      testID={testID}
      tone={offline ? "blue" : "red"}
      icon={offline ? "offline" : "alertCircle"}
      iconTone={offline ? "solidBlue" : "solidRed"}
      title={info.title}
      message={info.message}
      actionLabel={opsStrings.common.retry}
      onAction={onRetry}
    />
  );
}

export interface StaleNoticeProps {
  offline: boolean;
  failedToRefresh: boolean;
  onRetry: () => void;
  testID: string;
}

/** Ya hay datos en pantalla pero la última actualización falló: se conservan y se avisa. */
export function StaleNotice({ offline, failedToRefresh, onRetry, testID }: StaleNoticeProps): React.JSX.Element | null {
  if (offline) {
    return <OfflineBanner testID={testID} title={opsStrings.common.offlineTitle} detail={opsStrings.common.offlineDetail} retryLabel={opsStrings.common.retry} onRetry={onRetry} />;
  }
  if (failedToRefresh) {
    return <Banner testID={testID} kind="warning" size="sm" message={opsStrings.common.staleRefresh} actionLabel={opsStrings.common.retry} onAction={onRetry} />;
  }
  return null;
}
