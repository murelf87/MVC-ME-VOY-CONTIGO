import React from "react";
import { OptionSheet, type OptionSheetOption } from "@/ui";
import type { FileSource } from "../hooks/pickFile";
import type { UploadKind } from "../logic/documents";
import { publishStrings } from "../strings";

export interface UploadSourceSheetProps {
  /** Qué se va a subir; `null` = hoja cerrada. */
  kind: UploadKind | null;
  onChoose: (source: FileSource) => void;
  onClose: () => void;
  testID?: string;
}

const vehicleCopy = publishStrings.vehicle;
const docCopy = publishStrings.documents;

/** «¿Cómo quieres subirlo?»: hacer una foto, elegirla de la galería o (los documentos) elegir un archivo PDF. */
export function UploadSourceSheet({ kind, onChoose, onClose, testID = "UploadSourceSheet" }: UploadSourceSheetProps): React.JSX.Element | null {
  const isPhoto = kind === "vehicle_photo";
  const options: OptionSheetOption<FileSource>[] = [
    { value: "camera", label: isPhoto ? vehicleCopy.photoTake : docCopy.takePhoto, icon: "camera" },
    { value: "library", label: isPhoto ? vehicleCopy.photoLibrary : docCopy.fromLibrary, icon: "image" },
    ...(isPhoto ? [] : [{ value: "files" as const, label: docCopy.fromFiles, icon: "attach" as const }]),
  ];
  return (
    <OptionSheet<FileSource>
      visible={kind !== null}
      title={isPhoto ? vehicleCopy.photoSheetTitle : docCopy.chooseSource}
      options={options}
      onSelect={onChoose}
      onClose={onClose}
      testID={testID}
    />
  );
}
