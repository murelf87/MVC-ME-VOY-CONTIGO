/**
 * Vehículos y documentos privados sembrados. Los vehículos «aprobados» cumplen lo que exige conducir (foto aprobada,
 * seguro aprobado y vigente); los otros dos alimentan las colas de revisión de la administración.
 *
 * Los objetos «guardados» solo tienen metadatos: al descargarlos el almacén simulado devuelve una imagen de marcador
 * (nunca un documento de una persona real).
 */
import type { PreviewDb } from "../core/db";
import { sha256Hex } from "../core/sha256";
import type { DocumentKind, DocumentRow, VehicleRow } from "../core/rows";
import { STORAGE_PROVIDER_NAME } from "../core/storage";
import { madridDateTimeMs, addDaysToDate } from "../core/time";
import { normalizePlate } from "../domain/vehicles";
import { stableUuid } from "../core/ids";
import { anchorDate } from "./anchor";
import { castMember } from "./cast";
import { SEED_USER_IDS, SEED_VEHICLE_IDS, type SeedUserKey, type SeedVehicleKey } from "./ids";

type FleetState = "approved" | "pending-review" | "insurance-review";

interface FleetSpec {
  key: SeedVehicleKey;
  owner: SeedUserKey;
  make: string;
  model: string;
  plate: string;
  passengerSeats: number;
  color: string;
  state: FleetState;
  /** Días de vigencia del seguro respecto al ancla (solo `approved`). */
  insuranceDays?: number;
}

export const FLEET: readonly FleetSpec[] = [
  { key: "anaArona", owner: "ana", make: "SEAT", model: "Arona", plate: "1234 MBC", passengerSeats: 3, color: "Gris", state: "approved", insuranceDays: 241 },
  { key: "anaLeon", owner: "ana", make: "SEAT", model: "León", plate: "1234 LBC", passengerSeats: 4, color: "Blanco", state: "approved", insuranceDays: 198 },
  { key: "miguelAngelLeon", owner: "miguelAngel", make: "Seat", model: "León", plate: "5821 TRM", passengerSeats: 4, color: "Azul", state: "approved", insuranceDays: 322 },
  { key: "carlosClio", owner: "carlos", make: "Renault", model: "Clio", plate: "4410 KDT", passengerSeats: 3, color: "Rojo", state: "approved", insuranceDays: 150 },
  { key: "martaYaris", owner: "marta", make: "Toyota", model: "Yaris", plate: "7752 MNB", passengerSeats: 2, color: "Blanco", state: "approved", insuranceDays: 275 },
  { key: "danielFocus", owner: "daniel", make: "Ford", model: "Focus", plate: "2209 JBN", passengerSeats: 4, color: "Gris", state: "approved", insuranceDays: 260 },
  { key: "carmen208", owner: "carmen", make: "Peugeot", model: "208", plate: "6118 GHT", passengerSeats: 3, color: "Rojo", state: "approved", insuranceDays: 301 },
  { key: "rafaelSandero", owner: "rafael", make: "Dacia", model: "Sandero", plate: "3309 HZP", passengerSeats: 4, color: "Azul", state: "pending-review" },
  { key: "inesCorsa", owner: "ines", make: "Opel", model: "Corsa", plate: "9984 FWX", passengerSeats: 3, color: "Negro", state: "insurance-review" },
];

interface DocInput {
  id: string;
  owner: string;
  vehicleId: string | null;
  kind: DocumentKind;
  createdAt: number;
  review: DocumentRow["review_status"];
  reviewedAt?: number;
  analysis?: Partial<Pick<DocumentRow, "analysis_status" | "detected_expires_on" | "verified_expires_on" | "analysis_confidence" | "analyzer_provider" | "analyzer_reference" | "analyzed_at" | "expiry_verification_source">>;
}

function insertDocument(db: PreviewDb, input: DocInput): Readonly<DocumentRow> {
  const isPdf = input.kind === "vehicle_insurance" || input.kind === "vehicle_registration";
  const extension = isPdf ? "pdf" : "jpg";
  const key = `private/${input.owner}/${input.kind}/${input.id}.${extension}`;
  const contentType = isPdf ? "application/pdf" : "image/jpeg";
  const sizeBytes = isPdf ? 184_320 : 412_672;
  db.blobs.putMetadataOnly({ key, sizeBytes, contentType, uploadedAt: input.createdAt });
  return db.documents.insert({
    id: input.id,
    owner_user_id: input.owner,
    vehicle_id: input.vehicleId,
    kind: input.kind,
    storage_provider: STORAGE_PROVIDER_NAME,
    storage_key: key,
    content_type: contentType,
    size_bytes: sizeBytes,
    sha256: sha256Hex(`${key}:${input.id}`),
    review_status: input.review,
    review_reason: null,
    reviewed_by_user_id: input.review === "pending" ? null : SEED_USER_IDS.staff,
    reviewed_at: input.review === "pending" ? null : (input.reviewedAt ?? input.createdAt + 3_600_000),
    analysis_status: input.analysis?.analysis_status ?? (input.kind === "vehicle_insurance" ? "pending" : "not_required"),
    detected_expires_on: input.analysis?.detected_expires_on ?? null,
    verified_expires_on: input.analysis?.verified_expires_on ?? null,
    analysis_confidence: input.analysis?.analysis_confidence ?? null,
    analyzer_provider: input.analysis?.analyzer_provider ?? null,
    analyzer_reference: input.analysis?.analyzer_reference ?? null,
    analyzed_at: input.analysis?.analyzed_at ?? null,
    expiry_verification_source: input.analysis?.expiry_verification_source ?? null,
    created_at: input.createdAt,
    updated_at: input.reviewedAt ?? input.createdAt,
  });
}

function seedVehicle(db: PreviewDb, spec: FleetSpec): void {
  const owner = SEED_USER_IDS[spec.owner];
  const vehicleId = SEED_VEHICLE_IDS[spec.key];
  const joinedAt = madridDateTimeMs(castMember(spec.owner).joined, "11:00");
  const uploadedAt = joinedAt + 86_400_000;
  const reviewedAt = uploadedAt + 7_200_000;
  const plate = normalizePlate(spec.plate);
  const docId = (kind: string): string => stableUuid(`doc:${spec.key}:${kind}`);

  const base: VehicleRow = {
    id: vehicleId,
    driver_user_id: owner,
    make: spec.make,
    model: spec.model,
    plate: plate.display,
    plate_normalized: plate.normalized,
    passenger_seats: spec.passengerSeats,
    color: spec.color,
    review_status: "pending",
    documentation_status: "pending",
    vehicle_photo_status: "pending",
    vehicle_photo_document_id: null,
    insurance_status: "pending",
    insurance_expires_on: null,
    insurance_document_id: null,
    insurance_reviewed_at: null,
    review_reason: null,
    reviewed_by_user_id: null,
    reviewed_at: null,
    created_at: uploadedAt,
    updated_at: uploadedAt,
  };

  if (spec.state === "approved") {
    const expires = addDaysToDate(anchorDate(db), spec.insuranceDays ?? 240);
    const photo = insertDocument(db, { id: docId("photo"), owner, vehicleId, kind: "vehicle_photo", createdAt: uploadedAt, review: "approved", reviewedAt });
    const insurance = insertDocument(db, {
      id: docId("insurance"),
      owner,
      vehicleId,
      kind: "vehicle_insurance",
      createdAt: uploadedAt,
      review: "approved",
      reviewedAt,
      analysis: { analysis_status: "needs_review", verified_expires_on: expires, expiry_verification_source: "manual" },
    });
    insertDocument(db, { id: docId("registration"), owner, vehicleId, kind: "vehicle_registration", createdAt: uploadedAt, review: "approved", reviewedAt });
    db.vehicles.insert({
      ...base,
      review_status: "approved",
      documentation_status: "approved",
      vehicle_photo_status: "approved",
      vehicle_photo_document_id: photo.id,
      insurance_status: "approved",
      insurance_expires_on: expires,
      insurance_document_id: insurance.id,
      insurance_reviewed_at: reviewedAt,
      reviewed_by_user_id: SEED_USER_IDS.staff,
      reviewed_at: reviewedAt,
    });
    return;
  }

  if (spec.state === "pending-review") {
    // Alta reciente: documentos subidos, nada revisado todavía (cola de «Vehículos» de la administración).
    const at = madridDateTimeMs(anchorDate(db), "00:00") - 2 * 86_400_000 + 36_000_000;
    insertDocument(db, { id: docId("photo"), owner, vehicleId, kind: "vehicle_photo", createdAt: at, review: "pending" });
    insertDocument(db, { id: docId("insurance"), owner, vehicleId, kind: "vehicle_insurance", createdAt: at, review: "pending" });
    insertDocument(db, { id: docId("registration"), owner, vehicleId, kind: "vehicle_registration", createdAt: at, review: "pending" });
    db.vehicles.insert({ ...base, created_at: at, updated_at: at });
    return;
  }

  // insurance-review: todo aprobado salvo el seguro, cuyo análisis automático no fue concluyente.
  const at = madridDateTimeMs(anchorDate(db), "00:00") - 86_400_000 + 39_600_000;
  const photo = insertDocument(db, { id: docId("photo"), owner, vehicleId, kind: "vehicle_photo", createdAt: at, review: "approved", reviewedAt: at + 1_800_000 });
  insertDocument(db, { id: docId("registration"), owner, vehicleId, kind: "vehicle_registration", createdAt: at, review: "approved", reviewedAt: at + 1_800_000 });
  const insurance = insertDocument(db, {
    id: docId("insurance"),
    owner,
    vehicleId,
    kind: "vehicle_insurance",
    createdAt: at,
    review: "pending",
    analysis: {
      analysis_status: "needs_review",
      detected_expires_on: addDaysToDate(anchorDate(db), 365),
      analysis_confidence: 0.42,
      analyzer_provider: "preview-sim",
      analyzer_reference: "ocr-sim-0001",
      analyzed_at: at + 60_000,
    },
  });
  db.vehicles.insert({
    ...base,
    created_at: at,
    updated_at: at,
    documentation_status: "approved",
    vehicle_photo_status: "approved",
    vehicle_photo_document_id: photo.id,
    insurance_document_id: insurance.id,
  });
}

/** Documentos personales de la persona conductora (identidad y carné) y pendientes de revisión de otras personas. */
function seedPersonalDocuments(db: PreviewDb, skip: ReadonlySet<SeedUserKey>): void {
  if (!skip.has("ana")) {
    const anaJoined = madridDateTimeMs(castMember("ana").joined, "10:30");
    insertDocument(db, {
      id: stableUuid("doc:ana:identity"),
      owner: SEED_USER_IDS.ana,
      vehicleId: null,
      kind: "identity_document",
      createdAt: anaJoined,
      review: "approved",
      reviewedAt: anaJoined + 3_600_000,
    });
    insertDocument(db, {
      id: stableUuid("doc:ana:license"),
      owner: SEED_USER_IDS.ana,
      vehicleId: null,
      kind: "driver_license",
      createdAt: anaJoined + 60_000,
      review: "approved",
      reviewedAt: anaJoined + 3_600_000,
    });
  }
  // Cola de identidad: Sofía subió su documento ayer.
  insertDocument(db, {
    id: stableUuid("doc:sofia:identity"),
    owner: SEED_USER_IDS.sofia,
    vehicleId: null,
    kind: "identity_document",
    createdAt: madridDateTimeMs(anchorDate(db), "00:00") - 86_400_000 + 55_800_000,
    review: "pending",
  });
}

export interface SeedFleetOptions {
  /** Personas cuyos vehículos y documentos no se siembran. */
  skipOwners?: readonly SeedUserKey[];
}

export function seedFleet(db: PreviewDb, options: SeedFleetOptions = {}): void {
  const skip = new Set(options.skipOwners ?? []);
  for (const spec of FLEET) {
    if (!skip.has(spec.owner)) seedVehicle(db, spec);
  }
  seedPersonalDocuments(db, skip);
}

/** Vehículos de una persona (sin documentos), para los escenarios que parten de «sin vehículo». */
export function fleetOf(owner: SeedUserKey): readonly FleetSpec[] {
  return FLEET.filter((spec) => spec.owner === owner);
}
