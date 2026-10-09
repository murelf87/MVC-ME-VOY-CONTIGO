/**
 * Puente con la vista previa en navegador: tipos de `globalThis.__MVC_PREVIEW_SHELL__`.
 *
 * La vista previa NO ejecuta una app distinta: ejecuta ESTA app en un navegador. Lo que un navegador no puede dar de
 * verdad (diálogos de permisos del sistema, cámara nativa, SMS, compartir, abrir apps, modo avión, GPS) lo SIMULA el
 * visor («shell», agente `preview-shell`) y lo declara en pantalla como «Simulación». Este fichero define SOLO el
 * contrato TypeScript; el visor lo implementa (`inner.js`) y lo instala en `globalThis`.
 * Contrato completo y vigente: `tools/preview/shell/API.md` (este fichero es su transcripción tipada).
 *
 * Reglas:
 *  - NADA de esto existe en iOS/Android ni en una compilación de producción: toda lectura es `getPreviewShell()?.…`
 *    y debe degradar con elegancia si falta.
 *  - Los módulos nativos (expo-location, expo-camera, expo-image-picker, expo-notifications, expo-sharing, expo-linking,
 *    expo-secure-store…) ya los sustituye Metro por `mobile/web-stubs/*` SOLO en web, y esos sustitutos hablan con el
 *    visor. Por eso los wrappers de `@/platform` llaman SIEMPRE a los módulos de Expo: no hay ramas «if preview».
 *    Este puente es para lo que Expo no cubre: márgenes seguros del móvil simulado, `reportScreen`, pagos simulados
 *    (Apple Pay / Google Pay), biometría simulada, reloj simulado y el SMS del OTP.
 *  - Los permisos usan los estados del visor (`undetermined | granted | denied | blocked`); los wrappers de la app los
 *    traducen a `granted | denied | blocked | unavailable` (ver `permissions.ts`).
 *  - El shell nunca devuelve datos que parezcan reales: una foto elegida es una foto de muestra etiquetada por el
 *    visor; el código SMS lo genera el backend en memoria (`src/preview`) y el shell solo lo muestra.
 */

export type PreviewPermissionKind =
  | "location"
  | "locationAlways"
  | "notifications"
  | "camera"
  | "microphone"
  | "photos"
  | "contacts"
  | "bluetooth";
/** `blocked` = denegado sin poder volver a preguntar. */
export type PreviewPermissionStatus = "undetermined" | "granted" | "denied" | "blocked";

export interface PreviewDevice {
  id: "iphone15" | "promax" | "se" | "pixel8" | "small";
  label: string;
  /** `Platform.OS` «efectivo» del móvil simulado (en web `Platform.OS` es siempre `"web"`). */
  platform: "ios" | "android";
  width: number;
  height: number;
  /** Márgenes seguros REALES del móvil simulado (el iframe no tiene `env(safe-area-inset-*)`). */
  safeTop: number;
  safeBottom: number;
  safeLeft: number;
  safeRight: number;
  cornerRadius: number;
  chrome: boolean;
}

export interface PreviewSim {
  /** `none` = sin Internet (offline). */
  network: "wifi" | "cellular" | "none";
  gps: "good" | "weak" | "off";
  place: { id: string; label: string; latitude: number; longitude: number };
  clock: string | null;
  statusTime: string;
  screenReader: boolean;
}

export type PreviewProfile = "new" | "passenger" | "driver" | "admin";

export interface PreviewBoot {
  profile: PreviewProfile;
  seed?: string;
  clock?: string | null;
  device: PreviewDevice;
  sim: PreviewSim;
  permissions: Partial<Record<PreviewPermissionKind, PreviewPermissionStatus>>;
  chrome: boolean;
}

export interface PreviewSms {
  id: string;
  to: string;
  from: string;
  body: string;
  code?: string;
  at: number;
}

export interface PreviewPickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
  width?: number;
  height?: number;
  /** Archivo de ejemplo del proyecto (no de una persona real). */
  example?: boolean;
}

export interface PreviewAlertButton {
  id: string;
  label: string;
  style?: "default" | "cancel" | "destructive";
}

export interface PreviewShell {
  readonly version: 1;
  readonly boot: PreviewBoot;
  readonly device: PreviewDevice;
  readonly sim: PreviewSim;
  readonly profile: PreviewProfile;

  permissionStatus(kind: PreviewPermissionKind): PreviewPermissionStatus;
  requestPermission(kind: PreviewPermissionKind): Promise<PreviewPermissionStatus>;
  setPermission(kind: PreviewPermissionKind, status: PreviewPermissionStatus): void;
  openSettings(): Promise<void>;

  cameraCapture(opts?: { facing?: "user" | "environment"; label?: string; video?: boolean; instant?: boolean }): Promise<PreviewPickedFile | null>;
  pickImages(opts?: { multiple?: boolean; limit?: number; video?: boolean }): Promise<PreviewPickedFile[]>;
  pickDocument(opts?: { accept?: string[]; multiple?: boolean }): Promise<PreviewPickedFile[]>;
  share(opts: { title?: string; message?: string; url?: string }): Promise<"shared" | "dismissed">;
  /** Confirmación «¿Abrir enlace externo?». `true` si la persona acepta. */
  openExternal(url: string): Promise<boolean>;
  /** SIMULACIÓN de Apple Pay / Google Pay: nunca cobra nada. */
  payWithWallet(req: {
    merchant: string;
    label: string;
    amountLabel: string;
    lines?: { label: string; amountLabel: string }[];
  }): Promise<{ status: "authorized" | "cancelled" | "failed"; reference?: string }>;
  biometricPrompt(opts?: { reason?: string }): Promise<"success" | "fail" | "cancel">;
  alert(opts: { title: string; message?: string; buttons?: PreviewAlertButton[] }): Promise<string>;
  saveFile(opts: { baseName?: string; data: Blob | string }): Promise<"saved" | "declined" | "failed">;

  /** SMS «recibido» (lo manda el backend en el navegador al pedir un OTP): aparece en la bandeja del visor. */
  deliverSms(sms: Omit<PreviewSms, "id" | "at"> & { id?: string; at?: number }): void;
  notify(n: {
    app?: "MVC" | "Mensajes";
    title: string;
    body?: string;
    tone?: "info" | "warning" | "critical";
    data?: unknown;
    id?: string;
  }): void;
  setStatusBar(s: { style?: "auto" | "light" | "dark"; hidden?: boolean }): void;

  /** Desplaza `Date.now()`/`new Date()` de este documento. `null` = hora real. */
  setClock(iso: string | null): void;

  /** La app lo llama en cada cambio de ruta → «Estás en» del visor. */
  reportScreen(name: string, params?: unknown): void;

  readonly blocked: { kind: string; url: string }[];
  /** `sim.network === "none"`. */
  isOffline(): boolean;
}

/** Eventos DOM que lanza el visor en la ventana de la app. */
export const PREVIEW_EVENTS = {
  sim: "mvc:preview-sim",
  permission: "mvc:preview-permission",
  device: "mvc:preview-device",
  notificationResponse: "mvc:preview-notification-response",
} as const;

declare global {
  // eslint-disable-next-line no-var
  var __MVC_PREVIEW_SHELL__: PreviewShell | undefined;
}

/** `true` en la compilación de vista previa (`EXPO_PUBLIC_PREVIEW=1`). Expo sustituye la expresión literal. */
export const IS_PREVIEW_BUILD: boolean = process.env.EXPO_PUBLIC_PREVIEW === "1";

/**
 * El visor instalado en este navegador, o `undefined` (app real / sin visor). Solo se atiende en la compilación de
 * vista previa: en producción la lectura desaparece del paquete y ninguna página puede suplantar al visor.
 */
export function getPreviewShell(): PreviewShell | undefined {
  return IS_PREVIEW_BUILD ? globalThis.__MVC_PREVIEW_SHELL__ : undefined;
}

/** Plataforma efectiva: la del móvil simulado en la vista previa; `Platform.OS` de iOS/Android en la app real. */
export function resolveDevicePlatform(realPlatform: string): "ios" | "android" | "web" {
  const simulated = getPreviewShell()?.device.platform;
  if (simulated) return simulated;
  return realPlatform === "ios" || realPlatform === "android" ? realPlatform : "web";
}

/** Métricas iniciales de `SafeAreaProvider` en la vista previa (el iframe no conoce los márgenes del móvil simulado). */
export function getPreviewSafeAreaMetrics():
  | { frame: { x: number; y: number; width: number; height: number }; insets: { top: number; left: number; right: number; bottom: number } }
  | undefined {
  const device = getPreviewShell()?.device;
  if (!device) return undefined;
  return {
    frame: { x: 0, y: 0, width: device.width, height: device.height },
    insets: { top: device.safeTop, left: device.safeLeft, right: device.safeRight, bottom: device.safeBottom },
  };
}

/** Avisa al visor de la pantalla actual. No hace nada fuera de la vista previa. */
export function reportPreviewScreen(name: string, params?: unknown): void {
  try {
    getPreviewShell()?.reportScreen(name, params);
  } catch {
    // el visor es solo informativo: nunca debe romper la navegación
  }
}
