/**
 * Fila de la bandeja (lámina 25): foto de 82 pt (o disco de grupo), nombre, subtítulo azul, vista previa de dos líneas,
 * hora a la derecha y, si hay mensajes sin leer, insignia roja de 29,5 pt.
 *
 * Medidas de la lámina (pt): tarjeta de 387 pt de ancho con un contorno casi invisible, foto de 82 pt a 13,5 pt del borde
 * izquierdo, texto a 17 pt de la foto, hora alineada con el nombre y la insignia 39 pt por debajo de ella.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ConversationSummary } from "@/api/types";
import { Icon } from "@/icons";
import { colors, hexAlpha } from "@/theme";
import { Avatar, Text } from "@/ui";
import { a11yLabelOf, badgeText, hasUnread, previewOf, rowStamp } from "../model/inbox";

export interface ConversationRowProps {
  conversation: ConversationSummary;
  /** «Ahora» para la hora de la fila («07:12», «Ayer», «16 may»). */
  now: number;
  onPress: (conversation: ConversationSummary) => void;
  testID?: string;
}

const AVATAR = 82;
const GROUP_TILE = 70;

export const ConversationRow = React.memo(function ConversationRow({ conversation, now, onPress, testID }: ConversationRowProps): React.JSX.Element {
  const unread = hasUnread(conversation);
  const isGroup = conversation.kind === "group";
  return (
    <Pressable
      testID={testID ?? `Inbox.row.${conversation.id}`}
      accessibilityRole="button"
      accessibilityLabel={a11yLabelOf(conversation, now)}
      onPress={() => onPress(conversation)}
      style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
    >
      <View style={styles.leading}>
        {isGroup ? (
          <View style={styles.groupTile} aria-hidden>
            <Icon name="people" size={40} color={colors.primary} />
          </View>
        ) : (
          <Avatar size={AVATAR} source={conversation.peer?.photoUrl ?? null} name={conversation.peer?.displayName ?? conversation.title} />
        )}
      </View>

      <View style={styles.text}>
        <Text variant="titleSm" color="heading" size={23} lineHeight={26} numberOfLines={1}>
          {conversation.title}
        </Text>
        {conversation.subtitle !== null ? (
          <Text variant="subtitle" color={unread ? "link" : "muted"} size={19} lineHeight={22} numberOfLines={1} style={styles.subtitle}>
            {conversation.subtitle}
          </Text>
        ) : null}
        <Text variant="body" color="body" size={19.5} lineHeight={24} numberOfLines={2} style={conversation.subtitle !== null ? styles.preview : styles.previewGroup}>
          {previewOf(conversation)}
        </Text>
      </View>

      <View style={styles.meta}>
        <Text variant="rowText" color="subtle" size={18} lineHeight={22} numberOfLines={1} style={styles.stamp}>
          {rowStamp(conversation, now)}
        </Text>
        {unread ? (
          <View
            testID={`Inbox.badge.${conversation.id}`}
            style={styles.badge}
            aria-hidden
          >
            <Text variant="rowTextStrong" color="inverse" weight="bold" size={19} lineHeight={22} letterSpacing={0}>
              {badgeText(conversation.unreadCount)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    minHeight: 112,
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 1,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 13,
    paddingRight: 17,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: hexAlpha(colors.shadow, 0.05),
    backgroundColor: colors.bg.screen,
  },
  cardPressed: { backgroundColor: colors.bg.tintSoft },
  leading: { width: AVATAR, height: AVATAR, alignItems: "center", justifyContent: "center" },
  groupTile: {
    width: GROUP_TILE,
    height: GROUP_TILE,
    borderRadius: GROUP_TILE / 2,
    backgroundColor: colors.tile.blue,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, marginLeft: 17, marginTop: 4, marginRight: 8 },
  subtitle: { marginTop: 0 },
  preview: { marginTop: 8 },
  previewGroup: { marginTop: 3 },
  meta: { width: 62, alignItems: "flex-end", marginTop: 5 },
  stamp: { marginRight: 3 },
  badge: {
    marginTop: 12,
    marginRight: -3,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.error.solid,
    alignItems: "center",
    justifyContent: "center",
  },
});
