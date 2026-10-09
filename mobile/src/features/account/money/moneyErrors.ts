/**
 * Traduce los errores del módulo `money` a texto de usuario en español. Los códigos que comparten varios paquetes
 * (proveedor desactivado, pago en curso) se resuelven aquí por contexto en lugar de sobrescribir el catálogo global.
 * Nunca se muestra el `message` del servidor: la app decide por `code` (docs/contracts/money.md §1).
 */
import { describeError, isApiError } from "@/api";

export type MoneyErrorContext = "load" | "addMethod" | "removeMethod" | "printable";

export interface MoneyErrorView {
  title: string;
  message: string;
  code: string | null;
  /** Reintentar la misma acción puede funcionar. */
  retryable: boolean;
  /** No hay red: la pantalla ofrece «Reintentar cuando tengas conexión». */
  offline: boolean;
}

interface Copy {
  title: string;
  message: string;
}

const PROVIDER_DISABLED: Copy = {
  title: "Pagos aún no disponibles",
  message: "Todavía no hemos activado el proveedor de pagos. No se ha guardado ni cobrado nada.",
};

const BY_CONTEXT: Record<MoneyErrorContext, Readonly<Record<string, Copy>>> = {
  load: {},
  addMethod: {
    PAYMENTS_PROVIDER_DISABLED: PROVIDER_DISABLED,
    PAYMENT_METHOD_NOT_AVAILABLE: { title: "Método no disponible", message: "El proveedor de pagos no ha aceptado este método. Prueba con otro." },
    VALIDATION_ERROR: { title: "Datos no válidos", message: "No hemos podido guardar el método con esos datos. Vuelve a elegirlo." },
  },
  removeMethod: {
    PAYMENTS_PROVIDER_DISABLED: PROVIDER_DISABLED,
    PAYMENT_ALREADY_OPEN: { title: "Pago en curso", message: "Este método se está usando en un pago en curso. Inténtalo de nuevo cuando termine." },
  },
  printable: {
    RECEIPT_NOT_FOUND: { title: "Recibo no encontrado", message: "No encontramos este recibo. Puede que no sea tuyo o que ya no esté disponible." },
  },
};

export function describeMoneyError(error: unknown, context: MoneyErrorContext = "load"): MoneyErrorView {
  const base = describeError(error);
  if (isApiError(error)) {
    const copy = BY_CONTEXT[context][error.code];
    if (copy !== undefined) {
      return { title: copy.title, message: copy.message, code: error.code, retryable: base.retryable, offline: false };
    }
  }
  return { title: base.title, message: base.message, code: base.code, retryable: base.retryable, offline: base.kind === "offline" };
}
