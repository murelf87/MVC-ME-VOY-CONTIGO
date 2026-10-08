import React, { useEffect, useState } from "react";
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
import type { Vehicle } from "../api/types";
import { Card, PrimaryButton } from "../components/UI";
import { BlockedPeople } from "../components/TripFeedback";
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
  const { profile, roles, token, refreshProfile, logout } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [passengerSeats, setPassengerSeats] = useState("4");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const isDriver = roles.includes("driver");

  useEffect(() => {
    setDisplayName(profile?.display_name ?? "");
  }, [profile?.display_name]);

  useEffect(() => {
    if (!token || !isDriver) return;
    let mounted = true;
    void (async () => {
      try {
        const response = await apiRequest<{ vehicles: Vehicle[] }>(
          "/v1/me/vehicles",
          { token }
        );
        if (mounted) setVehicles(response.vehicles);
      } catch (e) {
        if (mounted) {
          setError(
            e instanceof ApiError ? e.message : "No se pudieron cargar tus vehículos."
          );
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [token, isDriver]);

  async function saveName() {
    if (!token) return;
    const normalized = displayName.trim();
    if (normalized.length < 2) {
      setError("El nombre visible debe tener al menos 2 caracteres.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest("/v1/me/profile", {
        method: "PATCH",
        token,
        body: { displayName: normalized },
      });
      await refreshProfile();
      setNotice("Nombre actualizado.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo actualizar el perfil.");
    } finally {
      setBusy(false);
    }
  }

  async function reloadVehicles() {
    if (!token || !isDriver) return;
    const response = await apiRequest<{ vehicles: Vehicle[] }>(
      "/v1/me/vehicles",
      { token }
    );
    setVehicles(response.vehicles);
  }

  async function createVehicle() {
    if (!token) return;
    const seats = Number(passengerSeats);
    if (!make.trim() || !model.trim() || !plate.trim()) {
      setError("Completa marca, modelo y matrícula.");
      return;
    }
    if (!Number.isInteger(seats) || seats < 1 || seats > 8) {
      setError("Las plazas de pasajeros deben estar entre 1 y 8.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest<Vehicle>("/v1/me/vehicles", {
        method: "POST",
        token,
        body: {
          make: make.trim(),
          model: model.trim(),
          plate: plate.trim(),
          passengerSeats: seats,
        },
      });
      await reloadVehicles();
      setMake("");
      setModel("");
      setPlate("");
      setPassengerSeats("4");
      setShowVehicleForm(false);
      setNotice("Vehículo registrado. Queda pendiente de revisión.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo registrar el vehículo.");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await refreshProfile();
      if (isDriver) await reloadVehicles();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo actualizar el estado.");
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
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Tu perfil MVC</Text>
      <Text style={s.subtitle}>
        Datos reales de tu cuenta, verificación y vehículos.
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
          <Text style={s.name}>{profile?.display_name?.trim() || "Perfil MVC"}</Text>
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

      <Text style={s.sectionTitle}>Nombre visible</Text>
      <Card>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          style={s.input}
          placeholder="Nombre y apellidos"
          placeholderTextColor="#91A0BC"
          maxLength={80}
        />
        <PrimaryButton
          title={busy ? "Guardando..." : "Guardar nombre"}
          onPress={() => void saveName()}
          disabled={busy || displayName.trim() === (profile?.display_name ?? "").trim()}
        />
      </Card>

      <Text style={s.sectionTitle}>Verificación</Text>
      <Card style={s.statusCard}>
        <View style={s.statusRow}>
          <View style={s.statusIcon}>
            <Ionicons name="camera-outline" size={22} color={C.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.statusTitle}>Foto pública</Text>
            <Text style={s.statusMeta}>{statusLabel(profile?.public_photo_status)}</Text>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.statusRow}>
          <View style={s.statusIcon}>
            <Ionicons name="shield-checkmark-outline" size={22} color={C.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.statusTitle}>Identidad</Text>
            <Text style={s.statusMeta}>{statusLabel(profile?.identity_status)}</Text>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.statusRow}>
          <View style={s.statusIcon}>
            <Ionicons name="scan-outline" size={22} color={C.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.statusTitle}>Comprobación de presencia</Text>
            <Text style={s.statusMeta}>{profile?.presence_status ?? "Pendiente de definir"}</Text>
          </View>
        </View>
      </Card>

      <Card style={s.pendingStorage}>
        <Ionicons name="lock-closed-outline" size={23} color={C.blue} />
        <View style={{ flex: 1 }}>
          <Text style={s.pendingStorageTitle}>Fotos y documentos</Text>
          <Text style={s.pendingStorageText}>
            La carga permanece desactivada hasta conectar almacenamiento privado y URLs firmadas.
            No se enviará ninguna foto a un destino ficticio.
          </Text>
        </View>
      </Card>

      {isDriver ? (
        <>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Mis vehículos</Text>
            <Pressable
              onPress={() => setShowVehicleForm(current => !current)}
              style={s.addVehicle}
            >
              <Ionicons name={showVehicleForm ? "close" : "add"} size={18} color={C.blue} />
              <Text style={s.addVehicleText}>
                {showVehicleForm ? "Cancelar" : "Añadir"}
              </Text>
            </Pressable>
          </View>

          {showVehicleForm ? (
            <Card style={s.vehicleForm}>
              <TextInput value={make} onChangeText={setMake} style={s.input} placeholder="Marca" placeholderTextColor="#91A0BC" />
              <TextInput value={model} onChangeText={setModel} style={s.input} placeholder="Modelo" placeholderTextColor="#91A0BC" />
              <TextInput value={plate} onChangeText={setPlate} style={s.input} placeholder="Matrícula" placeholderTextColor="#91A0BC" autoCapitalize="characters" />
              <TextInput value={passengerSeats} onChangeText={setPassengerSeats} style={s.input} placeholder="Plazas de pasajeros" placeholderTextColor="#91A0BC" keyboardType="number-pad" maxLength={1} />
              <PrimaryButton
                title={busy ? "Registrando..." : "Registrar vehículo"}
                onPress={() => void createVehicle()}
                disabled={busy}
              />
            </Card>
          ) : null}

          {!vehicles.length ? (
            <Card style={s.emptyVehicle}>
              <Ionicons name="car-sport-outline" size={34} color={C.blue} />
              <Text style={s.emptyVehicleTitle}>Aún no tienes vehículos</Text>
              <Text style={s.emptyVehicleText}>
                Registra uno para poder preparar viajes como conductor.
              </Text>
            </Card>
          ) : null}

          {vehicles.map(item => (
            <Card key={item.id} style={s.vehicleCard}>
              <View style={s.vehicleIcon}>
                <Ionicons name="car-sport" size={25} color={C.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.vehicleName}>{item.make} {item.model}</Text>
                <Text style={s.vehicleMeta}>{item.plate} · {item.passenger_seats} plazas</Text>
                <View style={s.vehicleStatuses}>
                  <Text style={s.statusChip}>Vehículo: {statusLabel(item.review_status)}</Text>
                  <Text style={s.statusChip}>Docs: {statusLabel(item.documentation_status)}</Text>
                </View>
                {item.review_reason ? (
                  <Text style={s.reviewReason}>{item.review_reason}</Text>
                ) : null}
              </View>
            </Card>
          ))}
        </>
      ) : null}

      {error ? <Text style={s.error}>{error}</Text> : null}
      {notice ? <Text style={s.notice}>{notice}</Text> : null}

      <PrimaryButton
        title={busy ? "Actualizando..." : "Actualizar estado"}
        onPress={() => void refresh()}
        disabled={busy}
      />
      {token ? <Card style={{ marginTop: 12 }}><BlockedPeople token={token} /></Card> : null}

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
  role: { flex: 1, height: 46, borderRadius: 13, borderWidth: 1, borderColor: C.border, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  roleActive: { borderColor: C.blue, backgroundColor: "#F6FAFF" },
  roleText: { fontSize: 13, fontWeight: "800", color: C.navy },
  roleActiveText: { fontSize: 13, fontWeight: "900", color: C.blue },
  account: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: "#6E98B7", alignItems: "center", justifyContent: "center" },
  name: { fontSize: 19, fontWeight: "900", color: C.navy },
  phone: { fontSize: 12, color: C.muted, marginTop: 4 },
  roleLine: { marginTop: 7, alignSelf: "flex-start", backgroundColor: C.pale, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  roleSummary: { fontSize: 10, fontWeight: "900", color: C.blue },
  sectionTitle: { fontSize: 16, fontWeight: "900", color: C.navy, marginTop: 18, marginBottom: 8 },
  sectionHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  input: { height: 50, borderWidth: 1, borderColor: C.border, borderRadius: 13, paddingHorizontal: 12, fontSize: 14, color: C.navy, marginBottom: 8 },
  statusCard: { marginTop: 0 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.pale, alignItems: "center", justifyContent: "center" },
  statusTitle: { fontSize: 14, fontWeight: "900", color: C.navy },
  statusMeta: { fontSize: 11, color: C.muted, marginTop: 2 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 11 },
  pendingStorage: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F7FAFF" },
  pendingStorageTitle: { fontSize: 13, fontWeight: "900", color: C.navy },
  pendingStorageText: { fontSize: 11, lineHeight: 16, color: C.muted, marginTop: 2 },
  addVehicle: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8 },
  addVehicleText: { fontSize: 11, fontWeight: "900", color: C.blue },
  vehicleForm: { marginBottom: 10 },
  emptyVehicle: { alignItems: "center", paddingVertical: 22, marginBottom: 10 },
  emptyVehicleTitle: { fontSize: 14, fontWeight: "900", color: C.navy, marginTop: 8 },
  emptyVehicleText: { fontSize: 11, color: C.muted, marginTop: 3, textAlign: "center" },
  vehicleCard: { marginBottom: 9, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  vehicleIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.pale, alignItems: "center", justifyContent: "center" },
  vehicleName: { fontSize: 14, fontWeight: "900", color: C.navy },
  vehicleMeta: { fontSize: 11, color: C.muted, marginTop: 2 },
  vehicleStatuses: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 7 },
  statusChip: { fontSize: 9, fontWeight: "800", color: C.blue, backgroundColor: C.pale, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4 },
  reviewReason: { fontSize: 10, lineHeight: 15, color: "#9E302D", marginTop: 7 },
  error: { marginTop: 10, color: "#9E302D", backgroundColor: "#FFF0EF", padding: 10, borderRadius: 12, fontSize: 11, lineHeight: 16 },
  notice: { marginTop: 10, color: "#166C4B", backgroundColor: C.mintPale, padding: 10, borderRadius: 12, fontSize: 11, lineHeight: 16 },
  logout: { height: 50, marginTop: 10, borderWidth: 1, borderColor: "#F0CACA", borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  logoutText: { color: "#A73535", fontWeight: "900", fontSize: 13 },
});
