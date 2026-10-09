/**
 * 26 · Chat de reserva. Cabecera con la persona, la ruta y tres tarjetas (reserva, punto de recogida, aporte del viaje),
 * burbujas con ticks, ubicación compartida, «Llamar a Ana» y barra de redacción. También sirve el chat de grupo de una
 * ruta recurrente (foto de grupo, nombre de quien escribe).
 *
 * Datos: `GET /v1/conversations/:id` (cabecera y acceso) + `useChatThread` (mensajes, sondeo `afterSeq`, envío optimista
 * con reintento, marca de lectura). Estados propios: cargando, error con «Reintentar», sin conexión, chat bloqueado /
 * cerrado / inexistente. El menú ⋮ da información, llamada, denunciar un mensaje o a la persona y bloquear.
 *
 * La lista está INVERTIDA (lo último, abajo y pegado al teclado); la cabecera del chat es su «pie», es decir, lo más alto.
 */
import React from "react";
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from "react-native";
import { describeError } from "@/api";
import type { ChatLocation, ConversationDetail } from "@/api/types";
import { useIsOnline } from "@/hooks";
import { Icon } from "@/icons";
import type { AppScreenProps } from "@/navigation";
import { copyToClipboard, openMapsAt } from "@/platform";
import { useAuth } from "@/session";
import { colors } from "@/theme";
import {
  Avatar,
  Button,
  ConfirmDialog,
  Dialog,
  ErrorStateCard,
  LoadingBlock,
  OfflineBanner,
  OptionSheet,
  Screen,
  ScreenHeader,
  Spinner,
  Text,
  showToast,
  type OptionSheetOption,
} from "@/ui";
import { AttachSheet } from "../components/AttachSheet";
import { CallButton } from "../components/CallButton";
import { ChatComposer } from "../components/ChatComposer";
import { ChatHeaderCard } from "../components/ChatHeaderCard";
import { ChatStateView } from "../components/ChatStateView";
import { ContributionSheet } from "../components/ContributionSheet";
import { DayDivider } from "../components/DayDivider";
import { LocationMessageCard } from "../components/LocationMessageCard";
import { BUBBLE_AVATAR, BUBBLE_GAP, BUBBLE_LEFT, MessageBubble } from "../components/MessageBubble";
import { useBlockActions } from "../hooks/useBlockActions";
import { useCallContact } from "../hooks/useCallContact";
import { MAX_MESSAGE_CHARS, useChatThread } from "../hooks/useChatThread";
import { useConversation } from "../hooks/useConversation";
import { useNow } from "../hooks/useNow";
import { useShareLocation } from "../hooks/useShareLocation";
import { buildTimeline, isRetryable, messageText, type MessageEntry, type TimelineEntry } from "../model/chat";
import { firstNameOf } from "../model/people";
import { messagesStrings } from "../strings";

const copy = messagesStrings.chat;

type MenuAction = "info" | "call" | "reportMessage" | "reportPerson" | "block";
type MessageAction = "copy" | "report";
type FailedAction = "retry" | "delete";

const GAP_SAME_SENDER = 5;
const GAP_DEFAULT = 10;

function keyOf(entry: TimelineEntry): string {
  return entry.key;
}

export function BookingChatScreen({ navigation, route }: AppScreenProps<"BookingChat">): React.JSX.Element {
  const { conversationId } = route.params;
  const conversation = useConversation(conversationId);
  const thread = useChatThread(conversationId);
  const call = useCallContact(conversationId);
  const share = useShareLocation();
  const blocks = useBlockActions();
  const { me } = useAuth();
  const online = useIsOnline();
  const now = useNow();

  const detail = conversation.detail;
  const isGroup = detail?.kind === "group";
  const peer = detail?.peer ?? null;
  const peerName = peer?.firstName ?? (detail !== undefined ? firstNameOf(detail.title) : "");

  const [text, setText] = React.useState("");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [attachOpen, setAttachOpen] = React.useState(false);
  const [contributionOpen, setContributionOpen] = React.useState(false);
  const [blockDialog, setBlockDialog] = React.useState(false);
  const [selecting, setSelecting] = React.useState(false);
  const [messageSheet, setMessageSheet] = React.useState<MessageEntry | null>(null);
  const [failedSheet, setFailedSheet] = React.useState<MessageEntry | null>(null);
  const [localRefusal, setLocalRefusal] = React.useState<"blocked" | null>(null);

  const listRef = React.useRef<FlatList<TimelineEntry>>(null);

  const refusal = localRefusal ?? (conversation.access !== "ok" ? conversation.access : thread.refusal);

  const timeline = React.useMemo(
    () =>
      buildTimeline(thread.state, {
        nowMs: now,
        isGroup,
        myUserId: me?.id ?? null,
        myName: me?.display_name ?? "",
      }),
    [thread.state, now, isGroup, me?.id, me?.display_name],
  );
  const data = React.useMemo(() => [...timeline].reverse(), [timeline]);

  const members = React.useMemo(() => {
    const map = new Map<string, { name: string; photoUrl: string | null }>();
    for (const member of detail?.members ?? []) map.set(member.user.id, { name: member.user.displayName, photoUrl: member.user.photoUrl });
    return map;
  }, [detail?.members]);

  // ── Acciones ────────────────────────────────────────────────────────────────────────────────────────────────────

  const goInbox = React.useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Inbox");
  }, [navigation]);

  const seeBlocked = React.useCallback(() => navigation.navigate("BlockedUsers"), [navigation]);

  const openBooking = React.useCallback(() => {
    if (detail === undefined) return;
    setContributionOpen(false);
    if (detail.myRole === "driver") {
      const tripId = detail.trip?.id ?? detail.tripId;
      if (tripId !== null) navigation.navigate("DriverTripManage", { tripId });
      return;
    }
    const bookingId = detail.booking?.id ?? detail.bookingId;
    if (bookingId !== null) navigation.navigate("BookingDetail", { bookingId });
  }, [detail, navigation]);

  const openPlace = React.useCallback(async (place: { lat: number; lng: number; label: string | null }) => {
    const result = await openMapsAt({ latitude: place.lat, longitude: place.lng, ...(place.label !== null ? { label: place.label } : {}) });
    if (result !== "opened") showToast({ id: "chat-map", kind: "error", message: copy.pickupOpenFailed });
  }, []);

  const send = React.useCallback(() => {
    if (thread.sendText(text)) {
      setText("");
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
  }, [text, thread]);

  const sendLocation = React.useCallback(
    (location: ChatLocation) => {
      thread.sendLocation(location);
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    },
    [thread],
  );

  const shareMyLocation = React.useCallback(async () => {
    const sent = await share.shareMyLocation(sendLocation);
    if (sent) setAttachOpen(false);
  }, [share, sendLocation]);

  const sharePickup = React.useCallback(() => {
    const pickup = detail?.pickupPoint;
    if (pickup === null || pickup === undefined) return;
    setAttachOpen(false);
    sendLocation({ lat: pickup.lat, lng: pickup.lng, label: pickup.label });
  }, [detail?.pickupPoint, sendLocation]);

  const reportMessage = React.useCallback(
    (entry: MessageEntry) => {
      if (entry.messageId === null) return;
      setSelecting(false);
      setMessageSheet(null);
      navigation.navigate("ReportUser", { userId: entry.senderId, conversationId, messageId: entry.messageId });
    },
    [conversationId, navigation],
  );

  const undoBlock = React.useCallback(
    async (userId: string, name: string) => {
      try {
        await blocks.unblock.mutateAsync(userId);
        setLocalRefusal(null);
        thread.clearRefusal();
        void conversation.query.refetch();
        showToast({ id: "chat-block", kind: "success", message: copy.unblockedToast(name) });
      } catch (error) {
        showToast({ id: "chat-block", kind: "error", message: describeError(error).message });
      }
    },
    [blocks.unblock, conversation.query, thread],
  );

  const confirmBlock = React.useCallback(async () => {
    if (peer === null) return;
    try {
      await blocks.block.mutateAsync(peer.id);
      setBlockDialog(false);
      setLocalRefusal("blocked");
      showToast({
        id: "chat-block",
        kind: "success",
        message: copy.blockedToast(peerName),
        actionLabel: copy.undo,
        durationMs: 8000,
        onAction: () => void undoBlock(peer.id, peerName),
      });
    } catch {
      setBlockDialog(false);
      showToast({ id: "chat-block", kind: "error", message: copy.blockFailed });
    }
  }, [blocks.block, peer, peerName, undoBlock]);

  const handleMenu = React.useCallback(
    (action: MenuAction) => {
      setMenuOpen(false);
      switch (action) {
        case "info":
          navigation.navigate("ConversationInfo", { conversationId });
          return;
        case "call":
          call.press();
          return;
        case "reportMessage":
          setSelecting(true);
          return;
        case "reportPerson":
          if (peer !== null) navigation.navigate("ReportUser", { userId: peer.id, conversationId });
          return;
        case "block":
          setBlockDialog(true);
          return;
      }
    },
    [call, conversationId, navigation, peer],
  );

  const handleMessageAction = React.useCallback(
    async (action: MessageAction) => {
      const entry = messageSheet;
      setMessageSheet(null);
      if (entry === null) return;
      if (action === "report") {
        reportMessage(entry);
        return;
      }
      const copied = await copyToClipboard(messageText(entry, copy.sharedLocation));
      showToast({ id: "chat-copy", kind: copied ? "success" : "error", message: copied ? copy.copied : messagesStrings.common.copy });
    },
    [messageSheet, reportMessage],
  );

  const handleFailedAction = React.useCallback(
    (action: FailedAction) => {
      const entry = failedSheet;
      setFailedSheet(null);
      if (entry === null || entry.clientMessageId === null) return;
      if (action === "retry") thread.retry(entry.clientMessageId);
      else thread.discard(entry.clientMessageId);
    },
    [failedSheet, thread],
  );

  // ── Opciones de las hojas ───────────────────────────────────────────────────────────────────────────────────────

  const menuOptions = React.useMemo<OptionSheetOption<MenuAction>[]>(() => {
    const options: OptionSheetOption<MenuAction>[] = [{ value: "info", label: copy.menuInfo, icon: "infoOutline" }];
    if (!isGroup && peerName !== "") options.push({ value: "call", label: copy.menuCall(peerName), icon: "phone" });
    options.push({ value: "reportMessage", label: copy.menuReportMessage, description: copy.menuReportMessageHint, icon: "flag" });
    if (!isGroup && peerName !== "") {
      options.push({ value: "reportPerson", label: copy.menuReportPerson(peerName), icon: "flag" });
      options.push({ value: "block", label: copy.menuBlock(peerName), description: copy.menuBlockHint, icon: "lock", destructive: true });
    }
    return options;
  }, [isGroup, peerName]);

  const messageOptions = React.useMemo<OptionSheetOption<MessageAction>[]>(() => {
    const entry = messageSheet;
    if (entry === null) return [];
    const options: OptionSheetOption<MessageAction>[] = [];
    if (!entry.hidden) options.push({ value: "copy", label: copy.messageMenuCopy, icon: "copy" });
    if (entry.side === "incoming" && !entry.hidden && entry.messageId !== null) {
      options.push({ value: "report", label: copy.messageMenuReport, icon: "flag", destructive: true });
    }
    return options;
  }, [messageSheet]);

  const failedOptions: OptionSheetOption<FailedAction>[] = [
    { value: "retry", label: copy.failedActionRetry, icon: "refresh" },
    { value: "delete", label: copy.failedActionDelete, icon: "trash", destructive: true },
  ];

  // ── Filas ───────────────────────────────────────────────────────────────────────────────────────────────────────

  const renderAvatar = React.useCallback(
    (entry: MessageEntry): React.ReactNode | null | undefined => {
      if (entry.side === "outgoing") return undefined;
      if (!isGroup) return <Avatar size={BUBBLE_AVATAR} source={peer?.photoUrl ?? null} name={peer?.displayName ?? entry.senderName} />;
      if (!entry.showSender) return null;
      const member = members.get(entry.senderId);
      return <Avatar size={BUBBLE_AVATAR} source={member?.photoUrl ?? null} name={member?.name ?? entry.senderName} />;
    },
    [isGroup, members, peer?.displayName, peer?.photoUrl],
  );

  const renderItem = React.useCallback(
    ({ item, index }: ListRenderItemInfo<TimelineEntry>) => {
      const older = data[index + 1];
      const gap = older === undefined ? 0 : older.type === "message" && item.type === "message" && older.senderId === item.senderId ? GAP_SAME_SENDER : GAP_DEFAULT;
      if (item.type === "day") {
        return (
          <View style={{ marginTop: older === undefined ? 0 : 6 }}>
            <DayDivider label={item.label} testID={`BookingChat.day.${item.key}`} />
          </View>
        );
      }
      const failed = isRetryable(item);
      const reportable = selecting && item.side === "incoming" && !item.hidden && item.messageId !== null;
      const testID = `BookingChat.message.${item.messageId ?? item.clientMessageId ?? item.key}`;
      const avatar = renderAvatar(item);
      const onLongPress =
        failed ? () => setFailedSheet(item) : item.side === "incoming" && !item.hidden ? () => setMessageSheet(item) : item.kind === "text" && !item.hidden ? () => setMessageSheet(item) : undefined;
      const onRetry = failed && item.clientMessageId !== null ? () => thread.retry(item.clientMessageId as string) : undefined;
      const row =
        item.kind === "location" && !item.hidden ? (
          <LocationMessageCard
            entry={item}
            avatar={avatar}
            selecting={selecting}
            testID={testID}
            onOpen={(entry) => (reportable ? reportMessage(entry) : entry.location !== null ? void openPlace(entry.location) : undefined)}
            onLongPress={onLongPress}
            onRetry={onRetry}
          />
        ) : (
          <MessageBubble
            entry={item}
            avatar={avatar}
            selecting={selecting}
            testID={testID}
            onPress={reportable ? () => reportMessage(item) : failed ? () => setFailedSheet(item) : undefined}
            onLongPress={onLongPress}
            onRetry={onRetry}
          />
        );
      return (
        <View style={{ marginTop: gap }}>
          {isGroup && item.side === "incoming" && item.showSender ? (
            <Text variant="rowTextStrong" color="heading" size={15.5} lineHeight={20} numberOfLines={1} style={styles.senderName}>
              {firstNameOf(item.senderName)}
            </Text>
          ) : null}
          {row}
        </View>
      );
    },
    [data, isGroup, openPlace, renderAvatar, reportMessage, selecting, thread],
  );

  // ── Cabecera del chat (lo más alto de la lista) ─────────────────────────────────────────────────────────────────

  const listTop = (
    <View>
      {detail !== undefined ? (
        <ChatHeaderCard
          detail={detail}
          now={now}
          onOpenBooking={openBooking}
          onOpenPickup={() => {
            if (detail.pickupPoint !== null) void openPlace(detail.pickupPoint);
          }}
          onOpenContribution={() => setContributionOpen(true)}
          onOpenMembers={() => navigation.navigate("ConversationInfo", { conversationId })}
        />
      ) : null}
      {thread.loadingOlder ? (
        <View style={styles.older} accessible accessibilityLabel={copy.loadingOlder} testID="BookingChat.loadingOlder">
          <Spinner size="sm" />
        </View>
      ) : null}
      {thread.olderError ? (
        <View style={styles.older}>
          <Text variant="rowText" color="muted" align="center">
            {copy.olderError}
          </Text>
          <Button label={messagesStrings.common.retry} variant="link" chevron={false} onPress={thread.loadOlder} testID="BookingChat.olderRetry" />
        </View>
      ) : null}
      {data.length === 0 && thread.state.loaded ? (
        <View style={styles.emptyThread} testID="BookingChat.empty">
          <Icon name="chatText" size={40} color={colors.empty.icon} />
          <Text variant="heading" weight="bold" color={colors.empty.text} align="center" size={19} lineHeight={24} style={styles.emptyTitle}>
            {copy.emptyThreadTitle}
          </Text>
          <Text variant="body" color={colors.empty.text} align="center" size={16.5} lineHeight={21}>
            {isGroup ? copy.emptyThreadGroup : copy.emptyThreadDirect(peerName)}
          </Text>
        </View>
      ) : null}
      <View style={styles.gapBelowCard} />
    </View>
  );

  // ── Cuerpo ──────────────────────────────────────────────────────────────────────────────────────────────────────

  const inRefusal = refusal !== null;
  const loadingFirst = !inRefusal && (conversation.query.isLoading || thread.loading) && detail === undefined;
  const errored = !inRefusal && detail === undefined && (conversation.loadError !== null || thread.loadError !== null);

  let body: React.ReactNode;
  if (inRefusal) {
    body = <ChatStateView kind={refusal} onBackToInbox={goInbox} onSeeBlocked={seeBlocked} />;
  } else if (loadingFirst) {
    body = <LoadingBlock testID="BookingChat.loading" />;
  } else if (errored) {
    const described = conversation.loadError ?? thread.loadError;
    body = (
      <View style={styles.state}>
        <ErrorStateCard
          testID="BookingChat.error"
          tone="red"
          icon="alertCircle"
          title={copy.loadErrorTitle}
          message={described?.message ?? messagesStrings.inbox.loadErrorMessage}
          actionLabel={messagesStrings.common.retry}
          onAction={() => {
            void conversation.query.refetch();
            thread.reload();
          }}
        />
      </View>
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        testID="BookingChat.list"
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={data}
        inverted
        keyExtractor={keyOf}
        renderItem={renderItem}
        ListHeaderComponent={<View style={styles.gapAboveComposer} />}
        ListFooterComponent={listTop}
        onEndReached={thread.hasOlder && !thread.loadingOlder && !thread.olderError ? thread.loadOlder : undefined}
        onEndReachedThreshold={0.3}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        initialNumToRender={14}
        windowSize={9}
        extraData={selecting}
      />
    );
  }

  const showComposer = !inRefusal && !loadingFirst && !errored;
  const tripEnded = detail?.trip?.status === "completed";

  const footer = !showComposer ? null : selecting ? (
    <View style={styles.footer}>
      <Button label={copy.selectToReportCancel} variant="outline" chevron={false} onPress={() => setSelecting(false)} testID="BookingChat.selectCancel" />
    </View>
  ) : (
    <View style={styles.footer}>
      {tripEnded ? (
        <Text variant="rowText" color="muted" size={14.5} lineHeight={19} style={styles.tripEnded} testID="BookingChat.tripEnded">
          {copy.tripEnded}
        </Text>
      ) : null}
      {!isGroup && detail !== undefined ? (
        <View style={styles.callWrap}>
          <CallButton
            label={copy.callTo(peerName)}
            busyLabel={copy.callChecking}
            busy={call.phase.kind === "checking"}
            onPress={call.press}
          />
        </View>
      ) : null}
      <ChatComposer
        value={text}
        onChangeText={setText}
        onSend={send}
        onAttach={() => setAttachOpen(true)}
        placeholder={copy.placeholder}
        sendLabel={copy.sendA11y}
        attachLabel={copy.attachA11y}
        maxLength={MAX_MESSAGE_CHARS}
      />
    </View>
  );

  const headerNode = (
    <ScreenHeader
      title={isGroup ? copy.titleGroup : copy.title}
      testID="BookingChat.header"
      {...(detail !== undefined && !inRefusal ? { onMenu: () => setMenuOpen(true) } : {})}
    />
  );

  const callUnavailable = call.phase.kind === "unavailable" ? call.phase : null;

  return (
    <Screen testID="BookingChat" scroll={false} padded={false} header={headerNode} footer={footer}>
      {!online && showComposer ? (
        <OfflineBanner
          testID="BookingChat.offline"
          title={messagesStrings.common.offlineTitle}
          detail={copy.offlineBanner}
          style={styles.offline}
        />
      ) : null}
      {selecting ? (
        <View style={styles.selectBanner} accessibilityLiveRegion="polite" testID="BookingChat.selectBanner">
          <Icon name="flag" size={22} color={colors.primary} />
          <Text variant="rowTextStrong" color="heading" size={16} lineHeight={20} style={styles.selectText}>
            {copy.selectToReport}
          </Text>
        </View>
      ) : null}
      {body}

      <OptionSheet<MenuAction>
        visible={menuOpen}
        title={copy.menuTitle}
        options={menuOptions}
        onSelect={handleMenu}
        onClose={() => setMenuOpen(false)}
        testID="BookingChat.menu"
      />
      <OptionSheet<MessageAction>
        visible={messageSheet !== null}
        title={copy.messageMenuTitle}
        options={messageOptions}
        onSelect={(action) => void handleMessageAction(action)}
        onClose={() => setMessageSheet(null)}
        testID="BookingChat.messageMenu"
      />
      <OptionSheet<FailedAction>
        visible={failedSheet !== null}
        title={copy.failedActionsTitle}
        options={failedOptions}
        onSelect={handleFailedAction}
        onClose={() => setFailedSheet(null)}
        testID="BookingChat.failedMenu"
      />
      <AttachSheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        onShareMyLocation={() => void shareMyLocation()}
        onSharePickup={sharePickup}
        pickupAvailable={detail !== undefined && detail.pickupPoint !== null}
        locating={share.locating}
      />
      <ContributionSheet
        visible={contributionOpen}
        onClose={() => setContributionOpen(false)}
        contribution={detail?.contribution ?? null}
        seats={detail?.booking?.seats ?? null}
        onOpenBooking={openBooking}
        openLabel={detail?.myRole === "driver" ? copy.seeTrip : copy.seeBooking}
      />
      <ConfirmDialog
        visible={blockDialog}
        title={copy.blockTitle(peerName)}
        message={copy.blockMessage}
        confirmLabel={copy.blockConfirm}
        destructive
        loading={blocks.block.isPending}
        onConfirm={() => void confirmBlock()}
        onCancel={() => setBlockDialog(false)}
        testID="BookingChat.blockDialog"
      />
      <Dialog
        visible={callUnavailable !== null}
        icon="phone"
        title={copy.callUnavailableTitle(callUnavailable?.name ?? peerName)}
        message={callUnavailable?.explanation}
        onClose={call.dismiss}
        testID="BookingChat.callDialog"
        actions={<Button label={copy.callUnderstood} chevron={false} onPress={call.dismiss} testID="BookingChat.callDialog.ok" />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { flexGrow: 1, justifyContent: "flex-end", paddingTop: 4 },
  gapBelowCard: { height: 14 },
  gapAboveComposer: { height: 8 },
  older: { alignItems: "center", paddingVertical: 12 },
  emptyThread: { alignItems: "center", paddingHorizontal: 40, paddingTop: 28, paddingBottom: 8 },
  emptyTitle: { marginTop: 8, marginBottom: 4 },
  senderName: { marginLeft: BUBBLE_LEFT + BUBBLE_AVATAR + BUBBLE_GAP + 13.5, marginBottom: 2 },
  state: { paddingHorizontal: 30, paddingTop: 24 },
  offline: { marginHorizontal: 15, marginBottom: 6 },
  selectBanner: {
    marginHorizontal: 15,
    marginBottom: 8,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.bg.tint,
  },
  selectText: { flex: 1, marginLeft: 10 },
  footer: { paddingLeft: 10, paddingRight: 12 },
  callWrap: { alignItems: "flex-end", marginRight: 2, marginBottom: 14 },
  tripEnded: { paddingHorizontal: 6, paddingBottom: 8 },
});
