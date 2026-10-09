/**
 * Imágenes ILUSTRATIVAS de las pruebas privadas de la vista previa (SIMULACIÓN): no son documentos de nadie. Cada una lleva
 * escrito «Ejemplo ilustrativo» para que no se confunda con una prueba real. Se sirven desde el almacén privado simulado
 * (`storage.mvc-preview.invalid`) con la URL firmada de 120 s, igual que las reales.
 */
import type { PreviewDb } from "@/preview";
import type { AdminEvidenceKind } from "@/api/types";
import type { EvidenceRow } from "./store";

export const EVIDENCE_CONTENT_TYPE = "image/svg+xml";

const NAVY = "#0407FA";
const SOFT = "#EAF4FE";
const INK = "#1B3A6B";
const MUTED = "#5B6B85";

function frame(inner: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">` +
    `<rect width="640" height="420" fill="#F4F8FE"/>${inner}` +
    `<text x="320" y="402" text-anchor="middle" font-family="sans-serif" font-size="14" fill="${MUTED}">Ejemplo ilustrativo de la vista previa · no es un documento real</text>` +
    `</svg>`
  );
}

function person(cx: number, cy: number, scale: number): string {
  return (
    `<g transform="translate(${cx} ${cy}) scale(${scale})">` +
    `<circle cx="0" cy="-34" r="30" fill="#A5C1F6"/>` +
    `<path d="M-58 62 C-58 18 -30 4 0 4 C30 4 58 18 58 62 Z" fill="#A5C1F6"/>` +
    `</g>`
  );
}

function card(title: string, code: string): string {
  return (
    `<rect x="70" y="50" width="500" height="300" rx="24" fill="#FFFFFF" stroke="${NAVY}" stroke-width="3"/>` +
    `<rect x="70" y="50" width="500" height="64" rx="24" fill="${NAVY}"/>` +
    `<rect x="70" y="90" width="500" height="24" fill="${NAVY}"/>` +
    `<text x="100" y="92" font-family="sans-serif" font-size="26" font-weight="700" fill="#FFFFFF">${title}</text>` +
    `<rect x="100" y="140" width="130" height="160" rx="12" fill="${SOFT}"/>${person(165, 215, 0.9)}` +
    `<rect x="260" y="146" width="230" height="14" rx="7" fill="#C9D8F2"/>` +
    `<rect x="260" y="176" width="180" height="14" rx="7" fill="#C9D8F2"/>` +
    `<rect x="260" y="206" width="210" height="14" rx="7" fill="#C9D8F2"/>` +
    `<rect x="260" y="236" width="150" height="14" rx="7" fill="#C9D8F2"/>` +
    `<text x="260" y="300" font-family="monospace" font-size="20" fill="${INK}">${code}</text>`
  );
}

/** SVG de ejemplo para un tipo de prueba. */
export function evidenceSvg(kind: AdminEvidenceKind, label: string): string {
  if (kind === "profile_photo") {
    return frame(`<circle cx="320" cy="200" r="150" fill="${SOFT}" stroke="${NAVY}" stroke-width="3"/>${person(320, 230, 1.9)}`);
  }
  if (kind === "identity_selfie") {
    return frame(
      `<rect x="190" y="30" width="260" height="340" rx="40" fill="${SOFT}" stroke="${NAVY}" stroke-width="3"/>${person(320, 220, 2.1)}` +
        `<text x="320" y="360" text-anchor="middle" font-family="sans-serif" font-size="18" fill="${INK}">${label}</text>`,
    );
  }
  const isLicense = /permiso/i.test(label);
  return frame(card(isLicense ? "PERMISO DE CONDUCIR" : "DOCUMENTO DE IDENTIDAD", isLicense ? "B · 0000000 · EJEMPLO" : "00000000X · EJEMPLO"));
}

/** Clave del objeto en el almacén privado simulado. */
export function evidenceStorageKey(userId: string, kind: AdminEvidenceKind, evidenceId: string): string {
  return `users/${userId}/${kind}/${evidenceId}.svg`;
}

/**
 * Guarda los bytes de la imagen de ejemplo en el almacén simulado. Tras recargar la página solo queda la metadata y el
 * almacén sirve su marcador genérico (igual que con cualquier objeto sembrado).
 */
export function putEvidenceBlob(db: PreviewDb, evidence: EvidenceRow): void {
  const bytes = new TextEncoder().encode(evidenceSvg(evidence.kind, evidence.label));
  db.blobs.put(evidence.storage_key, bytes, EVIDENCE_CONTENT_TYPE, evidence.submitted_at);
}
