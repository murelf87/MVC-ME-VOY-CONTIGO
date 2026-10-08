import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { apiRequest } from "../api/client";
import { Brand, PrimaryButton } from "../components/UI";
import { useAuth } from "../session/AuthContext";
import { C } from "../theme";

export type LegalDocument = { id: string; kind: "terms" | "privacy"; version: number; title: string; body: string };

const KIND: Record<LegalDocument["kind"], string> = { terms: "Condiciones de uso", privacy: "Privacidad" };

/**
 * Published conditions the user has not accepted yet. A failed check never blocks the app:
 * the backend refuses bookings and publications on its own until they are accepted.
 */
export function usePendingLegal(token: string | null) {
  const [pending, setPending] = useState<LegalDocument[]>([]);
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiRequest<{ pending: LegalDocument[] }>("/v1/me/legal", { token });
      setPending(r.pending);
    } catch {
      // Keep whatever we knew; the server is the one that enforces acceptance.
    }
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { pending, refresh, setPending };
}

export function LegalScreen({ documents, onAccepted }: { documents: LegalDocument[]; onAccepted: (pending: LegalDocument[]) => void }) {
  const { token, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const r = await apiRequest<{ pending: LegalDocument[] }>("/v1/me/legal/accept", {
        method: "POST", token, body: { documentIds: documents.map(d => d.id) },
      });
      onAccepted(r.pending);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.head}>
        <Brand width={150} />
        <Text style={s.title}>Antes de seguir</Text>
        <Text style={s.lead}>
          {documents.some(d => d.version > 1)
            ? "Hemos actualizado las condiciones. Léelas y acéptalas para reservar o publicar viajes."
            : "Lee y acepta las condiciones para reservar o publicar viajes."}
        </Text>
      </View>
      <ScrollView contentContainerStyle={s.docs}>
        {documents.map(d => (
          <View key={d.id} style={s.doc}>
            <Text style={s.kind}>{KIND[d.kind]} · versión {d.version}</Text>
            <Text style={s.docTitle}>{d.title}</Text>
            <Text style={s.body}>{d.body}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={s.foot}>
        {error ? <Text style={s.error}>{error}</Text> : null}
        {busy ? <ActivityIndicator color={C.blue} /> : <PrimaryButton title="Acepto" onPress={() => void accept()} />}
        <Text style={s.out} onPress={() => void logout()}>Ahora no, cerrar sesión</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  head: { alignItems: "center", paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { marginTop: 12, fontSize: 20, fontWeight: "900", color: C.navy },
  lead: { marginTop: 6, fontSize: 13, color: C.muted, textAlign: "center", fontWeight: "600" },
  docs: { padding: 18, gap: 16 },
  doc: { backgroundColor: C.bg, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  kind: { fontSize: 11, fontWeight: "800", color: C.blue, textTransform: "uppercase" },
  docTitle: { marginTop: 4, fontSize: 16, fontWeight: "900", color: C.navy },
  body: { marginTop: 8, fontSize: 13, lineHeight: 19, color: C.text },
  foot: { padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: C.border },
  error: { color: C.danger, fontWeight: "700", fontSize: 12, textAlign: "center" },
  out: { textAlign: "center", color: C.muted, fontWeight: "700", fontSize: 13, paddingVertical: 4 },
});
