import { getLegalDocument, getPrivateCheck, getProfilePhoto, getVerification } from "../api";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import type { LegalDocument, PrivateCheckState, ProfilePhotoState, TrustVerificationOverview } from "@/api/types/trust";

/** Claves de la caché del slice `auth` (verificación). `queryCache.invalidate(TRUST)` las refresca todas. */
export const TRUST = ["auth", "trust"] as const;
export const TRUST_PHOTO = ["auth", "trust", "photo"] as const;
export const TRUST_CHECK = ["auth", "trust", "check"] as const;
export const TRUST_OVERVIEW = ["auth", "trust", "overview"] as const;

export function useProfilePhotoState(enabled = true): UseApiQueryResult<ProfilePhotoState> {
  return useApiQuery<ProfilePhotoState>(TRUST_PHOTO, ({ signal }) => getProfilePhoto({ signal }), { enabled, staleTimeMs: 10_000 });
}

export function usePrivateCheckState(options: { enabled?: boolean; pollMs?: number | false } = {}): UseApiQueryResult<PrivateCheckState> {
  return useApiQuery<PrivateCheckState>(TRUST_CHECK, ({ signal }) => getPrivateCheck({ signal }), {
    enabled: options.enabled ?? true,
    staleTimeMs: 5_000,
    refetchIntervalMs: options.pollMs ?? false,
  });
}

export function useTrustOverview(enabled = true): UseApiQueryResult<TrustVerificationOverview> {
  return useApiQuery<TrustVerificationOverview>(TRUST_OVERVIEW, ({ signal }) => getVerification({ signal }), { enabled, staleTimeMs: 10_000 });
}

/** Aviso de privacidad de la comprobación (lámina 07): texto vigente publicado por el servidor. */
export function usePrivateCheckNotice(enabled = true): UseApiQueryResult<LegalDocument> {
  return useApiQuery<LegalDocument>(["auth", "legal", "private_check_notice"], ({ signal }) => getLegalDocument("private_check_notice", undefined, { signal }), {
    enabled,
    staleTimeMs: 60_000,
  });
}
