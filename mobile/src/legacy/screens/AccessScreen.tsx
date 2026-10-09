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
import { ApiError } from "../../api/client";
import type { Role } from "../../api/types";
import { Card, PrimaryButton } from "../components/UI";
import { OfficialLogo } from "../components/OfficialLogo";
import { useAuth } from "../../session/AuthContext";
import { C, shadow } from "../theme";

export function AccessScreen() {
  const { startVerification, verifyCode } = useAuth();
  const [roles, setRoles] = useState<Role[]>(["passenger"]);
  const [phone, setPhone] = useState("+34");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const hasDriver = roles.includes("driver");
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
    setChallengeId(null);
    setCode("");
    setError("");
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
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={s.wrap}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.brandRow}>
          <OfficialLogo width={222} />
          <View style={s.secureBadge}>
            <Ionicons name="shield-checkmark" size={14} color={C.blue} />
            <Text style={s.secureText}>Acceso seguro</Text>
          </View>
        </View>

        <View style={s.hero}>
          <Text style={s.eyebrow}>BIENVENIDO A MVC</Text>
          <Text style={s.title}>¿Cómo quieres viajar?</Text>
          <Text style={s.subtitle}>
            Entra como pasajero, conductor o activa ambos perfiles.
          </Text>
        </View>

        <View style={s.roles}>
          <Pressable
            onPress={() => toggle("passenger")}
            style={[s.roleCard, roles.includes("passenger") && s.roleActive]}
          >
            <View style={[s.roleIcon, s.passengerIcon]}>
              <Ionicons name="person" size={35} color={C.blue} />
              <Ionicons name="location" size={20} color={C.mint} style={s.cornerIcon} />
            </View>
            <View style={s.roleBody}>
              <View style={s.roleTitleRow}>
                <Text style={s.roleTitle}>Soy pasajero</Text>
                {roles.includes("passenger") ? (
                  <Ionicons name="checkmark-circle" size={21} color={C.blue} />
                ) : null}
              </View>
              <Text style={s.roleText}>
                Busca trayectos, solicita plaza y sigue el coche en directo.
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => toggle("driver")}
            style={[s.roleCard, roles.includes("driver") && s.roleActive]}
          >
            <View style={[s.roleIcon, s.driverIcon]}>
              <Ionicons name="car-sport" size={38} color={C.blue} />
              <Ionicons name="people" size={19} color={C.mint} style={s.cornerIcon} />
            </View>
            <View style={s.roleBody}>
              <View style={s.roleTitleRow}>
                <Text style={s.roleTitle}>Soy conductor</Text>
                {roles.includes("driver") ? (
                  <Ionicons name="checkmark-circle" size={21} color={C.blue} />
                ) : null}
              </View>
              <Text style={s.roleText}>
                Publica tus trayectos y decide qué solicitudes aceptar.
              </Text>
              <Text style={s.driverRequirement}>
                Durante el registro añadirás matrícula, datos del coche, foto del
                vehículo y seguro en vigor.
              </Text>
            </View>
          </Pressable>
        </View>

        <View style={s.bothRow}>
          <Ionicons name="people-circle-outline" size={21} color={C.blue} />
          <Text style={s.bothText}>Puedes activar ambos perfiles en una sola cuenta.</Text>
        </View>

        <Card style={s.form}>
          <View style={s.formHeader}>
            <View style={s.phoneIcon}>
              <Ionicons name="phone-portrait-outline" size={23} color={C.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.formTitle}>
                {challengeId ? "Introduce el código" : "Acceso con teléfono"}
              </Text>
              <Text style={s.formMeta}>
                {challengeId
                  ? "Introduce el código enviado a tu móvil para continuar."
                  : hasDriver
                    ? "Verifica tu móvil y después completa el registro del coche."
                    : subtitle + ". Verifica tu móvil para entrar en MVC."}
              </Text>
            </View>
          </View>

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
                title={busy ? "Enviando…" : "Verificar móvil"}
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
                title={busy ? "Comprobando…" : "Continuar"}
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

          {busy ? <ActivityIndicator style={s.spinner} color={C.blue} /> : null}
          {error ? <Text style={s.error}>{error}</Text> : null}
        </Card>

        {hasDriver ? (
          <View style={s.driverInfo}>
            <Ionicons name="shield-checkmark-outline" size={22} color={C.blue} />
            <Text style={s.driverInfoText}>
              Un conductor no podrá publicar ni iniciar viajes hasta que la foto
              del coche y el seguro estén validados. Si el seguro caduca, MVC
              bloqueará la conducción hasta verificar la renovación.
            </Text>
          </View>
        ) : (
          <View style={s.trust}>
            <Ionicons name="shield-checkmark-outline" size={21} color={C.blue} />
            <Text style={s.trustText}>
              Acceso sin contraseña maestra ni códigos universales. La sesión la
              valida el backend de MVC.
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  wrap: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 14 : 22,
    paddingBottom: 42,
    backgroundColor: "#fff",
  },
  brandRow: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  secureBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.pale,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  secureText: { fontSize: 10, fontWeight: "900", color: C.blue },
  hero: { marginTop: 18, marginBottom: 18 },
  eyebrow: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
    color: C.blue,
    marginBottom: 7,
  },
  title: {
    fontSize: 34,
    lineHeight: 39,
    fontWeight: "900",
    color: C.navy,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: C.muted,
    marginTop: 5,
  },
  roles: { gap: 11 },
  roleCard: {
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: "#fff",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    ...shadow,
  },
  roleActive: { borderColor: C.blue, backgroundColor: "#F8FBFF" },
  roleIcon: {
    width: 74,
    height: 74,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    flexShrink: 0,
  },
  passengerIcon: { backgroundColor: C.pale },
  driverIcon: { backgroundColor: C.mintPale },
  cornerIcon: { position: "absolute", right: 9, bottom: 8 },
  roleBody: { flex: 1 },
  roleTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  roleTitle: { fontSize: 18, fontWeight: "900", color: C.navy },
  roleText: {
    fontSize: 12,
    lineHeight: 17,
    color: C.muted,
    marginTop: 4,
  },
  driverRequirement: {
    fontSize: 10,
    lineHeight: 15,
    color: C.blue,
    fontWeight: "800",
    marginTop: 6,
  },
  bothRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginVertical: 15,
  },
  bothText: {
    fontSize: 11,
    color: C.navy,
    fontWeight: "800",
    textAlign: "center",
  },
  form: { padding: 17 },
  formHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 15,
  },
  phoneIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: C.pale,
    alignItems: "center",
    justifyContent: "center",
  },
  formTitle: { fontSize: 18, fontWeight: "900", color: C.navy },
  formMeta: {
    fontSize: 11,
    lineHeight: 16,
    color: C.muted,
    marginTop: 3,
  },
  label: {
    fontSize: 12,
    fontWeight: "900",
    color: C.navy,
    marginBottom: 7,
  },
  input: {
    height: 54,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 15,
    paddingHorizontal: 14,
    fontSize: 16,
    color: C.navy,
    backgroundColor: "#fff",
  },
  codeInput: {
    textAlign: "center",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 6,
  },
  restart: { alignItems: "center", padding: 12 },
  restartText: { fontSize: 11, fontWeight: "900", color: C.blue },
  spinner: { marginTop: 12 },
  error: {
    marginTop: 12,
    color: "#9E302D",
    backgroundColor: "#FFF0EF",
    borderRadius: 12,
    padding: 11,
    fontSize: 11,
    lineHeight: 16,
  },
  driverInfo: {
    flexDirection: "row",
    gap: 9,
    alignItems: "flex-start",
    backgroundColor: "#F7FAFF",
    borderRadius: 15,
    padding: 13,
    marginTop: 14,
  },
  driverInfoText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    color: C.muted,
  },
  trust: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    paddingHorizontal: 3,
    marginTop: 14,
  },
  trustText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    color: C.muted,
  },
});
