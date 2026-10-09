/**
 * Documentos legales sembrados en la vista previa (`GET /v1/legal/documents`). SIMULACIÓN.
 * Texto estructural SIN validez legal: `status: "draft_pending_legal_review"` hasta que Legal lo revise (Bloqueado).
 * El aviso de la comprobación privada reproduce el texto de la lámina 07.
 */
import type { LegalDocumentKind, LegalSection } from "@/api/types/trust";

export interface LegalSeed {
  kind: LegalDocumentKind;
  title: string;
  scope: "account" | "booking" | "private_check";
  sections: LegalSection[];
}

const PENDING = "Contenido pendiente de revisión legal.";

export const LEGAL_SEEDS: readonly LegalSeed[] = [
  {
    kind: "terms",
    title: "Términos y condiciones de uso",
    scope: "account",
    sections: [
      { heading: "Quiénes somos y qué es MVC", paragraphs: ["MVC · Me voy contigo conecta a personas que hacen el mismo trayecto dentro de una provincia para compartir coche.", PENDING], bullets: [] },
      { heading: "Tu cuenta", paragraphs: [PENDING], bullets: ["Una persona, una cuenta.", "Los datos que facilites deben ser reales."] },
      { heading: "Compartir coche", paragraphs: [PENDING], bullets: ["MVC pone en contacto a conductores y pasajeros; no presta el servicio de transporte.", "Las condiciones económicas están por definir."] },
      { heading: "Conducta y seguridad", paragraphs: [PENDING], bullets: [] },
    ],
  },
  {
    kind: "privacy",
    title: "Política de Privacidad",
    scope: "account",
    sections: [
      { heading: "Quién trata tus datos", paragraphs: [PENDING], bullets: [] },
      { heading: "Qué datos usamos y para qué", paragraphs: [PENDING], bullets: ["Datos de cuenta: nombre, móvil y provincia.", "Ubicación aproximada para encontrar trayectos cercanos.", "Foto de perfil visible para otras personas en los trayectos."] },
      { heading: "Tus derechos", paragraphs: ["Puedes acceder, rectificar, exportar y borrar tus datos desde «Privacidad y datos».", PENDING], bullets: [] },
      { heading: "Conservación y proveedores: por definir", paragraphs: ["Los plazos de conservación y los proveedores se definirán en próximas fases."], bullets: [] },
    ],
  },
  {
    kind: "cancellation",
    title: "Política de cancelación",
    scope: "booking",
    sections: [
      { heading: "Cancelar una reserva", paragraphs: [PENDING], bullets: ["La política de cancelación y devoluciones está por definir."] },
      { heading: "Cancelaciones del conductor", paragraphs: [PENDING], bullets: [] },
    ],
  },
  {
    kind: "private_check_notice",
    title: "Privacidad de la comprobación",
    scope: "private_check",
    sections: [
      {
        heading: "Tus fotos, usos y privacidad",
        paragraphs: [],
        bullets: [
          "Foto visible en tu perfil: la ven otros usuarios para generar confianza en los trayectos.",
          "Comprobación privada: solo la ve el equipo de MVC para revisar tu cuenta.",
        ],
      },
      {
        heading: "Qué se usa y para qué",
        paragraphs: [],
        bullets: ["Comprobamos que la foto y la cuenta pertenecen a una persona real.", "No se muestra esta foto a otros usuarios.", "No se utiliza para ningún otro fin."],
      },
      {
        heading: "Conservación y proveedor: por definir",
        paragraphs: ["El tiempo de conservación y el proveedor del servicio se definirán en próximas fases."],
        bullets: [],
      },
      { heading: "Otra forma de verificar", paragraphs: ["Puedes aportar un documento de identidad."], bullets: [] },
    ],
  },
];
