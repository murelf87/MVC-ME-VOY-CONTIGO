/**
 * Catálogo de motivos (códigos estables + textos es-ES para la persona usuaria).
 * Regla de producto: el texto de un rechazo de la comprobación privada es NEUTRO; la sospecha interna del revisor
 * (p. ej. «no coincide con la foto de perfil») no se muestra al usuario.
 */
export const PHOTO_REASON_CODES = [
  "FACE_NOT_VISIBLE",
  "SUNGLASSES_OR_COVERING",
  "MULTIPLE_PEOPLE",
  "LOW_QUALITY",
  "NOT_A_PERSON",
  "INAPPROPRIATE_CONTENT",
  "OTHER"
] as const;
export const CHECK_RETRY_REASON_CODES = ["FACE_OUT_OF_FRAME", "LOW_LIGHT", "IMAGE_BLURRY", "FACE_COVERED", "MULTIPLE_PEOPLE"] as const;
export const CHECK_REJECT_REASON_CODES = ["NOT_MATCHING_PROFILE_PHOTO", "NOT_A_LIVE_PERSON", "MAX_ATTEMPTS_REACHED", "OTHER"] as const;
export const DOCUMENT_REASON_CODE = "DOCUMENT_REVIEW_REJECTED" as const;

export type ReasonView = { code: string; title: string | null; message: string };

const PHOTO: Record<(typeof PHOTO_REASON_CODES)[number], { label: string; title: string; message: string }> = {
  FACE_NOT_VISIBLE: { label: "Rostro no visible", title: "Necesitamos otra foto", message: "No se te ve el rostro con claridad en la foto." },
  SUNGLASSES_OR_COVERING: { label: "Gafas de sol o rostro tapado", title: "Necesitamos otra foto", message: "Sube una foto sin gafas de sol ni nada que te tape la cara." },
  MULTIPLE_PEOPLE: { label: "Varias personas", title: "Necesitamos otra foto", message: "En la foto debes aparecer solo tú." },
  LOW_QUALITY: { label: "Poca calidad", title: "Necesitamos otra foto", message: "La foto tiene poca calidad o sale borrosa." },
  NOT_A_PERSON: { label: "No es una persona", title: "Necesitamos otra foto", message: "La foto de perfil debe ser una foto tuya." },
  INAPPROPRIATE_CONTENT: { label: "Contenido inapropiado", title: "No hemos podido aprobar tu foto", message: "La foto no cumple las normas de la comunidad." },
  OTHER: { label: "Otro motivo", title: "No hemos podido aprobar tu foto", message: "No hemos podido aprobar tu foto de perfil. Sube otra foto en la que se te vea bien." }
};

const CHECK_RETRY: Record<(typeof CHECK_RETRY_REASON_CODES)[number], { label: string; message: string }> = {
  FACE_OUT_OF_FRAME: { label: "Rostro fuera del marco", message: "El rostro está fuera del marco o no se ve con claridad." },
  LOW_LIGHT: { label: "Poca luz", message: "Hay poca luz. Busca un lugar más iluminado." },
  IMAGE_BLURRY: { label: "Imagen borrosa", message: "La imagen sale borrosa. Mantén el móvil quieto al hacer la captura." },
  FACE_COVERED: { label: "Rostro tapado", message: "Algo te tapa el rostro. Quítate gafas, gorra o mascarilla." },
  MULTIPLE_PEOPLE: { label: "Varias personas", message: "En la captura debes aparecer solo tú." }
};

const CHECK_REJECT: Record<(typeof CHECK_REJECT_REASON_CODES)[number], { label: string; title: string; message: string }> = {
  NOT_MATCHING_PROFILE_PHOTO: {
    label: "No coincide con la foto de perfil",
    title: "No hemos podido completar la comprobación",
    message: "No hemos podido completar la comprobación con una foto. Puedes verificar tu identidad aportando un documento."
  },
  NOT_A_LIVE_PERSON: {
    label: "No parece una persona real",
    title: "No hemos podido completar la comprobación",
    message: "No hemos podido completar la comprobación con una foto. Puedes verificar tu identidad aportando un documento."
  },
  MAX_ATTEMPTS_REACHED: {
    label: "Intentos agotados",
    title: "Has agotado los intentos",
    message: "Has usado los 3 intentos con foto. Puedes verificar tu identidad aportando un documento."
  },
  OTHER: {
    label: "Otro motivo",
    title: "No hemos podido completar la comprobación",
    message: "No hemos podido completar la comprobación con una foto. Puedes verificar tu identidad aportando un documento."
  }
};

export function isPhotoReason(code: string): code is (typeof PHOTO_REASON_CODES)[number] {
  return (PHOTO_REASON_CODES as readonly string[]).includes(code);
}
export function isCheckRetryReason(code: string): code is (typeof CHECK_RETRY_REASON_CODES)[number] {
  return (CHECK_RETRY_REASON_CODES as readonly string[]).includes(code);
}
export function isCheckRejectReason(code: string): code is (typeof CHECK_REJECT_REASON_CODES)[number] {
  return (CHECK_REJECT_REASON_CODES as readonly string[]).includes(code);
}

export function photoReasonView(code: string | null | undefined): ReasonView | null {
  if (!code) return null;
  const entry = isPhotoReason(code) ? PHOTO[code] : PHOTO.OTHER;
  return { code: isPhotoReason(code) ? code : "OTHER", title: entry.title, message: entry.message };
}

/** Motivo visible para la persona usuaria según el estado de la comprobación privada. */
export function checkReasonView(state: "needs_retry" | "rejected", code: string | null | undefined): ReasonView {
  if (state === "needs_retry") {
    const key = code && isCheckRetryReason(code) ? code : "FACE_OUT_OF_FRAME";
    return { code: key, title: "Necesitamos otra captura", message: CHECK_RETRY[key].message };
  }
  const key = code && isCheckRejectReason(code) ? code : "OTHER";
  const entry = CHECK_REJECT[key];
  return { code: key, title: entry.title, message: entry.message };
}

export function documentReasonView(reviewReason: string | null | undefined): ReasonView {
  const text = (reviewReason ?? "").trim();
  return {
    code: DOCUMENT_REASON_CODE,
    title: "No hemos podido validar tu documento",
    message: text.length > 0 ? text : "No hemos podido validar tu documento. Puedes aportar otro."
  };
}

export type ReasonOption = { code: string; label: string; decisions: Array<"approved" | "rejected" | "needs_retry"> };

export function photoReasonOptions(): ReasonOption[] {
  return PHOTO_REASON_CODES.map(code => ({ code, label: PHOTO[code].label, decisions: ["rejected"] }));
}
export function checkReasonOptions(): ReasonOption[] {
  const options: ReasonOption[] = CHECK_RETRY_REASON_CODES.map(code => ({ code, label: CHECK_RETRY[code].label, decisions: ["needs_retry"] }));
  for (const code of CHECK_REJECT_REASON_CODES) {
    if (code === "MAX_ATTEMPTS_REACHED") continue; // lo fija el sistema, no el revisor
    options.push({ code, label: CHECK_REJECT[code].label, decisions: ["rejected"] });
  }
  return options;
}
export function documentReasonOptions(): ReasonOption[] {
  return [{ code: DOCUMENT_REASON_CODE, label: "Documento no válido", decisions: ["rejected"] }];
}
