/**
 * Hilo de un chat (pantalla 26): carga, sondeo `afterSeq`, mensajes anteriores, envío optimista con reintento, y marca
 * de lectura. Toda la lógica de mezcla es pura (`model/chat.ts`) y el estado vive en `threadStore`; este hook solo la
 * conecta a React y a la red.
 *
 *  - Primera carga: `GET …/messages?limit=30` (últimos mensajes). Después, cada 5 s mientras la pantalla está a la vista,
 *    la app en primer plano y hay red: `afterSeq` (lo nuevo + los acuses de mis últimos mensajes, ver `pollFromSeq`).
 *  - Enviar: el mensaje aparece al instante («enviando»); si el servidor lo confirma pasa a «enviado» (✓); si falla se
 *    queda con «No enviado · Reintentar». Reintentar reutiliza el MISMO `clientMessageId`: el servidor no lo duplica
 *    aunque el primer intento sí hubiera llegado. Si falló solo por falta de red, se reenvía solo al volver la conexión.
 *  - Marcar leído: `POST …/read` con el mayor `seq` recibido, solo con la pantalla a la vista.
 *  - Una negativa del servidor (`CHAT_BLOCKED`, `CHAT_FORBIDDEN`, `CONVERSATION_NOT_FOUND`) no es un error de red: se
 *    expone como `refusal` y la pantalla enseña su propio estado.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { describeError, isAbortError, isApiError, isOfflineError, newIdempotencyKey, type ErrorDescription } from "@/api";
import { onSessionCleared } from "@/api/runtime";
import type { ChatLocation, SendChatMessageRequest } from "@/api/types";
import { queryCache, useAppActive, useInterval, useIsOnline, useIsScreenFocused, useOnReconnect } from "@/hooks";
import { listChatMessages, markConversationRead, sendChatMessage } from "../api";
import {
  addPending,
  appendNewer,
  applyRead,
  confirmPending,
  dropPending,
  failPending,
  loadFirstPage,
  offlineFailures,
  pollFromSeq,
  prependOlder,
  retryPending,
  unreadUpToSeq,
  type PendingFailure,
  type ThreadState,
} from "../model/chat";
import { threadStore } from "../model/threadStore";
import { CONVERSATIONS, UNREAD_MESSAGES_KEY } from "./keys";
import { accessFromErrorCode, type ChatAccess } from "./useConversation";

/** Cada cuánto se sondea el chat abierto. */
export const CHAT_POLL_MS = 5_000;
const FIRST_PAGE = 30;
const POLL_PAGE = 100;
/** Máximo de caracteres de un mensaje (contrato: 1–2.000 tras recortar). */
export const MAX_MESSAGE_CHARS = 2000;

// Cerrar sesión borra los hilos: nunca se ven mensajes de otra cuenta.
onSessionCleared(() => threadStore.clear());

export type ChatRefusal = Exclude<ChatAccess, "ok">;

export interface ChatThreadController {
  state: ThreadState;
  /** Todavía no hay primera página ni error. */
  loading: boolean;
  /** La primera carga falló por algo que no es un permiso (red, servidor). */
  loadError: ErrorDescription | null;
  /** El servidor niega el acceso (bloqueo, reserva no vigente, no existe). */
  refusal: ChatRefusal | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  olderError: boolean;
  /** Añade un mensaje de texto en vuelo. `false` si el texto no es válido (vacío o demasiado largo). */
  sendText(text: string): boolean;
  /** Añade una ubicación en vuelo. */
  sendLocation(location: ChatLocation): void;
  /** Reintenta un mensaje que falló. */
  retry(clientMessageId: string): void;
  /** Quita de la lista un mensaje que no se pudo enviar. */
  discard(clientMessageId: string): void;
  loadOlder(): void;
  /** Vuelve a cargar (botón «Reintentar» de la pantalla de error). */
  reload(): void;
  /** Quita la negativa de acceso (tras desbloquear) y vuelve a cargar. */
  clearRefusal(): void;
}

function failureOf(error: unknown): PendingFailure {
  if (isOfflineError(error)) return "offline";
  if (isApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) return "rejected";
  return "unknown";
}

function codeOf(error: unknown): string | null {
  return isApiError(error) ? error.code : null;
}

export function useChatThread(conversationId: string): ChatThreadController {
  const subscribe = useCallback((listener: () => void) => threadStore.subscribe(conversationId, listener), [conversationId]);
  const getSnapshot = useCallback(() => threadStore.get(conversationId), [conversationId]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [loadError, setLoadError] = useState<ErrorDescription | null>(null);
  const [refusal, setRefusal] = useState<ChatRefusal | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);

  const focused = useIsScreenFocused();
  const appActive = useAppActive();
  const online = useIsOnline();

  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  /** Señal de la sincronización en curso (si se aborta al desmontar, una nueva puede empezar sin esperar). */
  const syncing = useRef<AbortSignal | null>(null);
  const marking = useRef(false);
  const markedUpTo = useRef(0);
  const olderBusy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    controller.current = new AbortController();
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  // Otro chat en la misma pantalla: se parte de cero.
  useEffect(() => {
    setLoadError(null);
    setRefusal(null);
    setOlderError(false);
    markedUpTo.current = 0;
  }, [conversationId]);

  /** Anota una negativa de acceso si el error lo es; `true` en ese caso. */
  const noteRefusal = useCallback((error: unknown): boolean => {
    const refused = accessFromErrorCode(codeOf(error));
    if (refused === null) return false;
    if (mounted.current) setRefusal(refused);
    return true;
  }, []);

  const markRead = useCallback(async (): Promise<void> => {
    if (marking.current) return;
    const upTo = unreadUpToSeq(threadStore.get(conversationId));
    if (upTo === null || upTo <= markedUpTo.current) return;
    marking.current = true;
    const previous = markedUpTo.current;
    markedUpTo.current = upTo;
    try {
      const result = await markConversationRead(conversationId, { upToSeq: upTo }, { signal: controller.current?.signal });
      threadStore.update(conversationId, (s) => applyRead(s, result.lastReadSeq));
      void queryCache.invalidate(CONVERSATIONS);
      void queryCache.invalidate(UNREAD_MESSAGES_KEY);
    } catch (error) {
      markedUpTo.current = previous; // se reintenta en el siguiente sondeo
      if (!isAbortError(error)) noteRefusal(error);
    } finally {
      marking.current = false;
    }
  }, [conversationId, noteRefusal]);

  const sync = useCallback(async (): Promise<void> => {
    const signal = controller.current?.signal;
    if (syncing.current !== null && !syncing.current.aborted) return;
    syncing.current = signal ?? null;
    try {
      const current = threadStore.get(conversationId);
      if (!current.loaded) {
        const page = await listChatMessages(conversationId, { limit: FIRST_PAGE }, { signal });
        threadStore.update(conversationId, (s) => loadFirstPage(s, page));
      } else {
        const page = await listChatMessages(conversationId, { afterSeq: pollFromSeq(current), limit: POLL_PAGE }, { signal });
        threadStore.update(conversationId, (s) => appendNewer(s, page));
      }
      if (mounted.current) setLoadError(null);
      void markRead();
    } catch (error) {
      if (isAbortError(error) || !mounted.current) return;
      if (noteRefusal(error)) return;
      // Un sondeo que falla con el hilo ya cargado no molesta: la pantalla ya avisa de «Sin conexión».
      if (!threadStore.get(conversationId).loaded) setLoadError(describeError(error));
    } finally {
      if (syncing.current === (signal ?? null)) syncing.current = null;
    }
  }, [conversationId, markRead, noteRefusal]);

  // Al abrir el chat (o cambiar de chat) se sincroniza: primera página, o lo nuevo si ya se había abierto antes.
  useEffect(() => {
    void sync();
  }, [sync]);

  // Al volver a la pantalla o a la app se sincroniza ya, sin esperar al próximo sondeo.
  const visible = focused && appActive;
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisible.current) void sync();
    wasVisible.current = visible;
  }, [visible, sync]);

  useInterval(() => void sync(), visible && online && refusal === null && state.loaded ? CHAT_POLL_MS : null);

  // Mensajes recibidos mientras se mira la pantalla: se marcan como leídos.
  useEffect(() => {
    if (visible && refusal === null && state.loaded) void markRead();
  }, [state, visible, refusal, markRead]);

  // ── Envío ───────────────────────────────────────────────────────────────────────────────────────────────────────

  const deliver = useCallback(
    async (clientMessageId: string): Promise<void> => {
      const pending = threadStore.get(conversationId).pending.find((p) => p.clientMessageId === clientMessageId);
      if (pending === undefined) return;
      const label = pending.location?.label ?? null;
      const request: SendChatMessageRequest =
        pending.kind === "location" && pending.location !== null
          ? {
              clientMessageId,
              kind: "location",
              ...(pending.body !== "" ? { body: pending.body } : {}),
              location: { lat: pending.location.lat, lng: pending.location.lng, ...(label !== null && label !== "" ? { label } : {}) },
            }
          : { clientMessageId, kind: "text", body: pending.body };
      try {
        const message = await sendChatMessage(conversationId, request);
        threadStore.update(conversationId, (s) => confirmPending(s, clientMessageId, message));
        void queryCache.invalidate(CONVERSATIONS);
      } catch (error) {
        const refused = accessFromErrorCode(codeOf(error));
        if (refused !== null && mounted.current) setRefusal(refused);
        threadStore.update(conversationId, (s) =>
          failPending(s, clientMessageId, refused !== null ? "rejected" : failureOf(error), codeOf(error)),
        );
      }
    },
    [conversationId],
  );

  const sendText = useCallback(
    (text: string): boolean => {
      const body = text.trim();
      if (body === "" || body.length > MAX_MESSAGE_CHARS) return false;
      const clientMessageId = newIdempotencyKey();
      threadStore.update(conversationId, (s) => addPending(s, { clientMessageId, kind: "text", body, nowMs: Date.now() }));
      void deliver(clientMessageId);
      return true;
    },
    [conversationId, deliver],
  );

  const sendLocation = useCallback(
    (location: ChatLocation): void => {
      const clientMessageId = newIdempotencyKey();
      threadStore.update(conversationId, (s) =>
        addPending(s, { clientMessageId, kind: "location", body: location.label ?? "", location, nowMs: Date.now() }),
      );
      void deliver(clientMessageId);
    },
    [conversationId, deliver],
  );

  const retry = useCallback(
    (clientMessageId: string): void => {
      threadStore.update(conversationId, (s) => retryPending(s, clientMessageId));
      void deliver(clientMessageId);
    },
    [conversationId, deliver],
  );

  const discard = useCallback(
    (clientMessageId: string): void => {
      threadStore.update(conversationId, (s) => dropPending(s, clientMessageId));
    },
    [conversationId],
  );

  // Los que fallaron solo por falta de red se reenvían solos cuando vuelve la conexión.
  useOnReconnect(() => {
    for (const pending of offlineFailures(threadStore.get(conversationId))) retry(pending.clientMessageId);
    void sync();
  });

  // ── Mensajes anteriores ─────────────────────────────────────────────────────────────────────────────────────────

  const loadOlder = useCallback((): void => {
    const cursor = threadStore.get(conversationId).olderCursor;
    if (cursor === null || olderBusy.current) return;
    olderBusy.current = true;
    setLoadingOlder(true);
    setOlderError(false);
    void listChatMessages(conversationId, { cursor, limit: FIRST_PAGE }, { signal: controller.current?.signal })
      .then((page) => {
        threadStore.update(conversationId, (s) => prependOlder(s, page));
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || !mounted.current) return;
        if (!noteRefusal(error)) setOlderError(true);
      })
      .finally(() => {
        olderBusy.current = false;
        if (mounted.current) setLoadingOlder(false);
      });
  }, [conversationId, noteRefusal]);

  const reload = useCallback((): void => {
    setLoadError(null);
    void sync();
  }, [sync]);

  const clearRefusal = useCallback((): void => {
    setRefusal(null);
    setLoadError(null);
    void sync();
  }, [sync]);

  return useMemo<ChatThreadController>(
    () => ({
      state,
      loading: !state.loaded && loadError === null && refusal === null,
      loadError,
      refusal,
      hasOlder: state.olderCursor !== null,
      loadingOlder,
      olderError,
      sendText,
      sendLocation,
      retry,
      discard,
      loadOlder,
      reload,
      clearRefusal,
    }),
    [state, loadError, refusal, loadingOlder, olderError, sendText, sendLocation, retry, discard, loadOlder, reload, clearRefusal],
  );
}
