/**
 * Tablas del backend en memoria de `auth` / verificación (SIMULACIÓN, solo vista previa).
 *   legal_documents    versiones legales (4 documentos, v1, borrador pendiente de revisión legal)
 *   legal_acceptances  aceptaciones por persona (usuario, versión, contexto, instante)
 *   trust_uploads      intenciones de subida (foto, selfie, documento) hacia el almacén privado simulado
 * Las entregas a revisión viven en `trust_review_items` (la tabla que lee el panel de administración) y los
 * documentos de identidad / permiso en `private_documents`, igual que en el servidor.
 */
import type { LegalAcceptanceContext, LegalDocumentKind } from "@/api/types/trust";
import type { Collection, PreviewDb } from "@/preview";
import { sha256Hex, stableUuid } from "@/preview";
import { LEGAL_SEEDS, type LegalSeed } from "./legalSeed";

export interface LegalDocumentRow {
  id: string;
  kind: LegalDocumentKind;
  version: number;
  status: "draft_pending_legal_review" | "published" | "retired";
  title: string;
  scope: LegalSeed["scope"];
  sections: LegalSeed["sections"];
  content_sha256: string;
  effective_from: number | null;
  published_at: number | null;
}

export interface LegalAcceptanceRow {
  id: string;
  user_id: string;
  document_id: string;
  kind: LegalDocumentKind;
  version: number;
  context: LegalAcceptanceContext;
  accepted_at: number;
}

export type TrustUploadPurpose = "profile_photo" | "identity_selfie" | "identity_document" | "driver_license";

export interface TrustUploadRow {
  id: string;
  owner_user_id: string;
  purpose: TrustUploadPurpose;
  storage_key: string;
  content_type: string;
  expected_size_bytes: number;
  expires_at: number;
  completed_at: number | null;
  created_at: number;
}

export interface TrustTables {
  legalDocuments: Collection<LegalDocumentRow>;
  acceptances: Collection<LegalAcceptanceRow>;
  uploads: Collection<TrustUploadRow>;
}

export function trustTables(db: PreviewDb): TrustTables {
  return {
    legalDocuments: db.collection<LegalDocumentRow>("legal_documents"),
    acceptances: db.collection<LegalAcceptanceRow>("legal_acceptances"),
    uploads: db.collection<TrustUploadRow>("trust_uploads"),
  };
}

/** Siembra las cuatro versiones legales (idempotente). */
export function seedLegalDocuments(db: PreviewDb): void {
  const { legalDocuments } = trustTables(db);
  for (const seed of LEGAL_SEEDS) {
    const id = stableUuid(`legal:${seed.kind}:1`);
    if (legalDocuments.has(id)) continue;
    legalDocuments.insert({
      id,
      kind: seed.kind,
      version: 1,
      status: "draft_pending_legal_review",
      title: seed.title,
      scope: seed.scope,
      sections: seed.sections,
      content_sha256: sha256Hex(new TextEncoder().encode(JSON.stringify(seed.sections))),
      effective_from: null,
      published_at: null,
    });
  }
}

/** Las personas del reparto ya aceptaron Términos y Privacidad al darse de alta. */
export function seedAccountAcceptances(db: PreviewDb): void {
  const { legalDocuments, acceptances } = trustTables(db);
  const docs = legalDocuments.filter((doc) => doc.scope === "account");
  const at = db.nowMs() - 30 * 86_400_000;
  for (const user of db.users.all()) {
    for (const doc of docs) {
      const id = stableUuid(`accept:${user.id}:${doc.kind}:${doc.version}`);
      if (acceptances.has(id)) continue;
      acceptances.insert({ id, user_id: user.id, document_id: doc.id, kind: doc.kind, version: doc.version, context: "registration", accepted_at: at });
    }
  }
}

/** Documento vigente de un tipo: la última versión publicada o, si no hay, la más alta en borrador. */
export function currentDocument(db: PreviewDb, kind: LegalDocumentKind): Readonly<LegalDocumentRow> | undefined {
  const all = trustTables(db).legalDocuments.filter((doc) => doc.kind === kind && doc.status !== "retired");
  const published = all.filter((doc) => doc.status === "published").sort((a, b) => b.version - a.version)[0];
  return published ?? all.sort((a, b) => b.version - a.version)[0];
}
