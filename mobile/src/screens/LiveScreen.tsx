import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, ApiError } from "../api/client";
import type { PublicLiveTrip, TripEta, TripLocation } from "../api/types";
import { Card, PrimaryButton } from "../components/UI";
import { useAuth } from "../session/AuthContext";
import { C } from "../theme";

const POLL_MS = 5000;

function age(seconds: number): string {
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `hace ${minutes} min` : `hace ${Math.floor(minutes / 60)} h`;
}

function mins(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
function km(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km`;
}
const STOP_KIND: Record<string, string> = { origin: "Salida", stop: "Parada", pickup: "Recogida", dropoff: "Bajada", destination: "Destino" };

function openInMaps(latitude: number, longitude: number) {
  void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`);
}

export function LiveScreen({ tripId, provinceId }: { tripId?: string; provinceId?: string }) {
  return tripId ? <TripTracking tripId={tripId} /> : <ProvinceLiveMap provinceId={provinceId} />;
}

function TripTracking({ tripId }: { tripId: string }) {
  const { token } = useAuth();
  const [location, setLocation] = useState<TripLocation | null>(null);
  const [eta, setEta] = useState<TripEta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ location: TripLocation | null }>(`/v1/trips/${tripId}/location`, { token });
      setLocation(response.location);
      setError("");
      // Only the driver and confirmed passengers get an ETA; anyone else just sees the position.
      setEta(await apiRequest<TripEta>(`/v1/trips/${tripId}/eta`, { token }).catch(() => null));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar la ubicación.");
    } finally {
      setLoaded(true);
    }
  }, [tripId, token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Tu coche en directo</Text>
      {!loaded ? <ActivityIndicator color={C.blue} /> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}

      {loaded && !location && !error ? (
        <Card style={s.empty}>
          <Ionicons name="time-outline" size={36} color={C.blue} />
          <Text style={s.emptyTitle}>Aún no hay posición</Text>
          <Text style={s.emptyText}>Aparecerá cuando el conductor inicie el viaje y comparta su ubicación.</Text>
        </Card>
      ) : null}

      {location ? (
        <>
          <View style={[s.status, location.stale ? s.statusStale : s.statusLive]}>
            <Ionicons name={location.stale ? "warning" : "radio"} size={22} color={location.stale ? "#966112" : "#0E7A55"} />
            <View style={{ flex: 1 }}>
              <Text style={s.statusTitle}>{location.stale ? "Posición no actualizada" : "En directo"}</Text>
              <Text style={s.statusMeta}>
                Última señal {age(location.ageSeconds)}
                {location.stale ? ". No la uses como posición actual." : ""}
              </Text>
            </View>
          </View>

          <Card style={s.coords}>
            <Row label="Precisión" value={location.precision === "precise" ? "Exacta (eres parte del viaje)" : "Aproximada (unos 1 km)"} />
            <Row label="Latitud" value={location.latitude.toFixed(5)} />
            <Row label="Longitud" value={location.longitude.toFixed(5)} />
            {location.speedMps != null ? <Row label="Velocidad" value={`${Math.round(location.speedMps * 3.6)} km/h`} /> : null}
            {location.accuracyM != null ? <Row label="Margen GPS" value={`${Math.round(location.accuracyM)} m`} /> : null}
          </Card>

          {eta ? <EtaCard eta={eta} /> : null}

          <PrimaryButton title="Abrir en el mapa" onPress={() => openInMaps(location.latitude, location.longitude)} />
          <Text style={s.note}>La hora estimada sale de la ruta calculada y de la última posición. El tráfico puede cambiarla; nunca cambia el precio.</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

function ProvinceLiveMap({ provinceId }: { provinceId?: string }) {
  const [trips, setTrips] = useState<PublicLiveTrip[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!provinceId) {
      setLoaded(true);
      return;
    }
    try {
      const response = await apiRequest<{ trips: PublicLiveTrip[] }>(`/v1/live/map?provinceId=${provinceId}`);
      setTrips(response.trips);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar el mapa en directo.");
    } finally {
      setLoaded(true);
    }
  }, [provinceId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Coches en marcha</Text>
      <Text style={s.subtitle}>Posiciones aproximadas de viajes activos en tu provincia. La posición exacta solo la ven los pasajeros del viaje.</Text>
      {!loaded ? <ActivityIndicator color={C.blue} /> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
      {!provinceId ? <Text style={s.subtitle}>Busca un trayecto desde Inicio para elegir provincia.</Text> : null}
      {loaded && provinceId && !trips.length && !error ? (
        <Card style={s.empty}>
          <Ionicons name="car-outline" size={36} color={C.blue} />
          <Text style={s.emptyTitle}>Ningún coche en marcha ahora</Text>
        </Card>
      ) : null}
      {trips.map(trip => (
        <Card key={trip.tripId} style={s.carRow}>
          <View style={[s.carPin, trip.stale && { backgroundColor: "#8A98B8" }]}>
            <Ionicons name="car-sport" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.carTitle}>{trip.stale ? "Sin señal reciente" : "En ruta"}</Text>
            <Text style={s.carMeta}>Zona {trip.latitude.toFixed(2)}, {trip.longitude.toFixed(2)} · {age(trip.ageSeconds)}</Text>
          </View>
          <Pressable onPress={() => openInMaps(trip.latitude, trip.longitude)} style={s.mapButton} accessibilityLabel="Ver zona en el mapa">
            <Ionicons name="map-outline" size={19} color={C.blue} />
          </Pressable>
        </Card>
      ))}
    </ScrollView>
  );
}

function EtaCard({ eta }: { eta: TripEta }) {
  if (!eta.live) {
    return (
      <Card style={s.etaCard}>
        <Text style={s.etaTitle}>Sin hora estimada</Text>
        <Text style={s.etaMeta}>Hace falta una posición reciente del coche para calcularla.</Text>
      </Card>
    );
  }
  const me = eta.me;
  const ahead = eta.stops.filter(x => !x.passed && x.etaS != null);
  return (
    <>
      {me?.arriving ? (
        <View style={s.arriving}>
          <Ionicons name="notifications" size={20} color="#fff" />
          <Text style={s.arrivingText}>Tu conductor está llegando a la recogida</Text>
        </View>
      ) : null}
      {me ? (
        <Card style={s.etaCard}>
          {me.pickedUp ? (
            <Text style={s.etaTitle}>Ya vas en el coche</Text>
          ) : me.pickupEtaS != null ? (
            <>
              <Text style={s.etaLabel}>Te recoge en</Text>
              <Text style={s.etaBig}>{mins(me.pickupEtaS)}</Text>
              <Text style={s.etaMeta}>{km(me.pickupDistanceM ?? 0)} por carretera hasta tu punto</Text>
            </>
          ) : (
            <Text style={s.etaTitle}>El coche ya pasó por tu punto de recogida</Text>
          )}
          {me.dropoffEtaS != null ? (
            <View style={s.etaRow}>
              <Text style={s.rowLabel}>Llegas a tu destino en</Text>
              <Text style={s.rowValue}>{mins(me.dropoffEtaS)} · {km(me.dropoffDistanceM ?? 0)}</Text>
            </View>
          ) : null}
        </Card>
      ) : null}
      {ahead.length ? (
        <Card style={s.etaCard}>
          <Text style={s.etaTitle}>Próximas paradas</Text>
          {ahead.map(x => (
            <View key={x.seq} style={s.etaRow}>
              <Text style={s.rowLabel}>{STOP_KIND[x.kind] ?? "Parada"}{x.label ? ` · ${x.label}` : ""}</Text>
              <Text style={s.rowValue}>{mins(x.etaS ?? 0)} · {km(x.roadDistanceM ?? 0)}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 18, paddingBottom: 32, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "900", color: C.navy, textAlign: "center", marginBottom: 10 },
  subtitle: { fontSize: 12, lineHeight: 18, color: C.muted, textAlign: "center", marginBottom: 14 },
  error: { marginBottom: 12, color: "#9E302D", backgroundColor: "#FFF0EF", padding: 11, borderRadius: 12, fontSize: 12 },
  empty: { alignItems: "center", paddingVertical: 26 },
  emptyTitle: { fontSize: 16, fontWeight: "900", color: C.navy, marginTop: 10 },
  emptyText: { fontSize: 12, lineHeight: 18, color: C.muted, textAlign: "center", marginTop: 5 },
  status: { borderRadius: 15, padding: 13, flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 12 },
  statusLive: { backgroundColor: C.mintPale },
  statusStale: { backgroundColor: C.softWarning },
  statusTitle: { fontSize: 15, fontWeight: "900", color: C.navy },
  statusMeta: { fontSize: 11, color: C.muted, marginTop: 2 },
  coords: { gap: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#EEF3FA" },
  rowLabel: { fontSize: 12, color: C.muted, fontWeight: "700" },
  rowValue: { fontSize: 13, color: C.navy, fontWeight: "900", fontVariant: ["tabular-nums"] },
  etaCard: { marginTop: 12, gap: 4 },
  etaLabel: { fontSize: 12, fontWeight: "800", color: C.muted },
  etaBig: { fontSize: 30, fontWeight: "900", color: C.navy, fontVariant: ["tabular-nums"] },
  etaTitle: { fontSize: 15, fontWeight: "900", color: C.navy },
  etaMeta: { fontSize: 12, color: C.muted },
  etaRow: { flexDirection: "row", justifyContent: "space-between", gap: 10, paddingTop: 8, marginTop: 4, borderTopWidth: 1, borderTopColor: "#EEF3FA" },
  arriving: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#0E7A55", borderRadius: 14, padding: 13, marginTop: 4 },
  arrivingText: { color: "#fff", fontWeight: "900", fontSize: 14, flex: 1 },
  note: { fontSize: 11, color: C.muted, textAlign: "center", marginTop: 12, lineHeight: 16 },
  carRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  carPin: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.blue, alignItems: "center", justifyContent: "center" },
  carTitle: { fontSize: 14, fontWeight: "900", color: C.navy },
  carMeta: { fontSize: 11, color: C.muted, marginTop: 2 },
  mapButton: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
});
