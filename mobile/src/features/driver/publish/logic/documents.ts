/**
 * Documentación del vehículo (pantalla «Documentación del vehículo»): qué se ha subido, en qué estado está cada cosa y qué
 * puede hacer el conductor. Lógica pura: sin React ni red. El estado definitivo lo decide siempre el equipo de revisión;
 * aquí solo se presenta lo que devuelven `GET /v1/me/vehicles`, `GET /v1/me/documents` y `GET /v1/me/driver/readiness`.
 */
import type { ReadinessItem } from "@/api/types/trips";
import { formatDateShort } from "@/i18n";
import { publishStrings } from "../strings";
import type { DocumentRecord, VehicleRecord } from "../types";
import { daysBetween } from "./readiness";
import { vehicleReview } from "./vehicle";

const copy = publishStrings.documents;

export type DocStatus = "none" | "pending" | "approved" | "rejected" | "expired";
export type DocSectionKey = "photo" | "insurance" | "license" | "data";
export type DocTone = "success" | "warning" | "danger" | "neutral";

/** Qué se sube: los dos del núcleo de vehículos y el permiso de conducir (módulo de confianza). */
export type UploadKind = "vehicle_photo" | "vehicle_insurance" | "driver_license";

export interface DocSection {
  key: DocSectionKey;
  title: string;
  help: string;
  status: DocStatus;
  statusLabel: string;
  tone: DocTone;
  /** Líneas de detalle: «Vigente hasta 12 mar 2027», «Subido el 5 oct 2026», «Motivo: …». */
  lines: readonly string[];
  /** Acción principal; `null` si en este estado no hay nada que subir. */
  action: { label: string; kind: "upload" | "edit" } | null;
  uploadKind: UploadKind | null;
  /** Último archivo subido que se puede abrir; `null` si no hay (o es el permiso, que no sale de este listado). */
  documentId: string | null;
  accessibilityLabel: string;
}

// ── Subidas ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Formatos aceptados por el servidor para cada tipo de subida. */
export const ALLOWED_TYPES: Readonly<Record<UploadKind, readonly string[]>> = {
  vehicle_photo: [...IMAGE_TYPES, "image/heic", "image/heif"],
  vehicle_insurance: [...IMAGE_TYPES, "application/pdf"],
  driver_license: [...IMAGE_TYPES, "application/pdf"],
};

export type UploadCheck = { ok: true } | { ok: false; reason: "type" | "size" | "unreadable" };

/** Comprueba en el dispositivo lo mismo que comprobará el servidor (formato y tamaño) para avisar antes de subir. */
export function checkUpload(kind: UploadKind, file: { contentType: string; sizeBytes: number | null }): UploadCheck {
  if (file.sizeBytes === null || !Number.isFinite(file.sizeBytes) || file.sizeBytes < 1) return { ok: false, reason: "unreadable" };
  if (file.sizeBytes > MAX_UPLOAD_BYTES) return { ok: false, reason: "size" };
  const type = file.contentType.trim().toLowerCase();
  if (!ALLOWED_TYPES[kind].includes(type)) return { ok: false, reason: "type" };
  return { ok: true };
}

export function uploadErrorText(reason: "type" | "size" | "unreadable", kind: UploadKind): string {
  if (reason === "size") return kind === "vehicle_photo" ? publishStrings.vehicle.photoTooLarge : copy.tooLarge;
  if (reason === "type") return copy.typeNotAllowed;
  return kind === "vehicle_photo" ? publishStrings.vehicle.photoUnreadable : copy.unreadable;
}

// ── Estado de cada elemento ─────────────────────────────────────────────────────────────────────────────────────────────

export function toneOf(status: DocStatus): DocTone {
  switch (status) {
    case "approved":
      return "success";
    case "pending":
      return "neutral";
    case "none":
      return "warning";
    case "rejected":
    case "expired":
      return "danger";
  }
}

function newest(documents: readonly DocumentRecord[], vehicleId: string, kind: string): DocumentRecord | undefined {
  return documents
    .filter((doc) => doc.kind === kind && doc.vehicle_id === vehicleId)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
}

export function photoStatus(vehicle: VehicleRecord, latest: DocumentRecord | undefined): DocStatus {
  if (vehicle.vehicle_photo_status === "approved") return "approved";
  if (vehicle.vehicle_photo_status === "rejected" || latest?.review_status === "rejected") return "rejected";
  if (latest !== undefined || (vehicle.vehicle_photo_document_id ?? null) !== null) return "pending";
  return "none";
}

export function insuranceStatus(vehicle: VehicleRecord, latest: DocumentRecord | undefined, todayIso: string): DocStatus {
  const expiresOn = vehicle.insurance_expires_on ?? null;
  if (vehicle.insurance_status === "approved") {
    if (expiresOn !== null && expiresOn < todayIso) return "expired";
    return "approved";
  }
  if (vehicle.insurance_status === "rejected" || latest?.review_status === "rejected") return "rejected";
  if (latest !== undefined || (vehicle.insurance_document_id ?? null) !== null) return "pending";
  return "none";
}

export function licenseStatus(item: ReadinessItem | undefined): DocStatus {
  switch (item?.state) {
    case "approved":
      return "approved";
    case "in_review":
      return "pending";
    case "rejected":
      return "rejected";
    case "expired":
      return "expired";
    case "missing":
    case undefined:
      return "none";
  }
}

function statusLabel(status: DocStatus): string {
  return copy.status[status];
}

function uploadedLine(doc: DocumentRecord | undefined): string | null {
  if (doc?.created_at === undefined) return null;
  const date = formatDateShort(doc.created_at);
  return date === "" ? null : copy.uploadedOn(date);
}

function reasonLine(reason: string | null | undefined): string | null {
  const text = (reason ?? "").trim();
  return text === "" ? null : copy.reviewReason(text);
}

function section(input: Omit<DocSection, "tone" | "statusLabel" | "accessibilityLabel">): DocSection {
  const tone = toneOf(input.status);
  const label = statusLabel(input.status);
  return {
    ...input,
    tone,
    statusLabel: label,
    accessibilityLabel: [input.title, label, ...input.lines].join(". "),
  };
}

export interface DocumentsInput {
  vehicle: VehicleRecord;
  documents: readonly DocumentRecord[];
  readiness: readonly ReadinessItem[] | undefined;
  /** Hoy en formato ISO `YYYY-MM-DD` (reloj de la app). */
  todayIso: string;
}

/** Las cuatro secciones de la pantalla, en orden. */
export function buildSections(input: DocumentsInput): DocSection[] {
  const { vehicle, documents, readiness, todayIso } = input;
  const photoDoc = newest(documents, vehicle.id, "vehicle_photo");
  const insuranceDoc = newest(documents, vehicle.id, "vehicle_insurance");
  const licenseItem = readiness?.find((item) => item.key === "driver_license");

  // Foto
  const photo = photoStatus(vehicle, photoDoc);
  const photoLines = [
    ...(photo !== "none" ? [uploadedLine(photoDoc)] : []),
    ...(photo === "rejected" ? [reasonLine(photoDoc?.review_reason ?? vehicle.review_reason)] : []),
  ].filter((line): line is string => line !== null);

  // Seguro
  const insurance = insuranceStatus(vehicle, insuranceDoc, todayIso);
  const expiresOn = vehicle.insurance_expires_on ?? null;
  const insuranceLines: string[] = [];
  if (insurance === "approved" && expiresOn !== null) {
    insuranceLines.push(copy.expiresOn(formatDateShort(expiresOn)));
    if (daysBetween(todayIso, expiresOn) <= 30) insuranceLines.push(copy.expiresSoon);
  } else if (insurance === "expired" && expiresOn !== null) {
    insuranceLines.push(copy.expiredOn(formatDateShort(expiresOn)));
  } else if (insurance === "pending") {
    insuranceLines.push(copy.expiresPending);
  }
  const insuranceUploaded = uploadedLine(insuranceDoc);
  if (insurance !== "none" && insuranceUploaded !== null) insuranceLines.push(insuranceUploaded);
  if (insurance === "rejected") {
    const reason = reasonLine(insuranceDoc?.review_reason);
    if (reason !== null) insuranceLines.push(reason);
  }

  // Permiso de conducir
  const license = licenseStatus(licenseItem);
  const licenseLines = [licenseItem?.detail ?? null, license === "rejected" ? copy.licenseRejectedHint : null].filter(
    (line): line is string => line !== null && line.trim() !== "",
  );

  // Datos
  const review = vehicleReview(vehicle);
  const dataStatus: DocStatus = review === "approved" ? "approved" : review === "rejected" ? "rejected" : "pending";
  const dataLines = dataStatus === "rejected" ? [reasonLine(vehicle.review_reason)].filter((line): line is string => line !== null) : [];

  return [
    section({
      key: "photo",
      title: copy.sections.photo,
      help: copy.photoHelp,
      status: photo,
      lines: photoLines,
      action: { label: photo === "none" ? copy.uploadPhoto : copy.replacePhoto, kind: "upload" },
      uploadKind: "vehicle_photo",
      documentId: photoDoc?.id ?? vehicle.vehicle_photo_document_id ?? null,
    }),
    section({
      key: "insurance",
      title: copy.sections.insurance,
      help: copy.insuranceHelp,
      status: insurance,
      lines: insuranceLines,
      action: {
        label: insurance === "none" ? copy.uploadInsurance : insurance === "expired" ? copy.renewInsurance : copy.replaceInsurance,
        kind: "upload",
      },
      uploadKind: "vehicle_insurance",
      documentId: insuranceDoc?.id ?? vehicle.insurance_document_id ?? null,
    }),
    section({
      key: "license",
      title: copy.sections.license,
      help: copy.licenseHelp,
      status: license,
      lines: licenseLines,
      // Con un permiso ya en revisión el servidor responde `DOCUMENT_IN_REVIEW`: no se ofrece subir otro.
      action: license === "pending" ? null : { label: license === "none" ? copy.uploadLicense : copy.replaceLicense, kind: "upload" },
      uploadKind: "driver_license",
      documentId: null,
    }),
    section({
      key: "data",
      title: copy.sections.data,
      help: copy.dataHelp,
      status: dataStatus,
      lines: dataLines,
      action: { label: copy.editData, kind: "edit" },
      uploadKind: null,
      documentId: null,
    }),
  ];
}
