/**
 * Edición de las restricciones y reglas de alerta (pantalla 40, Administración): cada cambio se guarda al momento con
 * `PUT /v1/admin/operations`. Mientras el servidor responde se ve el valor nuevo (optimista) y, si falla, se restaura el
 * anterior y se avisa. Solo se admite un guardado a la vez (todo queda quieto mientras tanto).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { describeError } from "@/api";
import type { AdminAlertKind, AdminAlertRuleParams, AdminOperations, AdminOperationsUpdate } from "@/api/types";
import { showToast } from "@/ui";
import { ruleUpdate } from "../model/operations";
import { opsStrings } from "../strings";
import { useUpdateOperations } from "./useOperations";

interface Overlay {
  master?: boolean;
  rules: Partial<Record<AdminAlertKind, { enabled?: boolean; params?: AdminAlertRuleParams }>>;
}

/** El documento con el cambio pendiente ya aplicado. */
export function applyOverlay(data: AdminOperations | undefined, overlay: Overlay | null): AdminOperations | undefined {
  if (data === undefined || overlay === null) return data;
  return {
    ...data,
    realtimeAlerts: {
      enabled: overlay.master ?? data.realtimeAlerts.enabled,
      rules: data.realtimeAlerts.rules.map((rule) => {
        const change = overlay.rules[rule.kind];
        if (change === undefined) return rule;
        return { ...rule, enabled: change.enabled ?? rule.enabled, params: change.params ?? rule.params };
      }),
    },
  };
}

export interface OperationsEditor {
  /** Lo que se pinta: el documento del servidor con el cambio en curso aplicado. */
  view: AdminOperations | undefined;
  saving: boolean;
  setMaster: (enabled: boolean) => Promise<boolean>;
  setRule: (kind: AdminAlertKind, enabled: boolean) => Promise<boolean>;
  saveParams: (kind: AdminAlertKind, params: AdminAlertRuleParams) => Promise<boolean>;
}

export function useOperationsEditor(data: AdminOperations | undefined): OperationsEditor {
  const mutation = useUpdateOperations();
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const busy = useRef(false);
  const o = opsStrings.operations;

  const apply = useCallback(
    async (update: AdminOperationsUpdate, next: Overlay, success: string): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      setOverlay(next);
      try {
        await mutation.mutateAsync(update);
        showToast({ kind: "success", message: success, id: "ops-operations" });
        return true;
      } catch (error) {
        const info = describeError(error);
        showToast({ kind: "error", title: info.title, message: `${info.message} ${o.restoredNote}`, id: "ops-operations" });
        return false;
      } finally {
        setOverlay(null);
        busy.current = false;
      }
    },
    [mutation, o.restoredNote],
  );

  const setMaster = useCallback(
    (enabled: boolean) => apply({ realtimeAlertsEnabled: enabled }, { master: enabled, rules: {} }, o.toggleSaved),
    [apply, o.toggleSaved],
  );
  const setRule = useCallback(
    (kind: AdminAlertKind, enabled: boolean) => apply(ruleUpdate(kind, { enabled }), { rules: { [kind]: { enabled } } }, o.toggleSaved),
    [apply, o.toggleSaved],
  );
  const saveParams = useCallback(
    (kind: AdminAlertKind, params: AdminAlertRuleParams) => apply(ruleUpdate(kind, { params }), { rules: { [kind]: { params } } }, o.paramSaved),
    [apply, o.paramSaved],
  );

  const view = useMemo(() => applyOverlay(data, overlay), [data, overlay]);
  return { view, saving: overlay !== null || mutation.isPending, setMaster, setRule, saveParams };
}
