/**
 * Acceso (tolerante) al visor de la vista previa: `globalThis.__MVC_PREVIEW_SHELL__`.
 *
 * El contrato lo define `tools/preview/shell/API.md` y lo transcribe `@/platform/previewBridge` (agente `app`). El
 * visor NO está siempre: las pruebas de Node y una exportación abierta sin visor no lo tienen, así que todo aquí
 * degrada con valores por defecto. Solo se importan TIPOS del puente (se borran al compilar) para que un cambio de
 * contrato rompa la compilación y no se descubra en el navegador.
 *
 * Campos opcionales PROPIOS del backend en memoria (el visor real no los define; los usan las pruebas y las
 * automatizaciones: un script de inicio puede dejarlos en `__MVC_PREVIEW_SHELL__` antes de que arranque la app, porque
 * `inner.js` reutiliza el objeto si ya existe). Todos tienen valor por defecto:
 *
 *   clockMode   "frozen" | "running" | "host". Por defecto: «host» si el visor puede mover el reloj (`setClock`),
 *               «running» si no.
 *   latency     ms fijos o [mín, máx]; 0 desactiva la latencia simulada. Por defecto [80, 250].
 *   patchDate   si es false, no sustituye el `Date` global (solo aplica sin visor).
 *   otp         código SMS fijo (automatización); si no, se genera uno determinista de 6 dígitos.
 *   onRequest   función llamada con cada entrada del registro de peticiones.
 */
import type { PreviewBoot, PreviewShell, PreviewSim, PreviewSms } from "@/platform/previewBridge";
import type { ClockMode } from "./clock";
import type { RequestLogEntry } from "./log";

export interface PreviewShellExtras {
  clockMode?: ClockMode;
  latency?: number | readonly [number, number];
  patchDate?: boolean;
  otp?: string;
  onRequest?(entry: RequestLogEntry): void;
}

/** Lo que el backend en memoria ve del visor: todo opcional. */
export type ShellView = Partial<PreviewShell> & PreviewShellExtras;

type GlobalWithShell = { __MVC_PREVIEW_SHELL__?: unknown };

/** Nombre del evento DOM del visor al cambiar la simulación (`PREVIEW_EVENTS.sim` en el puente tipado). */
export const SIM_EVENT = "mvc:preview-sim";

/** El visor instalado, o `{}` si no hay (la vista previa funciona igualmente, con valores por defecto). */
export function readShell(): ShellView {
  const shell = (globalThis as unknown as GlobalWithShell).__MVC_PREVIEW_SHELL__;
  return typeof shell === "object" && shell !== null ? (shell as ShellView) : {};
}

export function hasShell(): boolean {
  const shell = (globalThis as unknown as GlobalWithShell).__MVC_PREVIEW_SHELL__;
  return typeof shell === "object" && shell !== null;
}

/** ¿Modo avión simulado? (`shell.isOffline()` o, en su defecto, `shell.sim.network === "none"`). */
export function isShellOffline(): boolean {
  const shell = readShell();
  try {
    if (typeof shell.isOffline === "function") return shell.isOffline() === true;
  } catch {
    // un visor defectuoso no debe tumbar el backend: se mira la simulación
  }
  return shell.sim?.network === "none";
}

/** Parámetros de arranque que fija el visor (`boot`): perfil, semilla y reloj. */
export function readBoot(): Partial<Pick<PreviewBoot, "profile" | "seed" | "clock">> {
  const boot = readShell().boot;
  if (!boot) return {};
  return { profile: boot.profile, seed: boot.seed, clock: boot.clock };
}

/**
 * Se suscribe a los cambios de la simulación (red, GPS, lugar…) que el visor anuncia con el evento DOM
 * `mvc:preview-sim`. Devuelve la función para darse de baja; sin `window` no hace nada.
 */
export function subscribeSim(listener: (sim: PreviewSim) => void): () => void {
  const target = (globalThis as { addEventListener?: unknown }).addEventListener;
  if (typeof target !== "function") return () => undefined;
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<PreviewSim>).detail;
    if (detail && typeof detail === "object") listener(detail);
  };
  globalThis.addEventListener(SIM_EVENT, handler);
  return () => {
    globalThis.removeEventListener(SIM_EVENT, handler);
  };
}

/** Entrega un SMS «recibido» al visor. `false` si no hay visor (el llamador usa su aviso de reserva). */
export function deliverSmsToShell(sms: Omit<PreviewSms, "id" | "at"> & { id?: string; at?: number }): boolean {
  const shell = readShell();
  if (typeof shell.deliverSms !== "function") return false;
  try {
    shell.deliverSms(sms);
    return true;
  } catch {
    return false;
  }
}

/**
 * Muestra una notificación «push» SIMULADA en el visor (`shell.notify`): la usan los slices que crean avisos para la persona
 * conectada (el visor los pinta como una notificación del sistema etiquetada «Simulación»). `false` si no hay visor.
 */
export function notifyShell(notification: Parameters<PreviewShell["notify"]>[0]): boolean {
  const shell = readShell();
  if (typeof shell.notify !== "function") return false;
  try {
    shell.notify(notification);
    return true;
  } catch {
    return false;
  }
}

/** Latencia de red simulada en ms: valor fijo, o aleatorio dentro del rango. */
export function pickLatencyMs(random: () => number, fallback: readonly [number, number] = [80, 250]): number {
  const configured = readShell().latency;
  if (typeof configured === "number") return Math.max(0, configured);
  const range = configured ?? fallback;
  const [min, max] = range;
  if (max <= min) return Math.max(0, min);
  return Math.round(min + random() * (max - min));
}
