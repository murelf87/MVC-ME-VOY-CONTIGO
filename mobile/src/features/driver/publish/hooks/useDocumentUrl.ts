import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getDocumentDownloadUrl } from "../api";
import { PUBLISH_ROOT } from "../keys";

/** Las URL firmadas duran unos minutos: se piden de nuevo antes de que caduquen (y siempre al volver a la pantalla). */
const URL_STALE_MS = 4 * 60_000;

export type SignedDocument = { url: string; expiresAt: string };

/**
 * URL firmada de corta duración para VER un documento propio (la foto del vehículo, por ejemplo). Sin `documentId`
 * no se pide nada. Nunca se guarda: el servidor la emite en cada consulta.
 */
export function useDocumentUrl(documentId: string | null | undefined): UseApiQueryResult<SignedDocument> {
  return useApiQuery<SignedDocument>(
    [PUBLISH_ROOT, "document-url", documentId ?? "none"],
    ({ signal }) => getDocumentDownloadUrl(documentId as string, { signal }),
    { enabled: typeof documentId === "string" && documentId !== "", staleTimeMs: URL_STALE_MS },
  );
}
