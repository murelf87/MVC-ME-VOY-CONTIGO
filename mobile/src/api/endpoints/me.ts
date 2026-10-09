/**
 * Perfil propio y datos de provincias.
 *
 *   GET   /me                     → fila de perfil (snake_case), incluye `roles` (también de personal)
 *   PATCH /v1/me/profile          → { user_id, display_name, … }  (nombre visible, 2–80 caracteres)
 *   GET   /v1/provinces           → { provinces: Province[] }
 *   GET   /v1/provinces/resolve   → { province } | 404 PROVINCE_NOT_FOUND
 */
import { apiRequest } from "../client";
import { isApiErrorWithCode } from "../errors";
import type { MeProfile, Province, UpdatedProfile } from "../types";
import type { CallOptions } from "./auth";

/** `token` explícito: para validar una sesión recién creada o restaurada (no emite `authExpired`). */
export function getMe(options: CallOptions & { token?: string } = {}): Promise<MeProfile> {
  const { token, ...rest } = options;
  return apiRequest<MeProfile>("/me", {
    ...(token ? { token, authExpiry: "ignore" as const } : {}),
    ...rest,
  });
}

/** Cambia el nombre visible. PATCH no se reintenta automáticamente. */
export function updateProfile(
  input: { displayName: string },
  options: CallOptions & { token?: string } = {}
): Promise<UpdatedProfile> {
  const { token, ...rest } = options;
  return apiRequest<UpdatedProfile>("/v1/me/profile", {
    method: "PATCH",
    body: input,
    ...(token ? { token, authExpiry: "ignore" as const } : {}),
    ...rest,
  });
}

export async function listProvinces(options: CallOptions = {}): Promise<Province[]> {
  const result = await apiRequest<{ provinces: Province[] }>("/v1/provinces", { token: null, ...options });
  return result.provinces;
}

/** Provincia que contiene el punto; `null` si el punto no cae en ninguna provincia disponible. */
export async function resolveProvince(
  point: { latitude: number; longitude: number },
  options: CallOptions = {}
): Promise<Province | null> {
  try {
    const result = await apiRequest<{ province: Province }>("/v1/provinces/resolve", {
      token: null,
      query: { latitude: point.latitude, longitude: point.longitude },
      ...options,
    });
    return result.province;
  } catch (error) {
    if (isApiErrorWithCode(error, "PROVINCE_NOT_FOUND")) return null;
    throw error;
  }
}
