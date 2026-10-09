// Sustituto web de expo-sharing (SOLO VISTA PREVIA): la hoja de compartir del móvil simulado la dibuja el visor.
import { previewShell } from './_preview-system';

export async function isAvailableAsync() {
  return true;
}

/** Abre la hoja de compartir simulada del visor. Como en el sistema, resuelve al cerrarla (se comparta o no). */
export async function shareAsync(url, options) {
  const shell = previewShell();
  if (!shell || typeof shell.share !== 'function') return;
  const opts = options || {};
  await shell.share({ url: typeof url === 'string' ? url : String(url), title: opts.dialogTitle, message: undefined });
}

export function getSharedPayloads() {
  return [];
}
export async function getResolvedSharedPayloadsAsync() {
  return [];
}
export function clearSharedPayloads() {}
export function useIncomingShare() {
  return { sharedPayloads: [], resolvedSharedPayloads: [], clearSharedPayloads() {}, isResolving: false, error: null, refreshSharePayloads() {} };
}
