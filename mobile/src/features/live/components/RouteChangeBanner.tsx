import React from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { LivePendingRouteChange } from "@/api/types";
import { formatTime } from "@/i18n";
import { Banner } from "@/ui";
import { liveStrings } from "../strings";

const copy = liveStrings.waiting;

export interface RouteChangeBannerProps {
  pending: LivePendingRouteChange | null;
  driverName: string;
  onOpen: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Aviso de que la persona que conduce propone una nueva parada (abre la pantalla 22). */
export function RouteChangeBanner({ pending, driverName, onOpen, testID, style }: RouteChangeBannerProps): React.JSX.Element | null {
  if (pending === null) return null;
  const until = pending.expiresAt === null ? null : formatTime(pending.expiresAt);
  const mine = pending.awaitingMyDecision;
  return (
    <Banner
      kind={mine ? "warning" : "info"}
      size="md"
      title={mine ? copy.routeChangeTitle(driverName) : copy.routeChangePendingTitle}
      message={mine ? copy.routeChangeMessage(until === "" ? null : until) : copy.routeChangePendingMessage}
      chevron
      onPress={onOpen}
      accessibilityLabel={`${mine ? copy.routeChangeTitle(driverName) : copy.routeChangePendingTitle}. ${copy.routeChangeAction}`}
      testID={testID}
      style={style}
    />
  );
}
