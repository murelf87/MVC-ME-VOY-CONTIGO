import React, { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { AdminSupportAttachment, AdminSupportMessage } from "@/api/types";
import { formatDateTime } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Avatar, Banner, Button, ConfirmDialog, Screen, StatusPill, Text, TextArea, showToast, type StatusTone } from "@/ui";
import { AdminHeader } from "../../review/components/AdminHeader";
import { CheckingAccess, NoPermission, PanelError } from "../../review/components/AccessStates";
import { EvidenceViewerSheet } from "../../review/components/EvidenceViewerSheet";
import { CardListSkeleton } from "../../review/components/ListStates";
import { StaffAccessSheet } from "../../review/components/StaffAccessSheet";
import { useAdminGate } from "../../review/hooks/useAdminGate";
import { useEvidenceViewer, type EvidenceTarget } from "../../review/hooks/useEvidenceViewer";
import { adminError } from "../../review/logic/errors";
import { staffInitial } from "../../review/logic/permissions";
import { PanelCard } from "../components/PanelCard";
import { backofficeStrings } from "../backofficeStrings";
import { useAssignTicket, useAttachmentAccess, useCloseTicket, useReplyTicket, useSupportTicket } from "../hooks/useSupport";
import { REPLY_MAX, formatBytes, ticketTone, validateReply } from "../model/support";

const s = backofficeStrings.ticket;
const sq = backofficeStrings.support;
const TONE: Record<ReturnType<typeof ticketTone>, StatusTone> = { amber: "amber", blue: "blue", gray: "gray" };

function AttachmentButtons({
  attachments,
  prefix,
  onOpen,
}: {
  attachments: readonly AdminSupportAttachment[];
  prefix: string;
  onOpen: (attachment: AdminSupportAttachment, index: number) => void;
}): React.JSX.Element | null {
  if (attachments.length === 0) return null;
  return (
    <View style={styles.attachments}>
      {attachments.map((attachment, index) => (
        <Button
          key={attachment.id}
          testID={`${prefix}.attachment.${attachment.id}`}
          label={`${s.attachmentLabel(index + 1)} · ${formatBytes(attachment.sizeBytes)}`}
          accessibilityLabel={s.attachmentA11y(index + 1, formatBytes(attachment.sizeBytes))}
          variant="outline"
          size="sm"
          inline
          chevron={false}
          onPress={() => onOpen(attachment, index)}
        />
      ))}
    </View>
  );
}

function MessageBubble({ message, userName, onOpen }: { message: AdminSupportMessage; userName: string; onOpen: (attachment: AdminSupportAttachment, index: number) => void }): React.JSX.Element {
  const staff = message.authorType === "staff";
  return (
    <View style={[styles.bubble, staff ? styles.bubbleStaff : styles.bubbleUser]} testID={`AdminSupportTicket.message.${message.id}`}>
      <Text variant="caption" color={staff ? "link" : "muted"} size={13.5}>
        {`${staff ? (message.author?.displayName ?? s.team) : userName} · ${formatDateTime(message.createdAt)}`}
      </Text>
      <Text variant="body" color="deep" size={16}>{message.body}</Text>
      <AttachmentButtons attachments={message.attachments} prefix={`AdminSupportTicket.message.${message.id}`} onOpen={onOpen} />
    </View>
  );
}

/**
 * Detalle de una consulta de atención al cliente (sin lámina): la persona, la conversación, los adjuntos (con visor
 * seguro: aviso previo, URL firmada de 120 s y acceso auditado), asignación, respuesta y cierre.
 */
export function AdminSupportTicketScreen({ navigation, route }: AppScreenProps<"AdminSupportTicket">): React.JSX.Element {
  const { ticketId } = route.params;
  const gate = useAdminGate((access) => access.canRead("support"));
  const { access } = gate;
  const ready = gate.state === "ready";
  const canWrite = access.canWrite("support");
  const query = useSupportTicket(ticketId, ready);
  const reply = useReplyTicket();
  const assign = useAssignTicket();
  const close = useCloseTicket();
  const attachmentAccess = useAttachmentAccess();
  const viewer = useEvidenceViewer(useCallback((target: EvidenceTarget) => attachmentAccess.mutateAsync({ attachmentId: target.id, note: null }), [attachmentAccess]));

  const [text, setText] = useState("");
  const [replyError, setReplyError] = useState<string | undefined>(undefined);
  const [closing, setClosing] = useState(false);

  const detail = query.data;
  const myId = access.me?.userId ?? null;
  const mine = detail?.assignedTo !== null && detail?.assignedTo?.id === myId;

  const openAttachment = (attachment: AdminSupportAttachment, index: number): void => {
    if (detail === undefined) return;
    viewer.open({ kind: "support_attachment", id: attachment.id, title: s.attachmentLabel(index + 1), ownerName: detail.user.displayName });
  };

  const send = async (): Promise<void> => {
    const result = validateReply(text);
    if (!result.ok) {
      setReplyError(result.message);
      return;
    }
    setReplyError(undefined);
    try {
      await reply.mutateAsync({ ticketId, body: result.body });
      setText("");
      showToast({ kind: "success", message: s.sent, id: "ticket.reply" });
    } catch (error) {
      setReplyError(adminError(error).message);
    }
  };

  const toggleAssign = async (assignee: "me" | "none"): Promise<void> => {
    try {
      await assign.mutateAsync({ ticketId, assignee });
      showToast({ kind: "success", message: assignee === "me" ? s.assigned : s.released, id: "ticket.assign" });
    } catch (error) {
      showToast({ kind: "error", message: adminError(error).message, id: "ticket.assign" });
    }
  };

  const confirmClose = async (): Promise<void> => {
    try {
      await close.mutateAsync(ticketId);
      setClosing(false);
      showToast({ kind: "success", message: s.closedToast, id: "ticket.close" });
    } catch (error) {
      setClosing(false);
      showToast({ kind: "error", message: adminError(error).message, id: "ticket.close" });
    }
  };

  const loadError = query.isError && detail === undefined ? adminError(query.error) : null;

  let body: React.ReactNode;
  if (gate.state === "checking") body = <CheckingAccess />;
  else if (gate.state === "error" && gate.error !== null) body = <PanelError error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} testID="AdminSupportTicket.error" />;
  else if (gate.state === "denied") body = <NoPermission testID="AdminSupportTicket.denied" message={sq.deniedMessage} onGoHome={gate.goHome} />;
  else if (loadError !== null) body = <PanelError error={loadError} onRetry={() => void query.refetch()} onGoHome={() => navigation.navigate("AdminSupportQueue")} testID="AdminSupportTicket.loadError" />;
  else if (detail === undefined) body = <CardListSkeleton count={2} testID="AdminSupportTicket.loading" />;
  else {
    const closed = detail.status === "closed";
    const left = REPLY_MAX - text.length;
    body = (
      <View testID="AdminSupportTicket.content">
        <View style={styles.summary} testID="AdminSupportTicket.summary">
          <View style={styles.head}>
            <Avatar source={detail.user.photoUrl} name={detail.user.displayName} size="lg" />
            <View style={styles.flex}>
              <Text variant="titleSm" color="heading" size={19} numberOfLines={1}>{detail.user.displayName}</Text>
              <Text variant="caption" color="subtle" size={13.5}>{detail.reference}</Text>
            </View>
            <StatusPill label={sq.status[detail.status] ?? detail.status} tone={TONE[ticketTone(detail.status)]} size="sm" testID="AdminSupportTicket.status" />
          </View>
          <Text variant="body" color="body" size={15.5}>{`${s.category}: ${detail.categoryLabel}`}</Text>
          <Text variant="body" color="muted" size={15}>{s.created(formatDateTime(detail.createdAt))}</Text>
          <Text variant="body" color={detail.assignedTo === null ? "warning" : "deep"} size={15.5} testID="AdminSupportTicket.assignee">
            {detail.assignedTo === null ? sq.unassigned : mine ? sq.assignedToMe : sq.assignedTo(detail.assignedTo.displayName ?? "—")}
          </Text>
          {closed ? <Text variant="body" color="muted" size={15}>{s.closedAt(s.closedBy[detail.closedBy ?? "staff"] ?? "", detail.closedAt !== null ? formatDateTime(detail.closedAt) : "")}</Text> : null}
          {canWrite && !closed ? (
            <View style={styles.row}>
              {mine ? (
                <Button testID="AdminSupportTicket.release" label={s.release} variant="outline" size="sm" inline chevron={false} loading={assign.isPending} onPress={() => void toggleAssign("none")} />
              ) : (
                <Button testID="AdminSupportTicket.assignMe" label={s.assignMe} variant="outline" size="sm" inline chevron={false} loading={assign.isPending} onPress={() => void toggleAssign("me")} />
              )}
              <Button testID="AdminSupportTicket.close" label={s.close} variant="outline" size="sm" inline chevron={false} onPress={() => setClosing(true)} />
            </View>
          ) : null}
        </View>

        <Text variant="rowTitle" color="heading" size={18} style={styles.title}>{s.conversation}</Text>
        <View style={styles.thread} testID="AdminSupportTicket.thread">
          {detail.messages.map((message) => (
            <MessageBubble key={message.id} message={message} userName={detail.user.displayName} onOpen={openAttachment} />
          ))}
          {detail.attachments.length > 0 ? <AttachmentButtons attachments={detail.attachments} prefix="AdminSupportTicket" onOpen={openAttachment} /> : null}
        </View>

        {closed ? (
          <Banner kind="notice" size="sm" message={s.closedNote} style={styles.gapTop} testID="AdminSupportTicket.closedNote" />
        ) : canWrite ? (
          <PanelCard title={s.replyLabel} style={styles.gapTop} testID="AdminSupportTicket.composer">
            <TextArea
              testID="AdminSupportTicket.reply"
              value={text}
              onChangeText={(value) => {
                setText(value);
                if (replyError !== undefined) setReplyError(undefined);
              }}
              placeholder={s.replyPlaceholder}
              minHeight={110}
              error={replyError}
              helper={replyError === undefined ? s.replyHelper(Math.max(left, 0)) : undefined}
              accessibilityLabel={s.replyLabel}
            />
            <Button testID="AdminSupportTicket.send" label={s.send} chevron={false} loading={reply.isPending} onPress={() => void send()} style={styles.gapTop} />
          </PanelCard>
        ) : (
          <Banner kind="notice" size="sm" message={s.readOnly} style={styles.gapTop} testID="AdminSupportTicket.readOnly" />
        )}
      </View>
    );
  }

  return (
    <>
      <Screen
        testID="AdminSupportTicket"
        header={<AdminHeader subtitle={s.subtitle} initial={staffInitial(access.me)} staffName={access.me?.displayName ?? null} onAvatarPress={gate.openSheet} testID="AdminSupportTicket.header" />}
        paddingX={11}
        refreshing={query.isRefreshing}
        onRefresh={ready ? () => void query.refetch() : undefined}
        contentContainerStyle={styles.content}
      >
        {body}
      </Screen>
      <EvidenceViewerSheet viewer={viewer} testID="AdminSupportTicket.viewer" />
      <ConfirmDialog
        visible={closing}
        title={s.closeTitle}
        message={s.closeMessage}
        confirmLabel={s.closeConfirm}
        loading={close.isPending}
        onConfirm={() => void confirmClose()}
        onCancel={() => setClosing(false)}
        testID="AdminSupportTicket.closeDialog"
      />
      <StaffAccessSheet
        visible={gate.sheetOpen}
        onClose={gate.closeSheet}
        me={access.me}
        loading={access.query.isLoading || access.query.isIdle}
        error={gate.error}
        onRetry={gate.retry}
        onGoHome={gate.goHome}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: 12, paddingBottom: 24 },
  summary: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  title: { marginTop: 20, marginBottom: 8, paddingHorizontal: 2 },
  thread: { gap: 10 },
  bubble: { padding: 12, borderRadius: 14, gap: 4, maxWidth: "92%" },
  bubbleUser: { backgroundColor: colors.bg.tintSoft, borderWidth: 1, borderColor: colors.border.default, alignSelf: "flex-start" },
  bubbleStaff: { backgroundColor: colors.bg.tintStrong, alignSelf: "flex-end" },
  attachments: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  gapTop: { marginTop: 16 },
});
