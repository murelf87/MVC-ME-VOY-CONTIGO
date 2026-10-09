import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage, isAbortError, isApiErrorWithCode } from "@/api";
import type { SupportAttachmentContentType } from "@/api/types";
import type { PickedImage } from "@/platform";
import { uploadSupportImage } from "../api";
import { MAX_ATTACHMENTS, checkImage } from "../logic/support";

export type DraftAttachmentStatus = "uploading" | "uploaded" | "failed";

/** Imagen que la persona está adjuntando a una consulta o respuesta (subida privada en curso o terminada). */
export interface DraftAttachment {
  localId: string;
  uri: string;
  contentType: SupportAttachmentContentType;
  sizeBytes: number;
  status: DraftAttachmentStatus;
  /** Id del adjunto ya completado en el servidor (para `attachmentIds`). */
  attachmentId: string | null;
  error: string | null;
}

export type AddAttachmentResult = { ok: true } | { ok: false; reason: "limit" | "type" | "size" };

export interface UseSupportAttachmentsResult {
  items: DraftAttachment[];
  /** Ids de los adjuntos ya subidos, en orden. */
  attachmentIds: string[];
  uploadingCount: number;
  failedCount: number;
  canAdd: boolean;
  /** El servidor no admite adjuntos (almacenamiento privado desactivado): se ofrece enviar solo con texto. */
  storageUnavailable: boolean;
  add(image: PickedImage): AddAttachmentResult;
  remove(localId: string): void;
  retry(localId: string): void;
  reset(): void;
}

let localCounter = 0;
function nextLocalId(): string {
  localCounter += 1;
  return `draft-${localCounter}`;
}

/**
 * Adjuntos de una consulta: valida tipo y tamaño en el móvil, sube cada imagen a almacenamiento privado (intención →
 * PUT firmado → completar) y lleva la cuenta de las que están listas. Cancela las subidas al desmontar.
 */
export function useSupportAttachments(max: number = MAX_ATTACHMENTS): UseSupportAttachmentsResult {
  const [items, setItems] = useState<DraftAttachment[]>([]);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const live = controllers.current;
    return () => {
      mounted.current = false;
      for (const controller of live.values()) controller.abort();
      live.clear();
    };
  }, []);

  const patch = useCallback((localId: string, change: Partial<DraftAttachment>) => {
    if (!mounted.current) return;
    setItems((current) => current.map((item) => (item.localId === localId ? { ...item, ...change } : item)));
  }, []);

  const startUpload = useCallback(
    (item: DraftAttachment) => {
      const controller = new AbortController();
      controllers.current.set(item.localId, controller);
      patch(item.localId, { status: "uploading", error: null });
      uploadSupportImage({ uri: item.uri, contentType: item.contentType, sizeBytes: item.sizeBytes }, { signal: controller.signal })
        .then((attachment) => patch(item.localId, { status: "uploaded", attachmentId: attachment.id, error: null }))
        .catch((error: unknown) => {
          if (isAbortError(error)) return;
          if (isApiErrorWithCode(error, "PRIVATE_STORAGE_NOT_CONFIGURED")) {
            if (!mounted.current) return;
            setStorageUnavailable(true);
            setItems((current) => current.filter((other) => other.localId !== item.localId));
            return;
          }
          patch(item.localId, { status: "failed", error: errorMessage(error) });
        })
        .finally(() => {
          controllers.current.delete(item.localId);
        });
    },
    [patch],
  );

  const add = useCallback(
    (image: PickedImage): AddAttachmentResult => {
      if (items.length >= max) return { ok: false, reason: "limit" };
      const check = checkImage(image.mimeType, image.sizeBytes);
      if (!check.ok) return { ok: false, reason: check.reason };
      const item: DraftAttachment = {
        localId: nextLocalId(),
        uri: image.uri,
        contentType: check.contentType,
        sizeBytes: image.sizeBytes ?? 0,
        status: "uploading",
        attachmentId: null,
        error: null,
      };
      setItems((current) => [...current, item]);
      startUpload(item);
      return { ok: true };
    },
    [items.length, max, startUpload],
  );

  const remove = useCallback((localId: string) => {
    controllers.current.get(localId)?.abort();
    controllers.current.delete(localId);
    setItems((current) => current.filter((item) => item.localId !== localId));
  }, []);

  const retry = useCallback(
    (localId: string) => {
      const item = items.find((candidate) => candidate.localId === localId);
      if (item && item.status === "failed") startUpload(item);
    },
    [items, startUpload],
  );

  const reset = useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    setItems([]);
  }, []);

  return useMemo(
    () => ({
      items,
      attachmentIds: items.flatMap((item) => (item.status === "uploaded" && item.attachmentId !== null ? [item.attachmentId] : [])),
      uploadingCount: items.filter((item) => item.status === "uploading").length,
      failedCount: items.filter((item) => item.status === "failed").length,
      canAdd: items.length < max && !storageUnavailable,
      storageUnavailable,
      add,
      remove,
      retry,
      reset,
    }),
    [items, max, storageUnavailable, add, remove, retry, reset],
  );
}
