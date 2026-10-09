/**
 * Persistencia de la sesión sobre `@/platform/storage`.
 *
 *  - `mvc.session.token`           token opaco (SecureStore en iOS/Android, localStorage en web). Clave histórica: no cambiar.
 *  - `mvc.session.me`              última copia de `/me` (para arrancar sin red). Se borra al cerrar sesión.
 *  - `mvc.session.activeRole.<id>` rol activo preferido de ese usuario (preferencias no secretas).
 */
import type { MeProfile } from "@/api/types";
import { getJson, preferences, secureStorage, setJson } from "@/platform/storage";
import type { SessionStorage } from "./sessionService";
import type { ActiveRole } from "./types";

export const TOKEN_KEY = "mvc.session.token";
export const ME_CACHE_KEY = "mvc.session.me";
const activeRoleKey = (userId: string) => `mvc.session.activeRole.${userId}`;

function isMeLike(value: unknown): value is MeProfile {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    Array.isArray((value as { roles?: unknown }).roles)
  );
}

export const sessionStorage: SessionStorage = {
  readToken: () => secureStorage.get(TOKEN_KEY),
  writeToken: (token) => secureStorage.set(TOKEN_KEY, token),
  async clearToken() {
    await secureStorage.remove(TOKEN_KEY);
  },
  async readMeCache() {
    const value = await getJson<unknown>(secureStorage, ME_CACHE_KEY);
    return isMeLike(value) ? value : null;
  },
  async writeMeCache(me) {
    await setJson(secureStorage, ME_CACHE_KEY, me);
  },
  async clearMeCache() {
    await secureStorage.remove(ME_CACHE_KEY);
  },
  async readActiveRole(userId) {
    const value = await preferences.get(activeRoleKey(userId));
    return value === "passenger" || value === "driver" ? value : null;
  },
  async writeActiveRole(userId, role: ActiveRole) {
    await preferences.set(activeRoleKey(userId), role);
  },
};
