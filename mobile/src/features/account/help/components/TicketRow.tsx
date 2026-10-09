import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { SupportTicketSummary } from "@/api/types";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { StatusPill, Text } from "@/ui";
import { ticketLastActivity, ticketStatusTone } from "../logic/support";
import { helpStrings } from "../strings";

export interface TicketRowProps {
  ticket: SupportTicketSummary;
  onPress: () => void;
  testID?: string;
}

/** Fila de una consulta: tipo, estado, extracto del mensaje, referencia, última actividad y adjuntos. */
export function TicketRow({ ticket, onPress, testID }: TicketRowProps): React.JSX.Element {
  const category = helpStrings.help.categories[ticket.category];
  const status = helpStrings.tickets.status[ticket.status];
  const activity = ticketLastActivity(ticket);
  const a11y = [category, status, ticket.bodyPreview, helpStrings.tickets.reference(ticket.reference), activity].join(". ");
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.bg.tintSoft : colors.bg.white }]}
    >
      <View style={styles.main}>
        <View style={styles.top}>
          <Text variant="rowTitle" color="heading" size={17.5} lineHeight={22} numberOfLines={1} style={styles.category}>
            {category}
          </Text>
          <StatusPill label={status} tone={ticketStatusTone(ticket.status)} size="sm" />
        </View>
        <Text variant="body" color="muted" size={16} lineHeight={21} numberOfLines={2} style={styles.preview}>
          {ticket.bodyPreview}
        </Text>
        <View style={styles.meta}>
          <Text variant="rowText" color="subtle" numberOfLines={1} style={styles.metaText}>
            {`${ticket.reference} · ${activity}`}
          </Text>
          {ticket.attachmentCount > 0 ? (
            <View style={styles.attach} aria-hidden>
              <Icon name="image" size={16} color={colors.text.subtle} />
              <Text variant="rowText" color="subtle" style={styles.attachText}>
                {ticket.attachmentCount}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <Icon name="chevronRight" size={22} color={colors.heading} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 8,
    minHeight: 88,
  },
  main: { flex: 1, marginRight: 6 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  category: { flex: 1, marginRight: 8 },
  preview: { marginTop: 3 },
  meta: { flexDirection: "row", alignItems: "center", marginTop: 5 },
  metaText: { flex: 1 },
  attach: { flexDirection: "row", alignItems: "center", marginLeft: 8 },
  attachText: { marginLeft: 3 },
});
