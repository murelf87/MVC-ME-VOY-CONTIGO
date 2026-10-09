/**
 * Errores del paquete «solicitar plaza y pagar» → datos listos para pintar. Los códigos de este paquete llevan SU texto
 * (aunque otro paquete registre el mismo código con otra redacción); el resto pasa por `describeError`.
 */
import { describeError, isApiError, type ErrorDescription } from "@/api";
import { requestStrings } from "../strings";

type OwnCopy = { title: string; message: string };

const OWN: Readonly<Record<string, OwnCopy>> = requestStrings.errors;

/** Códigos con los que el servidor dice «el proveedor de pagos no está activo» (el contrato real y el nombre corto). */
export const PROVIDER_UNAVAILABLE_CODES: readonly string[] = ["PAYMENTS_PROVIDER_DISABLED", "PAYMENT_PROVIDER_UNAVAILABLE"];

export function describeRequestError(error: unknown): ErrorDescription {
  const base = describeError(error);
  if (base.code === null) return base;
  const own = OWN[base.code];
  return own === undefined ? base : { ...base, title: own.title, message: own.message };
}

/** ¿El error es uno de estos códigos de API? */
export function hasErrorCode(error: unknown, ...codes: readonly string[]): boolean {
  return isApiError(error) && codes.includes(error.code);
}

/** `details.paymentId` de un `PAYMENT_ALREADY_OPEN` (el pago en curso que hay que seguir). */
export function openPaymentIdOf(error: unknown): string | null {
  if (!isApiError(error) || error.code !== "PAYMENT_ALREADY_OPEN") return null;
  const details = error.details;
  if (typeof details !== "object" || details === null) return null;
  const id = (details as { paymentId?: unknown }).paymentId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Errores tras los cuales no tiene sentido «Reintentar» la misma acción: hay que cambiar algo o salir. */
export function isTerminalForRequest(error: unknown): boolean {
  return hasErrorCode(
    error,
    "TRIP_NOT_FOUND",
    "TRIP_NOT_BOOKABLE",
    "DRIVER_CANNOT_REQUEST_OWN_TRIP",
    "DUPLICATE_OPEN_REQUEST",
    "REQUEST_NOT_FOUND",
    "NO_CAPACITY_ON_SEGMENT",
  );
}
