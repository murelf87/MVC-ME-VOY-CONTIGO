/**
 * Clasificación y textos de los errores del panel de personal. Se usa en lugar de `describeError` a secas porque
 * varios códigos del panel («Sin permiso», «No hay nada que revisar», «Proveedor de pago no disponible»…) necesitan un
 * texto propio que no debe sobrescribir el catálogo global (otras pantallas usan los mismos códigos con otro sentido).
 *
 * Funciones puras: se prueban en Node.
 */
import { describeError, isApiError, isOfflineError } from "@/api";
import { reviewStrings } from "../strings";

export type AdminErrorKind =
  /** 403: el rol no incluye esta acción (o ha cambiado). Se pinta «Sin permiso». */
  | "forbidden"
  /** 404 de un recurso concreto (persona, devolución, documento). */
  | "notFound"
  | "offline"
  /** 409: el estado cambió mientras se miraba (otra persona decidió antes, ya no está pendiente…). */
  | "conflict"
  /** 400 / 422: el dato enviado no es válido. */
  | "validation"
  | "other";

export interface AdminErrorView {
  kind: AdminErrorKind;
  title: string;
  message: string;
  code: string | null;
  retryable: boolean;
  /** `details` del servidor, por si la pantalla necesita un dato (p. ej. `maxRefundableCents`). */
  details: unknown;
}

interface LocalCopy {
  title: string;
  message: string;
  kind: AdminErrorKind;
}

/** Textos propios del panel, por código estable del servidor. */
const LOCAL: Readonly<Record<string, LocalCopy>> = {
  SELF_REVIEW_FORBIDDEN: {
    kind: "forbidden",
    title: "No puedes revisar tu propio expediente",
    message: "Por seguridad, nadie puede decidir sobre su propio expediente ni abrir su propia documentación desde el panel.",
  },
  USER_NOT_FOUND: {
    kind: "notFound",
    title: reviewStrings.dossier.notFoundTitle,
    message: reviewStrings.dossier.notFoundMessage,
  },
  NOTHING_TO_REVIEW: {
    kind: "conflict",
    title: reviewStrings.users.staleTitle,
    message: reviewStrings.users.staleMessage,
  },
  REVIEW_REASON_REQUIRED: {
    kind: "validation",
    title: "Falta el motivo",
    message: "Escribe un motivo de al menos 3 caracteres, o elige qué ha fallado en la captura.",
  },
  REVIEW_REASON_CODE_INVALID: {
    kind: "validation",
    title: "Motivo no válido",
    message: "El motivo estándar elegido no corresponde a este elemento. Elige otro o déjalo en blanco.",
  },
  REVIEW_ITEM_INVALID: {
    kind: "validation",
    title: "Decisión no aplicable",
    message: "Pedir otra captura solo es posible en la comprobación privada.",
  },
  REVIEW_REASON_TOO_LONG: {
    kind: "validation",
    title: "Motivo demasiado largo",
    message: "El motivo no puede pasar de 1.000 caracteres.",
  },
  EVIDENCE_NOT_FOUND: {
    kind: "notFound",
    title: reviewStrings.evidence.notFoundTitle,
    message: reviewStrings.evidence.notFoundMessage,
  },
  EVIDENCE_STORAGE_MISMATCH: {
    kind: "other",
    title: reviewStrings.evidence.storageMismatchTitle,
    message: reviewStrings.evidence.storageMismatchMessage,
  },
  PRIVATE_STORAGE_DISABLED: {
    kind: "other",
    title: reviewStrings.evidence.storageDisabledTitle,
    message: reviewStrings.evidence.storageDisabledMessage,
  },
  VEHICLE_NOT_FOUND: {
    kind: "notFound",
    title: "Vehículo no encontrado",
    message: "Puede que se haya eliminado. Actualiza el expediente.",
  },
  PROVINCE_NOT_FOUND: {
    kind: "notFound",
    title: "Provincia no encontrada",
    message: "La provincia elegida ya no está disponible. Elige otra.",
  },
  CURSOR_INVALID: {
    kind: "conflict",
    title: "La lista ha cambiado",
    message: "La lista ha cambiado mientras la mirabas. Actualízala e inténtalo de nuevo.",
  },
  REFUND_NOT_FOUND: {
    kind: "notFound",
    title: reviewStrings.refund.notFoundTitle,
    message: reviewStrings.refund.notFoundMessage,
  },
  REFUND_NOT_PENDING: {
    kind: "conflict",
    title: "La devolución ya no está pendiente",
    message: reviewStrings.refund.stale,
  },
  REFUND_NOT_EXECUTABLE: {
    kind: "conflict",
    title: "No se puede pedir al proveedor",
    message: "Esta devolución no está en un estado en el que se pueda pedir al proveedor de pago (ya se pidió o no está aprobada).",
  },
  REFUND_AMOUNT_REQUIRED: {
    kind: "validation",
    title: "Falta el importe",
    message: "Aún no hay propuesta: escribe el importe que se devolverá.",
  },
  REFUND_AMOUNT_EXCEEDS_PAID: {
    kind: "validation",
    title: "Importe demasiado alto",
    message: "El importe supera lo que queda por devolver de este pago.",
  },
  REFUND_NOTE_REQUIRED: {
    kind: "validation",
    title: "Falta la nota",
    message: "Escribe una nota con el criterio aplicado: no hay política aplicable o has cambiado el importe propuesto.",
  },
  REFUND_NO_PAYMENT_RECORD: {
    kind: "conflict",
    title: reviewStrings.refund.noPaymentTitle,
    message: reviewStrings.refund.noPaymentMessage,
  },
  PAYMENTS_PROVIDER_DISABLED: {
    kind: "conflict",
    title: reviewStrings.refund.providerDisabledTitle,
    message: reviewStrings.refund.providerDisabledMessage,
  },
  IDEMPOTENCY_KEY_REUSED: {
    kind: "conflict",
    title: "Acción repetida",
    message: "Esa acción ya se había enviado con otros datos. Vuelve a abrirla e inténtalo de nuevo.",
  },
};

export function adminError(error: unknown): AdminErrorView {
  const described = describeError(error);
  if (isOfflineError(error)) {
    return { kind: "offline", title: described.title, message: described.message, code: described.code, retryable: true, details: undefined };
  }
  if (isApiError(error)) {
    const local = LOCAL[error.code];
    if (local !== undefined) {
      return { kind: local.kind, title: local.title, message: local.message, code: error.code, retryable: false, details: error.details };
    }
    if (error.status === 403) {
      return {
        kind: "forbidden",
        title: reviewStrings.access.deniedTitle,
        message: reviewStrings.access.deniedByServer,
        code: error.code,
        retryable: false,
        details: error.details,
      };
    }
    if (error.status === 404) {
      return { kind: "notFound", title: described.title, message: described.message, code: error.code, retryable: false, details: error.details };
    }
    if (error.status === 409) {
      return { kind: "conflict", title: described.title, message: described.message, code: error.code, retryable: false, details: error.details };
    }
    if (error.status === 400 || error.status === 422) {
      return { kind: "validation", title: described.title, message: described.message, code: error.code, retryable: false, details: error.details };
    }
  }
  return { kind: "other", title: described.title, message: described.message, code: described.code, retryable: described.retryable, details: undefined };
}

/** `details.maxRefundableCents` de `REFUND_AMOUNT_EXCEEDS_PAID`, si viene como entero. */
export function maxRefundableFromError(error: unknown): number | null {
  if (!isApiError(error)) return null;
  const details = error.details;
  if (typeof details !== "object" || details === null) return null;
  const value = (details as { maxRefundableCents?: unknown }).maxRefundableCents;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
