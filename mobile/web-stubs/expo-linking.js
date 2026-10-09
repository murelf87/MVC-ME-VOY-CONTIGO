// Sustituto web de expo-linking (SOLO VISTA PREVIA). La página dentro del visor no tiene URL de aplicación
// (about:srcdoc): los enlaces entrantes no existen y los salientes piden confirmación con «¿Abrir enlace externo?»
// (nada se abre solo y nada sale del navegador sin que la persona lo acepte).
import { previewShell } from './_preview-system';

const SCHEME = 'mvc';
const OPENABLE = /^(https?|mailto|tel|sms|geo|maps|whatsapp):/i;

export function createURL(path, options) {
  const p = String(path || '').replace(/^\/+/, '');
  const qp = options && options.queryParams ? Object.entries(options.queryParams).filter(([, v]) => v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';
  return `${(options && options.scheme) || SCHEME}://${p}${qp ? `?${qp}` : ''}`;
}

export function parse(url) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^?#]*)(?:\?([^#]*))?/i.exec(String(url || ''));
  const queryParams = {};
  if (m && m[3]) m[3].split('&').forEach((kv) => { const [k, v] = kv.split('='); if (k) queryParams[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
  return { scheme: m ? m[1] : null, hostname: null, path: m ? m[2].replace(/^\/+|\/+$/g, '') || null : null, queryParams };
}
export async function parseInitialURLAsync() {
  return { scheme: null, hostname: null, path: null, queryParams: {} };
}

export async function getInitialURL() {
  return null;
}
export function getLinkingURL() {
  return null;
}
export function clearInitialURL() {}
export function useURL() {
  return null;
}
export function useLinkingURL() {
  return null;
}
export function addEventListener() {
  return { remove() {} };
}

export async function canOpenURL(url) {
  return OPENABLE.test(String(url || ''));
}

export async function openURL(url) {
  const target = String(url || '');
  const shell = previewShell();
  if (shell && typeof shell.openExternal === 'function') {
    await shell.openExternal(target);
    return true;
  }
  return true;
}

export async function openSettings() {
  const shell = previewShell();
  if (shell && typeof shell.openSettings === 'function') await shell.openSettings();
}
export async function sendIntent() {}

export function collectManifestSchemes() {
  return [SCHEME];
}
export function hasConstantsManifest() {
  return false;
}
export function hasCustomScheme() {
  return true;
}
export function resolveScheme() {
  return SCHEME;
}
