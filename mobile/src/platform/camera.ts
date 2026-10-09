/**
 * Cámara y fotos: hacer una foto, elegir de la galería, selfie con la cámara frontal.
 *
 * Todo devuelve uniones explícitas (`picked | cancelled | permission_denied | permission_blocked | unavailable`) y
 * nunca lanza. La galería NO necesita permiso (selector del sistema: PHPicker en iOS, Photo Picker en Android).
 * Para pantallas con visor propio (`CameraView` de expo-camera) usa `getCameraPermission/requestCameraPermission`.
 */
import { Camera } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { guessImageMime } from "./imageMime";
import { guardPermission, isGranted, type PermissionResult } from "./permissions";

export { guessImageMime } from "./imageMime";

export interface PickedImage {
  /** `file://`, `content://`, `data:` o `blob:`: legible con `fetch(uri)`. */
  uri: string;
  mimeType: string;
  /** Tamaño en bytes; `null` si no se pudo averiguar. */
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  fileName: string | null;
}

export type ImagePickFailure = "permission_denied" | "permission_blocked" | "unavailable";
export type ImagePickResult =
  | { status: "picked"; image: PickedImage }
  | { status: "cancelled" }
  | { status: ImagePickFailure };

export function getCameraPermission(): Promise<PermissionResult> {
  return guardPermission(() => Camera.getCameraPermissionsAsync());
}

export function requestCameraPermission(): Promise<PermissionResult> {
  return guardPermission(() => Camera.requestCameraPermissionsAsync());
}

async function measureSize(uri: string): Promise<number | null> {
  try {
    const response = await fetch(uri);
    return (await response.blob()).size;
  } catch {
    return null;
  }
}

async function toPickedImage(asset: ImagePicker.ImagePickerAsset): Promise<PickedImage> {
  const sizeBytes = typeof asset.fileSize === "number" ? asset.fileSize : await measureSize(asset.uri);
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? guessImageMime(asset.fileName ?? asset.uri),
    sizeBytes,
    width: asset.width || null,
    height: asset.height || null,
    fileName: asset.fileName ?? null,
  };
}

export interface TakePhotoOptions {
  /** Cámara frontal (selfie). Por defecto la trasera. */
  facing?: "front" | "back";
  /** 0–1. Por defecto 0,8. */
  quality?: number;
}

/** Abre la cámara del sistema y devuelve la foto. Pide el permiso de cámara si todavía se puede. */
export async function takePhoto(options: TakePhotoOptions = {}): Promise<ImagePickResult> {
  const { facing = "back", quality = 0.8 } = options;
  try {
    let permission = await guardPermission(() => ImagePicker.getCameraPermissionsAsync());
    if (!isGranted(permission) && permission.status !== "unavailable" && permission.canAskAgain) {
      permission = await guardPermission(() => ImagePicker.requestCameraPermissionsAsync());
    }
    if (!isGranted(permission)) {
      return { status: permission.status === "blocked" ? "permission_blocked" : permission.status === "unavailable" ? "unavailable" : "permission_denied" };
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      cameraType: facing === "front" ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
      allowsEditing: false,
      quality,
      exif: false,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    return asset ? { status: "picked", image: await toPickedImage(asset) } : { status: "cancelled" };
  } catch {
    return { status: "unavailable" };
  }
}

/** Selfie con la cámara frontal. NO acredita identidad (regla de producto): solo es una foto. */
export function captureSelfie(options: Pick<TakePhotoOptions, "quality"> = {}): Promise<ImagePickResult> {
  return takePhoto({ ...options, facing: "front" });
}

/** Elige una foto de la galería con el selector del sistema (sin permiso de Fotos). */
export async function pickPhotoFromLibrary(options: { quality?: number } = {}): Promise<ImagePickResult> {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      allowsEditing: false,
      quality: options.quality ?? 0.8,
      exif: false,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    return asset ? { status: "picked", image: await toPickedImage(asset) } : { status: "cancelled" };
  } catch {
    return { status: "unavailable" };
  }
}
