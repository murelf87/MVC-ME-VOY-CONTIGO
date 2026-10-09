/** Tipo MIME de una imagen según la extensión del nombre o la URI (puro, sin módulos nativos). */

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
};

/** Deduce el tipo MIME de una imagen por la extensión de su nombre o URI. Por defecto `image/jpeg`. */
export function guessImageMime(nameOrUri: string | null | undefined): string {
  const clean = (nameOrUri ?? "").split(/[?#]/)[0] ?? "";
  const dot = clean.lastIndexOf(".");
  const extension = dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
  return MIME_BY_EXTENSION[extension] ?? "image/jpeg";
}
