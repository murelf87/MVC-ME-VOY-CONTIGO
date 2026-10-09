/**
 * Consulta (hilo). Confirmación con la referencia justo tras enviarla, estado, mensajes del usuario y del equipo con sus
 * imágenes, respuesta (1–1.000 caracteres) mientras no esté cerrada y «Cerrar consulta» con confirmación. Se actualiza sola
 * cada 30 s. Estados: cargando · error · no encontrada · sin conexión.
 */
import React, { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { errorMessage } from "@/api";
import type { SupportAttachment } from "@/api/types";
import { useIsOnline } from "@/hooks";
import { formatDateTime } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Banner, Button, ConfirmDialog, EmptyState, Screen, ScreenHeader, StatusPill, Text, showToast } from "@/ui";
import { getSupportAttachmentDownload } from "../api";
import { ComposeField } from "../components/ComposeField";
import { ListSkeleton, LoadError, OfflineNotice } from "../components/StateCards";
import { useCloseTicket, useReplyTicket, useSupportTicket } from "../hooks/useSupport";
import { REPLY_BODY_MAX, ticketCanClose, ticketCanReply, ticketStatusTone, validateReplyBody } from "../logic/support";
import { helpStrings } from "../strings";

const copy = helpStrings.tickets;

function AttachmentLink({ attachment, index }: { attachment: SupportAttachment; index: number }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const open = async (): Promise<void> => {
    setBusy(true);
    try {
      const download = await getSupportAttachmentDownload(attachment.id);
      await Linking.openURL(download.url);
    } catch {
      showToast({ kind: "error", message: copy.attachmentFailed, id: "ticket.attachment" });
    } finally {
      setBusy(false);
    }
  };
  return <Button testID={`SupportTicketDetail.attachment.${attachment.id}`} label={busy ? copy.attachmentOpening : `${copy.attachmentOpen} · ${copy.attachmentImage(index + 1)}`} variant="outline" size="sm" inline chevron={false} disabled={busy} onPress={() => void open()} style={styles.attachment} />;
}

export function SupportTicketDetailScreen({ navigation, route }: AppScreenProps<"SupportTicketDetail">): React.JSX.Element {
  const { ticketId, sent } = route.params;
  const online = useIsOnline();
  const query = useSupportTicket(ticketId, true);
  const reply = useReplyTicket();
  const close = useCloseTicket();
  const [text, setText] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const header = <ScreenHeader title={copy.detailTitle} testID="SupportTicketDetail.header" />;
  const ticket = query.data;

  if (ticket === undefined) {
    const notFound = query.error !== null && (query.error as { status?: number }).status === 404;
    return (
      <Screen testID="SupportTicketDetail" header={header}>
        {notFound ? (
          <EmptyState testID="SupportTicketDetail.notFound" icon="alertCircle" title={copy.notFoundTitle} message={copy.notFoundMessage} actionLabel={copy.notFoundAction} onAction={() => navigation.replace("SupportTickets")} variant="plain" />
        ) : query.isError || query.isOffline ? (
          <LoadError testID="SupportTicketDetail.error" offline={query.isOffline} title={copy.loadErrorTitle} onRetry={() => void query.refetch()} />
        ) : (
          <ListSkeleton count={3} testID="SupportTicketDetail.skeleton" />
        )}
      </Screen>
    );
  }

  const replyError = attempted ? validateReplyBody(text) : null;
  const canReply = ticketCanReply(ticket);

  const send = async (): Promise<void> => {
    setAttempted(true);
    if (validateReplyBody(text) !== null) return;
    try {
      await reply.mutateAsync({ ticketId, body: text.trim() });
      setText("");
      setAttempted(false);
    } catch (error) {
      showToast({ kind: "error", message: `${copy.replyFailedTitle}. ${errorMessage(error)}`, id: "ticket.reply" });
    }
  };

  const doClose = async (): Promise<void> => {
    try {
      await close.mutateAsync({ ticketId });
      setConfirmClose(false);
      showToast({ kind: "success", message: copy.closedToast, id: "ticket.close" });
    } catch (error) {
      setConfirmClose(false);
      showToast({ kind: "error", message: errorMessage(error), id: "ticket.close" });
    }
  };

  return (
    <Screen testID="SupportTicketDetail" header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      {!online || query.isOffline ? <View style={styles.gap}><OfflineNotice testID="SupportTicketDetail.offline" /></View> : null}
      {sent ? <Banner testID="SupportTicketDetail.sent" kind="success" title={helpStrings.help.sentTitle} message={helpStrings.help.sentMessage(ticket.reference)} /> : null}

      <View style={styles.head}>
        <View style={styles.flex}>
          <Text variant="titleSm" color="heading" size={20}>{helpStrings.help.categories[ticket.category]}</Text>
          <Text variant="body" color="muted" size={15}>{copy.reference(ticket.reference)}</Text>
        </View>
        <StatusPill label={copy.status[ticket.status]} tone={ticketStatusTone(ticket.status)} />
      </View>
      <Text variant="body" color="body" size={15.5} style={styles.hint}>{copy.statusHint[ticket.status]}</Text>

      {ticket.messages.map((message) => (
        <View key={message.id} style={[styles.bubble, message.authorType === "staff" ? styles.staff : styles.user]} testID={`SupportTicketDetail.message.${message.id}`}>
          <Text variant="rowTextStrong" color={message.authorType === "staff" ? "link" : "heading"} size={15}>
            {message.authorType === "staff" ? copy.authorStaff : copy.authorUser} · {formatDateTime(message.createdAt)}
          </Text>
          <Text variant="body" color="deep" size={16.5}>{message.body}</Text>
          {message.attachments.map((attachment, index) => <AttachmentLink key={attachment.id} attachment={attachment} index={index} />)}
        </View>
      ))}

      {canReply ? (
        <View style={styles.reply}>
          <Text variant="rowTitle" color="heading" size={18} accessibilityRole="header">{copy.replyLabel}</Text>
          <ComposeField testID="SupportTicketDetail.reply" value={text} onChangeText={setText} placeholder={copy.replyPlaceholder} maxLength={REPLY_BODY_MAX} error={replyError ?? undefined} disabled={reply.isPending} accessibilityLabel={copy.replyLabel} />
          <Button testID="SupportTicketDetail.send" label={copy.replySubmit} chevron={false} loading={reply.isPending} disabled={!online} onPress={() => void send()} style={styles.gap} />
        </View>
      ) : (
        <Banner testID="SupportTicketDetail.closedNotice" kind="info" title={copy.closedNoticeTitle} message={ticket.closedAt !== null ? copy.closedNoticeMessage(formatDateTime(ticket.closedAt)) : copy.closedNoticeNoDate} />
      )}
      {!canReply ? <Button testID="SupportTicketDetail.new" label={copy.newAction} chevron={false} onPress={() => navigation.navigate("SupportNewTicket")} style={styles.gap} /> : null}
      {ticketCanClose(ticket) ? <Button testID="SupportTicketDetail.close" label={copy.closeAction} variant="outline" chevron={false} onPress={() => setConfirmClose(true)} style={styles.gap} /> : null}

      <ConfirmDialog testID="SupportTicketDetail.closeDialog" visible={confirmClose} loading={close.isPending} title={copy.closeConfirmTitle} message={copy.closeConfirmMessage} confirmLabel={copy.closeConfirm} cancelLabel={helpStrings.common.cancel} onConfirm={() => void doClose()} onCancel={() => (close.isPending ? undefined : setConfirmClose(false))} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { marginTop: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  hint: { marginTop: 8, marginBottom: 6 },
  bubble: { marginTop: 10, padding: 14, borderRadius: 14, gap: 4 },
  user: { backgroundColor: colors.bg.tint },
  staff: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: colors.border.default },
  attachment: { marginTop: 6 },
  reply: { marginTop: 18, gap: 8 },
});
