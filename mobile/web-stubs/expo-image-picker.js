// Sustituto web de expo-image-picker (SOLO VISTA PREVIA).
//  - Galería: selector de fotos del visor (fotos de ejemplo del proyecto o archivos del ordenador).
//  - Cámara: permiso de cámara con el diálogo del sistema simulado y la hoja de cámara del visor
//    (foto de ejemplo marcada como tal, o una foto elegida en el ordenador).
import { codedError, expoPermission, permissionStatus, previewShell, requestPermission, usePermissionHook } from './_preview-system';

export const MediaTypeOptions = { All: 'All', Images: 'Images', Videos: 'Videos' };
export const UIImagePickerPresentationStyle = { FULL_SCREEN: 'fullScreen', PAGE_SHEET: 'pageSheet', FORM_SHEET: 'formSheet', CURRENT_CONTEXT: 'currentContext', OVER_FULL_SCREEN: 'overFullScreen', OVER_CURRENT_CONTEXT: 'overCurrentContext', POPOVER: 'popover', AUTOMATIC: 'automatic' };
export const CameraType = { front: 'front', back: 'back' };
export const VideoQuality = { '2160p': 'high', '1080p': 'high', '720p': 'medium', '540p': 'medium', '480p': 'low', '360p': 'low' };
export const UIImagePickerControllerQualityType = { High: 0, Medium: 1, Low: 2, VGA640x480: 3, IFrame1280x720: 4, IFrame960x540: 5 };
export const VideoExportPreset = { Passthrough: 0, LowQuality: 1, MediumQuality: 2, HighestQuality: 3 };
export const PermissionStatus = { GRANTED: 'granted', UNDETERMINED: 'undetermined', DENIED: 'denied' };

function wantsVideo(opts) {
  const t = opts && opts.mediaTypes;
  if (Array.isArray(t)) return t.includes('videos');
  return t === 'All' || t === 'Videos' || t === 'videos';
}

function toAsset(f) {
  const isVideo = /^video\//.test(f.mimeType || '');
  return {
    uri: f.uri,
    assetId: null,
    fileName: f.name || null,
    fileSize: f.size == null ? null : f.size,
    mimeType: f.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
    type: isVideo ? 'video' : 'image',
    width: f.width || 0,
    height: f.height || 0,
    duration: null,
    exif: null,
    base64: null,
  };
}

export async function getMediaLibraryPermissionsAsync() {
  const st = permissionStatus('photos');
  return expoPermission(st, { accessPrivileges: st === 'granted' ? 'all' : 'none' });
}
export async function requestMediaLibraryPermissionsAsync() {
  const st = await requestPermission('photos');
  return expoPermission(st, { accessPrivileges: st === 'granted' ? 'all' : 'none' });
}
export async function getCameraPermissionsAsync() {
  return expoPermission(permissionStatus('camera'));
}
export async function requestCameraPermissionsAsync() {
  return expoPermission(await requestPermission('camera'));
}
export function useCameraPermissions() {
  return usePermissionHook('camera');
}
export function useMediaLibraryPermissions() {
  return usePermissionHook('photos', (st) => ({ accessPrivileges: st === 'granted' ? 'all' : 'none' }));
}

export async function launchImageLibraryAsync(opts) {
  const options = opts || {};
  const shell = previewShell();
  if (!shell || typeof shell.pickImages !== 'function') return { canceled: true, assets: null };
  // Como en iOS 14+, el selector del sistema no exige permiso de Fotos para elegir imágenes.
  const files = await shell.pickImages({ multiple: !!options.allowsMultipleSelection, limit: options.selectionLimit || undefined, video: wantsVideo(options) });
  if (!files.length) return { canceled: true, assets: null };
  return { canceled: false, assets: files.map(toAsset) };
}

export async function launchCameraAsync(opts) {
  const options = opts || {};
  const st = await requestPermission('camera');
  if (st !== 'granted') throw codedError('ERR_MISSING_CAMERA_PERMISSION', 'Falta el permiso de cámara.');
  const shell = previewShell();
  if (!shell || typeof shell.cameraCapture !== 'function') return { canceled: true, assets: null };
  const shot = await shell.cameraCapture({ video: wantsVideo(options), facing: options.cameraType === 'front' ? 'user' : 'environment' });
  if (!shot) return { canceled: true, assets: null };
  return { canceled: false, assets: [toAsset(shot)] };
}

export async function getPendingResultAsync() {
  return null;
}
