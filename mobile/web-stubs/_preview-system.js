// Ayudas comunes de los sustitutos web (SOLO VISTA PREVIA en el navegador). En iOS/Android estos ficheros no existen en
// el bundle: Metro los sustituye únicamente para platform === 'web' (mobile/metro.config.js).
// Hablan con el visor a través de globalThis.__MVC_PREVIEW_SHELL__ (contrato: tools/preview/shell/API.md). Si no hay
// visor (otra página web, servidor de desarrollo), degradan con elegancia: permisos concedidos al pedirlos, sin diálogos.
import { useCallback, useEffect, useState } from 'react';

export function previewShell() {
  return globalThis.__MVC_PREVIEW_SHELL__ || null;
}

/** Estado del permiso en el móvil simulado: undetermined | granted | denied | blocked. */
export function permissionStatus(kind) {
  const s = previewShell();
  return s && typeof s.permissionStatus === 'function' ? s.permissionStatus(kind) : 'undetermined';
}

/** Pide el permiso con el diálogo del sistema (solo si aún se puede preguntar). */
export async function requestPermission(kind) {
  const s = previewShell();
  if (s && typeof s.requestPermission === 'function') return s.requestPermission(kind);
  return 'granted';
}

/** Respuesta con la forma de los módulos de Expo ({ status, granted, canAskAgain, expires }). */
export function expoPermission(status, extra) {
  const expoStatus = status === 'granted' ? 'granted' : status === 'undetermined' ? 'undetermined' : 'denied';
  return Object.assign({ status: expoStatus, granted: status === 'granted', canAskAgain: status !== 'blocked', expires: 'never' }, extra || {});
}

/** Suscripción a un evento DOM del visor (mvc:preview-sim, mvc:preview-permission…). Devuelve la función para darse de baja. */
export function onShellEvent(name, listener) {
  if (typeof globalThis.addEventListener !== 'function') return () => undefined;
  const handler = (e) => listener((e && e.detail) || {});
  globalThis.addEventListener(name, handler);
  return () => globalThis.removeEventListener(name, handler);
}

/** Simulación del móvil (red, GPS, lugar…). Valores por defecto si no hay visor. */
export function currentSim() {
  const s = previewShell();
  return (
    (s && s.sim) || {
      network: 'wifi',
      gps: 'good',
      place: { id: 'sevilla', label: 'Plaza Nueva (ejemplo)', latitude: 37.3886, longitude: -5.9953 },
      clock: null,
      statusTime: '09:41',
      screenReader: false,
    }
  );
}

/** Plataforma efectiva del móvil simulado: 'ios' | 'android'. */
export function devicePlatform() {
  const s = previewShell();
  return (s && s.device && s.device.platform) || 'ios';
}

/** Hook de permisos con la forma de expo: [permiso | null, pedir(), consultar()]. */
export function usePermissionHook(kind, extraFor) {
  const read = useCallback(() => expoPermission(permissionStatus(kind), extraFor ? extraFor(permissionStatus(kind)) : undefined), [kind, extraFor]);
  const [perm, setPerm] = useState(read);
  useEffect(() => {
    setPerm(read());
    return onShellEvent('mvc:preview-permission', () => setPerm(read()));
  }, [read]);
  const request = useCallback(async () => {
    const st = await requestPermission(kind);
    const next = expoPermission(st, extraFor ? extraFor(st) : undefined);
    setPerm(next);
    return next;
  }, [kind, extraFor]);
  const get = useCallback(async () => {
    const next = read();
    setPerm(next);
    return next;
  }, [read]);
  return [perm, request, get];
}

/** Error con código, como los de los módulos de Expo. */
export function codedError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
