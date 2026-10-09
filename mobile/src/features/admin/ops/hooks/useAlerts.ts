/** Alertas de operación: lista con filtros, evaluación de reglas, reconocer y resolver (A S). */
import type { AdminAlert, AdminAlertEvaluation, AdminAlertKind, AdminAlertStatus } from "@/api/types";
import { useApiMutation, usePaginatedQuery, type UseApiMutationResult, type UsePaginatedQueryResult } from "@/hooks";
import { evaluateAlerts, listAlerts, setAlertStatus } from "../api";
import { ADMIN_ALERTS, ADMIN_AUDIT, alertsKey } from "./keys";

/** La lista se refresca sola cada 30 s mientras se mira. */
export const ALERTS_POLL_MS = 30_000;

export function useAlerts(status: AdminAlertStatus | "all", kind: AdminAlertKind | null, enabled: boolean): UsePaginatedQueryResult<AdminAlert> {
  return usePaginatedQuery<AdminAlert>(
    alertsKey(status, kind),
    ({ cursor, signal }) => listAlerts({ status, kind, cursor, limit: 20 }, { signal }),
    { enabled, staleTimeMs: 10_000, refetchIntervalMs: ALERTS_POLL_MS },
  );
}

export function useEvaluateAlerts(): UseApiMutationResult<AdminAlertEvaluation, void> {
  return useApiMutation<AdminAlertEvaluation, void>((_input, { signal }) => evaluateAlerts({ signal }), {
    invalidates: [ADMIN_ALERTS, ADMIN_AUDIT],
  });
}

export interface AlertStatusInput {
  alertId: string;
  status: "acknowledged" | "resolved";
}

export function useSetAlertStatus(): UseApiMutationResult<AdminAlert, AlertStatusInput> {
  return useApiMutation<AdminAlert, AlertStatusInput>((input, { signal }) => setAlertStatus(input.alertId, input.status, { signal }), {
    invalidates: [ADMIN_ALERTS, ADMIN_AUDIT],
  });
}
