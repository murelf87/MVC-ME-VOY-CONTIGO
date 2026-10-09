import React from "react";
import { StyleSheet } from "react-native";
import type { IconName, IconTileTone } from "@/icons";
import { ErrorStateCard, type SurfaceTone } from "@/ui";
import type { OpsErrorAction, OpsErrorKind, OpsErrorView } from "../logic/errors";

interface Look {
  tone: SurfaceTone;
  icon: IconName;
  iconTone: IconTileTone;
}

const LOOK: Record<OpsErrorKind, Look> = {
  offline: { tone: "blue", icon: "offline", iconTone: "solidBlue" },
  timeout: { tone: "blue", icon: "offline", iconTone: "solidBlue" },
  server: { tone: "amber", icon: "exclaim", iconTone: "solidAmber" },
  unknown: { tone: "amber", icon: "exclaim", iconTone: "solidAmber" },
  conflict: { tone: "amber", icon: "exclaim", iconTone: "solidAmber" },
  validation: { tone: "amber", icon: "exclaim", iconTone: "solidAmber" },
  locked: { tone: "red", icon: "lock", iconTone: "solidRed" },
  forbidden: { tone: "red", icon: "lock", iconTone: "solidRed" },
  notFound: { tone: "red", icon: "alertCircle", iconTone: "solidRed" },
};

export interface OpsErrorCardProps {
  error: OpsErrorView;
  /** Se llama con la acción que ofrece el error (`retry`, `refresh`, `fixVehicle`, `openConsole`). */
  onAction?: (action: Exclude<OpsErrorAction, "none">) => void;
  /** Sustituye el icono por defecto (p. ej. un coche para los problemas del vehículo). */
  icon?: IconName;
  testID?: string;
}

/** Error del servidor con lo que le toca al conductor: qué ha pasado y, si procede, un botón para resolverlo. */
export function OpsErrorCard({ error, onAction, icon, testID = "OpsErrorCard" }: OpsErrorCardProps): React.JSX.Element {
  const look = LOOK[error.kind];
  const action = error.action === "none" ? undefined : error.action;
  const handler = action !== undefined && onAction !== undefined ? () => onAction(action) : undefined;
  return (
    <ErrorStateCard
      testID={testID}
      tone={look.tone}
      icon={icon ?? look.icon}
      iconTone={look.iconTone}
      title={error.title}
      message={error.message}
      {...(handler !== undefined && error.actionLabel !== null ? { actionLabel: error.actionLabel, onAction: handler } : {})}
      style={styles.card}
    />
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 4 },
});
