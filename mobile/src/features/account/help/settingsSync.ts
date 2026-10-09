/**
 * Guardado de ajustes (`PATCH /v1/me/settings`) con envío optimista, cola y estado de «guardando / error».
 *
 *  - El cambio se ve al instante (se escribe en la caché de `GET /v1/me/settings`) y se envía en cuanto no hay otro en
 *    vuelo. Si la persona cambia varias veces seguidas, se manda UNA petición con lo último de cada campo.
 *  - Si el servidor lo rechaza, los campos vuelven al último valor confirmado (salvo el tamaño de letra, que es una
 *    preferencia de este móvil y se queda aplicada: el error solo dice que no se guardó en la cuenta) y `error`/`failed`
 *    permiten ofrecer «Reintentar».
 *  - Vive FUERA de React (un único almacén por app) para que la hoja de «Tamaño de letra», el interruptor y la
 *    sincronización de sesión compartan el mismo estado.
 */
import { useSyncExternalStore } from "react";
import type { UserSettings, UserSettingsPatch } from "@/api/types";
import { queryCache } from "@/hooks";
import { patchSettings } from "./api";
import { helpKeys } from "./hooks/keys";
import { applySettingsPatch, isEmptyPatch, mergePatches, revertFailedPatch } from "./logic/settings";

export interface SettingsSaveState {
  /** Hay un cambio en vuelo o esperando turno. */
  saving: boolean;
  /** Último fallo de guardado (se limpia con el siguiente cambio o al reintentar con éxito). */
  error: Error | null;
  /** Lo que no se pudo guardar (para «Reintentar»). */
  failed: UserSettingsPatch | null;
}

const IDLE: SettingsSaveState = { saving: false, error: null, failed: null };

let state: SettingsSaveState = IDLE;
const listeners = new Set<() => void>();
let pending: UserSettingsPatch = {};
let inFlight = false;
/** Últimos ajustes que el servidor confirmó (para deshacer un cambio rechazado). */
let confirmed: UserSettings | null = null;

function setState(next: SettingsSaveState): void {
  if (next.saving === state.saving && next.error === state.error && next.failed === state.failed) return;
  state = next;
  for (const listener of [...listeners]) listener();
}

export function getSettingsSaveState(): SettingsSaveState {
  return state;
}

export function subscribeSettingsSave(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSettingsSaveState(): SettingsSaveState {
  return useSyncExternalStore(subscribeSettingsSave, getSettingsSaveState, getSettingsSaveState);
}

/** El tamaño de letra se queda aplicado en el móvil aunque la cuenta no lo guarde. */
function withoutFontScale(patch: UserSettingsPatch): UserSettingsPatch {
  return {
    ...(patch.shareLiveLocationInTrip !== undefined ? { shareLiveLocationInTrip: patch.shareLiveLocationInTrip } : {}),
    ...(patch.language !== undefined ? { language: patch.language } : {}),
  };
}

async function flush(): Promise<void> {
  if (inFlight || isEmptyPatch(pending)) return;
  inFlight = true;
  const sending = pending;
  pending = {};
  try {
    const saved = await patchSettings(sending);
    confirmed = saved;
    const merged = isEmptyPatch(pending) ? saved : applySettingsPatch(saved, pending);
    queryCache.setData<UserSettings>(helpKeys.settings, merged);
    setState({ saving: !isEmptyPatch(pending), error: null, failed: null });
  } catch (raised) {
    const error = raised instanceof Error ? raised : new Error(String(raised));
    const current = queryCache.getData<UserSettings>(helpKeys.settings);
    const base = confirmed ?? current;
    if (current && base) {
      queryCache.setData<UserSettings>(helpKeys.settings, revertFailedPatch(current, base, withoutFontScale(sending), pending));
    }
    setState({ saving: !isEmptyPatch(pending), error, failed: sending });
  } finally {
    inFlight = false;
    if (!isEmptyPatch(pending)) void flush();
    else if (state.saving) setState({ ...state, saving: false });
  }
}

/**
 * Pide guardar un cambio de ajustes. Devuelve en cuanto el cambio queda aplicado en pantalla; el resultado del
 * guardado se lee en `useSettingsSaveState()`.
 */
export function queueSettingsPatch(patch: UserSettingsPatch): void {
  if (isEmptyPatch(patch)) return;
  const current = queryCache.getData<UserSettings>(helpKeys.settings);
  if (!inFlight && isEmptyPatch(pending) && current) confirmed = current;
  if (current) queryCache.setData<UserSettings>(helpKeys.settings, applySettingsPatch(current, patch));
  pending = mergePatches(pending, patch);
  setState({ saving: true, error: null, failed: null });
  void flush();
}

/** Repite lo último que no se pudo guardar. */
export function retrySettingsSave(): void {
  const failed = state.failed;
  if (failed === null) return;
  queueSettingsPatch(failed);
}

/** Olvida el error de guardado sin reintentar (la persona lo ha visto y lo descarta). */
export function dismissSettingsSaveError(): void {
  if (state.error !== null || state.failed !== null) setState({ saving: state.saving, error: null, failed: null });
}

/** Solo para pruebas y para el cierre de sesión: olvida la cola y el estado. */
export function resetSettingsSync(): void {
  pending = {};
  confirmed = null;
  state = IDLE;
  for (const listener of [...listeners]) listener();
}
