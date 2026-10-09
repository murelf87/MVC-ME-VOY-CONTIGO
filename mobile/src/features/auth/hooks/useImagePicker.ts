import { useCallback, useEffect, useRef, useState } from "react";
import { captureSelfie, pickPhotoFromLibrary, takePhoto, type PickedImage } from "@/platform";

/** De dónde sale la imagen: cámara trasera, cámara frontal (selfie) o galería (selector del sistema, sin permiso). */
export type PickSource = "camera" | "selfie" | "library";

export type PickOutcome =
  | { kind: "picked"; image: PickedImage }
  /** La persona cerró la cámara o la galería sin elegir nada (no es un error). */
  | { kind: "cancelled" }
  /** El sistema no dio permiso de cámara, pero se puede volver a pedir. */
  | { kind: "denied" }
  /** Denegado para siempre: solo se arregla en los ajustes del móvil. */
  | { kind: "blocked" }
  /** Sin cámara, sin galería o el sistema falló: hay que ofrecer otra vía. */
  | { kind: "unavailable" };

export interface UseImagePickerResult {
  /** Hay una cámara o galería abierta (evita pulsaciones repetidas). */
  busy: boolean;
  pick(source: PickSource): Promise<PickOutcome>;
}

/**
 * Cámara y galería a través de `@/platform` (en la web hay sustitutos). Ninguna ruta lanza: cada desenlace es un
 * estado que la pantalla traduce a un texto y a una alternativa (galería, otra forma de verificar, ajustes).
 */
export function useImagePicker(): UseImagePickerResult {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const pick = useCallback(async (source: PickSource): Promise<PickOutcome> => {
    if (busyRef.current) return { kind: "cancelled" };
    busyRef.current = true;
    setBusy(true);
    try {
      const result = source === "library" ? await pickPhotoFromLibrary() : source === "selfie" ? await captureSelfie() : await takePhoto();
      switch (result.status) {
        case "picked":
          return { kind: "picked", image: result.image };
        case "cancelled":
          return { kind: "cancelled" };
        case "permission_denied":
          return { kind: "denied" };
        case "permission_blocked":
          return { kind: "blocked" };
        case "unavailable":
          return { kind: "unavailable" };
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  return { busy, pick };
}
