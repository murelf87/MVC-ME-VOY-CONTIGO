/**
 * Fotos de una incidencia: elegir (cámara o galería), comprobar formato y tamaño en el móvil y subir a almacenamiento
 * privado por URL firmada (intención → PUT → completar). Nunca lanza: cada resultado es explícito.
 */
import { useCallback, useState } from "react";
import { putToSignedUrl } from "@/api";
import type { LiveIncidentAttachmentIntentBody } from "@/api/types";
import { guessImageMime, pickPhotoFromLibrary, takePhoto } from "@/platform";
import { completeIncidentAttachment, createIncidentAttachmentIntent } from "../api";
import { liveKeys } from "./keys";
import { queryCache } from "@/hooks";

export const MAX_INCIDENT_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

export interface LocalPhoto {
  key: string;
  uri: string;
  contentType: LiveIncidentAttachmentIntentBody["contentType"];
  sizeBytes: number;
}

export type PhotoSource = "camera" | "library";
export type PhotoPick = { status: "picked"; photo: LocalPhoto } | { status: "cancelled" | "denied" | "blocked" | "unavailable" } | { status: "invalid"; reason: "type" | "size" };

let counter = 0;

export async function pickIncidentPhoto(source: PhotoSource): Promise<PhotoPick> {
  const result = source === "camera" ? await takePhoto() : await pickPhotoFromLibrary();
  switch (result.status) {
    case "cancelled":
      return { status: "cancelled" };
    case "permission_denied":
      return { status: "denied" };
    case "permission_blocked":
      return { status: "blocked" };
    case "unavailable":
      return { status: "unavailable" };
    case "picked": {
      const contentType = (result.image.mimeType || guessImageMime(result.image.fileName ?? result.image.uri)).toLowerCase();
      if (!(ALLOWED as readonly string[]).includes(contentType)) return { status: "invalid", reason: "type" };
      const size = result.image.sizeBytes ?? 0;
      if (size > MAX_PHOTO_BYTES || size <= 0) return { status: "invalid", reason: "size" };
      counter += 1;
      return { status: "picked", photo: { key: `photo-${counter}`, uri: result.image.uri, contentType: contentType as LocalPhoto["contentType"], sizeBytes: size } };
    }
  }
}

export type UploadOutcome = { ok: true } | { ok: false; error: Error };

/** Sube UNA foto a la incidencia `reportId`. */
export async function uploadIncidentPhoto(reportId: string, photo: LocalPhoto): Promise<UploadOutcome> {
  try {
    const intent = await createIncidentAttachmentIntent(reportId, { contentType: photo.contentType, sizeBytes: photo.sizeBytes });
    await putToSignedUrl({ uploadUrl: intent.uploadUrl, headers: intent.headers }, { uri: photo.uri, contentType: photo.contentType });
    await completeIncidentAttachment(reportId, intent.attachmentId);
    void queryCache.invalidate(liveKeys.incident(reportId));
    void queryCache.invalidate(liveKeys.incidents);
    return { ok: true };
  } catch (raised) {
    return { ok: false, error: raised instanceof Error ? raised : new Error(String(raised)) };
  }
}

export interface IncidentPhotos {
  photos: LocalPhoto[];
  add(photo: LocalPhoto): void;
  remove(key: string): void;
  clear(): void;
}

/** Lista local de fotos elegidas (aún sin subir) en el formulario. */
export function useIncidentPhotos(): IncidentPhotos {
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const add = useCallback((photo: LocalPhoto) => setPhotos((current) => (current.length >= MAX_INCIDENT_PHOTOS ? current : [...current, photo])), []);
  const remove = useCallback((key: string) => setPhotos((current) => current.filter((p) => p.key !== key)), []);
  const clear = useCallback(() => setPhotos([]), []);
  return { photos, add, remove, clear };
}
