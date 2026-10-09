/**
 * Almacenamiento clave-valor con respaldo seguro en todas las plataformas. Nunca lanza.
 *
 *  - `secureStorage`: iOS Keychain / Android Keystore (expo-secure-store). Para secretos: token de sesión.
 *    Web: localStorage (la vista previa). Si el navegador lo bloquea (iframe aislado), memoria del proceso.
 *  - `preferences`: preferencias NO secretas (rol activo, filtros, «no volver a mostrar»). AsyncStorage / localStorage.
 *
 * `get` devuelve `null` si no hay valor O si el almacén falla; `set`/`remove` devuelven `false` si fallaron
 * (quien guarda algo importante, como el token, puede avisar al usuario de que no se recordará la sesión).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<boolean>;
  remove(key: string): Promise<boolean>;
}

const memory = new Map<string, string>();

function webStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    // Algunos navegadores lanzan al acceder o al escribir (modo privado, iframe sin allow-same-origin).
    const probe = "__mvc_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function createWebStore(): KeyValueStore {
  return {
    async get(key) {
      const storage = webStorage();
      return storage ? storage.getItem(key) : (memory.get(key) ?? null);
    },
    async set(key, value) {
      const storage = webStorage();
      if (storage) {
        try {
          storage.setItem(key, value);
          return true;
        } catch {
          // cae a memoria
        }
      }
      memory.set(key, value);
      return true;
    },
    async remove(key) {
      memory.delete(key);
      try {
        webStorage()?.removeItem(key);
      } catch {
        // nada que limpiar
      }
      return true;
    },
  };
}

function createSecureStore(): KeyValueStore {
  return {
    async get(key) {
      try {
        return await SecureStore.getItemAsync(key);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        await SecureStore.setItemAsync(key, value, {
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        });
        return true;
      } catch {
        return false;
      }
    },
    async remove(key) {
      try {
        await SecureStore.deleteItemAsync(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function createAsyncStore(): KeyValueStore {
  return {
    async get(key) {
      try {
        return await AsyncStorage.getItem(key);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        await AsyncStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    async remove(key) {
      try {
        await AsyncStorage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

const isWeb = Platform.OS === "web";

export const secureStorage: KeyValueStore = isWeb ? createWebStore() : createSecureStore();
export const preferences: KeyValueStore = isWeb ? createWebStore() : createAsyncStore();

/** Lee y decodifica JSON; `null` si no existe o está corrupto. */
export async function getJson<T>(store: KeyValueStore, key: string): Promise<T | null> {
  const raw = await store.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setJson(store: KeyValueStore, key: string, value: unknown): Promise<boolean> {
  return store.set(key, JSON.stringify(value));
}
