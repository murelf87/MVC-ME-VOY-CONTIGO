import * as Crypto from "expo-crypto";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, ApiError } from "../api/client";
import { formatDeparture, loadConversations, tripStatusLabel } from "../api/trips";
import type { ChatMessage, Conversation } from "../api/types";
import { Card } from "../components/UI";
import { useAuth } from "../session/AuthContext";
import { C } from "../theme";

const POLL_MS = 5000;

export function MessagesScreen({
  open,
  onOpen,
}: {
  open: Conversation | null;
  onOpen: (conversation: Conversation | null) => void;
}) {
  if (open) return <ChatThread conversation={open} onBack={() => onOpen(null)} />;
  return <ConversationList onOpen={onOpen} />;
}

function ConversationList({ onOpen }: { onOpen: (conversation: Conversation) => void }) {
  const { token, roles } = useAuth();
  const [items, setItems] = useState<Conversation[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    loadConversations(token, roles.includes("driver"))
      .then(result => mounted && setItems(result))
      .catch(e => mounted && setError(e instanceof ApiError ? e.message : "No se pudieron cargar las conversaciones."))
      .finally(() => mounted && setBusy(false));
    return () => {
      mounted = false;
    };
  }, [token, roles]);

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Mensajes</Text>
      <Text style={s.subtitle}>Solo puedes escribir a quien comparte contigo una reserva confirmada.</Text>
      {busy ? <ActivityIndicator color={C.blue} /> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
      {!busy && !items.length && !error ? (
        <Card style={s.emptyCard}>
          <Ionicons name="chatbubbles-outline" size={38} color={C.blue} />
          <Text style={s.emptyTitle}>Sin conversaciones</Text>
          <Text style={s.emptyText}>El chat se abre cuando una reserva queda confirmada.</Text>
        </Card>
      ) : null}
      {items.map(item => (
        <Pressable key={`${item.tripId}:${item.peerUserId}`} onPress={() => onOpen(item)}>
          <Card style={s.row}>
            <View style={s.avatar}><Text style={s.initial}>{item.peerName.slice(0, 1).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{item.peerName}</Text>
              <Text style={s.meta}>{formatDeparture(item.departureAt)} · {tripStatusLabel(item.tripStatus)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={C.blue} />
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ChatThread({ conversation, onBack }: { conversation: Conversation; onBack: () => void }) {
  const { token, profile } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scroll = useRef<ScrollView>(null);
  const path = `/v1/trips/${conversation.tripId}/chat/${conversation.peerUserId}/messages`;

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const response = await apiRequest<{ messages: ChatMessage[] }>(`${path}?limit=100`, { token });
      setMessages(response.messages);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudieron cargar los mensajes.");
    }
  }, [path, token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function send() {
    const body = draft.trim();
    if (!token || !body) return;
    setSending(true);
    try {
      await apiRequest(path, {
        method: "POST",
        token,
        body: { clientMessageId: Crypto.randomUUID(), body },
      });
      setDraft("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo enviar el mensaje.");
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <View style={s.threadHeader}>
        <Pressable onPress={onBack} style={s.back} accessibilityLabel="Volver a mensajes">
          <Ionicons name="chevron-back" size={22} color={C.navy} />
        </Pressable>
        <View style={s.avatarSmall}><Text style={s.initialSmall}>{conversation.peerName.slice(0, 1).toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{conversation.peerName}</Text>
          <Text style={s.meta}>{formatDeparture(conversation.departureAt)}</Text>
        </View>
      </View>
      <ScrollView
        ref={scroll}
        contentContainerStyle={s.thread}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        {error ? <Text style={s.error}>{error}</Text> : null}
        {!messages.length && !error ? <Text style={s.subtitle}>Escribe el primer mensaje para coordinar la recogida.</Text> : null}
        {messages.map(message => {
          const mine = message.sender_user_id === profile?.id;
          return (
            <View key={message.id} style={[s.bubble, mine ? s.mine : s.theirs]}>
              <Text style={[s.bubbleText, mine && { color: "#fff" }]}>{message.body}</Text>
              <Text style={[s.time, mine && { color: "#D6E4FF" }]}>
                {new Date(message.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
              </Text>
            </View>
          );
        })}
      </ScrollView>
      <View style={s.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Escribe un mensaje"
          style={s.input}
          maxLength={2000}
          onSubmitEditing={() => void send()}
        />
        <Pressable onPress={() => void send()} disabled={sending || !draft.trim()} style={[s.send, (sending || !draft.trim()) && { opacity: 0.45 }]} accessibilityLabel="Enviar">
          <Ionicons name="send" size={19} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 18, paddingBottom: 28, backgroundColor: "#fff" },
  title: { fontSize: 25, fontWeight: "900", color: C.navy, textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 12, lineHeight: 18, color: C.muted, textAlign: "center", marginBottom: 16 },
  error: { marginBottom: 12, color: "#9E302D", backgroundColor: "#FFF0EF", padding: 11, borderRadius: 12, fontSize: 12 },
  emptyCard: { alignItems: "center", paddingVertical: 26, marginTop: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "900", color: C.navy, marginTop: 10 },
  emptyText: { fontSize: 12, lineHeight: 18, color: C.muted, textAlign: "center", marginTop: 5 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#7BB7A1", alignItems: "center", justifyContent: "center" },
  initial: { color: "#fff", fontSize: 19, fontWeight: "900" },
  name: { fontSize: 15, fontWeight: "900", color: C.navy },
  meta: { fontSize: 11, color: C.muted, marginTop: 2 },
  threadHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  back: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  avatarSmall: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#7BB7A1", alignItems: "center", justifyContent: "center" },
  initialSmall: { color: "#fff", fontSize: 15, fontWeight: "900" },
  thread: { padding: 14, gap: 8, flexGrow: 1, backgroundColor: C.bg },
  bubble: { maxWidth: "80%", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  mine: { alignSelf: "flex-end", backgroundColor: C.blue, borderBottomRightRadius: 4 },
  theirs: { alignSelf: "flex-start", backgroundColor: "#fff", borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 19, color: C.navy },
  time: { fontSize: 10, color: C.muted, marginTop: 3, alignSelf: "flex-end" },
  composer: { flexDirection: "row", gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: "#fff" },
  input: { flex: 1, height: 46, borderWidth: 1, borderColor: C.border, borderRadius: 23, paddingHorizontal: 16, fontSize: 14, color: C.navy },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.blue, alignItems: "center", justifyContent: "center" },
});
