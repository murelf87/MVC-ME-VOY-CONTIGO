import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import { apiRequest } from "../api/client";

export type LocationSharing = { stop(): void };

/**
 * Sends the driver's foreground GPS to the backend while the trip is active.
 * Every event carries a fresh eventId and the device timestamp so the backend
 * can deduplicate retries and ignore out-of-order fixes.
 */
export async function startSharingLocation(
  token: string,
  tripId: string,
  onUpdate: (state: { sentAt: string } | { error: string }) => void
): Promise<LocationSharing> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") {
    throw new Error("Necesitamos permiso de ubicación para compartir el coche en directo.");
  }

  const subscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 25 },
    position => {
      const body: Record<string, unknown> = {
        eventId: Crypto.randomUUID(),
        recordedAt: new Date(position.timestamp).toISOString(),
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      if (position.coords.accuracy != null) body.accuracyM = Math.max(0, position.coords.accuracy);
      if (position.coords.speed != null && position.coords.speed >= 0) body.speedMps = position.coords.speed;
      apiRequest(`/v1/trips/${tripId}/location`, { method: "POST", token, body })
        .then(() => onUpdate({ sentAt: new Date().toISOString() }))
        .catch(error => onUpdate({ error: error instanceof Error ? error.message : "No se pudo enviar la ubicación." }));
    }
  );

  return { stop: () => subscription.remove() };
}
