import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, ApiError } from "../../api/client";
import type { TripSearchParams, TripSearchResult } from "../../api/types";
import { Card, PrimaryButton } from "../components/UI";
import { useAuth } from "../../session/AuthContext";
import { C } from "../theme";

type Mode = "available" | "mine" | "driver";

type PassengerRequest = {
  id: string;
  trip_id: string;
  from_segment_seq: number;
  to_segment_seq: number;
  status: string;
  requested_at: string;
  updated_at: string;
  hold_expires_at?: string | null;
};

type OwnTrip = {
  id: string;
  status: string;
  departure_at: string | null;
  category: string;
  offered_seats: number;
};

type DriverRequest = {
  id: string;
  tripId: string;
  passenger_user_id: string;
  from_segment_seq: number;
  to_segment_seq: number;
  status: string;
  requested_at: string;
  updated_at: string;
};

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

function requestStatus(status: string): { label: string; tone: "blue" | "green" | "amber" | "red" } {
  switch (status) {
    case "pending":
      return { label: "Pendiente del conductor", tone: "amber" };
    case "accepted":
    case "payment_pending":
      return { label: "Aceptada · pago pendiente", tone: "blue" };
    case "confirmed":
      return { label: "Reserva confirmada", tone: "green" };
    case "rejected":
      return { label: "Rechazada", tone: "red" };
    case "cancelled":
      return { label: "Cancelada", tone: "red" };
    case "payment_late":
      return { label: "Pago tardío · revisión", tone: "amber" };
    default:
      return { label: status, tone: "blue" };
  }
}

export function TripsScreen({
  searchParams,
  onLive,
}: {
  searchParams: TripSearchParams | null;
  onLive: () => void;
}) {
  const { token, roles } = useAuth();
  const [mode, setMode] = useState<Mode>("available");
  const [trips, setTrips] = useState<TripSearchResult[]>([]);
  const [mine, setMine] = useState<PassengerRequest[]>([]);
  const [driverRequests, setDriverRequests] = useState<DriverRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const isDriver = roles.includes("driver");

  const routeLabel = useMemo(() => {
    if (!searchParams) return "";
    return `${searchParams.origin.formattedAddress} → ${searchParams.destination.formattedAddress}`;
  }, [searchParams]);

  const loadSearch = useCallback(async () => {
    if (!searchParams) {
      setTrips([]);
      return;
    }
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
      setTrips(response.trips);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudieron buscar viajes.");
    } finally {
      setBusy(false);
    }
  }, [searchParams]);

  const loadMine = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest<{ requests: PassengerRequest[] }>(
        "/v1/me/ride-requests",
        { token }
      );
      setMine(response.requests);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudieron cargar tus solicitudes.");
    } finally {
      setBusy(false);
    }
  }, [token]);

  const loadDriverRequests = useCallback(async () => {
    if (!token || !isDriver) return;
    setBusy(true);
    setError("");
    try {
      const tripsResponse = await apiRequest<{ trips: OwnTrip[] }>(
        "/v1/me/trips",
        { token }
      );
      const batches = await Promise.all(
        tripsResponse.trips.map(async trip => {
          const response = await apiRequest<{ requests: Omit<DriverRequest, "tripId">[] }>(
            `/v1/trips/${trip.id}/requests`,
            { token }
          );
          return response.requests.map(request => ({ ...request, tripId: trip.id }));
        })
      );
      setDriverRequests(batches.flat());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudieron cargar las solicitudes del conductor.");
    } finally {
      setBusy(false);
    }
  }, [token, isDriver]);

  useEffect(() => {
    if (mode === "available") void loadSearch();
    if (mode === "mine") void loadMine();
    if (mode === "driver") void loadDriverRequests();
  }, [mode, loadSearch, loadMine, loadDriverRequests]);

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
      await loadMine();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo enviar la solicitud de plaza.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(requestId: string, decision: "accept" | "reject") {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(
        `/v1/ride-requests/${requestId}/decision`,
        {
          method: "POST",
          token,
          body: { decision },
        }
      );
      await loadDriverRequests();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo registrar la decisión.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Viajes</Text>

      <View style={s.tabs}>
        <Pressable onPress={() => setMode("available")} style={[s.tab, mode === "available" && s.tabActive]}>
          <Text style={[s.tabText, mode === "available" && s.tabTextActive]}>Disponibles</Text>
        </Pressable>
        <Pressable onPress={() => setMode("mine")} style={[s.tab, mode === "mine" && s.tabActive]}>
          <Text style={[s.tabText, mode === "mine" && s.tabTextActive]}>Mis solicitudes</Text>
        </Pressable>
        {isDriver ? (
          <Pressable onPress={() => setMode("driver")} style={[s.tab, mode === "driver" && s.tabActive]}>
            <Text style={[s.tabText, mode === "driver" && s.tabTextActive]}>Conductor</Text>
          </Pressable>
        ) : null}
      </View>

      {busy ? <ActivityIndicator color={C.blue} style={{ marginBottom: 12 }} /> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}

      {mode === "available" ? (
        <>
          <Text style={s.subtitle}>
            {searchParams
              ? `${searchParams.provinceName} · resultados reales del backend`
              : "Busca un trayecto desde Inicio para ver disponibilidad real."}
          </Text>

          {searchParams ? (
            <Card style={s.searchSummary}>
              <View style={s.routeLine}>
                <Ionicons name="location" size={19} color={C.blue} />
                <Text style={s.routeText} numberOfLines={3}>{routeLabel}</Text>
              </View>
            </Card>
          ) : null}

          {!busy && searchParams && !trips.length && !error ? (
            <Card style={s.emptyCard}>
              <Ionicons name="car-outline" size={36} color={C.blue} />
              <Text style={s.emptyTitle}>No hay viajes disponibles ahora</Text>
              <Text style={s.emptyText}>MVC no inventa resultados. Prueba otro horario, radio o trayecto.</Text>
            </Card>
          ) : null}

          {trips.map(trip => (
            <Card key={trip.tripId} style={s.tripCard}>
              <View style={s.tripTop}>
                <View style={s.avatar}><Ionicons name="person" size={28} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.tripName}>{trip.driverDisplayName || "Conductor MVC"}</Text>
                  <Text style={s.tripMeta}>
                    {trip.departureAt ? new Date(trip.departureAt).toLocaleString() : "Salida por confirmar"}
                  </Text>
                </View>
                <View style={s.badge}><Text style={s.badgeText}>{trip.availableSeats} {trip.availableSeats === 1 ? "plaza" : "plazas"}</Text></View>
              </View>

              <View style={s.dataGrid}>
                <View style={s.dataItem}><Text style={s.dataLabel}>Recorrido</Text><Text style={s.dataValue}>{km(trip.roadDistanceM)}</Text></View>
                <View style={s.dataItem}><Text style={s.dataLabel}>Duración</Text><Text style={s.dataValue}>{duration(trip.estimatedDurationS)}</Text></View>
                <View style={s.dataItem}><Text style={s.dataLabel}>A recogida</Text><Text style={s.dataValue}>{km(trip.pickupDistanceM)}</Text></View>
              </View>

              <PrimaryButton
                title={requested[trip.tripId] ? "Solicitud enviada" : "Solicitar plaza"}
                onPress={() => void requestSeat(trip)}
                disabled={busy || requested[trip.tripId]}
              />
              {requested[trip.tripId] ? (
                <Text style={s.pending}>Pendiente de aceptación del conductor. Aún no es una reserva confirmada.</Text>
              ) : null}
            </Card>
          ))}

          {trips.length ? (
            <Pressable style={s.liveLink} onPress={onLive}>
              <Ionicons name="map-outline" size={19} color={C.blue} />
              <Text style={s.liveLinkText}>Ver diseño del seguimiento en directo</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {mode === "mine" ? (
        <>
          <Text style={s.subtitle}>Estados reales de tus solicitudes de plaza.</Text>
          {!busy && !mine.length ? (
            <Card style={s.emptyCard}>
              <Ionicons name="document-text-outline" size={36} color={C.blue} />
              <Text style={s.emptyTitle}>No tienes solicitudes</Text>
            </Card>
          ) : null}
          {mine.map(item => {
            const status = requestStatus(item.status);
            return (
              <Card key={item.id} style={s.tripCard}>
                <View style={s.requestHeader}>
                  <View style={[s.statusDot, status.tone === "green" && s.green, status.tone === "amber" && s.amber, status.tone === "red" && s.red]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.tripName}>{status.label}</Text>
                    <Text style={s.tripMeta}>Solicitud {item.id.slice(0, 8)} · viaje {item.trip_id.slice(0, 8)}</Text>
                  </View>
                </View>
                <Text style={s.requestMeta}>Tramos {item.from_segment_seq} → {item.to_segment_seq}</Text>
                {item.hold_expires_at ? (
                  <Text style={s.pending}>La plaza está retenida temporalmente hasta {new Date(item.hold_expires_at).toLocaleTimeString()}.</Text>
                ) : null}
              </Card>
            );
          })}
        </>
      ) : null}

      {mode === "driver" ? (
        <>
          <Text style={s.subtitle}>Acepta o rechaza solicitudes de tus viajes. Aceptar crea un hold temporal, no una reserva pagada.</Text>
          {!busy && !driverRequests.length ? (
            <Card style={s.emptyCard}>
              <Ionicons name="people-outline" size={36} color={C.blue} />
              <Text style={s.emptyTitle}>No hay solicitudes pendientes</Text>
            </Card>
          ) : null}
          {driverRequests.map(item => (
            <Card key={item.id} style={s.tripCard}>
              <Text style={s.tripName}>Solicitud de pasajero</Text>
              <Text style={s.tripMeta}>Usuario {item.passenger_user_id.slice(0, 8)} · viaje {item.tripId.slice(0, 8)}</Text>
              <Text style={s.requestMeta}>Tramos {item.from_segment_seq} → {item.to_segment_seq} · estado {item.status}</Text>
              {item.status === "pending" ? (
                <View style={s.decisions}>
                  <Pressable onPress={() => void decide(item.id, "accept")} style={s.accept}>
                    <Ionicons name="checkmark" size={19} color="#fff" />
                    <Text style={s.acceptText}>Aceptar</Text>
                  </Pressable>
                  <Pressable onPress={() => void decide(item.id, "reject")} style={s.reject}>
                    <Ionicons name="close" size={19} color={C.blue} />
                    <Text style={s.rejectText}>Rechazar</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={s.pending}>{requestStatus(item.status).label}</Text>
              )}
            </Card>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

export function MessagesScreen() {
  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Mensajes</Text>
      <Text style={s.subtitle}>Solo aparecerán conversaciones autorizadas por una reserva o viaje real.</Text>
      <Card style={s.emptyCard}>
        <Ionicons name="chatbubbles-outline" size={38} color={C.blue} />
        <Text style={s.emptyTitle}>Sin conversaciones cargadas</Text>
        <Text style={s.emptyText}>MVC no muestra chats ficticios. Cuando tengas una reserva confirmada, el chat se vinculará al viaje correspondiente.</Text>
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 18, paddingBottom: 28, backgroundColor: "#fff" },
  title: { fontSize: 25, fontWeight: "900", color: C.navy, textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 12, lineHeight: 18, color: C.muted, textAlign: "center", marginBottom: 16 },
  tabs: { flexDirection: "row", gap: 7, marginBottom: 14 },
  tab: { flex: 1, minHeight: 40, borderWidth: 1, borderColor: C.border, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  tabActive: { backgroundColor: C.blue, borderColor: C.blue },
  tabText: { fontSize: 10, fontWeight: "900", color: C.navy, textAlign: "center" },
  tabTextActive: { color: "#fff" },
  searchSummary: { marginBottom: 12 },
  tripCard: { marginBottom: 12 },
  tripTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#78B89F", alignItems: "center", justifyContent: "center" },
  tripName: { fontSize: 15, fontWeight: "900", color: C.navy },
  tripMeta: { fontSize: 10, color: C.muted, marginTop: 2 },
  badge: { backgroundColor: C.pale, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  badgeText: { fontSize: 10, fontWeight: "900", color: C.blue },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeText: { fontSize: 13, fontWeight: "800", color: C.navy, flex: 1 },
  dataGrid: { flexDirection: "row", gap: 8, marginTop: 14 },
  dataItem: { flex: 1, backgroundColor: "#F7FAFF", borderRadius: 12, padding: 10 },
  dataLabel: { fontSize: 9, fontWeight: "800", color: C.muted, textTransform: "uppercase" },
  dataValue: { fontSize: 12, fontWeight: "900", color: C.navy, marginTop: 3 },
  pending: { fontSize: 10, lineHeight: 15, color: "#966112", backgroundColor: "#FFF6E8", padding: 9, borderRadius: 10, marginTop: 8 },
  error: { marginBottom: 12, color: "#9E302D", backgroundColor: "#FFF0EF", padding: 11, borderRadius: 12, fontSize: 12 },
  emptyCard: { alignItems: "center", paddingVertical: 26, marginTop: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "900", color: C.navy, marginTop: 10 },
  emptyText: { fontSize: 12, lineHeight: 18, color: C.muted, textAlign: "center", marginTop: 5 },
  liveLink: { minHeight: 48, borderWidth: 1, borderColor: C.border, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  liveLinkText: { fontSize: 12, fontWeight: "800", color: C.blue },
  requestHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  requestMeta: { fontSize: 11, color: C.muted, marginTop: 10 },
  statusDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: C.blue },
  green: { backgroundColor: C.mint },
  amber: { backgroundColor: "#EAA43A" },
  red: { backgroundColor: "#D84A4A" },
  decisions: { flexDirection: "row", gap: 9, marginTop: 12 },
  accept: { flex: 1, height: 46, borderRadius: 13, backgroundColor: C.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  acceptText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  reject: { flex: 1, height: 46, borderRadius: 13, borderWidth: 1, borderColor: C.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  rejectText: { color: C.blue, fontSize: 12, fontWeight: "900" },
});
