/**
 * Notificaciones: permiso, registro del token push de Expo y toques sobre un aviso.
 *
 * ESTADO: el envío de push está DESACTIVADO en el servidor (`PUSH_PROVIDER=disabled`, ver docs/contracts/comms.md).
 * Aun así la app pide el permiso, obtiene el token y lo ofrece a `registerPushToken` del slice `messages`,
 * que lo enviará a `POST /v1/me/push-tokens` cuando el backend lo acepte. Sin `projectId` de EAS (decisión pendiente
 * del titular) no hay token: `registerForPushToken()` lo dice con `unavailable / no_project_id`.
 */
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { guardPermission, type PermissionResult } from "./permissions";

export function getNotificationPermission(): Promise<PermissionResult> {
  return guardPermission(() => Notifications.getPermissionsAsync());
}

/** En Android 13+ exige crear antes el canal; se hace aquí. */
export async function requestNotificationPermission(): Promise<PermissionResult> {
  await ensureAndroidChannel();
  return guardPermission(() => Notifications.requestPermissionsAsync());
}

const ANDROID_CHANNEL_ID = "default";

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Avisos de MVC",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch {
    // sin canal propio Android usa el canal por defecto de Expo
  }
}

let foregroundConfigured = false;

/** Cómo se muestran los avisos con la app abierta: banner y lista, sin sonido ni cifra en el icono. Idempotente. */
export function configureForegroundNotifications(): void {
  if (foregroundConfigured) return;
  foregroundConfigured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    foregroundConfigured = false;
  }
}

export type PushTokenResult =
  | { status: "registered"; token: string; provider: "expo" }
  | { status: "permission_denied" | "permission_blocked" }
  | { status: "unavailable"; reason: "no_project_id" | "web" | "error" };

function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const fromExtra = extra?.eas?.projectId;
  if (typeof fromExtra === "string" && fromExtra) return fromExtra;
  const fromEas = (Constants as { easConfig?: { projectId?: unknown } }).easConfig?.projectId;
  return typeof fromEas === "string" && fromEas ? fromEas : null;
}

/**
 * Obtiene el token push de Expo si hay permiso. NO pide el permiso (eso lo decide la pantalla de «Notificaciones»):
 * si falta, devuelve `permission_denied` / `permission_blocked`.
 */
export async function registerForPushToken(): Promise<PushTokenResult> {
  if (Platform.OS === "web") return { status: "unavailable", reason: "web" };
  const permission = await getNotificationPermission();
  if (permission.status === "unavailable") return { status: "unavailable", reason: "error" };
  if (permission.status !== "granted") {
    return { status: permission.status === "blocked" ? "permission_blocked" : "permission_denied" };
  }
  const projectId = easProjectId();
  if (!projectId) return { status: "unavailable", reason: "no_project_id" };
  try {
    await ensureAndroidChannel();
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { status: "registered", token: data, provider: "expo" };
  } catch {
    return { status: "unavailable", reason: "error" };
  }
}

export interface NotificationTap {
  /** Identificador del aviso en el dispositivo (no el de la tabla `notifications`). */
  id: string | null;
  /** `data` del aviso: `{ tripId?, bookingId?, requestId?, conversationId?, … }`. */
  data: Record<string, unknown>;
}

function toTap(response: Notifications.NotificationResponse | null): NotificationTap | null {
  if (!response) return null;
  const content = response.notification.request.content;
  const data = content.data && typeof content.data === "object" ? (content.data as Record<string, unknown>) : {};
  return { id: response.notification.request.identifier ?? null, data };
}

/** Se llama cuando la persona toca un aviso con la app abierta o en segundo plano. */
export function onNotificationTap(listener: (tap: NotificationTap) => void): () => void {
  try {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const tap = toTap(response);
      if (tap) listener(tap);
    });
    return () => subscription.remove();
  } catch {
    return () => undefined;
  }
}

/** El aviso que abrió la app desde cero (arranque en frío), si lo hubo. */
export async function getLaunchNotificationTap(): Promise<NotificationTap | null> {
  try {
    const tap = toTap(await Notifications.getLastNotificationResponseAsync());
    // Si no se limpia, el mismo aviso volvería a abrir la pantalla en cada arranque en frío posterior.
    if (tap) Notifications.clearLastNotificationResponse();
    return tap;
  } catch {
    return null;
  }
}
