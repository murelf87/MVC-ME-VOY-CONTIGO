/**
 * Ticks de un mensaje propio: reloj (enviando) · ✓ (enviado) · ✓✓ gris (entregado) · ✓✓ azul/blanco (leído) · aviso (no
 * enviado). Sobre la burbuja azul van en blanco; sobre la tarjeta de ubicación (fondo claro) en gris y azul.
 */
import React from "react";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import type { MessageDeliveryStatus } from "@/ui";

export type DeliveryTone = "onBubble" | "onCard";

export interface DeliveryMarkProps {
  status: MessageDeliveryStatus;
  tone?: DeliveryTone;
}

export function DeliveryMark({ status, tone = "onBubble" }: DeliveryMarkProps): React.JSX.Element {
  const onBubble = tone === "onBubble";
  switch (status) {
    case "pending":
      return <Icon name="clock" size={15} color={onBubble ? colors.text.inverseSoft : colors.text.time} />;
    case "sent":
      return <Icon name="check" size={17} color={onBubble ? colors.onPrimary : colors.text.time} />;
    case "delivered":
      return <Icon name="checkDouble" size={19} color={onBubble ? colors.text.inverseFaint : colors.text.time} />;
    case "read":
      return <Icon name="checkDouble" size={19} color={onBubble ? colors.onPrimary : colors.primary} />;
    case "failed":
      return <Icon name="alertCircle" size={18} color={onBubble ? colors.onPrimary : colors.error.solid} />;
  }
}
