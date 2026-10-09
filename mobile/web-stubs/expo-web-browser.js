// Sustituto web de expo-web-browser (SOLO VISTA PREVIA). Abrir una página web pide confirmación con
// «¿Abrir enlace externo?»; si la persona acepta, el visor SIMULA la apertura (nada se abre y nada sale del navegador).
// Las sesiones de autenticación OAuth no existen aquí (MVC no usa proveedores externos de inicio de sesión).
import { previewShell } from './_preview-system';

export const WebBrowserResultType = { CANCEL: 'cancel', DISMISS: 'dismiss', OPENED: 'opened', LOCKED: 'locked' };
export const WebBrowserPresentationStyle = { FULL_SCREEN: 'fullScreen', PAGE_SHEET: 'pageSheet', FORM_SHEET: 'formSheet', CURRENT_CONTEXT: 'currentContext', OVER_FULL_SCREEN: 'overFullScreen', OVER_CURRENT_CONTEXT: 'overCurrentContext', POPOVER: 'popover', AUTOMATIC: 'automatic' };

export async function openBrowserAsync(url) {
  const shell = previewShell();
  if (shell && typeof shell.openExternal === 'function') {
    const accepted = await shell.openExternal(String(url));
    return { type: accepted ? WebBrowserResultType.OPENED : WebBrowserResultType.CANCEL };
  }
  return { type: WebBrowserResultType.CANCEL };
}
export async function openAuthSessionAsync() {
  return { type: WebBrowserResultType.CANCEL };
}
export function dismissBrowser() {
  return { type: WebBrowserResultType.DISMISS };
}
export function dismissAuthSession() {}
export function maybeCompleteAuthSession() {
  return { type: 'failed', message: 'No hay ninguna sesión de autenticación en la vista previa.' };
}
export async function getCustomTabsSupportingBrowsersAsync() {
  return { browserPackages: [], defaultBrowserPackage: null, preferredBrowserPackage: null, servicePackages: [] };
}
export async function warmUpAsync() {
  return {};
}
export async function mayInitWithUrlAsync() {
  return {};
}
export async function coolDownAsync() {
  return {};
}
