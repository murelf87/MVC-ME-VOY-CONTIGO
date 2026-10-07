import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, ApiError } from "../api/client";
import type { TripSearchParams, TripSearchResult } from "../api/types";
import { Card, PrimaryButton } from "../components/UI";
import { useAuth } from "../session/AuthContext";
import { C } from "../theme";

function km(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`
    : `${meters} m`;
}

function duration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function TripsScreen({
  searchParams,
  onLive,
}: {
  searchParams: TripSearchParams | null;
  onLive: () => void;
}) {
  const { token } = useAuth();
  const [trips, setTrips] = useState<TripSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requested, setRequested] = useState<Record<string, boolean>>({});

  const routeLabel = useMemo(() => {
    if (!searchParams) return "";
    return `${searchParams.origin.formattedAddress} → ${searchParams.destination.formattedAddress}`;
  }, [searchParams]);

  useEffect(() => {
    let mounted = true;
    if (!searchParams) {
      setTrips([]);
      return;
    }
    void (async () => {
      setBusy(true);
      setError("");
      try {
        const query = [
          `provinceId=${encodeURIComponent(searchParams.provinceId)}`,
          `originLatitude=${searchParams.origin.location.latitude}`,
          `originLongitude=${searchParams.origin.location.longitude}`,
          `destinationLatitude=${searchParams.destination.location.latitude}`,
          `destinationLongitude=${searchParams.destination.location.longitude}`,
          "radiusM=5000",
          "limit=30",
        ].join("&");

        const response = await apiRequest<{ trips: TripSearchResult[] }>(
          `/v1/trips/search?${query}`
        );
        if (mounted) setTrips(response.trips);
      } catch (e) {
        if (mounted) {
          setError(
            e instanceof ApiError
              ? e.message
              : "No se pudieron buscar viajes."
          );
        }
      } finally {
        if (mounted) setBusy(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [searchParams]);

  async function requestSeat(trip: TripSearchResult) {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(
        `/v1/trips/${trip.tripId}/requests`,
        {
          method: "POST",
          token,
          body: {
            fromSegmentSeq: trip.fromSegmentSeq,
            toSegmentSeq: trip.toSegmentSeq,
          },
        }
      );
      setRequested(current => ({ ...current, [trip.tripId]: true }));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "No se pudo enviar la solicitud de plaza."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Viajes</Text>
      <Text style={s.subtitle}>
        {searchParams
          ? `${searchParams.provinceName} · resultados reales del backend`
          : "Busca un trayecto desde Inicio para ver disponibilidad real."}
      </Text>

      {searchParams ? (
        <Card style={s.searchSummary}>
          <View style={s.routeLine}>
            <Ionicons name="location" size={19} color={C.blue} />
            <Text style={s.routeText} numberOfLines={3}>
              {routeLabel}
            </Text>
          </View>
        </Card>
      ) : null}

      {busy && !trips.length ? (
        <ActivityIndicator color={C.blue} size="large" style={{ marginTop: 28 }} />
      ) : null}

      {error ? <Text style={s.error}>{error}</Text> : null}

      {!busy && searchParams && !trips.length && !error ? (
        <Card style={s.emptyCard}>
          <Ionicons name="car-outline" size={36} color={C.blue} />
          <Text style={s.emptyTitle}>No hay viajes disponibles ahora</Text>
          <Text style={s.emptyText}>
            MVC no inventa resultados. Prueba otro horario, radio o trayecto.
          </Text>
        </Card>
      ) : null}

      {trips.map(trip => (
        <Card key={trip.tripId} style={s.tripCard}>
          <View style={s.tripTop}>
            <View style={s.avatar}>
              <Ionicons name="person" size={28} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.tripName}>
                {trip.driverDisplayName || "Conductor MVC"}
              </Text>
              <Text style={s.tripMeta}>
                {trip.departureAt
                  ? new Date(trip.departureAt).toLocaleString()
                  : "Salida por confirmar"}
              </Text>
            </View>
            <View style={s.badge}>
              <Text style={s.badgeText}>
                {trip.availableSeats} {trip.availableSeats === 1 ? "plaza" : "plazas"}
              </Text>
            </View>
          </View>

          <View style={s.dataGrid}>
            <View style={s.dataItem}>
              <Text style={s.dataLabel}>Recorrido</Text>
              <Text style={s.dataValue}>{km(trip.roadDistanceM)}</Text>
            </View>
            <View style={s.dataItem}>
              <Text style={s.dataLabel}>Duración</Text>
              <Text style={s.dataValue}>{duration(trip.estimatedDurationS)}</Text>
            </View>
            <View style={s.dataItem}>
              <Text style={s.dataLabel}>A recogida</Text>
              <Text style={s.dataValue}>{km(trip.pickupDistanceM)}</Text>
            </View>
          </View>

          <PrimaryButton
            title={
              requested[trip.tripId]
                ? "Solicitud enviada"
                : busy
                  ? "Procesando..."
                  : "Solicitar plaza"
            }
            onPress={() => void requestSeat(trip)}
            disabled={busy || requested[trip.tripId]}
          />
          {requested[trip.tripId] ? (
            <Text style={s.pending}>
              Pendiente de aceptación del conductor. Aún no es una reserva confirmada.
            </Text>
          ) : null}
        </Card>
      ))}

      {trips.length ? (
        <Pressable style={s.liveLink} onPress={onLive}>
          <Ionicons name="map-outline" size={19} color={C.blue} />
          <Text style={s.liveLinkText}>
            Ver diseño del seguimiento en directo
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

export function MessagesScreen() {
  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Mensajes</Text>
      <Text style={s.subtitle}>
        Solo aparecerán conversaciones autorizadas por una reserva o viaje real.
      </Text>
      <Card style={s.emptyCard}>
        <Ionicons name="chatbubbles-outline" size={38} color={C.blue} />
        <Text style={s.emptyTitle}>Sin conversaciones cargadas</Text>
        <Text style={s.emptyText}>
          MVC no muestra chats ficticios. Cuando tengas una reserva confirmada,
          el chat se vinculará al viaje correspondiente.
        </Text>
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 18, paddingBottom: 28, backgroundColor: "#fff" },
  title: { fontSize: 25, fontWeight: "900", color: C.navy, textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 13, lineHeight: 18, color: C.muted, textAlign: "center", marginBottom: 16 },
  searchSummary: { marginBottom: 12 },
  tripCard: { marginBottom: 12 },
  tripTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#78B89F", alignItems: "center", justifyContent: "center" },
  tripName: { fontSize: 16, fontWeight: "900", color: C.navy },
  tripMeta: { fontSize: 11, color: C.muted, marginTop: 2 },
  badge: { backgroundColor: C.pale, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  badgeText: { fontSize: 11, fontWeight: "900", color: C.blue },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeText: { fontSize: 13, fontWeight: "800", color: C.navy, flex: 1 },
  dataGrid: { flexDirection: "row", gap: 8, marginTop: 14 },
  dataItem: { flex: 1, backgroundColor: "#F7FAFF", borderRadius: 12, padding: 10 },
  dataLabel: { fontSize: 9, fontWeight: "800", color: C.muted, textTransform: "uppercase" },
  dataValue: { fontSize: 13, fontWeight: "900", color: C.navy, marginTop: 3 },
  pending: { fontSize: 11, lineHeight: 16, color: "#966112", backgroundColor: "#FFF6E8", padding: 9, borderRadius: 10, marginTop: 8 },
  error: { marginBottom: 12, color: "#9E302D", backgroundColor: "#FFF0EF", padding: 11, borderRadius: 12, fontSize: 12 },
  emptyCard: { alignItems: "center", paddingVertical: 26, marginTop: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "900", color: C.navy, marginTop: 10 },
  emptyText: { fontSize: 12, lineHeight: 18, color: C.muted, textAlign: "center", marginTop: 5 },
  liveLink: { minHeight: 48, borderWidth: 1, borderColor: C.border, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  liveLinkText: { fontSize: 12, fontWeight: "800", color: C.blue },
  ok: { marginTop: 12, backgroundColor: C.mintPale, borderRadius: 14, padding: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  okText: { fontSize: 12, color: C.navy, fontWeight: "700", flex: 1 },
  pendingFeature: { fontSize: 11, lineHeight: 16, color: C.muted, textAlign: "center", marginTop: 10 },
});
