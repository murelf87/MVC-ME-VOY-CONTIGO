import React, { useCallback, useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { SupportTicketDetail } from "@/api/types";
import { useIsOnline } from "@/hooks";
import { Icon } from "@/icons";
import { requireAccount, type AppScreenProps } from "@/navigation";
import { useAuth } from "@/session";
import { colors } from "@/theme";
import { Screen, ScreenHeader, Text, showToast } from "@/ui";
import { HelpIntroCard, InfoCard } from "../components/HelpCards";
import { GuestNotice, ListSkeleton, LoadError, OfflineNotice } from "../components/StateCards";
import { TicketForm } from "../components/TicketForm";
import { TicketRow } from "../components/TicketRow";
import { useSupportTickets } from "../hooks/useSupport";
import { useTicketForm } from "../hooks/useTicketForm";
import { helpStrings } from "../strings";

const RECENT_COUNT = 3;

/**
 * Lámina 36b (y 35a, su primera versión): «Centro de ayuda». Elegir el tipo de consulta, un viaje opcional, escribir hasta
 * 500 caracteres, adjuntar imágenes y enviar. Debajo, «Si es urgente», las últimas consultas y accesos a más ayuda.
 */
export function HelpCenterScreen({ navigation, route }: AppScreenProps<"HelpCenter">): React.JSX.Element {
  const params = route.params;
  const auth = useAuth();
  const signedIn = auth.status === "signedIn";
  const online = useIsOnline();
  const form = useTicketForm({ category: params?.category, tripId: params?.tripId }, signedIn);
  const tickets = useSupportTickets("all", signedIn);
  const redirectTicketId = signedIn ? params?.ticketId : undefined;

  // Un aviso de «respuesta del equipo» abre el Centro de ayuda con el id de la consulta: se va directo al hilo.
  useEffect(() => {
    if (redirectTicketId !== undefined) navigation.replace("SupportTicketDetail", { ticketId: redirectTicketId });
  }, [navigation, redirectTicketId]);

  const openSent = useCallback(
    (ticket: SupportTicketDetail) => {
      showToast({ message: helpStrings.help.sentTitle, kind: "success", durationMs: 2000 });
      navigation.navigate("SupportTicketDetail", { ticketId: ticket.id, sent: true });
    },
    [navigation],
  );

  const refresh = useCallback(() => {
    void tickets.refresh();
    void form.trips.refetch();
  }, [tickets, form.trips]);

  const recent = tickets.items.slice(0, RECENT_COUNT);

  return (
    <Screen
      testID="HelpCenter"
      paddingX={18.5}
      header={<ScreenHeader title={helpStrings.help.title} testID="HelpCenter.header" />}
      refreshing={signedIn && tickets.isRefreshing}
      onRefresh={signedIn ? refresh : undefined}
      contentContainerStyle={styles.content}
    >
      {!online ? (
        <View style={styles.notice}>
          <OfflineNotice testID="HelpCenter.offline" />
        </View>
      ) : null}

      <HelpIntroCard testID="HelpCenter.intro" />

      <View style={styles.afterIntro}>
        {signedIn ? (
          <TicketForm form={form} onSubmitted={openSent} testID="HelpCenter.form" />
        ) : (
          <GuestNotice
            testID="HelpCenter.guest"
            message={helpStrings.help.guestMessage}
            onSignIn={() => {
              requireAccount({ name: "HelpCenter", ...(params !== undefined ? { params } : null) });
            }}
          />
        )}
      </View>

      <InfoCard testID="HelpCenter.urgent" title={helpStrings.help.urgentTitle} message={helpStrings.help.urgentMessage} style={styles.urgent} />

      {signedIn ? (
        <View style={styles.section} testID="HelpCenter.history">
          <View style={styles.sectionHeader}>
            <Text variant="heading" color="heading" size={20} lineHeight={25} accessibilityRole="header" style={styles.sectionTitle}>
              {helpStrings.help.historyTitle}
            </Text>
            {tickets.items.length > 0 ? (
              <Pressable
                testID="HelpCenter.history.all"
                accessibilityRole="button"
                accessibilityLabel={helpStrings.help.historyAll}
                hitSlop={8}
                onPress={() => navigation.navigate("SupportTickets")}
                style={styles.seeAll}
              >
                <Text variant="rowTextStrong" color="link" underline size={16}>
                  {helpStrings.help.historyAll}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {tickets.isLoading && tickets.items.length === 0 ? <ListSkeleton count={2} testID="HelpCenter.history.skeleton" /> : null}
          {tickets.items.length === 0 && (tickets.isError || tickets.isOffline) ? (
            <LoadError
              testID="HelpCenter.history.error"
              offline={tickets.isOffline}
              title={helpStrings.help.historyError}
              onRetry={() => void tickets.refresh()}
            />
          ) : null}
          {tickets.isEmpty ? (
            <Text variant="body" color="muted" style={styles.empty} testID="HelpCenter.history.empty">
              {helpStrings.help.historyEmpty}
            </Text>
          ) : null}
          {recent.map((ticket) => (
            <View key={ticket.id} style={styles.ticket}>
              <TicketRow
                testID={`HelpCenter.ticket.${ticket.id}`}
                ticket={ticket}
                onPress={() => navigation.navigate("SupportTicketDetail", { ticketId: ticket.id })}
              />
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text variant="heading" color="heading" size={20} lineHeight={25} accessibilityRole="header" style={styles.sectionTitle}>
          {helpStrings.help.moreHelpTitle}
        </Text>
        <MoreHelpRow
          testID="HelpCenter.more.status"
          icon="signal"
          title={helpStrings.help.moreHelpStatus}
          subtitle={helpStrings.help.moreHelpStatusSubtitle}
          onPress={() => navigation.navigate("ServiceStatus")}
        />
        <MoreHelpRow
          testID="HelpCenter.more.legal"
          icon="documentOutline"
          title={helpStrings.help.moreHelpLegal}
          subtitle={helpStrings.help.moreHelpLegalSubtitle}
          onPress={() => navigation.navigate("LegalCenter")}
        />
      </View>
    </Screen>
  );
}

function MoreHelpRow({
  icon,
  title,
  subtitle,
  onPress,
  testID,
}: {
  icon: "signal" | "documentOutline";
  title: string;
  subtitle: string;
  onPress: () => void;
  testID: string;
}): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => [styles.more, { backgroundColor: pressed ? colors.bg.tintPressed : colors.bg.tint }]}
    >
      <View style={styles.moreIcon}>
        <Icon name={icon} size={28} color={colors.text.link} />
      </View>
      <View style={styles.moreText}>
        <Text variant="rowTitle" color="heading" size={18} lineHeight={23}>
          {title}
        </Text>
        <Text variant="body" color="muted" size={15.5} lineHeight={20}>
          {subtitle}
        </Text>
      </View>
      <Icon name="chevronRight" size={26} color={colors.heading} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 3.5, paddingBottom: 32 },
  notice: { marginBottom: 10 },
  afterIntro: { marginTop: 11.5 },
  urgent: { marginTop: 9 },
  section: { marginTop: 26 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { flexShrink: 1 },
  seeAll: { minHeight: 44, justifyContent: "center", paddingLeft: 12 },
  empty: { marginTop: 8 },
  ticket: { marginTop: 8 },
  more: { minHeight: 68, flexDirection: "row", alignItems: "center", borderRadius: 14, paddingVertical: 10, paddingLeft: 14, paddingRight: 8, marginTop: 8 },
  moreIcon: { width: 40, alignItems: "center", justifyContent: "center" },
  moreText: { flex: 1, marginLeft: 12 },
});
