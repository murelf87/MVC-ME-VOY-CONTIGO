import { useCallback, useState } from "react";
import { showToast } from "@/ui";
import { describePublishError } from "../logic/errors";
import { uploadErrorText, type UploadKind } from "../logic/documents";
import { publishStrings } from "../strings";
import type { UploadPhase } from "../types";
import { pickFile, type FileSource } from "./pickFile";
import { useDocumentUpload } from "./useDocumentUpload";

export type UploadNotice = {
  tone: "success" | "error" | "warning";
  message: string;
  /** El problema se arregla en los ajustes del móvil: la pantalla ofrece «Abrir ajustes». */
  settings: boolean;
};

export interface UploadFlow {
  /** Hoja «¿Cómo quieres subirlo?» abierta para este tipo de archivo. */
  chooser: { kind: UploadKind; vehicleId: string | null } | null;
  open(kind: UploadKind, vehicleId: string | null): void;
  close(): void;
  /** Elige el origen (cámara, galería o archivos), comprueba el archivo y lo sube. Nunca rechaza. */
  choose(source: FileSource): Promise<void>;
  /** Subida en curso. */
  busy: { kind: UploadKind; phase: UploadPhase | null; label: string } | null;
  /** Foto recién elegida (para enseñarla al momento mientras se sube). */
  localUri: { kind: UploadKind; uri: string } | null;
  notice: UploadNotice | null;
  clearNotice(): void;
}

const vehicleCopy = publishStrings.vehicle;
const docCopy = publishStrings.documents;

function progressLabel(kind: UploadKind, phase: UploadPhase | null): string {
  const texts = kind === "vehicle_photo" ? vehicleCopy.photoUploading : docCopy.uploading;
  return texts[phase ?? "preparing"];
}

function deniedText(kind: UploadKind, source: FileSource, blocked: boolean): string {
  if (kind === "vehicle_photo") {
    if (source === "camera") return blocked ? vehicleCopy.photoBlocked : vehicleCopy.photoDenied;
    return blocked ? vehicleCopy.libraryBlocked : vehicleCopy.libraryDenied;
  }
  if (source === "camera") return blocked ? docCopy.cameraBlocked : docCopy.cameraDenied;
  return blocked ? docCopy.libraryBlocked : docCopy.libraryDenied;
}

/**
 * Subir una foto o un documento: pregunta de dónde (cámara, galería, archivos), comprueba formato y tamaño en el móvil,
 * lo sube por URL firmada y avisa del resultado. Cada fallo (permiso, formato, tamaño, red, servidor) tiene su texto.
 */
export function useUploadFlow(): UploadFlow {
  const uploader = useDocumentUpload();
  const [chooser, setChooser] = useState<UploadFlow["chooser"]>(null);
  const [localUri, setLocalUri] = useState<UploadFlow["localUri"]>(null);
  const [notice, setNotice] = useState<UploadNotice | null>(null);
  const { upload } = uploader;

  const open = useCallback((kind: UploadKind, vehicleId: string | null) => {
    setNotice(null);
    setChooser({ kind, vehicleId });
  }, []);
  const close = useCallback(() => setChooser(null), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  const choose = useCallback(
    async (source: FileSource): Promise<void> => {
      const target = chooser;
      setChooser(null);
      if (target === null) return;
      const { kind, vehicleId } = target;
      const outcome = await pickFile(kind, source);
      switch (outcome.status) {
        case "cancelled":
          return;
        case "denied":
          setNotice({ tone: "warning", message: deniedText(kind, source, false), settings: false });
          return;
        case "blocked":
          setNotice({ tone: "warning", message: deniedText(kind, source, true), settings: true });
          return;
        case "unavailable":
          setNotice({
            tone: "warning",
            message: kind === "vehicle_photo" ? vehicleCopy.photoUnavailable : docCopy.unavailable,
            settings: false,
          });
          return;
        case "invalid":
          setNotice({ tone: "error", message: uploadErrorText(outcome.reason, kind), settings: false });
          return;
        case "picked": {
          setNotice(null);
          if (kind === "vehicle_photo") setLocalUri({ kind, uri: outcome.file.uri });
          const result = await upload(vehicleId === null ? { kind, file: outcome.file } : { kind, vehicleId, file: outcome.file });
          setLocalUri(null);
          if (result.ok) {
            const message = kind === "vehicle_photo" ? vehicleCopy.photoUploaded : docCopy.uploaded;
            setNotice({ tone: "success", message, settings: false });
            showToast({ message, kind: "success" });
          } else {
            const view = describePublishError(result.error);
            setNotice({ tone: "error", message: view.offline ? publishStrings.common.offlineAction : view.message, settings: false });
          }
          return;
        }
      }
    },
    [chooser, upload],
  );

  const busy: UploadFlow["busy"] =
    uploader.isPending && uploader.kind !== null
      ? { kind: uploader.kind, phase: uploader.phase, label: progressLabel(uploader.kind, uploader.phase) }
      : null;

  return { chooser, open, close, choose, busy, localUri, notice, clearNotice };
}
