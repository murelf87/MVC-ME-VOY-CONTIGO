import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, apiRequest } from "../api/client";
import { useAuth } from "../session/AuthContext";
import { C } from "../theme";

const msg = (e: unknown, fallback: string) => {
  if (!(e instanceof ApiError)) return fallback;
  const text: Record<string, string> = {
    AUTH_CODE_INVALID_OR_EXPIRED: "El código no es correcto o ha caducado. Pide otro.",
    AUTH_RESEND_TOO_SOON: "Espera un minuto antes de pedir otro código.",
    EMAIL_PROVIDER_UNAVAILABLE: "Ahora mismo no podemos enviar correos.",
    INVALID_CREDENTIALS: "La contraseña actual no es correcta.",
    PASSWORD_TOO_WEAK: "La nueva contraseña es demasiado corta o fácil de adivinar.",
  };
  return text[e.code] ?? e.message;
};

/** Email confirmation and password change, at the top of Profile. */
export function AccountSecurity() {
  const { token, profile, refreshProfile } = useAuth();
  const [code, setCode] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>, fallback: string) {
    setBusy(true); setError(""); setNote("");
    try { await fn(); } catch (e) { setError(msg(e, fallback)); } finally { setBusy(false); }
  }

  return (
    <View style={s.box}>
      <View style={s.row}>
        <Ionicons name="mail-outline" size={18} color={C.blue} />
        <Text style={s.email} numberOfLines={1}>{profile?.email ?? "Sin correo"}</Text>
        <Text style={[s.badge, profile?.email_verified ? s.ok : s.pending]}>
          {profile?.email_verified ? "Confirmado" : "Sin confirmar"}
        </Text>
      </View>

      {profile && !profile.email_verified ? (
        <View style={s.block}>
          <Text style={s.text}>Escribe el código de 6 cifras que te enviamos al crear la cuenta.</Text>
          <View style={s.inline}>
            <TextInput value={code} onChangeText={v => setCode(v.replace(/\D/g, ""))} placeholder="000000" maxLength={6}
              keyboardType="number-pad" style={[s.input, { flex: 1 }]} />
            <Pressable disabled={busy || code.length !== 6} style={[s.btn, (busy || code.length !== 6) && s.off]}
              onPress={() => void run(async () => {
                await apiRequest("/v1/auth/email/verify", { method: "POST", token, body: { code } });
                setCode(""); await refreshProfile(); setNote("Correo confirmado.");
              }, "No se pudo confirmar.")}>
              <Text style={s.btnText}>Confirmar</Text>
            </Pressable>
          </View>
          <Text style={s.link} onPress={() => void run(async () => {
            await apiRequest("/v1/auth/email/resend", { method: "POST", token });
            setNote("Te hemos enviado un código nuevo.");
          }, "No se pudo enviar el código.")}>Enviar otro código</Text>
        </View>
      ) : null}

      {!open ? (
        <Text style={s.link} onPress={() => { setOpen(true); setNote(""); setError(""); }}>Cambiar contraseña</Text>
      ) : (
        <View style={s.block}>
          <TextInput value={current} onChangeText={setCurrent} placeholder="Contraseña actual" secureTextEntry autoCapitalize="none" style={s.input} />
          <TextInput value={next} onChangeText={setNext} placeholder="Nueva contraseña (mín. 10)" secureTextEntry autoCapitalize="none" style={s.input} />
          <View style={s.inline}>
            <Pressable disabled={busy || !current || next.length < 10} style={[s.btn, (busy || !current || next.length < 10) && s.off]}
              onPress={() => void run(async () => {
                await apiRequest("/v1/auth/password/change", { method: "POST", token, body: { currentPassword: current, newPassword: next } });
                setCurrent(""); setNext(""); setOpen(false);
                setNote("Contraseña cambiada. Se han cerrado tus otras sesiones.");
              }, "No se pudo cambiar la contraseña.")}>
              <Text style={s.btnText}>Guardar</Text>
            </Pressable>
            <Text style={s.link} onPress={() => { setOpen(false); setCurrent(""); setNext(""); }}>Cancelar</Text>
          </View>
        </View>
      )}
      {note ? <Text style={s.note}>{note}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginTop: 8, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  email: { flex: 1, fontSize: 12, color: C.text, fontWeight: "700" },
  badge: { fontSize: 10, fontWeight: "900", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
  ok: { backgroundColor: C.mintPale, color: "#167A5B" },
  pending: { backgroundColor: C.softWarning, color: "#966112" },
  block: { gap: 8 },
  inline: { flexDirection: "row", alignItems: "center", gap: 10 },
  text: { fontSize: 11, color: C.muted, lineHeight: 16 },
  input: { minHeight: 42, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, fontSize: 14, color: C.navy },
  btn: { height: 42, paddingHorizontal: 16, borderRadius: 10, backgroundColor: C.blue, alignItems: "center", justifyContent: "center" },
  off: { opacity: 0.4 },
  btnText: { color: "#fff", fontWeight: "900", fontSize: 13 },
  link: { color: C.blue, fontWeight: "800", fontSize: 12 },
  note: { color: "#167A5B", fontSize: 11, fontWeight: "700" },
  error: { color: C.danger, fontSize: 11, fontWeight: "700" },
});
