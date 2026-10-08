import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import { ApiError, apiRequest } from "../api/client";

export type LocationSharing = { stop(): void };

/** Fixes kept while there is no signal; older ones are dropped first. About five minutes at one fix every 10 s. */
const MAX_BUFFERED = 30;

/**
 * Sends the driver's foreground GPS to the backend while the trip is active.
 * Every event carries a fresh eventId and the device timestamp so the backend
 * can deduplicate retries and ignore out-of-order fixes.
 *
 * Fixes that fail to send (tunnel, no coverage) are kept and resent, newest first,
 * as soon as one gets through: the newest becomes the live position at once and the
 * older ones only fill the trip's history.
 */
export async function startSharingLocation(
  token: string,
  tripId: string,
  onUpdate: (state: { sentAt: string; pending: number } | { error: string; pending: number }) => void
): Promise<LocationSharing> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") {
    throw new Error("Necesitamos permiso de ubicación para compartir el coche en directo.");
  }

  let pending: Record<string, unknown>[] = [];
  let flushing = false;
  let stopped = false;

  const send = (body: Record<string, unknown>) =>
    apiRequest(`/v1/trips/${tripId}/location`, { method: "POST", token, body });

  // A 4xx other than rate limiting means the backend refused this fix for good (trip finished, not the driver): resending will not help.
  const isFinal = (error: unknown) => error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429;

  async function flush() {
    if (flushing || stopped) return;
    flushing = true;
    try {
      while (pending.length && !stopped) {
        const next = pending[pending.length - 1]!;
        try {
          await send(next);
        } catch (error) {
          if (!isFinal(error)) throw error;
        }
        pending = pending.filter(p => p !== next);
        onUpdate({ sentAt: new Date().toISOString(), pending: pending.length });
      }
    } catch (error) {
      onUpdate({
        error: error instanceof Error ? error.message : "No se pudo enviar la ubicación.",
        pending: pending.length,
      });
    } finally {
      flushing = false;
    }
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
      pending = [...pending, body].slice(-MAX_BUFFERED);
      void flush();
    }
  );

  return {
    stop: () => {
      stopped = true;
      subscription.remove();
    },
  };
}
