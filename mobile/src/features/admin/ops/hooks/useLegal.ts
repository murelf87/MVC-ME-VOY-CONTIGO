/**
 * Documentos legales (solo administración): todas las versiones, texto completo de una versión, crear borrador
 * «pendiente de revisión legal» y publicar con la referencia de la revisión legal.
 */
import type { AdminLegalDocumentCreate, AdminLegalPublishRequest, LegalDocument, LegalDocumentKind, LegalDocumentSummary } from "@/api/types";
import { queryCache, useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { createLegalDocument, getLegalVersion, listLegalDocuments, publishLegalDocument } from "../api";
import { ADMIN_AUDIT, ADMIN_LEGAL, LEGAL_LIST_KEY, legalVersionKey } from "./keys";

export function useLegalDocuments(enabled: boolean): UseApiQueryResult<{ items: LegalDocumentSummary[] }> {
  return useApiQuery<{ items: LegalDocumentSummary[] }>(LEGAL_LIST_KEY, ({ signal }) => listLegalDocuments({ signal }), { enabled, staleTimeMs: 15_000 });
}

/** Texto completo de una versión (`GET /v1/legal/documents/{kind}/versions/{version}`, público). */
export function useLegalVersionText(kind: LegalDocumentKind | null, version: number | null, enabled: boolean): UseApiQueryResult<LegalDocument> {
  return useApiQuery<LegalDocument>(
    legalVersionKey(kind ?? "terms", version ?? 0),
    ({ signal }) => {
      if (kind === null || version === null) return Promise.reject(new Error("Versión no indicada"));
      return getLegalVersion(kind, version, { signal });
    },
    { enabled: enabled && kind !== null && version !== null, staleTimeMs: 60_000 },
  );
}

export function useCreateLegalDocument(): UseApiMutationResult<LegalDocument, AdminLegalDocumentCreate> {
  return useApiMutation<LegalDocument, AdminLegalDocumentCreate>((input, { signal }) => createLegalDocument(input, { signal }), {
    onSuccess: (document) => queryCache.setData<LegalDocument>(legalVersionKey(document.kind, document.version), document),
    invalidates: [LEGAL_LIST_KEY, ADMIN_AUDIT],
  });
}

export interface PublishLegalInput {
  documentId: string;
  request: AdminLegalPublishRequest;
}

export function usePublishLegalDocument(): UseApiMutationResult<LegalDocument, PublishLegalInput> {
  return useApiMutation<LegalDocument, PublishLegalInput>((input, { signal }) => publishLegalDocument(input.documentId, input.request, { signal }), {
    onSuccess: (document) => queryCache.setData<LegalDocument>(legalVersionKey(document.kind, document.version), document),
    invalidates: [ADMIN_LEGAL, ADMIN_AUDIT],
  });
}
