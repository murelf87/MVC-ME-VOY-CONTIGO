import { BEARER, type Schema, errorResponses } from "../schemas.js";

export const TAG_USER = "Verificación (persona usuaria)";
export const TAG_LEGAL = "Documentos legales";
export const TAG_ADMIN_SUMMARY = "Administración · Resumen";
export const TAG_ADMIN_REVIEW = "Administración · Usuarios y revisión";
export const TAG_ADMIN_BOOKINGS = "Administración · Reservas y devoluciones";
export const TAG_ADMIN_TARIFFS = "Administración · Tarifas y operaciones";
export const TAG_ADMIN_AUDIT = "Administración · Auditoría";
export const TAG_ADMIN_LEGAL = "Administración · Documentos legales";
export const TAG_ADMIN_SUPPORT = "Administración · Atención al cliente";

export type RouteDoc = {
  tags: string[];
  summary: string;
  description?: string;
  /** false = endpoint público (sin `security`). */
  auth?: boolean;
  params?: Schema;
  querystring?: Schema;
  body?: Schema;
  /** Respuestas correctas por código HTTP. */
  responses: Record<number, Schema>;
  /** Códigos de error documentados (cuerpo `{ error:{code,message,details?}, requestId }`). */
  errors: readonly number[];
};

/** Construye el `schema` de una ruta (resumen/etiquetas en español, seguridad Bearer y respuestas de error documentadas). */
export function doc(d: RouteDoc) {
  return {
    tags: d.tags,
    summary: d.summary,
    ...(d.description ? { description: d.description } : {}),
    ...(d.auth === false ? {} : { security: BEARER }),
    ...(d.params ? { params: d.params } : {}),
    ...(d.querystring ? { querystring: d.querystring } : {}),
    ...(d.body ? { body: d.body } : {}),
    response: { ...errorResponses(d.errors), ...d.responses }
  };
}

/** Límites de frecuencia por IP a nivel de ruta (además del límite global y del tope diario de subidas en base de datos). */
export const RATE_UPLOAD = { max: 20, timeWindow: "1 minute" } as const;
export const RATE_COMPLETE = { max: 30, timeWindow: "1 minute" } as const;
export const RATE_LEGAL_ACCEPT = { max: 30, timeWindow: "1 minute" } as const;
export const RATE_PUBLIC_PHOTO = { max: 300, timeWindow: "1 minute" } as const;
export const RATE_ADMIN_WRITE = { max: 60, timeWindow: "1 minute" } as const;
