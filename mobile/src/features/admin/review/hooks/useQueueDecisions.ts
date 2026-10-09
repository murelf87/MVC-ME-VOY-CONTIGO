/**
 * Decisiones rápidas de la cola de 38: «Aprobar» (con confirmación) y «Rechazar» (con motivo obligatorio) sobre todo lo
 * que está en revisión de una persona.
 *
 * El resultado lo manda el servidor (`results[]` por elemento): la tarjeta no cambia «a mano»; tras decidir se invalida la
 * cola y es la lista recargada la que la quita de «Pendientes». Un conflicto (otra persona decidió antes) avisa y refresca.
 */
import { useCallback, useState } from "react";
import type { AdminReviewDecisionRequest, AdminReviewQueueItem } from "@/api/types";
import { showToast } from "@/ui";
import { adminError } from "../logic/errors";
import { decisionOutcome, pendingItemKeys, pendingItemNames } from "../logic/reviewQueue";
import { reviewStrings } from "../strings";
import { useReviewDecision } from "./useReviewDossier";

export type QueueBusyKind = "approve" | "reject";

export interface QueueDecisions {
  /** Persona cuya aprobación se está confirmando. */
  approving: AdminReviewQueueItem | null;
  /** Persona cuyo rechazo se está redactando. */
  rejecting: AdminReviewQueueItem | null;
  /** Decisión en curso. */
  busy: { userId: string; kind: QueueBusyKind } | null;
  /** Error del servidor al rechazar, para mostrarlo dentro de la hoja. */
  rejectError: string | null;
  /** Elementos que se aprobarían/rechazarían, con el nombre que ve la persona de personal. */
  itemNames: (item: AdminReviewQueueItem) => string[];
  askApprove: (item: AdminReviewQueueItem) => void;
  askReject: (item: AdminReviewQueueItem) => void;
  cancelApprove: () => void;
  cancelReject: () => void;
  confirmApprove: () => Promise<void>;
  confirmReject: (reason: string) => Promise<void>;
}

export function useQueueDecisions(onConflict: () => void): QueueDecisions {
  const decision = useReviewDecision();
  const [approving, setApproving] = useState<AdminReviewQueueItem | null>(null);
  const [rejecting, setRejecting] = useState<AdminReviewQueueItem | null>(null);
  const [busy, setBusy] = useState<QueueDecisions["busy"]>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const run = useCallback(
    async (item: AdminReviewQueueItem, body: AdminReviewDecisionRequest, kind: QueueBusyKind): Promise<{ ok: true } | { ok: false; message: string }> => {
      setBusy({ userId: item.userId, kind });
      try {
        const result = await decision.mutateAsync({ userId: item.userId, body });
        const outcome = decisionOutcome(result, body.decision, item.displayName);
        showToast({ message: outcome.message, kind: outcome.kind, id: `review.decision.${item.userId}`, testID: "AdminUsersReview.toast" });
        if (outcome.kind === "error") onConflict();
        return { ok: true };
      } catch (failure) {
        const view = adminError(failure);
        if (view.kind === "conflict") onConflict();
        return { ok: false, message: view.kind === "conflict" ? view.message : `${view.title}. ${view.message}` };
      } finally {
        setBusy(null);
      }
    },
    [decision, onConflict],
  );

  const confirmApprove = useCallback(async () => {
    if (approving === null) return;
    const item = approving;
    const result = await run(item, { decision: "approved", items: pendingItemKeys(item) }, "approve");
    setApproving(null);
    if (!result.ok) showToast({ title: reviewStrings.users.errorTitle, message: result.message, kind: "error", id: `review.decision.${item.userId}` });
  }, [approving, run]);

  const confirmReject = useCallback(
    async (reason: string) => {
      if (rejecting === null) return;
      const item = rejecting;
      setRejectError(null);
      const result = await run(item, { decision: "rejected", reason, items: pendingItemKeys(item) }, "reject");
      if (result.ok) {
        setRejecting(null);
      } else {
        setRejectError(result.message);
      }
    },
    [rejecting, run],
  );

  return {
    approving,
    rejecting,
    busy,
    rejectError,
    itemNames: pendingItemNames,
    askApprove: setApproving,
    askReject: (item) => {
      setRejectError(null);
      setRejecting(item);
    },
    cancelApprove: () => setApproving(null),
    cancelReject: () => {
      setRejecting(null);
      setRejectError(null);
    },
    confirmApprove,
    confirmReject,
  };
}
