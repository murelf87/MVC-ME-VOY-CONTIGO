/**
 * Mis consultas: historial de consultas al equipo de MVC con filtro por estado (todas · abiertas · respondidas · cerradas),
 * «Ver más consultas» (paginado por cursor) y el acceso a «Nueva consulta». Estados: cargando · error · sin conexión · vacío
 * (con y sin filtro). Cada fila abre el hilo.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useIsOnline } from "@/hooks";
import { requireAccount, type AppScreenProps } from "@/navigation";
import { useAuth } from "@/session";
import { colors } from "@/theme";
import { Button, EmptyState, Screen, ScreenHeader, Text } from "@/ui";
import { GuestNotice, ListSkeleton, LoadError, OfflineNotice } from "../components/StateCards";
import { TicketRow } from "../components/TicketRow";
import { useSupportTickets } from "../hooks/useSupport";
import { TICKET_FILTERS, ticketFilterLabel, type TicketFilter } from "../logic/support";
import { helpStrings } from "../strings";

const copy = helpStrings.tickets;

export function SupportTicketsScreen({ navigation }: AppScreenProps<"SupportTickets">): React.JSX.Element {
  const auth = useAuth();
  const signedIn = auth.status === "signedIn";
  const online = useIsOnline();
  const [filter, setFilter] = useState<TicketFilter>("all");
  const tickets = useSupportTickets(filter, signedIn);
  const header = <ScreenHeader title={copy.listTitle} testID="SupportTickets.header" />;

  if (!signedIn) {
    return (
      <Screen testID="SupportTickets" header={header}>
        <GuestNotice testID="SupportTickets.guest" message={helpStrings.help.guestMessage} onSignIn={() => requireAccount({ name: "SupportTickets" })} />
      </Screen>
    );
  }

  return (
    <Screen testID="SupportTickets" header={header} refreshing={tickets.isRefreshing} onRefresh={() => void tickets.refresh()}>
      {!online ? <View style={styles.gap}><OfflineNotice testID="SupportTickets.offline" /></View> : null}
      <View style={styles.filters} accessibilityLabel={copy.filterA11y} accessibilityRole="tablist">
        {TICKET_FILTERS.map((item) => (
          <Pressable
            key={item}
            testID={`SupportTickets.filter.${item}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === item }}
            onPress={() => setFilter(item)}
            style={[styles.pill, filter === item ? styles.pillOn : null]}
          >
            <Text variant="rowTextStrong" size={15.5} color={filter === item ? "inverse" : "link"}>{ticketFilterLabel(item)}</Text>
          </Pressable>
        ))}
      </View>

      {tickets.isLoading && tickets.items.length === 0 ? <ListSkeleton count={3} testID="SupportTickets.skeleton" /> : null}
      {tickets.items.length === 0 && (tickets.isError || tickets.isOffline) ? (
        <LoadError testID="SupportTickets.error" offline={tickets.isOffline} title={copy.loadErrorTitle} onRetry={() => void tickets.refresh()} />
      ) : null}
      {tickets.isEmpty ? (
        <EmptyState
          testID="SupportTickets.empty"
          icon="chat"
          title={filter === "all" ? copy.emptyTitle : copy.emptyFilteredTitle}
          message={filter === "all" ? copy.emptyMessage : copy.emptyFilteredMessage}
          actionLabel={filter === "all" ? copy.newAction : undefined}
          onAction={filter === "all" ? () => navigation.navigate("SupportNewTicket") : undefined}
          variant="plain"
        />
      ) : null}

      {tickets.items.map((ticket) => (
        <View key={ticket.id} style={styles.row}>
          <TicketRow testID={`SupportTickets.ticket.${ticket.id}`} ticket={ticket} onPress={() => navigation.navigate("SupportTicketDetail", { ticketId: ticket.id })} />
        </View>
      ))}

      {tickets.hasMore ? (
        <Button testID="SupportTickets.more" label={copy.loadMore} variant="outline" chevron={false} loading={tickets.isFetchingMore} onPress={() => void tickets.fetchMore()} style={styles.more} />
      ) : null}
      {tickets.items.length > 0 ? <Button testID="SupportTickets.new" label={copy.newAction} chevron={false} onPress={() => navigation.navigate("SupportNewTicket")} style={styles.more} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { marginBottom: 10 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pill: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.primary, justifyContent: "center", backgroundColor: "#FFFFFF" },
  pillOn: { backgroundColor: colors.primary },
  row: { marginTop: 8 },
  more: { marginTop: 16 },
});
