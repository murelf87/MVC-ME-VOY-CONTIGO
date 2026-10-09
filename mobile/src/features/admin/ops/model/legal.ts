/**
 * Documentos legales (docs/contracts/trust.md §4.3): edición de secciones, validación en español (espejo de
 * `src/modules/trust/legal.ts`) y requisitos para publicar. Un texto NUNCA se publica sin la referencia de la revisión
 * legal que lo aprueba. Funciones puras: se prueban en Node.
 */
import { formatDecimal, madridOffsetMinutes } from "@/i18n";
import type { AdminLegalDocumentCreate, AdminLegalPublishRequest, LegalDocumentKind, LegalDocumentStatus, LegalSection } from "@/api/types";
import { dayStartIso, parseSpanishDate } from "./audit";

export const LEGAL_KINDS: readonly LegalDocumentKind[] = ["terms", "privacy", "cancellation", "private_check_notice"];

export const TITLE_MIN = 3;
export const TITLE_MAX = 200;
export const MAX_SECTIONS = 60;
export const HEADING_MAX = 200;
export const MAX_BLOCKS = 50;
export const PARAGRAPH_MAX = 5000;
export const BULLET_MAX = 1000;
export const REFERENCE_MIN = 3;
export const REFERENCE_MAX = 300;

/** Una sección tal y como se edita: párrafos separados por una línea en blanco, una viñeta por línea. */
export interface SectionDraft {
  heading: string;
  paragraphs: string;
  bullets: string;
}

export function emptySection(): SectionDraft {
  return { heading: "", paragraphs: "", bullets: "" };
}

export function sectionsToDrafts(sections: readonly LegalSection[]): SectionDraft[] {
  return sections.map((section) => ({
    heading: section.heading,
    paragraphs: section.paragraphs.join("\n\n"),
    bullets: section.bullets.join("\n"),
  }));
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== "");
}

export function splitBullets(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*[-•*]\s+/, "").trim())
    .filter((line) => line !== "");
}

export interface SectionErrors {
  heading?: string;
  paragraphs?: string;
  bullets?: string;
  general?: string;
}

export interface LegalDraftErrors {
  title?: string;
  sections?: string;
  perSection: SectionErrors[];
}

export type LegalDraftValidation = { ok: true; input: AdminLegalDocumentCreate } | { ok: false; errors: LegalDraftErrors };

export function validateLegalDraft(kind: LegalDocumentKind, title: string, drafts: readonly SectionDraft[]): LegalDraftValidation {
  const errors: LegalDraftErrors = { perSection: drafts.map(() => ({})) };
  let failed = false;

  const cleanTitle = title.trim();
  if (cleanTitle.length < TITLE_MIN || cleanTitle.length > TITLE_MAX) {
    errors.title = `El título debe tener entre ${TITLE_MIN} y ${TITLE_MAX} caracteres.`;
    failed = true;
  }
  if (drafts.length < 1 || drafts.length > MAX_SECTIONS) {
    errors.sections = `El documento debe tener entre 1 y ${MAX_SECTIONS} secciones.`;
    failed = true;
  }

  const sections: LegalSection[] = [];
  drafts.forEach((draft, index) => {
    const slot: SectionErrors = errors.perSection[index] ?? {};
    errors.perSection[index] = slot;
    const heading = draft.heading.trim();
    const paragraphs = splitParagraphs(draft.paragraphs);
    const bullets = splitBullets(draft.bullets);
    if (heading.length < 1 || heading.length > HEADING_MAX) {
      slot.heading = `El encabezado debe tener entre 1 y ${HEADING_MAX} caracteres.`;
      failed = true;
    }
    if (paragraphs.length > MAX_BLOCKS || paragraphs.some((p) => p.length > PARAGRAPH_MAX)) {
      slot.paragraphs = `Como máximo ${MAX_BLOCKS} párrafos de hasta ${formatDecimal(PARAGRAPH_MAX, 0)} caracteres.`;
      failed = true;
    }
    if (bullets.length > MAX_BLOCKS || bullets.some((b) => b.length > BULLET_MAX)) {
      slot.bullets = `Como máximo ${MAX_BLOCKS} viñetas de hasta ${formatDecimal(BULLET_MAX, 0)} caracteres.`;
      failed = true;
    }
    if (paragraphs.length === 0 && bullets.length === 0) {
      slot.general = "Cada sección necesita al menos un párrafo o una viñeta.";
      failed = true;
    }
    sections.push({ heading, paragraphs, bullets });
  });

  if (failed) return { ok: false, errors };
  return { ok: true, input: { kind, title: cleanTitle, sections } };
}

export interface PublishErrors {
  reference?: string;
  effectiveFrom?: string;
}

export type PublishValidation = { ok: true; request: AdminLegalPublishRequest } | { ok: false; errors: PublishErrors };

/**
 * Publicar exige la referencia de la revisión legal (≥ 3 caracteres). La fecha de entrada en vigor es opcional
 * (`dd/mm/aaaa`; sin ella rige desde ahora) y no puede ser anterior a hoy.
 */
export function validatePublish(reference: string, effectiveFrom: string, nowMs: number): PublishValidation {
  const errors: PublishErrors = {};
  const cleanReference = reference.trim();
  if (cleanReference.length < REFERENCE_MIN) errors.reference = "Indica la referencia de la revisión legal que aprueba este texto (mínimo 3 caracteres).";
  else if (cleanReference.length > REFERENCE_MAX) errors.reference = `La referencia admite como máximo ${REFERENCE_MAX} caracteres.`;

  let effective: string | undefined;
  const dateText = effectiveFrom.trim();
  if (dateText !== "") {
    const date = parseSpanishDate(dateText);
    if (date === null) {
      errors.effectiveFrom = "Escribe una fecha válida, por ejemplo 05/11/2026.";
    } else {
      const iso = dayStartIso(date);
      const todayStart = dayStartIso(todayCivil(nowMs));
      if (iso < todayStart) errors.effectiveFrom = "La fecha de entrada en vigor no puede ser anterior a hoy.";
      else effective = iso;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const request: AdminLegalPublishRequest = { legalReviewReference: cleanReference };
  if (effective !== undefined) request.effectiveFrom = effective;
  return { ok: true, request };
}

function todayCivil(nowMs: number): { year: number; month: number; day: number } {
  const offset = madridOffsetMinutes(nowMs);
  const local = new Date(nowMs + offset * 60_000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

export function canPublish(status: LegalDocumentStatus): boolean {
  return status === "draft_pending_legal_review";
}

/** Versiones agrupadas por tipo (en el orden de `LEGAL_KINDS`) y, dentro de cada tipo, de la más reciente a la más antigua. */
export function groupByKind<T extends { kind: LegalDocumentKind; version: number }>(items: readonly T[]): { kind: LegalDocumentKind; items: T[] }[] {
  return LEGAL_KINDS.map((kind) => ({
    kind,
    items: items.filter((item) => item.kind === kind).sort((a, b) => b.version - a.version),
  })).filter((group) => group.items.length > 0);
}
