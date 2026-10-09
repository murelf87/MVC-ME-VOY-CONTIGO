/** Selector de documentos del sistema («Archivos»). No lanza. */
import * as DocumentPicker from "expo-document-picker";

export interface PickedDocument {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
}

export type DocumentPickResult =
  | { status: "picked"; document: PickedDocument }
  | { status: "cancelled" }
  | { status: "too_large"; maxBytes: number }
  | { status: "unavailable" };

export interface PickDocumentOptions {
  /** Tipos MIME aceptados. Por defecto PDF e imágenes. */
  types?: string[];
  /** Tamaño máximo en bytes; si se supera, `too_large` (el archivo no se devuelve). */
  maxBytes?: number;
}

const DEFAULT_TYPES = ["application/pdf", "image/*"];

export async function pickDocument(options: PickDocumentOptions = {}): Promise<DocumentPickResult> {
  const { types = DEFAULT_TYPES, maxBytes } = options;
  try {
    const result = await DocumentPicker.getDocumentAsync({ type: types, multiple: false, copyToCacheDirectory: true });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return { status: "cancelled" };
    if (maxBytes !== undefined && typeof asset.size === "number" && asset.size > maxBytes) return { status: "too_large", maxBytes };
    return {
      status: "picked",
      document: {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? "application/octet-stream",
        sizeBytes: typeof asset.size === "number" ? asset.size : null,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}
