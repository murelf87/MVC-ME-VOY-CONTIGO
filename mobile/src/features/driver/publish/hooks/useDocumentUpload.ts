import { useCallback, useRef, useState } from "react";
import { useApiMutation } from "@/hooks";
import { uploadDriverLicense, uploadVehicleFile } from "../api";
import { publishKeys } from "../keys";
import type { UploadKind } from "../logic/documents";
import type { LocalFile, UploadPhase } from "../types";

export interface UploadVars {
  kind: UploadKind;
  /** Obligatorio salvo para el permiso de conducir (que no es de un vehículo). */
  vehicleId?: string;
  file: LocalFile;
}

export type UploadResult = { ok: true } | { ok: false; error: Error };

export interface DocumentUpload {
  /** Se está subiendo algo (y de qué tipo). */
  kind: UploadKind | null;
  phase: UploadPhase | null;
  isPending: boolean;
  isOffline: boolean;
  error: Error | null;
  /** Sube el archivo. Nunca rechaza: resuelve con el resultado. */
  upload(vars: UploadVars): Promise<UploadResult>;
  reset(): void;
}

/**
 * Subida privada de la foto o el seguro de un vehículo, o del permiso de conducir: intención → PUT firmado → completar.
 * Tras subir se refrescan vehículos, documentos y requisitos (el archivo queda en revisión).
 */
export function useDocumentUpload(): DocumentUpload {
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [kind, setKind] = useState<UploadKind | null>(null);
  const phaseSetter = useRef(setPhase);
  phaseSetter.current = setPhase;

  const mutation = useApiMutation<UploadKind, UploadVars>(
    async (vars, { signal }) => {
      const onPhase = (next: UploadPhase): void => phaseSetter.current(next);
      if (vars.kind === "driver_license") {
        await uploadDriverLicense(vars.file, { signal, onPhase });
      } else {
        if (vars.vehicleId === undefined) throw new Error("VEHICLE_REQUIRED");
        await uploadVehicleFile(vars.kind, vars.vehicleId, vars.file, { signal, onPhase });
      }
      return vars.kind;
    },
    {
      invalidates: [publishKeys.vehicles, publishKeys.documents, publishKeys.readiness],
      onSettled: () => {
        phaseSetter.current(null);
      },
    },
  );

  const { mutateAsync, reset: resetMutation } = mutation;
  const upload = useCallback(
    async (vars: UploadVars): Promise<UploadResult> => {
      setKind(vars.kind);
      setPhase("preparing");
      try {
        await mutateAsync(vars);
        return { ok: true };
      } catch (raised) {
        return { ok: false, error: raised instanceof Error ? raised : new Error(String(raised)) };
      }
    },
    [mutateAsync],
  );

  const reset = useCallback(() => {
    resetMutation();
    setKind(null);
    setPhase(null);
  }, [resetMutation]);

  return {
    kind: mutation.isPending || mutation.isError ? kind : null,
    phase: mutation.isPending ? phase : null,
    isPending: mutation.isPending,
    isOffline: mutation.isOffline,
    error: mutation.error,
    upload,
    reset,
  };
}
