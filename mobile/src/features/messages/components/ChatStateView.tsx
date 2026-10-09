/**
 * Estados del chat en los que el servidor NO deja ver la conversación (no son un error de red):
 *   · blocked → una de las dos personas ha bloqueado a la otra (403 `CHAT_BLOCKED`);
 *   · closed  → la reserva ya no está vigente o se salió del grupo (403 `CHAT_FORBIDDEN`);
 *   · gone    → el chat no existe o no es suyo (404 `CONVERSATION_NOT_FOUND`).
 * Cada uno dice qué ocurre y deja salir: volver a la bandeja o, si hay bloqueo, ver la lista de personas bloqueadas.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { IconName } from "@/icons";
import { Button, EmptyState } from "@/ui";
import { messagesStrings } from "../strings";

const copy = messagesStrings.chat;

export type ChatStateKind = "blocked" | "closed" | "gone";

export interface ChatStateViewProps {
  kind: ChatStateKind;
  onBackToInbox: () => void;
  onSeeBlocked: () => void;
  testID?: string;
}

const specs: Record<ChatStateKind, { icon: IconName; title: string; message: string }> = {
  blocked: { icon: "lock", title: copy.blockedTitle, message: copy.blockedMessage },
  closed: { icon: "chatText", title: copy.closedTitle, message: copy.closedMessage },
  gone: { icon: "alertCircle", title: copy.notFoundTitle, message: copy.notFoundMessage },
};

export function ChatStateView({ kind, onBackToInbox, onSeeBlocked, testID = "BookingChat.state" }: ChatStateViewProps): React.JSX.Element {
  const spec = specs[kind];
  return (
    <View style={styles.root} testID={testID} accessibilityLiveRegion="polite">
      <EmptyState variant="plain" icon={spec.icon} title={spec.title} message={spec.message} testID={`${testID}.${kind}`} />
      <View style={styles.actions}>
        {kind === "blocked" ? <Button label={copy.blockedAction} onPress={onSeeBlocked} chevron={false} testID={`${testID}.blocked`} /> : null}
        <Button
          label={copy.backToInbox}
          variant={kind === "blocked" ? "outline" : "primary"}
          onPress={onBackToInbox}
          chevron={false}
          testID={`${testID}.inbox`}
          style={kind === "blocked" ? styles.second : undefined}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", paddingHorizontal: 30, paddingBottom: 40 },
  actions: { marginTop: 8 },
  second: { marginTop: 10 },
});
