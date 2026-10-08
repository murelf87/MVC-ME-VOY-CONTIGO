import React, { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, ApiError } from "../api/client";
import { C } from "../theme";

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError || e instanceof Error ? e.message : fallback;
}

/** Five stars plus an optional comment; the backend allows one rating per person and booking. */
export function RatingPanel({
  token,
  bookingId,
  peerName,
  existing,
  onDone,
}: {
  token: string;
  bookingId: string;
  peerName: string;
  existing: number | null | undefined;
  onDone: () => void;
}) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (existing) {
    return (
      <View style={s.ratedRow}>
        <Text style={s.ratedText}>Tu valoración a {peerName}</Text>
        <Stars value={existing} />
      </View>
    );
  }

  async function submit() {
    if (!score) {
      setError("Elige de 1 a 5 estrellas.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/v1/bookings/${bookingId}/rating`, {
        method: "POST",
        token,
        body: { score, comment: comment.trim() || null },
      });
      onDone();
    } catch (e) {
      setError(errorText(e, "No se pudo enviar la valoración."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.panel}>
      <Text style={s.panelTitle}>¿Qué tal con {peerName}?</Text>
      <Stars value={score} onChange={setScore} />
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="Comentario opcional"
        maxLength={500}
        style={s.input}
      />
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Pressable style={[s.primary, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        <Text style={s.primaryText}>Enviar valoración</Text>
      </Pressable>
    </View>
  );
}

export function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <View style={s.stars} accessibilityRole={onChange ? "adjustable" : "text"} accessibilityLabel={`${value} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map(n => (
        <Pressable key={n} onPress={onChange ? () => onChange(n) : undefined} disabled={!onChange} hitSlop={6}>
          <Ionicons name={n <= value ? "star" : "star-outline"} size={onChange ? 30 : 18} color="#F5A524" />
        </Pressable>
      ))}
    </View>
  );
}

const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: "safety", label: "Seguridad" },
  { id: "behaviour", label: "Comportamiento" },
  { id: "no_show", label: "No se presentó" },
  { id: "vehicle", label: "Vehículo" },
  { id: "route", label: "Ruta u horario" },
  { id: "payment", label: "Pago" },
  { id: "other", label: "Otro" },
];

/** Report an incident on a trip, optionally blocking the person at the same time. */
export function ReportPanel({
  token,
  tripId,
  reportedUserId,
  peerName,
  onClose,
}: {
  token: string;
  tripId: string;
  reportedUserId: string;
  peerName: string;
  onClose: (sent: boolean) => void;
}) {
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!category) return setError("Elige un motivo.");
    if (description.trim().length < 10) return setError("Cuéntanos qué pasó (al menos 10 caracteres).");
    setBusy(true);
    setError("");
    try {
      await apiRequest("/v1/reports", {
        method: "POST",
        token,
        body: { tripId, reportedUserId, category, description: description.trim(), blockUser: block },
      });
      onClose(true);
    } catch (e) {
      setError(errorText(e, "No se pudo enviar el reporte."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.panel}>
      <View style={s.panelHead}>
        <Text style={s.panelTitle}>Reportar a {peerName}</Text>
        <Pressable onPress={() => onClose(false)} accessibilityLabel="Cerrar" hitSlop={8}>
          <Ionicons name="close" size={20} color={C.muted} />
        </Pressable>
      </View>
      <View style={s.chips}>
        {CATEGORIES.map(item => (
          <Pressable key={item.id} onPress={() => setCategory(item.id)} style={[s.chip, category === item.id && s.chipOn]}>
            <Text style={[s.chipText, category === item.id && s.chipTextOn]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Qué ocurrió, cuándo y dónde"
        multiline
        maxLength={2000}
        style={[s.input, { minHeight: 76, textAlignVertical: "top" }]}
      />
      <View style={s.switchRow}>
        <Text style={s.switchText}>Bloquear también a {peerName}</Text>
        <Switch value={block} onValueChange={setBlock} trackColor={{ true: C.blue, false: C.border }} />
      </View>
      <Text style={s.hint}>El equipo de soporte de MVC revisa cada reporte. Si hay peligro inmediato, llama al 112.</Text>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Pressable style={[s.danger, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        <Text style={s.primaryText}>Enviar reporte</Text>
      </Pressable>
    </View>
  );
}

/** Ask for confirmation (and a reason) before cancelling; the server applies the accepted policy. */
export function CancelPanel({
  title,
  explanation,
  requireReason,
  allowForceMajeure,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  explanation: string;
  requireReason: boolean;
  allowForceMajeure?: boolean;
  confirmLabel: string;
  onConfirm: (reason: string, forceMajeure: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [forceMajeure, setForceMajeure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (requireReason && reason.trim().length < 3) return setError("Escribe el motivo para avisar a los pasajeros.");
    setBusy(true);
    setError("");
    try {
      await onConfirm(reason.trim(), forceMajeure);
    } catch (e) {
      setError(errorText(e, "No se pudo cancelar."));
      setBusy(false);
    }
  }

  return (
    <View style={s.panel}>
      <View style={s.panelHead}>
        <Text style={s.panelTitle}>{title}</Text>
        <Pressable onPress={onClose} accessibilityLabel="Cerrar" hitSlop={8}>
          <Ionicons name="close" size={20} color={C.muted} />
        </Pressable>
      </View>
      <Text style={s.hint}>{explanation}</Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder={requireReason ? "Motivo" : "Motivo (opcional)"}
        maxLength={500}
        style={s.input}
      />
      {allowForceMajeure ? (
        <View style={s.switchRow}>
          <Text style={s.switchText}>Causa de fuerza mayor</Text>
          <Switch value={forceMajeure} onValueChange={setForceMajeure} trackColor={{ true: C.blue, false: C.border }} />
        </View>
      ) : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Pressable style={[s.danger, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        <Text style={s.primaryText}>{confirmLabel}</Text>
      </Pressable>
    </View>
  );
}

export function refundText(refundCents: number | null | undefined, refundStatus: string | null | undefined): string | null {
  if (!refundStatus) return null;
  if (refundStatus === "not_applicable") return "Cancelada sin cargo.";
  if (refundStatus === "pending_policy") return "Cancelada. El reembolso lo revisa MVC según la política de cancelación.";
  const euros = ((refundCents ?? 0) / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  if (refundStatus === "pending_provider") return `Cancelada. Reembolso de ${euros} pendiente de tramitar.`;
  return `Cancelada. Reembolso de ${euros} realizado.`;
}

const s = StyleSheet.create({
  panel: { marginTop: 12, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12, backgroundColor: C.bg, gap: 10 },
  panelHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  panelTitle: { fontSize: 14, fontWeight: "900", color: C.navy, flexShrink: 1 },
  stars: { flexDirection: "row", gap: 6 },
  input: { minHeight: 44, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.navy, backgroundColor: "#fff" },
  primary: { height: 44, borderRadius: 12, backgroundColor: C.blue, alignItems: "center", justifyContent: "center" },
  danger: { height: 44, borderRadius: 12, backgroundColor: "#C93A3A", alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  error: { color: "#9E302D", backgroundColor: "#FFF0EF", padding: 9, borderRadius: 10, fontSize: 12 },
  hint: { fontSize: 11, lineHeight: 16, color: C.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#fff" },
  chipOn: { backgroundColor: C.navy, borderColor: C.navy },
  chipText: { fontSize: 11, fontWeight: "800", color: C.navy },
  chipTextOn: { color: "#fff" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  switchText: { fontSize: 12, fontWeight: "800", color: C.navy, flexShrink: 1 },
  ratedRow: { marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  ratedText: { fontSize: 11, color: C.muted, fontWeight: "700", flexShrink: 1 },
});

type BlockedPerson = { user_id: string; display_name: string | null; created_at: string };

/** People the user has blocked; unblocking restores chat if a booking still allows it. */
export function BlockedPeople({ token }: { token: string }) {
  const [items, setItems] = useState<BlockedPerson[] | null>(null);
  const [error, setError] = useState("");

  React.useEffect(() => {
    let alive = true;
    apiRequest<{ blocks: BlockedPerson[] }>("/v1/me/blocks", { token })
      .then(r => alive && setItems(r.blocks))
      .catch(e => alive && setError(errorText(e, "No se pudieron cargar los bloqueos.")));
    return () => { alive = false; };
  }, [token]);

  async function unblock(userId: string) {
    try {
      await apiRequest(`/v1/me/blocks/${userId}`, { method: "DELETE", token });
      setItems(current => (current ?? []).filter(item => item.user_id !== userId));
    } catch (e) {
      setError(errorText(e, "No se pudo desbloquear."));
    }
  }

  return (
    <View style={b.wrap}>
      <Text style={b.title}>Personas bloqueadas</Text>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {items && !items.length ? <Text style={s.hint}>No has bloqueado a nadie.</Text> : null}
      {(items ?? []).map(item => (
        <View key={item.user_id} style={b.row}>
          <Ionicons name="person-remove-outline" size={18} color={C.muted} />
          <Text style={b.name}>{item.display_name || "Usuario MVC"}</Text>
          <Pressable onPress={() => void unblock(item.user_id)} style={b.button}>
            <Text style={b.buttonText}>Desbloquear</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const b = StyleSheet.create({
  wrap: { gap: 8 },
  title: { fontSize: 14, fontWeight: "900", color: C.navy },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  name: { flex: 1, fontSize: 13, fontWeight: "800", color: C.navy },
  button: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  buttonText: { fontSize: 11, fontWeight: "900", color: C.blue },
});
