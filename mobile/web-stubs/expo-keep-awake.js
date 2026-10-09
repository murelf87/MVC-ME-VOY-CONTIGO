// Sustituto web de expo-keep-awake (SOLO VISTA PREVIA): un navegador de escritorio no necesita mantener la pantalla encendida.
// Recuerda qué etiquetas están activas para que `useKeepAwake`/`activateKeepAwake` y sus listeners sean coherentes.
import { useEffect } from 'react';

export const ExpoKeepAwakeTag = 'ExpoKeepAwakeDefaultTag';
export const KeepAwakeEventState = { RELEASE: 'release' };

const active = new Set();
const listeners = new Map(); // tag → Set<listener>

export async function isAvailableAsync() {
  return true;
}
export async function activateKeepAwakeAsync(tag = ExpoKeepAwakeTag) {
  active.add(tag);
}
export async function activateKeepAwake(tag = ExpoKeepAwakeTag) {
  active.add(tag);
}
export async function deactivateKeepAwake(tag = ExpoKeepAwakeTag) {
  if (!active.delete(tag)) return;
  const set = listeners.get(tag);
  if (set) set.forEach((l) => l({ state: KeepAwakeEventState.RELEASE }));
}
export function useKeepAwake(tag = ExpoKeepAwakeTag) {
  useEffect(() => {
    void activateKeepAwakeAsync(tag);
    return () => {
      void deactivateKeepAwake(tag);
    };
  }, [tag]);
}
export function addListener(tagOrListener, maybeListener) {
  const tag = typeof tagOrListener === 'string' ? tagOrListener : ExpoKeepAwakeTag;
  const listener = typeof tagOrListener === 'string' ? maybeListener : tagOrListener;
  if (!listeners.has(tag)) listeners.set(tag, new Set());
  listeners.get(tag).add(listener);
  return { remove: () => listeners.get(tag).delete(listener) };
}
