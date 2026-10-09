/**
 * Mensaje de ubicación compartida (lámina 26): tarjeta azul clara con la miniatura, las líneas del lugar («Aparcamiento
 * P1 / Isla Mágica / Sevilla»), un chevron y la hora con sus ticks. Al tocarla se abre el punto en la app de mapas.
 *
 * Medidas de la lámina (pt): tarjeta de 308,5 de ancho (acaba a 12 pt del borde derecho), miniatura de 120 × 88 a 10 pt del
 * borde, texto a 16,5 pt de la miniatura y hora en la esquina inferior derecha.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import { locationLines, type MessageEntry } from "../model/chat";
import { messagesStrings } from "../strings";
import { BUBBLE_AVATAR, BUBBLE_GAP, BUBBLE_LEFT } from "./MessageBubble";
import { DeliveryMark } from "./DeliveryMark";
import { MapThumbnail } from "./MapThumbnail";

const copy = messagesStrings.chat;

export interface LocationMessageCardProps {
  entry: MessageEntry;
  /** Foto de quien comparte (solo recibidos). `null` reserva el hueco sin dibujar. */
  avatar?: React.ReactNode | null;
  selecting?: boolean;
  onOpen: (entry: MessageEntry) => void;
  onLongPress?: () => void;
  onRetry?: () => void;
  testID?: string;
}

export const LocationMessageCard = React.memo(function LocationMessageCard({
  entry,
  avatar,
  selecting = false,
  onOpen,
  onLongPress,
  onRetry,
  testID,
}: LocationMessageCardProps): React.JSX.Element {
  const outgoing = entry.side === "outgoing";
  const { title, lines } = locationLines(entry.location?.label ?? (entry.text !== "" ? entry.text : null), copy.sharedLocation);
  const who = outgoing ? copy.youSaid : entry.senderName;
  const failed = entry.status === "failed";
  const label = [
    `${who}: ${copy.sharedLocation}`,
    title,
    ...lines,
    entry.time,
    entry.status !== null ? copy.delivery[entry.status] : null,
    copy.openMap,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");
  const reportable = selecting && !outgoing && !entry.hidden;

  return (
    <View style={[styles.line, outgoing ? styles.lineOut : styles.lineIn]}>
      {!outgoing && avatar !== undefined ? <View style={styles.avatar}>{avatar}</View> : null}
      <View style={styles.column}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={reportable ? copy.selectToReport : undefined}
          onPress={() => onOpen(entry)}
          onLongPress={onLongPress}
          delayLongPress={350}
          style={({ pressed }) => [styles.card, failed ? styles.cardFailed : null, reportable ? styles.cardSelectable : null, pressed ? styles.pressed : null]}
        >
          <View style={styles.row}>
            <MapThumbnail />
            <View style={styles.text}>
              <Text variant="rowTitle" color="heading" size={18} lineHeight={22} numberOfLines={1}>
                {title}
              </Text>
              {lines.slice(0, 2).map((line) => (
                <Text key={line} variant="rowTitle" color="heading" size={18} lineHeight={22} numberOfLines={1}>
                  {line}
                </Text>
              ))}
            </View>
            <Icon name="chevronRight" size={24} color={colors.primary} style={styles.chevron} />
          </View>
          <View style={styles.meta}>
            <Text variant="rowText" color={colors.text.time} size={15} lineHeight={18}>
              {entry.time}
            </Text>
            {outgoing && entry.status !== null ? (
              <View style={styles.mark}>
                <DeliveryMark status={entry.status} tone="onCard" />
              </View>
            ) : null}
          </View>
        </Pressable>
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
  lineIn: { justifyContent: "flex-start", paddingLeft: BUBBLE_LEFT, paddingRight: 12 },
  lineOut: { justifyContent: "flex-end", paddingLeft: 12, paddingRight: 12 },
  avatar: { width: BUBBLE_AVATAR, marginRight: BUBBLE_GAP },
  column: { flexShrink: 1, width: 308.5, maxWidth: "100%" },
  card: { backgroundColor: colors.bg.tint, borderRadius: 20, paddingTop: 9, paddingBottom: 6, paddingLeft: 10, paddingRight: 13.5 },
  cardFailed: { borderWidth: 1.5, borderColor: colors.error.solid },
  cardSelectable: { borderWidth: 2, borderColor: colors.primary },
  pressed: { backgroundColor: colors.bg.tintPressed },
  row: { flexDirection: "row", alignItems: "center" },
  text: { flex: 1, marginLeft: 16.5, marginRight: 6 },
  chevron: { marginRight: 6 },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 4 },
  mark: { marginLeft: 6 },
  retry: { alignSelf: "flex-end", marginTop: 4, minHeight: 28, justifyContent: "center" },
});
