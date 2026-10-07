import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, PrimaryButton } from "../components/UI";
import { useAuth } from "../session/AuthContext";
import { C } from "../theme";

function statusLabel(value: string | null | undefined): string {
  switch (value) {
    case "approved":
    case "verified":
      return "Verificado";
    case "pending":
      return "Pendiente";
    case "rejected":
      return "Revisión necesaria";
    case "unverified":
      return "Sin verificar";
    default:
      return "Pendiente";
  }
}

export function ProfileScreen() {
  const { profile, roles, refreshProfile, logout } = useAuth();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      await refreshProfile();
    } finally {
      setBusy(false);
    }
  }

  async function closeSession() {
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Tu perfil MVC</Text>
      <Text style={s.subtitle}>
        Foto pública, verificación y roles de tu cuenta.
      </Text>

      <View style={s.roleTabs}>
        {roles.includes("driver") ? (
          <View style={[s.role, s.roleActive]}>
            <Ionicons name="car-sport-outline" size={20} color={C.blue} />
            <Text style={s.roleActiveText}>Conductor</Text>
          </View>
        ) : null}
        {roles.includes("passenger") ? (
          <View style={[s.role, roles.length === 1 && s.roleActive]}>
            <Ionicons name="person-outline" size={20} color={C.navy} />
            <Text style={roles.length === 1 ? s.roleActiveText : s.roleText}>
              Pasajero
            </Text>
          </View>
        ) : null}
      </View>

      <Card style={s.account}>
        <View style={s.avatar}>
          <Ionicons name="person" size={54} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>
            {profile?.display_name?.trim() || "Perfil MVC"}
          </Text>
          <Text style={s.phone}>{profile?.phone_e164 ?? "Teléfono verificado"}</Text>
          <View style={s.roleLine}>
            <Text style={s.roleSummary}>
              {roles.length === 2
                ? "Pasajero y conductor"
                : roles[0] === "driver"
                  ? "Conductor"
                  : "Pasajero"}
            </Text>
          </View>
        </View>
      </Card>

      <Card style={s.statusCard}>
        <View style={s.statusRow}>
          <View style={s.statusIcon}>
            <Ionicons name="camera-outline" size={22} color={C.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.statusTitle}>Foto pública</Text>
            <Text style={s.statusMeta}>
              {statusLabel(profile?.public_photo_status)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.navy} />
        </View>

        <View style={s.divider} />

        <View style={s.statusRow}>
          <View style={s.statusIcon}>
            <Ionicons name="shield-checkmark-outline" size={22} color={C.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.statusTitle}>Identidad</Text>
            <Text style={s.statusMeta}>
              {statusLabel(profile?.identity_status)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.navy} />
        </View>

        <View style={s.divider} />

        <View style={s.statusRow}>
          <View style={s.statusIcon}>
            <Ionicons name="scan-outline" size={22} color={C.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.statusTitle}>Comprobación de presencia</Text>
            <Text style={s.statusMeta}>
              {profile?.presence_status ?? "Pendiente de definir"}
            </Text>
          </View>
        </View>
      </Card>

      <Card style={s.notice}>
        <View style={s.cameraBubble}>
          <Ionicons name="camera" size={26} color={C.blue} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.noticeTitle}>Foto obligatoria para ambos perfiles.</Text>
          <Text style={s.noticeText}>
            Rostro visible, sin filtros ni otras personas.
          </Text>
        </View>
      </Card>

      <View style={s.actions}>
        <Pressable style={s.outlineButton}>
          <Ionicons name="camera-outline" size={20} color={C.blue} />
          <Text style={s.outlineText}>Hacer foto</Text>
        </Pressable>
        <Pressable style={s.outlineButton}>
          <Ionicons name="images-outline" size={20} color={C.blue} />
          <Text style={s.outlineText}>Elegir de galería</Text>
        </Pressable>
      </View>

      <Card style={s.privacy}>
        <Ionicons name="information-circle" size={23} color={C.blue} />
        <Text style={s.privacyText}>
          La foto pública y los documentos privados se tratan por separado.
          La biometría facial permanece desactivada hasta completar sus requisitos.
        </Text>
      </Card>

      <PrimaryButton
        title={busy ? "Actualizando..." : "Actualizar estado"}
        onPress={() => void refresh()}
        disabled={busy}
      />
      <Pressable style={s.logout} onPress={() => void closeSession()} disabled={busy}>
        <Ionicons name="log-out-outline" size={20} color="#A73535" />
        <Text style={s.logoutText}>Cerrar sesión</Text>
      </Pressable>
      {busy ? <ActivityIndicator color={C.blue} style={{ marginTop: 10 }} /> : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 18, paddingBottom: 32, backgroundColor: "#fff" },
  title: { fontSize: 25, fontWeight: "900", color: C.navy, textAlign: "center" },
  subtitle: { fontSize: 13, color: C.muted, textAlign: "center", marginTop: 4, marginBottom: 16 },
  roleTabs: { flexDirection: "row", gap: 8, marginBottom: 12 },
  role: {
    flex: 1,
    height: 46,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  roleActive: { borderColor: C.blue, backgroundColor: "#F6FAFF" },
  roleText: { fontSize: 13, fontWeight: "800", color: C.navy },
  roleActiveText: { fontSize: 13, fontWeight: "900", color: C.blue },
  account: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#6E98B7",
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 19, fontWeight: "900", color: C.navy },
  phone: { fontSize: 12, color: C.muted, marginTop: 4 },
  roleLine: { marginTop: 7, alignSelf: "flex-start", backgroundColor: C.pale, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  roleSummary: { fontSize: 10, fontWeight: "900", color: C.blue },
  statusCard: { marginTop: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.pale, alignItems: "center", justifyContent: "center" },
  statusTitle: { fontSize: 14, fontWeight: "900", color: C.navy },
  statusMeta: { fontSize: 11, color: C.muted, marginTop: 2 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 11 },
  notice: { marginTop: 12, backgroundColor: C.pale, flexDirection: "row", gap: 12, alignItems: "center" },
  cameraBubble: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#CFE4FF", alignItems: "center", justifyContent: "center" },
  noticeTitle: { fontSize: 14, fontWeight: "900", color: C.navy },
  noticeText: { fontSize: 12, color: C.muted, marginTop: 4 },
  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  outlineButton: { flex: 1, height: 50, borderRadius: 14, borderWidth: 1, borderColor: C.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  outlineText: { fontSize: 12, fontWeight: "800", color: C.blue },
  privacy: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "#F7FAFF" },
  privacyText: { fontSize: 11, lineHeight: 16, color: C.muted, flex: 1 },
  logout: { height: 50, marginTop: 10, borderWidth: 1, borderColor: "#F0CACA", borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  logoutText: { color: "#A73535", fontWeight: "900", fontSize: 13 },
});
