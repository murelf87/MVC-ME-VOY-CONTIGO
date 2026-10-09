// Sustituto web de expo-notifications (SOLO VISTA PREVIA).
//  - Permiso: diálogo del sistema simulado del visor.
//  - Notificaciones LOCALES (inmediatas o programadas): se muestran como banner del sistema dentro del móvil simulado y
//    respetan setNotificationHandler. Al pulsar el banner se entrega la respuesta a los listeners, como haría el sistema.
//  - NO hay push remoto en un navegador: getExpoPushTokenAsync / getDevicePushTokenAsync fallan de forma explícita y la
//    app no debe registrar ningún token. Nada sale del navegador.
import { codedError, expoPermission, onShellEvent, permissionStatus, previewShell, requestPermission } from './_preview-system';

export const AndroidImportance = { UNKNOWN: 0, UNSPECIFIED: -1000, NONE: 0, MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 };
export const AndroidNotificationVisibility = { UNKNOWN: 0, PUBLIC: 1, PRIVATE: 0, SECRET: -1 };
export const AndroidNotificationPriority = { MIN: 'min', LOW: 'low', DEFAULT: 'default', HIGH: 'high', MAX: 'max' };
export const AndroidAudioUsage = { UNKNOWN: 0, MEDIA: 1, NOTIFICATION: 5, ALARM: 4 };
export const AndroidAudioContentType = { UNKNOWN: 0, SPEECH: 1, MUSIC: 2, MOVIE: 3, SONIFICATION: 4 };
export const IosAuthorizationStatus = { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 };
export const PermissionStatus = { GRANTED: 'granted', UNDETERMINED: 'undetermined', DENIED: 'denied' };
export const SchedulableTriggerInputTypes = { CALENDAR: 'calendar', DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly', DATE: 'date', TIME_INTERVAL: 'timeInterval' };
export const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';
export const BackgroundNotificationTaskResult = { NoData: 1, NewData: 2, Failed: 3 };

const MAX_TIMEOUT_MS = 2147483647;
let handler = null;
let badge = 0;
const responseListeners = new Set();
const receivedListeners = new Set();
const presented = new Map();
const scheduled = new Map(); // id → { request, timer, fireAt }
let lastResponse = null;
let wired = false;

function newId() {
  return `pv-notif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function permissionResponse(raw) {
  const st = raw === 'granted' ? 'granted' : raw === 'undetermined' ? 'undetermined' : 'denied';
  return Object.assign(expoPermission(raw), {
    status: st,
    ios: { status: st === 'granted' ? IosAuthorizationStatus.AUTHORIZED : st === 'denied' ? IosAuthorizationStatus.DENIED : IosAuthorizationStatus.NOT_DETERMINED, allowsAlert: st === 'granted', allowsBadge: st === 'granted', allowsSound: st === 'granted', allowsCriticalAlerts: false },
    android: { importance: st === 'granted' ? AndroidImportance.DEFAULT : AndroidImportance.NONE },
  });
}

export async function getPermissionsAsync() {
  return permissionResponse(permissionStatus('notifications'));
}
export async function requestPermissionsAsync() {
  return permissionResponse(await requestPermission('notifications'));
}
export function setNotificationHandler(h) {
  handler = h || null;
}

function wire() {
  if (wired) return;
  wired = true;
  onShellEvent('mvc:preview-notification-response', (d) => {
    const id = d && d.id;
    const notification = (id && presented.get(id)) || { date: Date.now(), request: { identifier: id || newId(), content: { title: null, body: null, data: (d && d.data) || {} }, trigger: null } };
    const response = { notification, actionIdentifier: DEFAULT_ACTION_IDENTIFIER };
    lastResponse = response;
    responseListeners.forEach((l) => {
      try {
        l(response);
      } catch (e) {
        // sigue con el resto
      }
    });
  });
}

async function present(request) {
  if (permissionStatus('notifications') !== 'granted') return;
  const notification = { date: Date.now(), request };
  receivedListeners.forEach((l) => {
    try {
      l(notification);
    } catch (e) {
      // sigue con el resto
    }
  });
  let behavior = { shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
  if (handler && typeof handler.handleNotification === 'function') {
    try {
      behavior = Object.assign(behavior, await handler.handleNotification(notification));
    } catch (e) {
      // sin manejador válido: comportamiento por defecto
    }
  }
  presented.set(request.identifier, notification);
  const show = behavior.shouldShowBanner !== undefined ? behavior.shouldShowBanner : behavior.shouldShowAlert;
  if (behavior.shouldSetBadge && typeof request.content.badge === 'number') badge = request.content.badge;
  if (!show) return;
  const content = request.content || {};
  const shell = previewShell();
  if (shell && typeof shell.notify === 'function') {
    shell.notify({ app: 'MVC', title: String(content.title || 'MVC'), body: String(content.body || ''), tone: content.data && content.data.tone, data: content.data, id: request.identifier });
  }
}

export async function scheduleNotificationAsync(input) {
  wire();
  const content = (input && input.content) || {};
  const trigger = (input && input.trigger) || null;
  const id = (input && input.identifier) || newId();
  const request = { identifier: id, content: Object.assign({ title: null, subtitle: null, body: null, data: {}, sound: null }, content), trigger };
  let delay = 0;
  if (trigger) {
    if (trigger.date || trigger.type === 'date') {
      const d = trigger.date instanceof Date ? trigger.date.getTime() : Number(trigger.date);
      delay = Math.max(0, d - Date.now());
    } else if (trigger.seconds != null) {
      delay = Math.max(0, Number(trigger.seconds) * 1000);
    } else {
      throw codedError('ERR_NOTIFICATIONS_TRIGGER_UNSUPPORTED', 'La vista previa solo admite avisos inmediatos, por intervalo o con fecha.');
    }
  }
  if (delay > MAX_TIMEOUT_MS) throw codedError('ERR_NOTIFICATIONS_TRIGGER_TOO_FAR', 'El aviso está demasiado lejos para la vista previa.');
  if (delay === 0) {
    await present(request);
    return id;
  }
  const timer = setTimeout(() => {
    scheduled.delete(id);
    void present(request);
  }, delay);
  scheduled.set(id, { request, timer, fireAt: Date.now() + delay });
  return id;
}
export async function getAllScheduledNotificationsAsync() {
  return [...scheduled.values()].map((s) => s.request);
}
export async function cancelScheduledNotificationAsync(id) {
  const s = scheduled.get(id);
  if (s) clearTimeout(s.timer);
  scheduled.delete(id);
}
export async function cancelAllScheduledNotificationsAsync() {
  scheduled.forEach((s) => clearTimeout(s.timer));
  scheduled.clear();
}
export async function getNextTriggerDateAsync(trigger) {
  if (trigger && trigger.seconds != null) return Date.now() + trigger.seconds * 1000;
  return null;
}
export async function getPresentedNotificationsAsync() {
  return [...presented.values()];
}
export async function dismissNotificationAsync(id) {
  presented.delete(id);
}
export async function dismissAllNotificationsAsync() {
  presented.clear();
}

export function addNotificationReceivedListener(listener) {
  receivedListeners.add(listener);
  return { remove: () => receivedListeners.delete(listener) };
}
export function addNotificationResponseReceivedListener(listener) {
  wire();
  responseListeners.add(listener);
  return { remove: () => responseListeners.delete(listener) };
}
export function addNotificationsDroppedListener() {
  return { remove() {} };
}
export function addPushTokenListener() {
  return { remove() {} };
}
export function removeNotificationSubscription(sub) {
  if (sub && typeof sub.remove === 'function') sub.remove();
}
export function useLastNotificationResponse() {
  return lastResponse;
}
export async function getLastNotificationResponseAsync() {
  return lastResponse;
}
export function clearLastNotificationResponse() {
  lastResponse = null;
}

// Push remoto: no existe en un navegador. Se dice claramente.
const noPush = () => {
  throw codedError('ERR_NOTIFICATIONS_PUSH_UNAVAILABLE', 'Las notificaciones push remotas no están disponibles en la vista previa del navegador.');
};
export async function getExpoPushTokenAsync() {
  noPush();
}
export async function getDevicePushTokenAsync() {
  noPush();
}
export async function unregisterForNotificationsAsync() {}
export async function setAutoServerRegistrationEnabledAsync() {}
export async function subscribeToTopicAsync() {
  noPush();
}
export async function unsubscribeFromTopicAsync() {}
export async function registerTaskAsync() {}
export async function unregisterTaskAsync() {}

// Insignia, canales y categorías: sin efecto en un navegador (se recuerdan para que las lecturas sean coherentes).
export async function getBadgeCountAsync() {
  return badge;
}
export async function setBadgeCountAsync(n) {
  badge = Number(n) || 0;
  return true;
}
const channels = new Map();
const channelGroups = new Map();
export async function setNotificationChannelAsync(id, channel) {
  const c = Object.assign({ id, name: id, importance: AndroidImportance.DEFAULT }, channel || {});
  channels.set(id, c);
  return c;
}
export async function getNotificationChannelAsync(id) {
  return channels.get(id) || null;
}
export async function getNotificationChannelsAsync() {
  return [...channels.values()];
}
export async function deleteNotificationChannelAsync(id) {
  channels.delete(id);
}
export async function setNotificationChannelGroupAsync(id, group) {
  const g = Object.assign({ id, name: id, channels: [] }, group || {});
  channelGroups.set(id, g);
  return g;
}
export async function getNotificationChannelGroupAsync(id) {
  return channelGroups.get(id) || null;
}
export async function getNotificationChannelGroupsAsync() {
  return [...channelGroups.values()];
}
export async function deleteNotificationChannelGroupAsync(id) {
  channelGroups.delete(id);
}
export async function getNotificationCategoriesAsync() {
  return [];
}
export async function setNotificationCategoryAsync(id) {
  return { identifier: id, actions: [], options: {} };
}
export async function deleteNotificationCategoryAsync() {
  return true;
}
