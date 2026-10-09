/**
 * Fotos públicas de personas en el panel. El servidor da la foto APROBADA como ruta relativa a la API
 * (`/v1/public/users/{id}/photo?v=…`) o como URL absoluta; la foto privada (selfie, documentos) NO sale por aquí: solo
 * por la URL firmada de 120 s del visor de documentación.
 */
import { getApiBaseUrl } from "@/api";

/** Ruta de la propia API: solo estas se resuelven contra la URL base (un recurso empaquetado `/assets/…` no es de la API). */
const API_PATH_PREFIX = "/v1/";

/**
 * Ruta de la API → URL absoluta contra la API; cualquier otra forma (absoluta, `data:`, `blob:`, recurso empaquetado) se
 * deja tal cual; sin foto → `null`.
 */
export function resolvePublicPhoto(url: string | null | undefined, baseUrl: string = getApiBaseUrl()): string | null {
  if (url === null || url === undefined || url === "") return null;
  if (url.startsWith(API_PATH_PREFIX)) return baseUrl === "" ? null : `${baseUrl}${url}`;
  return url;
}
