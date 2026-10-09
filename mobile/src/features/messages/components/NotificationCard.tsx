/**
 * Tarjeta de aviso de la lámina 27: disco con icono de 64 pt a la izquierda, título azul marino en negrita, texto de dos o
 * tres líneas, hora a la derecha (arriba) y chevron si el aviso lleva a otra pantalla. Los no leídos llevan un punto azul
 * junto a la hora y el texto accesible empieza por «Sin leer».
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { AppNotification } from "@/api/types";
import { formatInboxStamp } from "@/i18n";
import { Icon } from "@/icons";
import { IconTile } from "@/icons/IconTile";
import { colors, hexAlpha } from "@/theme";
import { Text } from "@/ui";
import { lookOf } from "../model/notifications";
import { messagesStrings } from "../strings";

export interface NotificationCardProps {
  notification: AppNotification;
  now: number;
  hasTarget: boolean;
  onPress: (notification: AppNotification) => void;
}

export const NotificationCard = React.memo(function NotificationCard({ notification, now, hasTarget, onPress }: NotificationCardProps): React.JSX.Element {
  const look = lookOf(notification);
  const stamp = formatInboxStamp(notification.createdAt, now);
  const unread = !notification.read;
  return (
    <Pressable
      testID={`Notifications.item.${notification.id}`}
      accessibilityRole={hasTarget ? "button" : "text"}
      accessibilityLabel={messagesStrings.notifications.openA11y(notification.title, notification.body, stamp, unread)}
      onPress={() => onPress(notification)}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <IconTile name={look.icon} tone={look.tone} size={54} iconSize={28} />
      <View style={styles.text}>
        <Text variant="titleSm" color="heading" size={17.5} lineHeight={21} style={styles.title}>
          {notification.title}
        </Text>
        <Text variant="body" color="body" size={16} lineHeight={20} style={styles.body}>
          {notification.body}
        </Text>
      </View>
      <View style={styles.meta}>
        <View style={styles.stampRow}>
          {unread ? <View testID={`Notifications.unread.${notification.id}`} style={styles.dot} aria-hidden /> : null}
          <Text variant="rowText" color="subtle" size={16} lineHeight={20}>
            {stamp}
          </Text>
        </View>
        {hasTarget ? <Icon name="chevronRight" size={20} color={colors.primary} style={styles.chevron} /> : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 12, paddingLeft: 12, paddingRight: 12, borderRadius: 16, backgroundColor: colors.bg.tint, borderWidth: 1, borderColor: hexAlpha(colors.shadow, 0.04) },
  pressed: { opacity: 0.88 },
  text: { flex: 1, minWidth: 0 },
  title: { flexShrink: 1 },
  body: { marginTop: 2 },
  meta: { alignItems: "flex-end", minWidth: 40 },
  stampRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  chevron: { marginTop: 12 },
});
