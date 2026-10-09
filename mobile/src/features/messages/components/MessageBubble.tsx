/**
 * Burbuja de texto del chat (lámina 26). Recibida: gris, con la foto de la otra persona a la izquierda. Enviada: azul, a
 * la derecha. La hora (y los ticks, si es mía) van DENTRO de la burbuja, en la esquina inferior derecha y en la misma
 * línea que el final del texto cuando cabe, como dibuja la lámina.
 *
 * Para reservar ese hueco sin medir nada, tras el texto va una copia INVISIBLE de la hora (misma tipografía, así que
 * ocupa exactamente lo mismo) y la hora de verdad se coloca encima con posición absoluta.
 *
 * Estados: «enviando» (reloj), enviado, entregado, leído, «No enviado · Reintentar» (burbuja roja), y mensaje retirado
 * por moderación (línea gris sin texto). En el modo «elegir mensaje que denunciar» las recibidas se enmarcan.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import type { MessageEntry } from "../model/chat";
import { messagesStrings } from "../strings";
import { DeliveryMark } from "./DeliveryMark";

const copy = messagesStrings.chat;

/** Ancho máximo de una burbuja (pt): con él las líneas parten como en la lámina. */
export const BUBBLE_MAX_WIDTH = 252;
/** Foto de quien escribe (pt). */
export const BUBBLE_AVATAR = 50;
/** Sangrías de la fila (pt): la foto empieza a 14 pt del borde y la burbuja a 72,5 pt; una enviada acaba a 13 pt del borde derecho. */
export const BUBBLE_LEFT = 14;
export const BUBBLE_GAP = 8.5;
export const BUBBLE_RIGHT_INSET = 13;

export interface MessageBubbleProps {
  entry: MessageEntry;
  /** Foto de quien escribe (solo recibidos). `null` reserva el hueco sin dibujar nada (grupos). */
  avatar?: React.ReactNode | null;
  /** Modo «toca el mensaje que quieres denunciar»: las recibidas se enmarcan y al tocarlas se eligen. */
  selecting?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onRetry?: () => void;
  testID?: string;
}

export const MessageBubble = React.memo(function MessageBubble({
  entry,
  avatar,
  selecting = false,
  onPress,
  onLongPress,
  onRetry,
  testID,
}: MessageBubbleProps): React.JSX.Element {
  const outgoing = entry.side === "outgoing";
  const failed = entry.status === "failed";
  const hidden = entry.hidden;
  const reportable = selecting && !outgoing && !hidden;
  const ink = outgoing ? "inverse" : "strong";

  const who = outgoing ? copy.youSaid : entry.senderName;
  const label = hidden
    ? `${who}: ${copy.hiddenMessage}, ${entry.time}`
    : `${who}: ${entry.text}, ${entry.time}${entry.status !== null ? `, ${copy.delivery[entry.status]}` : ""}`;

  const reserve = `\u00A0\u00A0${entry.time}${outgoing ? "\u00A0".repeat(6) : ""}`;

  const bubble = (
    <View
      style={[
        styles.bubble,
        outgoing ? styles.bubbleOut : styles.bubbleIn,
        failed ? styles.bubbleFailed : null,
        hidden ? styles.bubbleHidden : null,
        reportable ? styles.bubbleSelectable : null,
      ]}
    >
      {hidden ? (
        <View style={styles.hiddenRow}>
          <Icon name="eyeOff" size={20} color={colors.text.muted} />
          <Text variant="body" color="muted" size={16.5} lineHeight={21} style={styles.hiddenText}>
            {copy.hiddenMessage}
          </Text>
        </View>
      ) : (
        <Text variant="body" color={ink} size={17.5} lineHeight={22.5}>
          {entry.text}
          <Text variant="rowText" size={15} lineHeight={22.5} color="transparent">
            {reserve}
          </Text>
        </Text>
      )}
      {!hidden ? (
        <View style={styles.meta} pointerEvents="none">
          <Text variant="rowText" color={outgoing ? "inverse" : colors.text.time} size={15} lineHeight={18} style={outgoing ? styles.timeOut : null}>
            {entry.time}
          </Text>
          {outgoing && entry.status !== null ? (
            <View style={styles.mark}>
              <DeliveryMark status={entry.status} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const interactive = onPress !== undefined || onLongPress !== undefined;

  return (
    <View style={[styles.line, outgoing ? styles.lineOut : styles.lineIn]}>
      {!outgoing && avatar !== undefined ? <View style={styles.avatar}>{avatar}</View> : null}
      <View style={styles.column}>
        {interactive ? (
          <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={reportable ? copy.selectToReport : undefined}
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={350}
            style={({ pressed }) => [pressed ? styles.pressed : null]}
          >
            {bubble}
          </Pressable>
        ) : (
          <View testID={testID} accessible accessibilityLabel={label}>
            {bubble}
          </View>
        )}
        {failed && onRetry !== undefined ? (
          <Pressable
            testID={testID !== undefined ? `${testID}.retry` : undefined}
            accessibilityRole="button"
            accessibilityLabel={copy.retryA11y}
            onPress={onRetry}
            hitSlop={8}
            style={styles.retry}
          >
            <Text variant="rowTextStrong" color="error" underline size={15}>
              {`No enviado · ${messagesStrings.common.retry}`}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "flex-start" },
  lineIn: { justifyContent: "flex-start", paddingLeft: BUBBLE_LEFT, paddingRight: 57 },
  lineOut: { justifyContent: "flex-end", paddingLeft: 60, paddingRight: BUBBLE_RIGHT_INSET },
  avatar: { width: BUBBLE_AVATAR, marginRight: BUBBLE_GAP },
  column: { flexShrink: 1, maxWidth: BUBBLE_MAX_WIDTH },
  bubble: { borderRadius: 20, paddingTop: 9, paddingBottom: 10, paddingLeft: 13.5, paddingRight: 12 },
  bubbleIn: { backgroundColor: colors.bg.bubble },
  bubbleOut: { backgroundColor: colors.primary },
  bubbleFailed: { backgroundColor: colors.error.solid },
  bubbleHidden: { backgroundColor: colors.bg.gray, borderWidth: 1, borderColor: colors.border.divider },
  bubbleSelectable: { borderWidth: 2, borderColor: colors.primary, paddingTop: 7, paddingBottom: 8, paddingLeft: 11.5, paddingRight: 10 },
  pressed: { opacity: 0.85 },
  meta: { position: "absolute", right: 12, bottom: 9, flexDirection: "row", alignItems: "center" },
  timeOut: { opacity: 0.95 },
  mark: { marginLeft: 6 },
  hiddenRow: { flexDirection: "row", alignItems: "center" },
  hiddenText: { flexShrink: 1, marginLeft: 8 },
  retry: { alignSelf: "flex-end", marginTop: 4, minHeight: 28, justifyContent: "center" },
});
