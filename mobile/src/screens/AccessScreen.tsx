import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ApiError } from "../api/client";
import type { Role } from "../api/types";
import { Brand, Card, PrimaryButton } from "../components/UI";
import { useAuth } from "../session/AuthContext";
import { C } from "../theme";

export function AccessScreen() {
  const { startVerification, verifyCode } = useAuth();
  const [roles, setRoles] = useState<Role[]>(["passenger"]);
  const [phone, setPhone] = useState("+34");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const subtitle = useMemo(() => {
    if (roles.length === 2) return "Pasajero y conductor";
    return roles[0] === "driver" ? "Conductor" : "Pasajero";
  }, [roles]);

  function toggle(role: Role) {
    setRoles(current => {
      if (current.includes(role)) {
        return current.length === 1 ? current : current.filter(item => item !== role);
      }
      return [...current, role];
    });
  }

  async function begin() {
    setBusy(true);
    setError("");
    try {
      const result = await startVerification(phone.trim(), roles);
      setChallengeId(result.challengeId);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "No se pudo iniciar la verificación por teléfono."
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!challengeId) return;
    setBusy(true);
    setError("");
    try {
      await verifyCode(challengeId, code.trim());
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "No se pudo verificar el código."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={s.wrap}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.top}>
          <Brand />
          <View style={s.badge}>
            <Text style={s.badgeText}>Acceso seguro</Text>
          </View>
        </View>

        <Text style={s.title}>¿Cómo quieres viajar?</Text>
        <Text style={s.subtitle}>Elige tu perfil para empezar.</Text>

        <View style={s.roles}>
          <Pressable
            onPress={() => toggle("passenger")}
            style={[s.roleCard, roles.includes("passenger") && s.roleActive]}
          >
            <View style={s.illustration}>
              <Ionicons name="person" size={56} color={C.blue} />
              <Ionicons
                name="location"
                size={30}
                color={C.mint}
                style={s.roleCorner}
              />
            </View>
            <Text style={s.roleTitle}>Soy pasajero</Text>
            <Text style={s.roleText}>Reserva tu plaza para ir a tu destino.</Text>
            <Ionicons name="chevron-forward" size={19} color={C.navy} />
          </Pressable>

          <Pressable
            onPress={() => toggle("driver")}
            style={[s.roleCard, roles.includes("driver") && s.roleActive]}
          >
            <View style={[s.illustration, { backgroundColor: C.mintPale }]}>
              <Ionicons name="car-sport" size={58} color={C.blue} />
              <Ionicons
                name="people"
                size={28}
                color={C.mint}
                style={s.roleCorner}
              />
            </View>
            <Text style={s.roleTitle}>Soy conductor</Text>
            <Text style={s.roleText}>Comparte tu coche y los gastos.</Text>
            <Ionicons name="chevron-forward" size={19} color={C.navy} />
          </Pressable>
        </View>

        <Text style={s.both}>
          Puedes activar ambos perfiles.
        </Text>

        <Card style={s.form}>
          <Text style={s.formTitle}>
            {challengeId ? "Introduce el código" : "Acceso con teléfono"}
          </Text>
          <Text style={s.formMeta}>
            {challengeId
              ? "Usa el código que te ha enviado el proveedor de verificación."
              : subtitle + ". Tu número se verifica antes de crear la sesión."}
          </Text>

          {!challengeId ? (
            <>
              <Text style={s.label}>Número de móvil</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoCapitalize="none"
                style={s.input}
                placeholder="+34 600 000 000"
                placeholderTextColor="#91A0BC"
              />
              <PrimaryButton
                title={busy ? "Enviando..." : "Verificar móvil"}
                onPress={() => void begin()}
                disabled={busy}
              />
            </>
          ) : (
            <>
              <Text style={s.label}>Código de verificación</Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                style={[s.input, s.codeInput]}
                placeholder="000000"
                placeholderTextColor="#91A0BC"
                maxLength={10}
              />
              <PrimaryButton
                title={busy ? "Comprobando..." : "Entrar en MVC"}
                onPress={() => void verify()}
                disabled={busy || code.trim().length < 4}
              />
              <Pressable
                style={s.restart}
                onPress={() => {
                  setChallengeId(null);
                  setCode("");
                  setError("");
                }}
              >
                <Text style={s.restartText}>Cambiar número</Text>
              </Pressable>
            </>
          )}

          {busy ? <ActivityIndicator style={{ marginTop: 12 }} color={C.blue} /> : null}
          {error ? <Text style={s.error}>{error}</Text> : null}
        </Card>

        <View style={s.privacy}>
          <Ionicons name="shield-checkmark-outline" size={22} color={C.blue} />
          <Text style={s.privacyText}>
            No hay contraseñas maestras ni códigos universales. El backend valida la sesión.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 18, paddingBottom: 40, backgroundColor: "#fff" },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  badge: { backgroundColor: C.pale, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { fontSize: 10, fontWeight: "900", color: C.blue },
  title: { fontSize: 30, fontWeight: "900", color: C.navy, marginTop: 26, letterSpacing: -0.7 },
  subtitle: { fontSize: 15, color: C.muted, marginTop: 3, marginBottom: 16 },
  roles: { gap: 10 },
  roleCard: {
    minHeight: 138,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    backgroundColor: "#fff",
  },
  roleActive: { borderColor: C.blue, backgroundColor: "#F8FBFF" },
  illustration: {
    height: 62,
    borderRadius: 14,
    backgroundColor: C.pale,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    marginBottom: 9,
  },
  roleCorner: { position: "absolute", right: 18, bottom: 10 },
  roleTitle: { fontSize: 17, fontWeight: "900", color: C.navy },
  roleText: { fontSize: 12, color: C.muted, marginTop: 2, paddingRight: 28 },
  both: { textAlign: "center", color: C.navy, fontSize: 12, fontWeight: "700", marginVertical: 14 },
  form: { padding: 16 },
  formTitle: { fontSize: 18, fontWeight: "900", color: C.navy },
  formMeta: { fontSize: 12, lineHeight: 18, color: C.muted, marginTop: 4, marginBottom: 14 },
  label: { fontSize: 12, fontWeight: "800", color: C.navy, marginBottom: 7 },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 16,
    color: C.navy,
    backgroundColor: "#fff",
  },
  codeInput: { textAlign: "center", fontSize: 24, fontWeight: "900", letterSpacing: 6 },
  restart: { alignItems: "center", padding: 12 },
  restartText: { fontSize: 12, fontWeight: "800", color: C.blue },
  error: {
    marginTop: 12,
    color: "#9E302D",
    backgroundColor: "#FFF0EF",
    borderRadius: 12,
    padding: 11,
    fontSize: 12,
    lineHeight: 17,
  },
  privacy: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 14, paddingHorizontal: 4 },
  privacyText: { flex: 1, fontSize: 11, color: C.muted, lineHeight: 16 },
});
