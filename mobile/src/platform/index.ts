/**
 * Servicios de plataforma con permisos explícitos. Importa desde `@/platform`.
 *
 * Todas las funciones devuelven uniones explícitas y NO lanzan. Estados de permiso:
 * `granted | denied | blocked | unavailable` (ver `permissions.ts`).
 */
export { copyToClipboard, readClipboard } from "./clipboard";
export { DEVICE_ID_KEY, getDeviceId } from "./deviceId";
export { captureSelfie, getCameraPermission, guessImageMime, pickPhotoFromLibrary, requestCameraPermission, takePhoto } from "./camera";
export type { ImagePickFailure, ImagePickResult, PickedImage, TakePhotoOptions } from "./camera";
export { pickDocument } from "./documents";
export type { DocumentPickResult, PickDocumentOptions, PickedDocument } from "./documents";
export {
  hapticError,
  hapticImpact,
  hapticSelection,
  hapticSuccess,
  hapticWarning,
  setHapticsEnabled,
} from "./haptics";
export { allowScreenSleep, keepScreenAwake, useKeepScreenAwake } from "./keepAwake";
export { callPhone, openAppSettings, openEmail, openMapsAt, openMapsDirections, openWebPage, sendSms } from "./linking";
export type { OpenResult } from "./linking";
export { buildDirectionsUrl, buildMapsUrl, isSafeExternalUrl, normalizePhoneForDialing } from "./linkBuilders";
export type { MapsTarget } from "./linkBuilders";
export {
  getCurrentPosition,
  getLastKnownPosition,
  getLocationPermission,
  requestLocationPermission,
  watchPosition,
} from "./location";
export type {
  CurrentPositionOptions,
  DevicePosition,
  LocationFailure,
  PositionResult,
  PositionWatch,
  WatchPositionOptions,
  WatchResult,
} from "./location";
export { distanceMeters } from "./locationMath";
export {
  configureForegroundNotifications,
  getLaunchNotificationTap,
  getNotificationPermission,
  onNotificationTap,
  registerForPushToken,
  requestNotificationPermission,
} from "./notifications";
export type { NotificationTap, PushTokenResult } from "./notifications";
export { canRequest, isGranted, needsSettings } from "./permissions";
export type { PermissionResult, PermissionStatus } from "./permissions";
export {
  IS_PREVIEW_BUILD,
  getPreviewSafeAreaMetrics,
  getPreviewShell,
  reportPreviewScreen,
  resolveDevicePlatform,
} from "./previewBridge";
export { shareContent } from "./share";
export type { ShareOutcome, SharePayload } from "./share";
export { getJson, preferences, secureStorage, setJson } from "./storage";
export type { KeyValueStore } from "./storage";
