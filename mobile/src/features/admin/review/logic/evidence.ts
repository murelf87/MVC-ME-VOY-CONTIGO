/**
 * Documentación privada del expediente: finalidad de cada acceso, vida de la URL firmada (120 s) y presentación.
 * La imagen jamás se cachea ni se guarda: la URL se pide cada vez, queda auditada en el servidor y caduca sola.
 * Funciones puras: se prueban en Node.
 */
import type { AdminEvidencePurpose, AdminEvidenceRef, AdminReviewItemKey } from "@/api/types";
import { formatDecimal } from "@/i18n";
import { reviewStrings } from "../strings";

/** Vida de la URL firmada que declara el contrato (`ttlSeconds`). */
export const EVIDENCE_TTL_SECONDS = 120;

/** Finalidad registrada en la auditoría, según el elemento que se está revisando. */
export function evidencePurpose(item: AdminReviewItemKey): AdminEvidencePurpose {
  switch (item) {
    case "identity":
    case "private_check":
      return "identity_review";
    case "driver_license":
      return "license_review";
    case "profile_photo":
      return "photo_moderation";
  }
}

/** Vida de la vista en segundos: la que declara el servidor (`ttlSeconds`) o, si viene mal, los 120 s del contrato. Nunca más de 120. */
export function ttlOf(ttlSeconds: number): number {
  return Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.min(Math.round(ttlSeconds), EVIDENCE_TTL_SECONDS) : EVIDENCE_TTL_SECONDS;
}

/**
 * Segundos que le quedan a la vista (nunca negativos). Se mide desde que llega la respuesta con un reloj monótono, no con
 * `expiresAt`: un reloj del dispositivo adelantado o atrasado no alarga ni acorta la vida de la imagen en pantalla.
 */
export function remainingSeconds(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export function isImageContentType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith("image/");
}

/** `184 KB` · `1,2 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${formatDecimal(kb, kb < 10 ? 1 : 0)} KB`;
  return `${formatDecimal(kb / 1024, 1)} MB`;
}

/** Título legible de una evidencia: el que da el servidor o, si falta, el del tipo. */
export function evidenceTitle(ref: Pick<AdminEvidenceRef, "kind" | "label">): string {
  return ref.label !== "" ? ref.label : reviewStrings.dossier.evidenceKinds[ref.kind];
}
