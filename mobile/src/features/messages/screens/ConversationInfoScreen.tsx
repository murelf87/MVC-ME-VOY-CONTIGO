/**
 * Información del chat (sin lámina; se diseña con la 26 al lado). Chat directo: la persona, el viaje, la reserva
 * (plazas, aporte, recogida) y las acciones (ver reserva o viaje, cancelar, denunciar, bloquear). Grupo de ruta: los
 * miembros actuales. Privacidad: solo nombres de pila; el teléfono nunca se muestra aquí.
 * Estados: cargando · chat cerrado/bloqueado/inexistente · error · contenido.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import { formatDateTime, formatMoney, formatTime } from "@/i18n";
import type { AppScreenProps } from "@/navigation/types";
import { Avatar, Banner, Button, Card, ConfirmDialog, ErrorStateCard, KeyValueRow, ListRow, Screen, ScreenHeader, Skeleton, StatusPill, Text, showToast } from "@/ui";
import { useBlockActions } from "../hooks/useBlockActions";
import { useConversation } from "../hooks/useConversation";
import { nameWithRole, peerRoleOf } from "../model/people";
import { messagesStrings } from "../strings";

const copy = messagesStrings.info;
const chatCopy = messagesStrings.chat;
const SIDE = 14;

export function ConversationInfoScreen({ navigation, route }: AppScreenProps<"ConversationInfo">): React.JSX.Element {
  const { conversationId } = route.params;
  const conversation = useConversation(conversationId);
  const blocks = useBlockActions();
  const [blockOpen, setBlockOpen] = React.useState(false);
  const header = <ScreenHeader title={copy.title} testID="ConversationInfo.header" />;
  const detail = conversation.detail;

  if (detail === undefined) {
    const refused = conversation.access !== "ok";
    return (
      <Screen testID="ConversationInfo" paddingX={SIDE} header={header}>
        <View style={styles.block}>
          {refused ? (
            <>
              <Banner testID="ConversationInfo.refused" kind="warning" title={conversation.access === "blocked" ? chatCopy.blockedTitle : conversation.access === "closed" ? messagesStrings.chat.closedTitle : messagesStrings.chat.notFoundTitle} message={conversation.access === "blocked" ? chatCopy.blockedMessage : undefined} />
              {conversation.access === "blocked" ? <Button testID="ConversationInfo.seeBlocked" label={chatCopy.blockedAction} variant="outline" onPress={() => navigation.navigate("BlockedUsers")} style={styles.gap} /> : null}
            </>
          ) : conversation.loadError ? (
            <ErrorStateCard testID="ConversationInfo.error" tone="red" icon="alertCircle" title={copy.loadError} message={conversation.loadError.message} actionLabel={messagesStrings.common.retry} onAction={() => void conversation.query.refetch()} />
          ) : (
            <View testID="ConversationInfo.loading" accessible accessibilityLabel={messagesStrings.common.updating} accessibilityState={{ busy: true }}>
              <Skeleton height={90} radius={16} />
              <Skeleton height={170} radius={16} style={styles.gap} />
              <Skeleton height={130} radius={16} style={styles.gap} />
            </View>
          )}
        </View>
      </Screen>
    );
  }

  const peer = detail.peer;
  const trip = detail.trip;
  const booking = detail.booking;
  const peerName = peer?.firstName ?? "";
  const isGroup = detail.kind === "group";
  const canCancel = detail.myRole === "passenger" && booking !== null && booking.status === "confirmed" && trip !== null && trip.status !== "active" && trip.status !== "completed" && trip.status !== "cancelled";

  const confirmBlock = async (): Promise<void> => {
    if (peer === null) return;
    try {
      await blocks.block.mutateAsync(peer.id);
      setBlockOpen(false);
      showToast({ kind: "success", message: chatCopy.blockedToast(peerName) });
      navigation.navigate("Inbox");
    } catch {
      setBlockOpen(false);
      showToast({ kind: "error", message: chatCopy.blockFailed });
    }
  };

  return (
    <Screen testID="ConversationInfo" paddingX={SIDE} header={header} refreshing={conversation.query.isRefreshing} onRefresh={() => void conversation.query.refetch()}>
      <View style={styles.block}>
        {peer !== null ? (
          <>
            <Text variant="titleSm" color="heading" size={19}>{copy.peerSection}</Text>
            <Card tone="blue" padding={12} style={styles.gap} testID="ConversationInfo.peer">
              <View style={styles.peerRow}>
                <Avatar source={peer.photoUrl} name={peer.displayName} size={60} />
                <View style={styles.flex}>
                  <Text variant="titleSm" color="heading" size={18}>{peer.displayName}</Text>
                  <Text variant="body" color="deep" size={15.5}>{nameWithRole(peerName, peerRoleOf(detail.myRole))}</Text>
                  {detail.subtitle !== null ? <Text variant="body" color="muted" size={14.5}>{detail.subtitle}</Text> : null}
                </View>
              </View>
            </Card>
          </>
        ) : null}

        {isGroup ? (
          <>
            <Text variant="titleSm" color="heading" size={19} style={styles.section}>{copy.membersSection(detail.members?.length ?? detail.memberCount ?? 0)}</Text>
            {detail.routeLabel !== null ? <Text variant="body" color="body" size={16} style={styles.gap} testID="ConversationInfo.route">{detail.routeLabel}</Text> : null}
            <View testID="ConversationInfo.members">
              {(detail.members ?? []).map((m) => (
                <ListRow key={m.user.id} testID={`ConversationInfo.member.${m.user.id}`} title={m.user.displayName} subtitle={m.role === "driver" ? copy.driver : copy.passenger} titleSize={17} leading={<Avatar source={m.user.photoUrl} name={m.user.displayName} size={44} />} style={styles.gap} />
              ))}
            </View>
          </>
        ) : null}

        {trip !== null ? (
          <>
            <Text variant="titleSm" color="heading" size={19} style={styles.section}>{copy.tripSection}</Text>
            <View style={styles.rows} testID="ConversationInfo.trip">
              <KeyValueRow label={copy.route} value={`${trip.originLabel ?? "—"} → ${trip.destinationLabel ?? "—"}`} />
              {trip.departureAt !== null ? <KeyValueRow label={copy.departure} value={formatDateTime(trip.departureAt)} /> : null}
              {trip.arrivalEstimateAt !== null ? <KeyValueRow label={copy.arrival} value={formatTime(trip.arrivalEstimateAt)} /> : null}
              <KeyValueRow label={copy.tripStatus} value={copy.tripStatusLabels[trip.status]} />
            </View>
          </>
        ) : null}

        {booking !== null ? (
          <>
            <View style={styles.sectionRow}>
              <Text variant="titleSm" color="heading" size={19}>{copy.bookingSection}</Text>
              <StatusPill size="sm" tone={booking.status === "confirmed" ? "green" : "gray"} label={copy.bookingStatusLabels[booking.status]} />
            </View>
            <View style={styles.rows} testID="ConversationInfo.booking">
              <KeyValueRow label={copy.seats} value={String(booking.seats)} />
              <KeyValueRow label={copy.contribution} value={detail.contribution === null || detail.contribution.cents === null ? messagesStrings.cancel.pendingValue : formatMoney(detail.contribution)} />
              {detail.pickupPoint?.label ? <KeyValueRow label={copy.pickup} value={detail.pickupPoint.label} /> : null}
            </View>
          </>
        ) : null}

        <Card tone="white" padding={14} style={styles.sectionCard} testID="ConversationInfo.privacy">
          <Text variant="titleSm" color="heading" size={16.5}>{copy.privacyTitle}</Text>
          <Text variant="body" color="body" size={15} lineHeight={21} style={styles.tiny}>{copy.privacyBody}</Text>
        </Card>

        <View style={styles.actions}>
          {booking !== null ? <Button testID="ConversationInfo.seeBooking" label={detail.myRole === "driver" ? copy.seeTrip : copy.seeBooking} onPress={() => (detail.myRole === "driver" && trip !== null ? navigation.navigate("TripDetail", { tripId: trip.id }) : navigation.navigate("BookingDetail", { bookingId: booking.id }))} /> : null}
          {isGroup && trip !== null ? <Button testID="ConversationInfo.seeTrip" label={copy.seeTrip} onPress={() => navigation.navigate("TripDetail", { tripId: trip.id })} /> : null}
          {canCancel && booking !== null ? <Button testID="ConversationInfo.cancel" label={copy.cancelBooking} variant="outline" leadingIcon="trash" onPress={() => navigation.navigate("CancelBooking", { bookingId: booking.id })} style={styles.gap} /> : null}
          {peer !== null ? (
            <>
              <Button testID="ConversationInfo.report" label={copy.reportPerson(peerName)} variant="outline" chevron={false} onPress={() => navigation.navigate("ReportUser", { userId: peer.id, conversationId })} style={styles.gap} />
              <Button testID="ConversationInfo.block" label={copy.block(peerName)} variant="ghost" chevron={false} onPress={() => setBlockOpen(true)} style={styles.gap} />
            </>
          ) : null}
        </View>
      </View>
      <ConfirmDialog visible={blockOpen} destructive loading={blocks.block.isPending} title={chatCopy.blockTitle(peerName)} message={chatCopy.blockMessage} confirmLabel={chatCopy.blockConfirm} onConfirm={() => void confirmBlock()} onCancel={() => setBlockOpen(false)} testID="ConversationInfo.blockDialog" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { paddingTop: 8, paddingBottom: 28 },
  gap: { marginTop: 10 },
  tiny: { marginTop: 4 },
  section: { marginTop: 22 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22 },
  sectionCard: { marginTop: 22 },
  rows: { marginTop: 8 },
  peerRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  actions: { marginTop: 22 },
});
