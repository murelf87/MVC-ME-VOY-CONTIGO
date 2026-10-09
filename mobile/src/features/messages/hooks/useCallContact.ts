/**
 * «Llamar a Ana» (pantalla 26). El teléfono de la otra persona solo lo entrega el servidor dentro de la ventana del
 * viaje (docs/contracts/comms.md §2.9) y cada entrega queda auditada, así que NO se pide al abrir el chat: se pide
 * cuando la persona pulsa el botón, se usa para abrir el marcador y no se guarda en ninguna parte.
 *
 * Si el servidor dice que no (fuera de ventana, llamadas desactivadas, la otra persona ya no tiene teléfono) el botón
 * enseña el motivo en un aviso, con el instante en que podrá llamar si lo hay.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { describeError, isOfflineError } from "@/api";
import { callPhone } from "@/platform";
import { showToast } from "@/ui";
import { getPeerCallContact } from "../api";
import { callStateOf, dialableNumber } from "../model/call";
import { messagesStrings } from "../strings";

const copy = messagesStrings.chat;

export type CallPhase =
  | { kind: "idle" }
  | { kind: "checking" }
  /** El servidor no deja llamar ahora: se explica por qué. */
  | { kind: "unavailable"; name: string; explanation: string };

export interface CallContactController {
  phase: CallPhase;
  /** Pregunta al servidor y, si deja, abre el marcador del teléfono. */
  press(): void;
  /** Cierra el aviso explicativo. */
  dismiss(): void;
}

export function useCallContact(conversationId: string): CallContactController {
  const [phase, setPhase] = useState<CallPhase>({ kind: "idle" });
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const press = useCallback((): void => {
    if (busy.current) return;
    busy.current = true;
    setPhase({ kind: "checking" });
    void (async () => {
      try {
        const contact = await getPeerCallContact(conversationId);
        const state = callStateOf(contact, Date.now());
        if (state.kind === "available") {
          const opened = await callPhone(dialableNumber(state.phoneE164));
          if (opened !== "opened") showToast({ kind: "error", message: copy.callOpenFailed, id: "chat-call" });
          if (mounted.current) setPhase({ kind: "idle" });
        } else if (state.kind === "unavailable") {
          if (mounted.current) setPhase({ kind: "unavailable", name: state.name, explanation: state.explanation });
        } else if (mounted.current) {
          setPhase({ kind: "idle" });
        }
      } catch (error) {
        showToast({ kind: "error", message: isOfflineError(error) ? describeError(error).message : copy.callError, id: "chat-call" });
        if (mounted.current) setPhase({ kind: "idle" });
      } finally {
        busy.current = false;
      }
    })();
  }, [conversationId]);

  const dismiss = useCallback((): void => setPhase({ kind: "idle" }), []);

  return { phase, press, dismiss };
}
