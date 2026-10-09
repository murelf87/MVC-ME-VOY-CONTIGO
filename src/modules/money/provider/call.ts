import { DomainError } from "../../../errors.js";

/**
 * Ejecuta una operación del proveedor de pagos. Los `DomainError` (p. ej. 409 PAYMENTS_PROVIDER_DISABLED) se propagan tal cual;
 * cualquier otro fallo (red, timeout, respuesta inesperada) se traduce a 502 PAYMENT_PROVIDER_ERROR sin filtrar detalles del proveedor.
 * La operación debe haberse invocado con una clave idempotente propia: reintentarla no duplica efectos en el proveedor.
 */
export async function callProvider<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      "PAYMENT_PROVIDER_ERROR",
      "El proveedor de pagos no ha respondido correctamente. No se ha guardado nada: inténtalo de nuevo.",
      502
    );
  }
}
