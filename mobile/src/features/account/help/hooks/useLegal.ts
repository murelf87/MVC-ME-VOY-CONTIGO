import type { LegalDocument, LegalDocumentKind, LegalDocumentSummary } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getLegalDocument, listLegalDocuments } from "../api";
import { helpKeys } from "./keys";

/** Última versión de cada documento legal (pública: no pide sesión). */
export function useLegalDocuments(): UseApiQueryResult<LegalDocumentSummary[]> {
  return useApiQuery(helpKeys.legalList, ({ signal }) => listLegalDocuments({ signal }), { staleTimeMs: 5 * 60_000 });
}

/** Documento vigente (`version` omitida) o una versión concreta. */
export function useLegalDocument(kind: LegalDocumentKind, version: number | undefined): UseApiQueryResult<LegalDocument> {
  return useApiQuery(helpKeys.legalDocument(kind, version ?? null), ({ signal }) => getLegalDocument(kind, version, { signal }), { staleTimeMs: 5 * 60_000 });
}
