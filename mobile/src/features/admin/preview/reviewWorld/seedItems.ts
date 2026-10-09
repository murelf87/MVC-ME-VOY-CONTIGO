/**
 * Datos de ejemplo de «Usuarios y revisión» (SIMULACIÓN, solo vista previa): personas ficticias del reparto del diseño con
 * sus entregas a revisión. Las pruebas privadas son imágenes ILUSTRATIVAS («Ejemplo ilustrativo»): ningún documento real.
 *
 * El estado de 38a (identidad en revisión) y el de 38b (identidad ya verificada, permiso por revisar) salen del mismo
 * mundo: 38b es 38a una vez aprobada la identidad (`applyUsersB`).
 */
import type { AdminEvidenceKind, AdminReviewItemKey } from "@/api/types";
import { addDaysToDate, createUser, madridDate, madridDateTimeMs, SEED_USER_IDS, stableUuid, TIME, type PreviewDb, type SeedUserKey } from "@/preview";
import { evidenceStorageKey, evidenceSvg, putEvidenceBlob, EVIDENCE_CONTENT_TYPE } from "./evidenceArt";
import { reviewTables, type EvidenceRow, type ReviewItemRow, type StoredItemState } from "./store";

const MIN = TIME.MS_MIN;
const HOUR = TIME.MS_HOUR;

const DNI = "Documento de identidad";
const LICENSE = "Permiso de conducir";
const PHOTO = "Foto de perfil";

interface EvidenceSpec {
  kind: AdminEvidenceKind;
  label: string;
  at: number;
  status: string;
}

interface ItemSpec {
  key: AdminReviewItemKey;
  state: StoredItemState;
  submittedAt: number;
  decidedAt?: number;
  reason?: string;
  reasonCode?: string;
  evidence: EvidenceSpec[];
}

function evidenceRow(userId: string, ref: string, key: AdminReviewItemKey, index: number, spec: EvidenceSpec): EvidenceRow {
  const id = stableUuid(`review:evidence:${ref}:${key}:${index}`);
  return {
    id,
    kind: spec.kind,
    label: spec.label,
    content_type: EVIDENCE_CONTENT_TYPE,
    size_bytes: new TextEncoder().encode(evidenceSvg(spec.kind, spec.label)).byteLength,
    submitted_at: spec.at,
    status: spec.status,
    storage_key: evidenceStorageKey(userId, spec.kind, id),
  };
}

function putItemFor(db: PreviewDb, userId: string, ref: string, spec: ItemSpec): void {
  const decided = spec.state === "approved" || spec.state === "rejected" || spec.state === "needs_retry";
  const evidence = spec.evidence.map((e, index) => evidenceRow(userId, ref, spec.key, index, e));
  for (const e of evidence) putEvidenceBlob(db, e);
  const row: ReviewItemRow = {
    id: `${userId}:${spec.key}`,
    user_id: userId,
    key: spec.key,
    state: spec.state,
    submitted_at: spec.submittedAt,
    decided_at: decided ? (spec.decidedAt ?? spec.submittedAt + 2 * HOUR) : null,
    decided_by: decided ? SEED_USER_IDS.staff : null,
    reason: spec.reason ?? null,
    reason_code: spec.reasonCode ?? null,
    evidence,
  };
  reviewTables(db).items.put(row);
}

function putItem(db: PreviewDb, user: SeedUserKey, spec: ItemSpec): void {
  putItemFor(db, SEED_USER_IDS[user], user, spec);
}

function document(label: string, at: number, status: string): EvidenceSpec {
  return { kind: "private_document", label, at, status };
}

function at(db: PreviewDb, dayOffset: number, hhmm: string): number {
  return madridDateTimeMs(addDaysToDate(madridDate(db.nowMs()), dayOffset), hhmm);
}

/** Personas con el expediente aprobado (la pestaña «Aprobados»): identidad y, si conducen, permiso. */
const APPROVED: ReadonlyArray<{ user: SeedUserKey; driver: boolean }> = [
  { user: "laura", driver: false },
  { user: "carlos", driver: true },
  { user: "marta", driver: true },
  { user: "miguelAngel", driver: true },
  { user: "daniel", driver: true },
  { user: "carmen", driver: true },
  { user: "javier", driver: false },
  { user: "elena", driver: false },
  { user: "irene", driver: false },
  { user: "alvaro", driver: false },
  { user: "nuria", driver: false },
];

/** Mundo por defecto de la cola de revisión: 5 pendientes, 11 aprobadas y 3 rechazadas. */
export function seedReviewItems(db: PreviewDb): void {
  const now = db.nowMs();

  // ── Pendientes (lo que muestran las láminas 38a: Ana López y Miguel Torres primero) ──
  putItem(db, "ana", {
    key: "identity",
    state: "in_review",
    submittedAt: now - 14 * MIN,
    evidence: [document(DNI, now - 14 * MIN, "in_review")],
  });
  putItem(db, "ana", {
    key: "driver_license",
    state: "in_review",
    submittedAt: now - 13 * MIN,
    evidence: [document(LICENSE, now - 13 * MIN, "in_review")],
  });
  putItem(db, "miguel", {
    key: "identity",
    state: "in_review",
    submittedAt: now - 22 * MIN,
    evidence: [document(DNI, now - 22 * MIN, "in_review")],
  });
  // Rafael: ya verificó su identidad; falta el permiso de conducir.
  putItem(db, "rafael", {
    key: "identity",
    state: "approved",
    submittedAt: at(db, -3, "17:20"),
    decidedAt: at(db, -3, "19:05"),
    evidence: [document(DNI, at(db, -3, "17:20"), "approved")],
  });
  putItem(db, "rafael", {
    key: "driver_license",
    state: "in_review",
    submittedAt: at(db, -2, "10:42"),
    evidence: [document(LICENSE, at(db, -2, "10:42"), "in_review")],
  });
  // Inés: identidad y permiso aprobados; la comprobación privada pidió otra captura y la segunda espera revisión.
  putItem(db, "ines", {
    key: "identity",
    state: "approved",
    submittedAt: at(db, -4, "09:15"),
    decidedAt: at(db, -4, "11:40"),
    evidence: [document(DNI, at(db, -4, "09:15"), "approved")],
  });
  putItem(db, "ines", {
    key: "driver_license",
    state: "approved",
    submittedAt: at(db, -4, "09:16"),
    decidedAt: at(db, -4, "11:41"),
    evidence: [document(LICENSE, at(db, -4, "09:16"), "approved")],
  });
  putItem(db, "ines", {
    key: "private_check",
    state: "in_review",
    submittedAt: now - 3 * HOUR,
    evidence: [
      { kind: "identity_selfie", label: "Captura 1", at: at(db, -3, "18:30"), status: "needs_retry" },
      { kind: "identity_selfie", label: "Captura 2", at: now - 3 * HOUR, status: "in_review" },
    ],
  });
  // Sofía no tiene fila propia: su documento de identidad pendiente es el que sube el mundo base (documentos privados).

  // ── Aprobadas ──
  APPROVED.forEach((entry, index) => {
    const submitted = at(db, -(9 + index * 4), "10:05");
    putItem(db, entry.user, {
      key: "identity",
      state: "approved",
      submittedAt: submitted,
      decidedAt: submitted + 2 * HOUR + index * MIN,
      evidence: [document(DNI, submitted, "approved")],
    });
    if (entry.driver) {
      putItem(db, entry.user, {
        key: "driver_license",
        state: "approved",
        submittedAt: submitted + MIN,
        decidedAt: submitted + 2 * HOUR + index * MIN,
        evidence: [document(LICENSE, submitted + MIN, "approved")],
      });
    }
  });

  // ── Rechazadas (con su motivo) ──
  putItem(db, "lucia", {
    key: "identity",
    state: "rejected",
    submittedAt: at(db, -6, "12:10"),
    decidedAt: at(db, -6, "13:30"),
    reason: "El documento se ve borroso y no se leen los datos. Sube una foto más nítida.",
    reasonCode: "DOCUMENT_REVIEW_REJECTED",
    evidence: [document(DNI, at(db, -6, "12:10"), "rejected")],
  });
  putItem(db, "pablo", {
    key: "identity",
    state: "approved",
    submittedAt: at(db, -20, "09:00"),
    decidedAt: at(db, -20, "10:10"),
    evidence: [document(DNI, at(db, -20, "09:00"), "approved")],
  });
  putItem(db, "pablo", {
    key: "profile_photo",
    state: "rejected",
    submittedAt: at(db, -5, "08:50"),
    decidedAt: at(db, -5, "09:35"),
    reason: "Se ve con gafas de sol. Sube una foto con la cara descubierta.",
    reasonCode: "SUNGLASSES_OR_COVERING",
    evidence: [{ kind: "profile_photo", label: PHOTO, at: at(db, -5, "08:50"), status: "rejected" }],
  });
  putItem(db, "hugo", {
    key: "identity",
    state: "approved",
    submittedAt: at(db, -16, "10:30"),
    decidedAt: at(db, -16, "12:00"),
    evidence: [document(DNI, at(db, -16, "10:30"), "approved")],
  });
  putItem(db, "hugo", {
    key: "private_check",
    state: "rejected",
    submittedAt: at(db, -8, "19:00"),
    decidedAt: at(db, -8, "20:15"),
    reason: "La captura no coincide con la foto de perfil.",
    reasonCode: "NOT_MATCHING_PROFILE_PHOTO",
    evidence: [{ kind: "identity_selfie", label: "Captura 1", at: at(db, -8, "19:00"), status: "rejected" }],
  });

  // Coherencia con el perfil, como lo dejaría el servidor al decidir.
  db.profiles.update(SEED_USER_IDS.lucia, { identity_status: "rejected" });
  db.profiles.update(SEED_USER_IDS.pablo, { public_photo_status: "rejected" });
}

/**
 * Variante 38b: Ana ya tiene la identidad verificada (queda el permiso de conducir por revisar) y Miguel, con la identidad
 * verificada, tiene una foto de perfil nueva por revisar. (En la lámina 38b la tarjeta de Miguel muestra «Pendiente» con
 * identidad y foto aprobadas, lo que ningún servidor puede producir: algo tiene que esperar revisión.)
 */
export function applyUsersB(db: PreviewDb): void {
  const now = db.nowMs();
  const tables = reviewTables(db);
  const decide = (user: SeedUserKey): void => {
    const row = tables.items.get(`${SEED_USER_IDS[user]}:identity`);
    if (row === undefined) return;
    tables.items.update(row.id, {
      state: "approved",
      decided_at: now - 6 * MIN,
      decided_by: SEED_USER_IDS.staff,
      evidence: row.evidence.map((e) => ({ ...e, status: e.status === "in_review" ? "approved" : e.status })),
    });
  };
  decide("ana");
  decide("miguel");
  putItem(db, "miguel", {
    key: "profile_photo",
    state: "in_review",
    submittedAt: now - 9 * MIN,
    evidence: [{ kind: "profile_photo", label: PHOTO, at: now - 9 * MIN, status: "in_review" }],
  });
}

/** Variante «autorrevisión»: el propio personal de administración tiene una entrega pendiente (no puede decidirla). */
export function applySelfReview(db: PreviewDb): void {
  const now = db.nowMs();
  putItem(db, "staff", {
    key: "identity",
    state: "in_review",
    submittedAt: now - 5 * MIN,
    evidence: [document(DNI, now - 5 * MIN, "in_review")],
  });
}

const EXTRA_NAMES: readonly string[] = [
  "Lola Prieto",
  "Sergio Navas",
  "Marina Cruz",
  "Adrián Molina",
  "Paula Ortega",
  "Iván Serrano",
  "Claudia Vega",
  "Rubén Castro",
  "Noelia Gallego",
  "Óscar Benítez",
  "Alba Herrero",
  "Mario Pastor",
  "Triana Rojas",
  "Emilio Crespo",
  "Celia Márquez",
  "Jaime Arroyo",
  "Natalia Fuentes",
  "Héctor Campos",
  "Rocío Iglesias",
  "Samuel Peña",
  "Beatriz Lozano",
  "Gonzalo Ibáñez",
  "Valeria Cortés",
  "Ismael Nieto",
  "Aitana Bravo",
  "Raúl Esteban",
  "Mireia Santos",
  "Dani Muñoz",
];

/**
 * Variante «cola larga»: `EXTRA_NAMES.length` personas más con la identidad por revisar (para probar la paginación y
 * «Cargar más»). Son personas ficticias que solo existen en esta variante.
 */
export function seedManyPending(db: PreviewDb): void {
  const now = db.nowMs();
  EXTRA_NAMES.forEach((displayName, index) => {
    const id = stableUuid(`review:many:user:${index}`);
    const submitted = now - (30 + index * 47) * MIN;
    createUser(db, {
      id,
      phone: `+346110003${String(index).padStart(2, "0")}`,
      roles: index % 3 === 0 ? ["passenger", "driver"] : ["passenger"],
      displayName,
      identityStatus: "pending",
      createdAt: submitted - 3 * HOUR,
    });
    putItemFor(db, id, `many-${index}`, {
      key: "identity",
      state: "in_review",
      submittedAt: submitted,
      evidence: [document(DNI, submitted, "in_review")],
    });
  });
}
