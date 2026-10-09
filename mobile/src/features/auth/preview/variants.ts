/**
 * Variantes de datos del slice `auth` para la vista previa (escenarios 08 y estados de verificación).
 * SIMULACIÓN: las capturas sembradas son dibujos de ejemplo, nunca fotos de personas.
 */
import { SEED_USER_IDS } from "@/preview";
import type { PreviewDb } from "@/preview";
import { putEvidenceBlob, evidenceStorageKey } from "../../admin/preview/reviewWorld/evidenceArt";
import { reviewTables, type EvidenceRow, type ReviewItemRow } from "../../admin/preview/reviewWorld/store";
import { currentDocument, trustTables } from "./trustStore";

export const authSeedVariants: Readonly<Record<string, string>> = {
  "auth-check-retry": "Ana ya aceptó el aviso y tiene 2 de 3 capturas: la última necesita repetirse («el rostro está fuera del marco»).",
};

const RETRY = "auth-check-retry";

function stable(db: PreviewDb): string {
  return db.ids.uuid();
}

export function seedAuthVariant(db: PreviewDb, seed: string): void {
  if (seed !== RETRY) return;
  const userId = SEED_USER_IDS.ana;
  const now = db.nowMs();
  const evidence: EvidenceRow[] = [1, 2].map((n) => {
    const id = stable(db);
    const row: EvidenceRow = {
      id,
      kind: "identity_selfie",
      label: "Captura de la comprobación",
      content_type: "image/svg+xml",
      size_bytes: 4_096,
      submitted_at: now - (3 - n) * 3_600_000,
      status: n === 1 ? "superseded" : "needs_retry",
      storage_key: evidenceStorageKey(userId, "identity_selfie", id),
    };
    putEvidenceBlob(db, row);
    return row;
  });
  const item: ReviewItemRow = {
    id: `${userId}:private_check`,
    user_id: userId,
    key: "private_check",
    state: "needs_retry",
    submitted_at: now - 3_600_000,
    decided_at: now - 1_800_000,
    decided_by: SEED_USER_IDS.staff,
    reason: null,
    reason_code: "FACE_OUT_OF_FRAME",
    evidence,
  };
  const items = reviewTables(db).items;
  if (items.has(item.id)) items.update(item.id, item);
  else items.insert(item);
  const doc = currentDocument(db, "private_check_notice");
  if (doc !== undefined) {
    const { acceptances } = trustTables(db);
    const id = stable(db);
    acceptances.insert({ id, user_id: userId, document_id: doc.id, kind: "private_check_notice", version: doc.version, context: "private_check", accepted_at: now - 4 * 3_600_000 });
  }
}
