import React, { useEffect, useState } from "react";
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
import type {
  GeocodeResult,
  Province,
  TripSearchParams,
} from "../api/types";
import { Brand, Card, FieldRow, PrimaryButton } from "../components/UI";
import { useAuth } from "../session/AuthContext";
import { C } from "../theme";

type PickerMode = "province" | "origin" | "destination" | null;

export function HomeScreen({
  onSearch,
  onOpenRoute,
}: {
  onSearch: (params: TripSearchParams) => void;
  onOpenRoute: () => void;
}) {
  const { token } = useAuth();
  const [role, setRole] = useState<"passenger" | "driver">("passenger");
  const [category, setCategory] = useState("Trabajo");
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [province, setProvince] = useState<Province | null>(null);
  const [origin, setOrigin] = useState<GeocodeResult | null>(null);
  const [destination, setDestination] = useState<GeocodeResult | null>(null);
  const [picker, setPicker] = useState<PickerMode>(null);
  const [query, setQuery] = useState("");
  const [geocodeResults, setGeocodeResults] = useState<GeocodeResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const cats = [
    ["Trabajo", "briefcase-outline"],
    ["Universidad", "school-outline"],
    ["FP y academias", "book-outline"],
    ["Hospital", "medical-outline"],
    ["Deporte", "walk-outline"],
    ["Otros destinos", "ellipsis-horizontal-circle-outline"],
  ] as const;

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const response = await apiRequest<{ provinces: Province[] }>(
          "/v1/provinces"
        );
        if (!mounted) return;
        setProvinces(response.provinces);
        if (response.provinces.length === 1) {
          setProvince(response.provinces[0] ?? null);
        }
      } catch (e) {
        if (!mounted) return;
        setError(
          e instanceof ApiError
            ? e.message
            : "No se pudieron cargar las provincias."
        );
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  function openPicker(mode: Exclude<PickerMode, null>) {
    setPicker(mode);
    setError("");
    setQuery("");
    setGeocodeResults([]);
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
      if (!response.results.length) {
        setError("No se encontraron direcciones con ese texto.");
      }
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "No se pudo buscar la dirección."
      );
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
        setError(
          `La dirección pertenece a ${resolved.province.name}, no a ${province.name}.`
        );
        return;
      }

      const matching =
        provinces.find(item => item.id === resolved.province.id) ??
        resolved.province;
      if (!province) setProvince(matching);

      if (picker === "origin") setOrigin(result);
      if (picker === "destination") setDestination(result);
      setPicker(null);
      setQuery("");
      setGeocodeResults([]);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "No se pudo validar la provincia de esa dirección."
      );
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    setError("");
    if (role === "driver") {
      onOpenRoute();
      return;
    }
    if (!province || !origin || !destination) {
      setError("Selecciona provincia, origen y destino antes de buscar.");
      return;
    }
    onSearch({
      provinceId: province.id,
      provinceName: province.name,
      origin,
      destination,
    });
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={s.wrap}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.top}>
          <Brand />
          <Ionicons name="notifications-outline" size={24} color={C.navy} />
        </View>

        <Text style={s.title}>¿A dónde vamos?</Text>
        <Text style={s.subtitle}>Comparte tus trayectos entre pueblos.</Text>

        <View style={s.roles}>
          <Pressable
            onPress={() => setRole("passenger")}
            style={[s.role, role === "passenger" && s.roleActive]}
          >
            <Ionicons
              name="person"
              size={19}
              color={role === "passenger" ? C.navy : C.muted}
            />
            <Text
              style={[
                s.roleText,
                role === "passenger" && s.roleTextActive,
              ]}
            >
              Soy pasajero
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setRole("driver")}
            style={[s.role, role === "driver" && s.roleActive]}
          >
            <Ionicons
              name="car-sport-outline"
              size={20}
              color={role === "driver" ? C.navy : C.muted}
            />
            <Text
              style={[
                s.roleText,
                role === "driver" && s.roleTextActive,
              ]}
            >
              Soy conductor
            </Text>
          </Pressable>
        </View>

        <View style={s.grid}>
          {cats.map(([label, icon]) => (
            <Pressable
              key={label}
              onPress={() => setCategory(label)}
              style={[s.cat, category === label && s.catActive]}
            >
              <Ionicons
                name={icon}
                size={30}
                color={label === "Hospital" ? C.danger : C.blue}
              />
              <Text style={s.catText}>{label}</Text>
              <Ionicons name="chevron-forward" size={14} color={C.text} />
            </Pressable>
          ))}
        </View>

        <Card style={s.routeCard}>
          <FieldRow
            icon="location"
            title="Provincia"
            value={province?.name ?? "Seleccionar"}
            onPress={() => openPicker("province")}
          />
          <FieldRow
            icon="navigate-outline"
            title="Desde"
            value={origin?.formattedAddress ?? "Buscar origen"}
            onPress={() => openPicker("origin")}
          />
          <FieldRow
            icon="flag"
            title="Hasta"
            value={destination?.formattedAddress ?? "Buscar destino"}
            onPress={() => openPicker("destination")}
          />
          <View style={s.ok}>
            <Ionicons name="checkmark-circle" size={22} color={C.mint} />
            <Text style={s.okText}>
              MVC valida que todo el recorrido permanezca en la misma provincia.
            </Text>
          </View>
        </Card>

        {error ? <Text style={s.error}>{error}</Text> : null}
        <PrimaryButton
          title={role === "driver" ? "Crear mi ruta" : "Buscar compañeros"}
          onPress={submit}
        />
      </ScrollView>

      <Modal
        visible={picker !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPicker(null)}
      >
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Pressable onPress={() => setPicker(null)} style={s.close}>
              <Ionicons name="chevron-back" size={22} color={C.navy} />
              <Text style={s.closeText}>Volver</Text>
            </Pressable>
            <Text style={s.modalTitle}>
              {picker === "province"
                ? "Elige provincia"
                : picker === "origin"
                  ? "Busca tu origen"
                  : "Busca tu destino"}
            </Text>
          </View>

          {picker === "province" ? (
            <ScrollView contentContainerStyle={s.list}>
              {provinces.map(item => (
                <Pressable
                  key={item.id}
                  style={s.listRow}
                  onPress={() => {
                    setProvince(item);
                    setOrigin(null);
                    setDestination(null);
                    setPicker(null);
                  }}
                >
                  <Ionicons name="location-outline" size={20} color={C.blue} />
                  <Text style={s.listText}>{item.name}</Text>
                  <Ionicons name="chevron-forward" size={18} color={C.navy} />
                </Pressable>
              ))}
              {!provinces.length ? (
                <Text style={s.empty}>No hay provincias cargadas en el backend.</Text>
              ) : null}
            </ScrollView>
          ) : (
            <View style={s.addressBody}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Pueblo, calle o lugar"
                placeholderTextColor="#91A0BC"
                style={s.input}
                autoFocus
                returnKeyType="search"
                onSubmitEditing={() => void searchAddress()}
              />
              <PrimaryButton
                title={busy ? "Buscando..." : "Buscar dirección"}
                onPress={() => void searchAddress()}
                disabled={busy || query.trim().length < 3}
              />
              {busy ? (
                <ActivityIndicator color={C.blue} style={{ marginTop: 14 }} />
              ) : null}
              {error ? <Text style={s.error}>{error}</Text> : null}
              <ScrollView contentContainerStyle={s.results}>
                {geocodeResults.map(item => (
                  <Pressable
                    key={item.placeId}
                    style={s.resultRow}
                    onPress={() => void chooseLocation(item)}
                  >
                    <Ionicons
                      name="location-outline"
                      size={20}
                      color={C.blue}
                    />
                    <Text style={s.resultText}>{item.formattedAddress}</Text>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={C.navy}
                    />
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
  wrap: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 28,
    backgroundColor: "#fff",
  },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  title: { fontSize: 31, fontWeight: "900", color: C.navy, letterSpacing: -0.7 },
  subtitle: { fontSize: 15, color: C.muted, marginTop: 3, marginBottom: 18 },
  roles: { flexDirection: "row", gap: 10, marginBottom: 16 },
  role: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#fff",
  },
  roleActive: { backgroundColor: C.mintPale, borderColor: "#BCEEDC" },
  roleText: { fontSize: 13, fontWeight: "700", color: C.muted },
  roleTextActive: { color: C.navy },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  cat: {
    width: "48.5%",
    minHeight: 88,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 15,
    padding: 12,
    backgroundColor: "#fff",
    justifyContent: "center",
  },
  catActive: { borderColor: C.blue, backgroundColor: "#F7FAFF" },
  catText: { fontSize: 13, fontWeight: "800", color: C.navy, marginTop: 7, marginRight: 18 },
  routeCard: { paddingVertical: 0, overflow: "hidden" },
  ok: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 5,
    backgroundColor: C.mintPale,
    marginTop: 6,
    borderRadius: 12,
  },
  okText: { fontSize: 12, fontWeight: "800", color: C.navy, flex: 1 },
  error: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#FFF0EF",
    color: "#9E302D",
    fontSize: 12,
    lineHeight: 17,
  },
  modal: { flex: 1, backgroundColor: "#fff", paddingTop: 12 },
  modalHeader: { paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  close: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingVertical: 7 },
  closeText: { fontSize: 13, fontWeight: "800", color: C.navy },
  modalTitle: { fontSize: 23, fontWeight: "900", color: C.navy, marginTop: 6 },
  list: { padding: 18, paddingBottom: 40 },
  listRow: { minHeight: 54, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: "row", alignItems: "center", gap: 10 },
  listText: { flex: 1, fontSize: 14, fontWeight: "800", color: C.navy },
  empty: { color: C.muted, fontSize: 13, textAlign: "center", marginTop: 30 },
  addressBody: { flex: 1, padding: 18 },
  input: { height: 52, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, fontSize: 16, color: C.navy },
  results: { paddingTop: 12, paddingBottom: 50 },
  resultRow: { minHeight: 62, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: "row", alignItems: "center", gap: 10 },
  resultText: { flex: 1, fontSize: 13, lineHeight: 18, color: C.navy, fontWeight: "700" },
});
