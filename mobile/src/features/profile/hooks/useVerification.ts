/**
 * Estado de verificación (foto, comprobación privada, identidad y documentos) y la foto propia de la persona.
 *
 * El estado lo sirve `GET /v1/me/verification` (lo registra el paquete `auth`). Aquí solo se lee; subir fotos o documentos
 * es de `auth` y se navega a sus pantallas.
 */
import { useMemo } from "react";
import type { TrustVerificationOverview } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { useAuth } from "@/session";
import { getVerification, resolvePhotoUrl } from "../api";
import { summarizeVerification, type VerificationSummary } from "../model/profileHeader";
import type { Viewer } from "../model/tripCards";
import { VERIFICATION } from "./keys";

export function useVerification(enabled = true): UseApiQueryResult<TrustVerificationOverview> {
  return useApiQuery<TrustVerificationOverview>(VERIFICATION, ({ signal }) => getVerification({ signal }), { enabled, staleTimeMs: 20_000 });
}

export function useVerificationSummary(enabled = true): { summary: VerificationSummary | null; query: UseApiQueryResult<TrustVerificationOverview> } {
  const query = useVerification(enabled);
  const summary = useMemo(() => (query.data !== undefined ? summarizeVerification(query.data) : null), [query.data]);
  return { summary, query };
}

/**
 * Persona que mira la pantalla: su foto aprobada (la ven otras personas en `/v1/public/users/{id}/photo`) o, sin ella,
 * `null` para que se pinten sus iniciales. No pide nada si no hay foto aprobada.
 */
export function useViewer(): Viewer | null {
  const { me } = useAuth();
  const approved = me !== null && me.public_photo_status === "approved" && me.public_photo_key !== null;
  const verification = useVerification(approved);
  const publicUrl = verification.data?.photo.publicPhotoUrl ?? null;
  return useMemo(() => {
    if (me === null) return null;
    const name = me.display_name?.trim() ?? "";
    // Solo se usa la URL que entrega el servidor: nunca se inventa una ruta (en la vista previa saldría a Internet).
    const photoUrl = approved && publicUrl !== null ? resolvePhotoUrl(publicUrl) : null;
    return { id: me.id, name, photoUrl };
  }, [me, approved, publicUrl]);
}
