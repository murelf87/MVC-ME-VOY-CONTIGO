import type { PoolClient } from "pg";
import { iso, isoOrNull } from "./common.js";
import type { Db } from "./context.js";

/**
 * Derechos sobre los datos (RGPD) del módulo «trust»: sección de la exportación y paso de eliminación de cuenta.
 * Se conectan al registro de `comms` (src/modules/comms/registry.ts) con `registerTrustDataRights()`.
 *
 * Límites honestos:
 *  - La exportación incluye metadatos (estados, fechas, versiones aceptadas), NO las imágenes (foto, selfies, documentos), que viven en
 *    almacenamiento privado, ni las notas internas del personal (criterio legal pendiente).
 *  - Los plazos de conservación de selfies/documentos están «por definir»; hasta entonces solo se borran al eliminar la cuenta.
 */
export const TRUST_MODULE_NAME = "trust";

export async function exportUserTrustData(db: Db, userId: string) {
  const [photos, check, attempts, acceptances, uploads] = await Promise.all([
    db.query<{ id: string; status: string; reason_code: string | null; submitted_at: Date; decided_at: Date | null }>(
      `select id, status, reason_code, submitted_at, decided_at
         from trust_profile_photos where user_id = $1 order by submitted_at desc, id desc limit 200`,
      [userId]
    ),
    db.query<{ state: string; attempts_used: number; reason_code: string | null; updated_at: Date }>(
      `select state, attempts_used, reason_code, updated_at from trust_identity_checks where user_id = $1`,
      [userId]
    ),
    db.query<{
      attempt_no: number; status: string; reason_code: string | null; submitted_at: Date; decided_at: Date | null; notice_version: number | null;
    }>(
      `select a.attempt_no, a.status, a.reason_code, a.submitted_at, a.decided_at, d.version as notice_version
         from trust_identity_check_attempts a
         left join trust_legal_documents d on d.id = a.notice_document_id
        where a.user_id = $1 order by a.attempt_no`,
      [userId]
    ),
    db.query<{ kind: string; version: number; context: string; accepted_at: Date; document_status: string; ip_hash: string | null }>(
      `select kind, version, context, accepted_at, document_status, ip_hash
         from trust_legal_acceptances where user_id = $1 order by accepted_at desc, id desc limit 500`,
      [userId]
    ),
    db.query<{ n: string }>(`select count(*)::text as n from trust_upload_intents where owner_user_id = $1`, [userId])
  ]);
  const state = check.rows[0];
  return {
    profilePhotos: photos.rows.map(p => ({
      id: p.id,
      status: p.status,
      reasonCode: p.reason_code,
      submittedAt: iso(p.submitted_at),
      decidedAt: isoOrNull(p.decided_at)
    })),
    privateCheck: state
      ? {
          state: state.state,
          attemptsUsed: state.attempts_used,
          reasonCode: state.reason_code,
          updatedAt: iso(state.updated_at),
          attempts: attempts.rows.map(a => ({
            attemptNo: a.attempt_no,
            status: a.status,
            reasonCode: a.reason_code,
            submittedAt: iso(a.submitted_at),
            decidedAt: isoOrNull(a.decided_at),
            privacyNoticeVersionAccepted: a.notice_version
          }))
        }
      : null,
    legalAcceptances: acceptances.rows.map(a => ({
      kind: a.kind,
      version: a.version,
      context: a.context,
      acceptedAt: iso(a.accepted_at),
      documentStatus: a.document_status,
      // Solo se guarda un HMAC de la IP (nunca la IP); aquí se indica si existe, no su valor.
      ipHashStored: a.ip_hash !== null
    })),
    uploadsRequested: Number(uploads.rows[0]?.n ?? 0),
    notes: [
      "Las imágenes subidas (foto de perfil, capturas de la comprobación privada y documentos) se conservan en almacenamiento privado y no se incluyen en este archivo.",
      "Las anotaciones internas del equipo de revisión no se incluyen en este archivo."
    ]
  };
}

/** Claves de almacenamiento privado del módulo (para borrarlas ANTES de anonimizar la cuenta). */
export async function listUserTrustStorageKeys(db: Db, userId: string): Promise<string[]> {
  const keys = new Set<string>();
  const queries = [
    `select storage_key as key from trust_profile_photos where user_id = $1`,
    `select storage_key as key from trust_identity_check_attempts where user_id = $1`,
    `select storage_key as key from trust_upload_intents where owner_user_id = $1`
  ];
  for (const sql of queries) {
    const rows = await db.query<{ key: string | null }>(sql, [userId]);
    for (const row of rows.rows) if (row.key) keys.add(row.key);
  }
  return [...keys];
}

/**
 * Borrado/anonimización dentro de la transacción de eliminación de cuenta.
 *  - Se eliminan fotos, capturas, comprobación privada e intenciones de subida.
 *  - Las aceptaciones legales se CONSERVAN como prueba del consentimiento (plazo «por definir», validación jurídica pendiente),
 *    pero se elimina el hash de IP.
 */
export async function eraseUserTrustData(client: PoolClient, userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const run = async (name: string, sql: string) => {
    const result = await client.query(sql, [userId]);
    counts[name] = result.rowCount ?? 0;
  };
  await run("identityCheckAttemptsDeleted", `delete from trust_identity_check_attempts where user_id = $1`);
  await run("identityChecksDeleted", `delete from trust_identity_checks where user_id = $1`);
  await run("profilePhotosDeleted", `delete from trust_profile_photos where user_id = $1`);
  await run("uploadIntentsDeleted", `delete from trust_upload_intents where owner_user_id = $1`);
  await run("legalAcceptancesIpHashRemoved", `update trust_legal_acceptances set ip_hash = null where user_id = $1 and ip_hash is not null`);
  return counts;
}

/**
 * Conecta el módulo con los derechos sobre los datos de `comms` (exportación y eliminación de cuenta).
 * Devuelve false (sin romper el arranque) si el registro de `comms` no está disponible en este despliegue.
 */
export async function registerTrustDataRights(): Promise<boolean> {
  try {
    const registry = await import("../comms/registry.js");
    registry.registerExportContributor({ name: TRUST_MODULE_NAME, build: (db, userId) => exportUserTrustData(db, userId) });
    registry.registerErasureStep({
      name: TRUST_MODULE_NAME,
      storageKeys: (db, userId) => listUserTrustStorageKeys(db, userId),
      run: (client, userId) => eraseUserTrustData(client, userId)
    });
    return true;
  } catch {
    return false;
  }
}
