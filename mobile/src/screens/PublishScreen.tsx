import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, ApiError } from "../api/client";
import type { GeocodeResult, Province, Vehicle } from "../api/types";
import { Card, FieldRow, PrimaryButton } from "../components/UI";
import { useAuth } from "../session/AuthContext";
import { C } from "../theme";

type PickerMode = "province" | "origin" | "destination" | "vehicle" | null;
type Category =
  | "work"
  | "university"
  | "fp_academies"
  | "hospital"
  | "sport"
  | "other";

type DraftTrip = {
  id: string;
  status: string;
  route_distance_m: number;
  route_duration_s: number;
  offered_seats: number;
  departure_at: string;
};

const categories: Array<{ key: Category; label: string; icon: any }> = [
  { key: "work", label: "Trabajo", icon: "briefcase-outline" },
  { key: "university", label: "Universidad", icon: "school-outline" },
  { key: "fp_academies", label: "FP y academias", icon: "book-outline" },
  { key: "hospital", label: "Hospital", icon: "medical-outline" },
  { key: "sport", label: "Deporte", icon: "walk-outline" },
  { key: "other", label: "Otros destinos", icon: "ellipsis-horizontal-circle-outline" },
];

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function departureIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const parsed = new Date(`${date}T${time}:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function PublishScreen() {
  const { token, roles } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [province, setProvince] = useState<Province | null>(null);
  const [origin, setOrigin] = useState<GeocodeResult | null>(null);
  const [destination, setDestination] = useState<GeocodeResult | null>(null);
  const [category, setCategory] = useState<Category>("work");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  const [seats, setSeats] = useState(1);
  const [flexibility, setFlexibility] = useState(15);
  const [maxDetourM, setMaxDetourM] = useState(3000);
  const [picker, setPicker] = useState<PickerMode>(null);
  const [query, setQuery] = useState("");
  const [geocodeResults, setGeocodeResults] = useState<GeocodeResult[]>([]);
  const [draft, setDraft] = useState<DraftTrip | null>(null);
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isDriver = roles.includes("driver");
  const vehicleCapacity = vehicle?.passenger_seats ?? 1;

  useEffect(() => {
    if (!token || !isDriver) return;
    let mounted = true;
    void (async () => {
      try {
        const [vehicleResponse, provinceResponse] = await Promise.all([
          apiRequest<{ vehicles: Vehicle[] }>("/v1/me/vehicles", { token }),
          apiRequest<{ provinces: Province[] }>("/v1/provinces"),
        ]);
        if (!mounted) return;
        setVehicles(vehicleResponse.vehicles);
        setProvinces(provinceResponse.provinces);
        if (vehicleResponse.vehicles.length === 1) {
          setVehicle(vehicleResponse.vehicles[0] ?? null);
        }
        if (provinceResponse.provinces.length === 1) {
          setProvince(provinceResponse.provinces[0] ?? null);
        }
      } catch (e) {
        if (mounted) {
          setError(e instanceof ApiError ? e.message : "No se pudo cargar la configuración del conductor.");
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [token, isDriver]);

  useEffect(() => {
    if (seats > vehicleCapacity) setSeats(vehicleCapacity);
  }, [vehicleCapacity, seats]);

  const vehicleLabel = useMemo(() => {
    if (!vehicle) return "Seleccionar";
    return `${vehicle.make} ${vehicle.model} · ${vehicle.plate}`;
  }, [vehicle]);

  function openPicker(mode: Exclude<PickerMode, null>) {
    setPicker(mode);
    setQuery("");
    setGeocodeResults([]);
    setError("");
  }

  async function searchAddress() {
    if (!token || query.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest<{ results: GeocodeResult[] }>(
        `/v1/maps/geocode?query=${encodeURIComponent(query.trim())}`,
        { token }
      );
      setGeocodeResults(response.results);
      if (!response.results.length) setError("No se encontraron direcciones.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo buscar la dirección.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseLocation(result: GeocodeResult) {
    setBusy(true);
    setError("");
    try {
      const resolved = await apiRequest<{ province: Province }>(
        `/v1/provinces/resolve?latitude=${result.location.latitude}&longitude=${result.location.longitude}`
      );
      if (province && resolved.province.id !== province.id) {
        setError(`La dirección está en ${resolved.province.name}, no en ${province.name}.`);
        return;
      }
      if (!province) {
        setProvince(
          provinces.find(item => item.id === resolved.province.id) ?? resolved.province
        );
      }
      if (picker === "origin") setOrigin(result);
      if (picker === "destination") setDestination(result);
      setPicker(null);
      setQuery("");
      setGeocodeResults([]);
      setDraft(null);
      setPublished(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo validar la dirección.");
    } finally {
      setBusy(false);
    }
  }

  async function createDraft() {
    if (!token) return;
    setError("");
    setPublished(false);
    const departureAt = departureIso(date, time);
    if (!vehicle || !province || !origin || !destination) {
      setError("Selecciona vehículo, provincia, origen y destino.");
      return;
    }
    if (!departureAt) {
      setError("Introduce fecha YYYY-MM-DD y hora HH:MM válidas.");
      return;
    }
    if (new Date(departureAt).getTime() <= Date.now()) {
      setError("La salida debe estar en el futuro.");
      return;
    }

    setBusy(true);
    try {
      const created = await apiRequest<DraftTrip>("/v1/me/trips", {
        method: "POST",
        token,
        body: {
          vehicleId: vehicle.id,
          provinceId: province.id,
          category,
          leg: "outbound",
          departureAt,
          flexibilityMinutes: flexibility,
          maxDetourM,
          offeredSeats: seats,
          origin: origin.location,
          destination: destination.location,
        },
      });
      setDraft(created);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo calcular la ruta.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!token || !draft) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest<void>(`/v1/me/trips/${draft.id}/publish`, {
        method: "POST",
        token,
      });
      setPublished(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo publicar el viaje.");
    } finally {
      setBusy(false);
    }
  }

  if (!isDriver) {
    return (
      <ScrollView contentContainerStyle={s.wrap}>
        <Text style={s.title}>Publicar viaje</Text>
        <Card style={s.emptyCard}>
          <Ionicons name="car-sport-outline" size={42} color={C.blue} />
          <Text style={s.emptyTitle}>Necesitas el perfil de conductor</Text>
          <Text style={s.emptyText}>
            Tu sesión actual no tiene rol de conductor. MVC no permite publicar viajes sin ese permiso.
          </Text>
        </Card>
      </ScrollView>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={s.wrap}>
        <Text style={s.title}>Publicar viaje</Text>
        <Text style={s.subtitle}>
          La ruta y su geometría completa se calculan y validan en el servidor.
        </Text>

        <Card style={{ paddingVertical: 0 }}>
          <FieldRow icon="car-sport-outline" title="Vehículo" value={vehicleLabel} onPress={() => openPicker("vehicle")} />
          <FieldRow icon="location" title="Provincia" value={province?.name ?? "Seleccionar"} onPress={() => openPicker("province")} />
          <FieldRow icon="navigate" title="Origen" value={origin?.formattedAddress ?? "Buscar origen"} onPress={() => openPicker("origin")} />
          <FieldRow icon="flag" title="Destino" value={destination?.formattedAddress ?? "Buscar destino"} onPress={() => openPicker("destination")} />
        </Card>

        <Text style={s.section}>Motivo del trayecto</Text>
        <View style={s.categories}>
          {categories.map(item => (
            <Pressable key={item.key} onPress={() => setCategory(item.key)} style={[s.category, category === item.key && s.categoryActive]}>
              <Ionicons name={item.icon} size={20} color={item.key === "hospital" ? C.danger : C.blue} />
              <Text style={s.categoryText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.section}>Fecha y hora</Text>
        <View style={s.twoCols}>
          <TextInput value={date} onChangeText={setDate} style={[s.input, { flex: 1 }]} placeholder="2026-10-08" placeholderTextColor="#91A0BC" />
          <TextInput value={time} onChangeText={setTime} style={[s.input, { width: 105 }]} placeholder="08:00" placeholderTextColor="#91A0BC" />
        </View>

        <Text style={s.section}>Plazas disponibles</Text>
        <View style={s.stepper}>
          <Pressable onPress={() => setSeats(Math.max(1, seats - 1))} style={s.stepButton}>
            <Ionicons name="remove" size={22} color={C.blue} />
          </Pressable>
          <Text style={s.stepValue}>{seats}</Text>
          <Pressable onPress={() => setSeats(Math.min(vehicleCapacity, seats + 1))} style={s.stepButton}>
            <Ionicons name="add" size={22} color={C.blue} />
          </Pressable>
          <Text style={s.capacity}>máx. {vehicleCapacity}</Text>
        </View>

        <Text style={s.section}>Flexibilidad</Text>
        <View style={s.options}>
          {[0, 15, 30, 60].map(value => (
            <Pressable key={value} onPress={() => setFlexibility(value)} style={[s.option, flexibility === value && s.optionActive]}>
              <Text style={[s.optionText, flexibility === value && s.optionTextActive]}>{value} min</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.section}>Desvío máximo</Text>
        <View style={s.options}>
          {[0, 3000, 5000, 10000].map(value => (
            <Pressable key={value} onPress={() => setMaxDetourM(value)} style={[s.option, maxDetourM === value && s.optionActive]}>
              <Text style={[s.optionText, maxDetourM === value && s.optionTextActive]}>{value === 0 ? "Sin desvío" : `${value / 1000} km`}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.ok}>
          <Ionicons name="shield-checkmark" size={23} color={C.mint} />
          <Text style={s.okText}>
            Si no existe una ruta íntegramente dentro de la provincia, el backend bloqueará el borrador.
          </Text>
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}
        {busy ? <ActivityIndicator color={C.blue} style={{ marginTop: 12 }} /> : null}

        {!draft ? (
          <PrimaryButton title={busy ? "Calculando..." : "Calcular ruta"} onPress={() => void createDraft()} disabled={busy} />
        ) : (
          <Card style={s.draftCard}>
            <Text style={s.draftTitle}>Ruta calculada por el servidor</Text>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Distancia</Text>
              <Text style={s.summaryValue}>{formatDistance(draft.route_distance_m)}</Text>
            </View>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Duración estimada</Text>
              <Text style={s.summaryValue}>{formatDuration(draft.route_duration_s)}</Text>
            </View>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Plazas</Text>
              <Text style={s.summaryValue}>{draft.offered_seats}</Text>
            </View>
            {!published ? (
              <PrimaryButton title={busy ? "Publicando..." : "Publicar viaje"} onPress={() => void publish()} disabled={busy} />
            ) : (
              <View style={s.published}>
                <Ionicons name="checkmark-circle" size={24} color={C.mint} />
                <Text style={s.publishedText}>Viaje publicado correctamente.</Text>
              </View>
            )}
          </Card>
        )}
      </ScrollView>

      <Modal visible={picker !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicker(null)}>
        <View style={s.modal}>
          <Pressable onPress={() => setPicker(null)} style={s.back}>
            <Ionicons name="chevron-back" size={22} color={C.navy} />
            <Text style={s.backText}>Volver</Text>
          </Pressable>
          <Text style={s.modalTitle}>
            {picker === "vehicle"
              ? "Elige vehículo"
              : picker === "province"
                ? "Elige provincia"
                : picker === "origin"
                  ? "Busca origen"
                  : "Busca destino"}
          </Text>

          {picker === "vehicle" ? (
            <ScrollView contentContainerStyle={s.list}>
              {vehicles.map(item => (
                <Pressable key={item.id} style={s.listRow} onPress={() => { setVehicle(item); setPicker(null); setDraft(null); }}>
                  <Ionicons name="car-sport-outline" size={21} color={C.blue} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.listTitle}>{item.make} {item.model}</Text>
                    <Text style={s.listMeta}>{item.plate} · {item.passenger_seats} plazas · {item.review_status}</Text>
                  </View>
                </Pressable>
              ))}
              {!vehicles.length ? <Text style={s.emptyText}>No tienes vehículos registrados.</Text> : null}
            </ScrollView>
          ) : picker === "province" ? (
            <ScrollView contentContainerStyle={s.list}>
              {provinces.map(item => (
                <Pressable key={item.id} style={s.listRow} onPress={() => { setProvince(item); setOrigin(null); setDestination(null); setPicker(null); setDraft(null); }}>
                  <Ionicons name="location-outline" size={21} color={C.blue} />
                  <Text style={s.listTitle}>{item.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <View style={s.addressBody}>
              <TextInput value={query} onChangeText={setQuery} style={s.input} placeholder="Pueblo, calle o lugar" placeholderTextColor="#91A0BC" autoFocus onSubmitEditing={() => void searchAddress()} />
              <PrimaryButton title={busy ? "Buscando..." : "Buscar dirección"} onPress={() => void searchAddress()} disabled={busy || query.trim().length < 3} />
              {error ? <Text style={s.error}>{error}</Text> : null}
              <ScrollView contentContainerStyle={s.list}>
                {geocodeResults.map(item => (
                  <Pressable key={item.placeId} style={s.listRow} onPress={() => void chooseLocation(item)}>
                    <Ionicons name="location-outline" size={21} color={C.blue} />
                    <Text style={[s.listTitle, { flex: 1 }]}>{item.formattedAddress}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 18, paddingBottom: 34, backgroundColor: "#fff" },
  title: { fontSize: 25, fontWeight: "900", color: C.navy, textAlign: "center" },
  subtitle: { fontSize: 12, lineHeight: 18, color: C.muted, textAlign: "center", marginTop: 5, marginBottom: 16 },
  section: { fontSize: 14, fontWeight: "900", color: C.navy, marginTop: 18, marginBottom: 8 },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  category: { width: "48.5%", minHeight: 52, borderWidth: 1, borderColor: C.border, borderRadius: 13, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  categoryActive: { borderColor: C.blue, backgroundColor: "#F7FAFF" },
  categoryText: { fontSize: 11, fontWeight: "800", color: C.navy, flex: 1 },
  twoCols: { flexDirection: "row", gap: 10 },
  input: { height: 50, borderWidth: 1, borderColor: C.border, borderRadius: 13, paddingHorizontal: 12, fontSize: 14, color: C.navy },
  stepper: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepButton: { width: 42, height: 42, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  stepValue: { minWidth: 32, textAlign: "center", fontSize: 21, fontWeight: "900", color: C.navy },
  capacity: { fontSize: 11, color: C.muted },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { minHeight: 39, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  optionActive: { backgroundColor: C.blue, borderColor: C.blue },
  optionText: { fontSize: 11, fontWeight: "800", color: C.navy },
  optionTextActive: { color: "#fff" },
  ok: { marginTop: 18, backgroundColor: C.mintPale, borderRadius: 14, padding: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  okText: { fontSize: 11, lineHeight: 16, color: C.navy, fontWeight: "700", flex: 1 },
  error: { marginTop: 10, color: "#9E302D", backgroundColor: "#FFF0EF", padding: 10, borderRadius: 12, fontSize: 11, lineHeight: 16 },
  draftCard: { marginTop: 14 },
  draftTitle: { fontSize: 16, fontWeight: "900", color: C.navy, marginBottom: 10 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.border },
  summaryLabel: { fontSize: 12, color: C.muted },
  summaryValue: { fontSize: 12, fontWeight: "900", color: C.navy },
  published: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.mintPale, padding: 12, borderRadius: 12, marginTop: 12 },
  publishedText: { fontSize: 12, fontWeight: "900", color: C.navy },
  modal: { flex: 1, backgroundColor: "#fff", paddingTop: 18, paddingHorizontal: 18 },
  back: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingVertical: 7 },
  backText: { fontSize: 13, fontWeight: "800", color: C.navy },
  modalTitle: { fontSize: 23, fontWeight: "900", color: C.navy, marginTop: 8, marginBottom: 12 },
  list: { paddingBottom: 40 },
  listRow: { minHeight: 58, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: "row", alignItems: "center", gap: 10 },
  listTitle: { fontSize: 13, fontWeight: "900", color: C.navy },
  listMeta: { fontSize: 10, color: C.muted, marginTop: 2 },
  addressBody: { flex: 1 },
  emptyCard: { alignItems: "center", paddingVertical: 30, marginTop: 18 },
  emptyTitle: { fontSize: 17, fontWeight: "900", color: C.navy, marginTop: 12 },
  emptyText: { fontSize: 12, lineHeight: 18, color: C.muted, textAlign: "center", marginTop: 5 },
});
