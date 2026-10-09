import React from "react";
import { StyleSheet } from "react-native";
import type { IconName, IconTileTone } from "@/icons";
import { ErrorStateCard, Text, type SurfaceTone } from "@/ui";

export type PickupNoticeKind = "locked" | "not_generated" | "not_live" | "not_eligible" | "missing";

interface Look {
  tone: SurfaceTone;
  icon: IconName;
  iconTone: IconTileTone;
}

const LOOK: Record<PickupNoticeKind, Look> = {
  locked: { tone: "red", icon: "lock", iconTone: "solidRed" },
  not_generated: { tone: "amber", icon: "clockFilled", iconTone: "solidAmber" },
  not_live: { tone: "blue", icon: "navigate", iconTone: "solidBlue" },
  not_eligible: { tone: "gray", icon: "alertCircle", iconTone: "slate" },
  missing: { tone: "red", icon: "alertCircle", iconTone: "solidRed" },
};

export interface PickupNoticeProps {
  kind: PickupNoticeKind;
  title: string;
  message: string;
  /** Línea pequeña bajo la tarjeta (p. ej. «Esta pantalla se actualiza sola…»). */
  note?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}

/** Por qué no se puede verificar ahora (código bloqueado, sin generar, viaje parado…) y qué hacer. */
export function PickupNotice({ kind, title, message, note, actionLabel, onAction, testID = "PickupNotice" }: PickupNoticeProps): React.JSX.Element {
  const look = LOOK[kind];
  return (
    <>
      <ErrorStateCard
        testID={testID}
        tone={look.tone}
        icon={look.icon}
        iconTone={look.iconTone}
        title={title}
        message={message}
        {...(actionLabel !== undefined && onAction !== undefined ? { actionLabel, onAction } : {})}
      />
      {note ? (
        <Text testID={testID !== undefined ? `${testID}.note` : undefined} variant="rowText" color="muted" size={14.5} lineHeight={18} align="center" style={styles.note}>
          {note}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  note: { marginTop: 10, paddingHorizontal: 12 },
});
