import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { apiRequest } from "../api/client";
import { useAuth } from "../session/AuthContext";
import { C } from "../theme";

type Check = { canDelete: boolean; blockers: { code: string; count: number }[] };

const BLOCKER: Record<string, string> = {
  OPEN_TRIPS_AS_DRIVER: "Tienes viajes publicados o en marcha como conductor. Termínalos o cancélalos.",
  OPEN_BOOKINGS: "Tienes solicitudes o reservas en viajes que aún no han terminado. Cancélalas o espera a que acaben.",
  REFUNDS_PENDING: "Tienes un reembolso pendiente. Espera a recibirlo para no perderlo.",
  DRIVER_BALANCE_UNSETTLED: "Tienes ganancias pendientes de cobrar. Espera a la transferencia del mes.",
  LAST_ADMIN: "Eres la única persona administradora. Da el rol a otra persona antes.",
};

/** Lets anyone delete their own account from the app, as both app stores require. */
export function DeleteAccount() {
  const { token, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setOpen(true);
    setError("");
    setBusy(true);
    try {
      setCheck(await apiRequest<Check>("/v1/me/account/deletion", { token }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo comprobar tu cuenta.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await apiRequest("/v1/me/account/delete", { method: "POST", token, body: { confirm: typed.trim().toUpperCase() } });
      await logout();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar la cuenta.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Pressable onPress={() => void start()} style={s.link}>
        <Text style={s.linkText}>Eliminar mi cuenta</Text>
      </Pressable>
    );
  }

  return (
    <View style={s.box}>
      <Text style={s.title}>Eliminar mi cuenta</Text>
      {busy && !check ? <ActivityIndicator color={C.blue} /> : null}
      {check && !check.canDelete ? (
        <>
          <Text style={s.text}>Todavía no se puede eliminar:</Text>
          {check.blockers.map(b => <Text key={b.code} style={s.item}>• {BLOCKER[b.code] ?? b.code}</Text>)}
        </>
      ) : null}
      {check?.canDelete ? (
        <>
          <Text style={s.text}>
            Se borran tu correo y contraseña, tu nombre, tus fotos y documentos, tus avisos y bloqueos, y se cierran tus sesiones. Los viajes, pagos,
            valoraciones y reportes ya hechos se conservan sin tus datos, porque la contabilidad y la seguridad de otras personas los necesitan.
            No se puede deshacer.
          </Text>
          <TextInput value={typed} onChangeText={setTyped} placeholder="Escribe BORRAR para confirmar" autoCapitalize="characters" style={s.input} />
          <Pressable
            onPress={() => void remove()}
            disabled={busy || typed.trim().toUpperCase() !== "BORRAR"}
            style={[s.danger, (busy || typed.trim().toUpperCase() !== "BORRAR") && { opacity: 0.4 }]}
          >
            <Text style={s.dangerText}>{busy ? "Eliminando…" : "Eliminar definitivamente"}</Text>
          </Pressable>
        </>
      ) : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Pressable onPress={() => { setOpen(false); setTyped(""); setCheck(null); }} style={s.link}>
        <Text style={s.cancel}>Cancelar</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  link: { alignSelf: "center", paddingVertical: 12 },
  linkText: { color: C.muted, fontWeight: "700", fontSize: 13, textDecorationLine: "underline" },
  box: { marginTop: 12, borderWidth: 1, borderColor: "#F0CACA", borderRadius: 15, padding: 14, gap: 8 },
  title: { fontSize: 15, fontWeight: "900", color: "#A73535" },
  text: { fontSize: 12, lineHeight: 18, color: C.text },
  item: { fontSize: 12, lineHeight: 18, color: C.text },
  input: { minHeight: 42, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, fontSize: 14, color: C.navy },
  danger: { height: 46, borderRadius: 13, backgroundColor: "#C93A3A", alignItems: "center", justifyContent: "center" },
  dangerText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  error: { color: C.danger, fontWeight: "700", fontSize: 12 },
  cancel: { color: C.muted, fontWeight: "700", fontSize: 13 },
});
