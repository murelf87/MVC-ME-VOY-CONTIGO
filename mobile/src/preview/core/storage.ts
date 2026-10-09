/**
 * Almacén de objetos PRIVADO simulado (equivale al bucket S3 privado del backend real).
 *
 * Las URL firmadas apuntan al origen reservado `https://storage.mvc-preview.invalid/<clave>?sig=…&exp=…`, que el
 * interceptor de `fetch` atiende. Los bytes se conservan solo en memoria de esta pestaña (no se persisten en
 * `sessionStorage`): tras recargar queda la metadata, no el contenido. El OCR del seguro está DESACTIVADO, igual
 * que en el backend real sin proveedor (`INSURANCE_OCR_PROVIDER=disabled`).
 */

export const STORAGE_HOST = "storage.mvc-preview.invalid";
export const STORAGE_PROVIDER_NAME = "preview-sim";

export interface StoredBlob {
  key: string;
  sizeBytes: number;
  contentType: string;
  /** `null` si el objeto existe pero sus bytes no se conservan (sembrado o recarga de página). */
  bytes: Uint8Array | null;
  uploadedAt: number;
}

export interface StoredBlobMeta {
  key: string;
  sizeBytes: number;
  contentType: string;
  uploadedAt: number;
}

export class BlobStore {
  private readonly objects = new Map<string, StoredBlob>();

  put(key: string, bytes: Uint8Array, contentType: string, uploadedAt: number): StoredBlob {
    const blob: StoredBlob = { key, sizeBytes: bytes.byteLength, contentType, bytes, uploadedAt };
    this.objects.set(key, blob);
    return blob;
  }

  /** Registra un objeto sin bytes (datos sembrados). */
  putMetadataOnly(meta: StoredBlobMeta): void {
    this.objects.set(meta.key, { ...meta, bytes: null });
  }

  get(key: string): StoredBlob | undefined {
    return this.objects.get(key);
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  delete(key: string): boolean {
    return this.objects.delete(key);
  }

  clear(): void {
    this.objects.clear();
  }

  metadata(): StoredBlobMeta[] {
    return [...this.objects.values()].map(({ key, sizeBytes, contentType, uploadedAt }) => ({
      key,
      sizeBytes,
      contentType,
      uploadedAt,
    }));
  }

  restoreMetadata(list: readonly StoredBlobMeta[]): void {
    this.objects.clear();
    for (const meta of list) this.putMetadataOnly(meta);
  }
}

export function signedUrl(kind: "upload" | "download", key: string, expiresAtMs: number): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `https://${STORAGE_HOST}/${path}?op=${kind}&sig=preview-simulation&exp=${Math.floor(expiresAtMs / 1000)}`;
}

/** Clave de objeto a partir de la ruta de una URL de almacenamiento simulado. */
export function keyFromPath(pathname: string): string {
  return pathname
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join("/");
}

/** SVG de marcador para documentos sembrados que no tienen bytes reales. */
export function placeholderObject(key: string): { contentType: string; body: string } {
  const label = key.split("/").slice(-1)[0] ?? "documento";
  const safe = label.replace(/[<>&"']/g, "");
  return {
    contentType: "image/svg+xml",
    body:
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">` +
      `<rect width="640" height="400" fill="#EEF3FA"/>` +
      `<rect x="24" y="24" width="592" height="352" rx="16" fill="none" stroke="#1B3A6B" stroke-width="3" stroke-dasharray="10 8"/>` +
      `<text x="320" y="180" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#1B3A6B">Documento de ejemplo</text>` +
      `<text x="320" y="220" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#5B6B85">Simulación de la vista previa · ${safe}</text>` +
      `</svg>`,
  };
}
