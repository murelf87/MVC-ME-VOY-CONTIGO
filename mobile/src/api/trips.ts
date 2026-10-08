import { apiRequest } from "./client";
import type {
  Conversation,
  DriverRideRequest,
  OwnTrip,
  PassengerRideRequest,
} from "./types";

export async function loadPassengerRequests(token: string): Promise<PassengerRideRequest[]> {
  const response = await apiRequest<{ requests: PassengerRideRequest[] }>(
    "/v1/me/ride-requests",
    { token }
  );
  return response.requests;
}

export async function loadDriverTrips(token: string): Promise<{
  trips: OwnTrip[];
  requests: DriverRideRequest[];
}> {
  const tripsResponse = await apiRequest<{ trips: OwnTrip[] }>("/v1/me/trips", { token });
  const trips = tripsResponse.trips.filter(trip => trip.status !== "draft");
  const batches = await Promise.all(
    trips.map(async trip => {
      const response = await apiRequest<{ requests: Omit<DriverRideRequest, "tripId">[] }>(
        `/v1/trips/${trip.id}/requests`,
        { token }
      );
      return response.requests.map(request => ({ ...request, tripId: trip.id }));
    })
  );
  return { trips, requests: batches.flat() };
}

/** A booking is chat-eligible while it is confirmed or completed; the backend enforces the same rule. */
function chatEligible(bookingStatus: string | null): boolean {
  return bookingStatus === "confirmed" || bookingStatus === "completed";
}

export async function loadConversations(
  token: string,
  isDriver: boolean
): Promise<Conversation[]> {
  const conversations: Conversation[] = [];

  const mine = await loadPassengerRequests(token).catch(() => []);
  for (const request of mine) {
    if (!chatEligible(request.booking_status)) continue;
    conversations.push({
      tripId: request.trip_id,
      peerUserId: request.driver_user_id,
      peerName: request.driver_display_name || "Conductor MVC",
      departureAt: request.departure_at,
      tripStatus: request.trip_status,
    });
  }

  if (isDriver) {
    const { trips, requests } = await loadDriverTrips(token);
    for (const request of requests) {
      if (!chatEligible(request.booking_status)) continue;
      const trip = trips.find(item => item.id === request.tripId);
      conversations.push({
        tripId: request.tripId,
        peerUserId: request.passenger_user_id,
        peerName: request.passenger_display_name || "Pasajero MVC",
        departureAt: trip?.departure_at ?? null,
        tripStatus: trip?.status ?? "",
      });
    }
  }

  return conversations;
}

export function tripStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Borrador";
    case "published":
      return "Publicado";
    case "active":
      return "En marcha";
    case "completed":
      return "Finalizado";
    case "cancelled":
      return "Cancelado";
    default:
      return status;
  }
}

export function formatDeparture(value: string | null): string {
  if (!value) return "Salida por confirmar";
  return new Date(value).toLocaleString("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
