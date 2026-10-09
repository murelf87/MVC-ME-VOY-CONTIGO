/**
 * Visor de documentación privada del expediente.
 *
 * Reglas del contrato (docs/contracts/trust.md §4.3, `POST /v1/admin/evidence/{kind}/{id}/access`):
 *  - se pide una URL firmada de 120 s CADA vez que se abre; el servidor audita el acceso antes de firmar;
 *  - la imagen nunca se guarda: no se pone en la caché de consultas, ni en el almacenamiento, ni se comparte;
 *  - al caducar (o al salir de la app, o al cerrar) la imagen se retira de la pantalla y se pide acceso de nuevo.
 *
 * En iOS/Android la URL firmada se carga directamente (con `cachePolicy="none"` en el visor). En la vista previa web,
 * donde `<img>` no pasa por el servidor simulado, los bytes se leen con `fetch` a un `blob:` local que se revoca al cerrar.
 *
 * La cuenta atrás se mide con un reloj monótono desde que llega la respuesta (no con la hora del dispositivo).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import type { AdminEvidenceKind, AdminEvidencePurpose } from "@/api/types";
import { useAppActive, useInterval } from "@/hooks";
import { requestEvidenceAccess } from "../api";
import { adminError, type AdminErrorView } from "../logic/errors";
import { isImageContentType, remainingSeconds, ttlOf } from "../logic/evidence";

export interface EvidenceTarget {
  kind: AdminEvidenceKind;
  id: string;
  /** «Foto de perfil», «Permiso de conducir»… */
  title: string;
  /** Nombre de la persona dueña, para el aviso previo. */
  ownerName: string;
  purpose: AdminEvidencePurpose;
}

/** `closed`: nada a la vista · `notice`: aviso previo («el acceso queda registrado») · `open`: visor. */
export type EvidencePhase = "closed" | "notice" | "open";
export type EvidenceStatus = "requesting" | "loading" | "ready" | "expired" | "error";

export interface EvidenceViewer {
  phase: EvidencePhase;
  target: EvidenceTarget | null;
  status: EvidenceStatus;
  /** Lo que se pinta: la URL firmada (nativo) o un `blob:` local (web). `null` si no hay imagen a la vista. */
  imageUri: string | null;
  /** El archivo no es una imagen: no se previsualiza. */
  contentType: string | null;
  isImage: boolean;
  secondsLeft: number;
  error: AdminErrorView | null;
  /** Abre el aviso previo. No pide acceso todavía. */
  open: (target: EvidenceTarget) => void;
  /** Acepta el aviso y pide el acceso (queda auditado). */
  confirm: () => void;
  /** Vuelve a pedir acceso tras caducar o fallar (queda auditado otra vez). */
  reopen: () => void;
  close: () => void;
}

function monotonicNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

export function useEvidenceViewer(): EvidenceViewer {
  const [phase, setPhase] = useState<EvidencePhase>("closed");
  const [target, setTarget] = useState<EvidenceTarget | null>(null);
  const [status, setStatus] = useState<EvidenceStatus>("requesting");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [contentType, setContentType] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<AdminErrorView | null>(null);

  /** Cada apertura/cierre abre una generación nueva: una respuesta tardía de la anterior se ignora. */
  const generation = useRef(0);
  const deadline = useRef(0);
  const blobUrl = useRef<string | null>(null);
  const appActive = useAppActive();

  const discardImage = useCallback(() => {
    if (blobUrl.current !== null) {
      URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = null;
    }
    setImageUri(null);
  }, []);

  const request = useCallback(
    async (next: EvidenceTarget) => {
      generation.current += 1;
      const mine = generation.current;
      discardImage();
      setError(null);
      setContentType(null);
      setStatus("requesting");
      try {
        const access = await requestEvidenceAccess(next.kind, next.id, { purpose: next.purpose });
        if (generation.current !== mine) return;
        deadline.current = monotonicNow() + ttlOf(access.ttlSeconds) * 1000;
        setSecondsLeft(remainingSeconds(deadline.current, monotonicNow()));
        setContentType(access.contentType);
        if (!isImageContentType(access.contentType)) {
          setStatus("ready");
          return;
        }
        if (Platform.OS === "web") {
          setStatus("loading");
          const response = await fetch(access.url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          if (generation.current !== mine) return;
          blobUrl.current = URL.createObjectURL(blob);
          setImageUri(blobUrl.current);
        } else {
          setImageUri(access.url);
        }
        setStatus("ready");
      } catch (failure) {
        if (generation.current !== mine) return;
        setError(adminError(failure));
        setStatus("error");
      }
    },
    [discardImage],
  );

  const open = useCallback((next: EvidenceTarget) => {
    generation.current += 1;
    setTarget(next);
    setPhase("notice");
  }, []);

  const confirm = useCallback(() => {
    if (target === null) return;
    setPhase("open");
    void request(target);
  }, [request, target]);

  const reopen = useCallback(() => {
    if (target === null) return;
    void request(target);
  }, [request, target]);

  const close = useCallback(() => {
    generation.current += 1;
    discardImage();
    setPhase("closed");
    setTarget(null);
    setStatus("requesting");
    setError(null);
    setContentType(null);
  }, [discardImage]);

  const expire = useCallback(() => {
    generation.current += 1;
    discardImage();
    setSecondsLeft(0);
    setStatus("expired");
  }, [discardImage]);

  const watching = phase === "open" && status === "ready";
  useInterval(() => {
    const left = remainingSeconds(deadline.current, monotonicNow());
    setSecondsLeft(left);
    if (left <= 0) expire();
  }, watching ? 1000 : null);

  // Si la app deja el primer plano con el visor abierto, la imagen se retira: no se queda en el conmutador de apps.
  useEffect(() => {
    if (!appActive && phase === "open" && (status === "ready" || status === "loading")) expire();
  }, [appActive, phase, status, expire]);

  // Al desmontar la pantalla no puede quedar ninguna imagen viva.
  useEffect(
    () => () => {
      generation.current += 1;
      if (blobUrl.current !== null) {
        URL.revokeObjectURL(blobUrl.current);
        blobUrl.current = null;
      }
    },
    [],
  );

  const isImage = contentType === null ? true : isImageContentType(contentType);
  return useMemo(
    () => ({ phase, target, status, imageUri, contentType, isImage, secondsLeft, error, open, confirm, reopen, close }),
    [phase, target, status, imageUri, contentType, isImage, secondsLeft, error, open, confirm, reopen, close],
  );
}
