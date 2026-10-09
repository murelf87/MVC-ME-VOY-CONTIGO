/**
 * Documentos legales: qué falta por aceptar y cómo se reparte el texto de un documento en tarjetas. Puro.
 * El texto legal real está «pendiente de revisión jurídica»: la UI lo muestra siempre que `pendingLegalReview` sea cierto.
 */
import type { LegalDocument, LegalDocumentKind, LegalSection, LegalStatus, LegalStatusItem } from "@/api/types/trust";

/** Documentos que se aceptan al abrir la cuenta (alcance `account`) y siguen sin aceptar en su versión vigente. */
export function missingAccountItems(status: LegalStatus): LegalStatusItem[] {
  return status.items.filter((item) => item.scope === "account" && !item.accepted);
}

export function pendingReviewIn(items: readonly Pick<LegalStatusItem, "pendingLegalReview">[]): boolean {
  return items.some((item) => item.pendingLegalReview);
}

export interface AcceptancePlan {
  kind: LegalDocumentKind;
  version: number;
}

export function acceptancePlan(items: readonly LegalStatusItem[]): AcceptancePlan[] {
  return items.map((item) => ({ kind: item.kind, version: item.latestVersion }));
}

/** «Foto visible en tu perfil: la ven otros usuarios…» → título «Foto visible en tu perfil» + texto «La ven otros usuarios…». */
export function splitBullet(bullet: string): { title: string | null; text: string } {
  const index = bullet.indexOf(": ");
  if (index <= 0 || index > 60) return { title: null, text: bullet };
  const title = bullet.slice(0, index).trim();
  const rest = bullet.slice(index + 2).trim();
  if (rest === "") return { title: null, text: bullet };
  return { title, text: rest.charAt(0).toUpperCase() + rest.slice(1) };
}

export type NoticeBlock =
  | { type: "cards"; heading: string; cards: { title: string | null; text: string }[] }
  | { type: "list"; heading: string; items: string[] }
  | { type: "note"; heading: string; text: string; highlight: boolean }
  | { type: "action"; heading: string; text: string };

function isRetention(section: LegalSection): boolean {
  return section.heading.toLowerCase().startsWith("conservación");
}

function isAlternative(section: LegalSection): boolean {
  return section.heading.toLowerCase().startsWith("otra forma de verificar");
}

/**
 * Reparte las secciones del aviso de la comprobación privada (lámina 07) en bloques de pantalla:
 *  · sección con viñetas «Título: texto» (la primera) → tarjetas con foto (verde y azul);
 *  · sección con viñetas sin título → lista «Qué se usa y para qué»;
 *  · «Conservación y proveedor: por definir» → nota destacada (nunca se oculta);
 *  · «Otra forma de verificar» → fila de acción hacia el documento de identidad.
 * Si el servidor cambia la estructura, lo que no encaja se pinta como nota o lista genérica: no se pierde texto.
 */
export function buildNoticeBlocks(document: Pick<LegalDocument, "sections">): NoticeBlock[] {
  const blocks: NoticeBlock[] = [];
  let cardsUsed = false;
  for (const section of document.sections) {
    if (isAlternative(section)) {
      blocks.push({ type: "action", heading: section.heading, text: section.paragraphs.join(" ") });
      continue;
    }
    if (isRetention(section)) {
      blocks.push({ type: "note", heading: section.heading, text: [...section.paragraphs, ...section.bullets].join(" "), highlight: true });
      continue;
    }
    const split = section.bullets.map(splitBullet);
    const titled = split.length > 0 && split.every((entry) => entry.title !== null);
    if (titled && !cardsUsed) {
      cardsUsed = true;
      blocks.push({ type: "cards", heading: section.heading, cards: split });
      continue;
    }
    if (section.bullets.length > 0) {
      blocks.push({ type: "list", heading: section.heading, items: section.bullets });
      continue;
    }
    blocks.push({ type: "note", heading: section.heading, text: section.paragraphs.join(" "), highlight: false });
  }
  return blocks;
}
