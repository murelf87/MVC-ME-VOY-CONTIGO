import type { LivePrivacyPreferences } from "@/api/types";
import { useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { getLivePrivacy, putLivePrivacy } from "../api";
import { liveKeys } from "./keys";

export function useLivePrivacy(): UseApiQueryResult<LivePrivacyPreferences> {
  return useApiQuery<LivePrivacyPreferences>(liveKeys.privacy, ({ signal }) => getLivePrivacy({ signal }), { staleTimeMs: 30_000 });
}

/** `PUT /v1/me/live-privacy`: tras guardar se refrescan las pantallas de «En el coche» que muestran a los copasajeros. */
export function useSaveLivePrivacy(): UseApiMutationResult<LivePrivacyPreferences, { showProfileToCoPassengers: boolean }> {
  return useApiMutation<LivePrivacyPreferences, { showProfileToCoPassengers: boolean }>((body, { signal }) => putLivePrivacy(body, { signal }), { invalidates: [liveKeys.privacy, liveKeys.all] });
}
