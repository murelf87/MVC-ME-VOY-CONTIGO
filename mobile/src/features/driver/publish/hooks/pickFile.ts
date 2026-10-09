/**
 * Elegir el archivo que se va a subir (cámara, galería o «Archivos») y comprobarlo antes de enviarlo. No lanza: devuelve
 * una unión explícita para que la pantalla explique cada caso (permiso denegado, bloqueado, formato, tamaño…).
 */
import { guessImageMime, pickDocument, pickPhotoFromLibrary, takePhoto } from "@/platform";
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES, checkUpload, type UploadKind } from "../logic/documents";
import type { LocalFile } from "../types";

export type FileSource = "camera" | "library" | "files";

export type PickOutcome =
  | { status: "picked"; file: LocalFile }
  | { status: "cancelled" }
  | { status: "denied" }
  | { status: "blocked" }
  | { status: "unavailable" }
  | { status: "invalid"; reason: "type" | "size" | "unreadable" };

function validated(kind: UploadKind, uri: string, contentType: string, sizeBytes: number | null): PickOutcome {
  const check = checkUpload(kind, { contentType, sizeBytes });
  if (!check.ok) return { status: "invalid", reason: check.reason };
  return { status: "picked", file: { uri, contentType: contentType.toLowerCase(), sizeBytes: sizeBytes as number } };
}

/** Hace una foto, elige una de la galería o un archivo (PDF o foto) según `source`. */
export async function pickFile(kind: UploadKind, source: FileSource): Promise<PickOutcome> {
  if (source === "files") {
    const result = await pickDocument({ types: [...ALLOWED_TYPES[kind]], maxBytes: MAX_UPLOAD_BYTES });
    if (result.status === "cancelled") return { status: "cancelled" };
    if (result.status === "unavailable") return { status: "unavailable" };
    if (result.status === "too_large") return { status: "invalid", reason: "size" };
    const { document } = result;
    return validated(kind, document.uri, document.mimeType, document.sizeBytes);
  }
  const result = source === "camera" ? await takePhoto() : await pickPhotoFromLibrary();
  switch (result.status) {
    case "picked":
      return validated(kind, result.image.uri, result.image.mimeType || guessImageMime(result.image.fileName ?? result.image.uri), result.image.sizeBytes);
    case "cancelled":
      return { status: "cancelled" };
    case "permission_denied":
      return { status: "denied" };
    case "permission_blocked":
      return { status: "blocked" };
    case "unavailable":
      return { status: "unavailable" };
  }
}
