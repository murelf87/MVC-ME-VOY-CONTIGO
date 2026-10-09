/**
 * Restricciones de operación + reglas de alerta en tiempo real (lámina 40), con su carga, errores y edición. Lo usan la
 * pestaña Tarifas (variante `summary`, como la lámina) y la pestaña Operaciones (variante `detail`, con umbrales).
 *
 * RBAC: lectura A F S · edición solo Administración (el resto ve los interruptores quietos y una nota de solo lectura).
 * Apagar las alertas en tiempo real pide confirmación; «Solo trayectos dentro de la provincia» es fija y explica por qué.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { formatDateTime } from "@/i18n";
import { colors } from "@/theme";
import { Button, ConfirmDialog, Dialog, Skeleton, Text } from "@/ui";
import { useOperations } from "../hooks/useOperations";
import { useOperationsEditor } from "../hooks/useOperationsEditor";
import { activeRuleCount } from "../model/operations";
import type { OpsAccess } from "../model/permissions";
import { opsStrings } from "../strings";
import { AlertRulesCard, RestrictionsCard } from "./OperationsCards";
import { NoPermissionState, QueryErrorState, StaleNotice } from "./StateViews";

export interface OperationsPanelProps {
  access: OpsAccess;
  variant: "summary" | "detail";
  /** Aviso de datos desactualizados / sin conexión (la pestaña Tarifas lo muestra una sola vez para todo). */
  showStaleNotice?: boolean;
  testID: string;
}

export function OperationsPanel({ access, variant, showStaleNotice = true, testID }: OperationsPanelProps): React.JSX.Element {
  const query = useOperations(access.readOperations);
  const editor = useOperationsEditor(query.data);
  const [lockedOpen, setLockedOpen] = React.useState(false);
  const [confirmOff, setConfirmOff] = React.useState(false);
  const t = opsStrings.tariffs;
  const o = opsStrings.operations;

  if (!access.readOperations) {
    return <NoPermissionState section={opsStrings.access.areas.operations} testID={`${testID}.noPermission`} />;
  }
  if (query.data === undefined) {
    if (query.isError || query.isOffline) {
      return <QueryErrorState error={query.error} onRetry={() => void query.refetch()} section={opsStrings.access.areas.operations} testID={`${testID}.error`} />;
    }
    return (
      <View testID={`${testID}.loading`} accessibilityState={{ busy: true }} accessible accessibilityLabel={opsStrings.common.loading}>
        <Skeleton height={67} radius={16} style={styles.restrictionsGap} />
        <Skeleton height={133} radius={16} style={styles.alertsGap} />
      </View>
    );
  }

  const view = editor.view ?? query.data;
  const rules = view.realtimeAlerts.rules;
  const updatedBy = view.updatedBy?.displayName ?? null;

  return (
    <View testID={testID}>
      {showStaleNotice ? <StaleNotice offline={query.isOffline} failedToRefresh={query.failedToRefresh} onRetry={() => void query.refetch()} testID={`${testID}.stale`} /> : null}
      <View style={styles.restrictionsGap}>
        <RestrictionsCard label={view.provinceOnly.label} onLockedPress={() => setLockedOpen(true)} testID={`${testID}.restrictions`} />
      </View>
      <AlertRulesCard
        operations={view}
        variant={variant}
        canWrite={access.writeOperations}
        saving={editor.saving}
        onToggleMaster={(enabled) => {
          if (enabled) void editor.setMaster(true);
          else setConfirmOff(true);
        }}
        onToggleRule={(kind, enabled) => {
          void editor.setRule(kind, enabled);
        }}
        onSaveParams={editor.saveParams}
        testID={`${testID}.alerts`}
      />
      {variant === "detail" ? (
        <View style={styles.meta}>
          <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} testID={`${testID}.count`}>
            {o.activeCount(activeRuleCount(rules), rules.length)}
          </Text>
          <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} testID={`${testID}.updated`}>
            {view.updatedAt === null ? o.neverUpdated : o.lastUpdated(formatDateTime(view.updatedAt), updatedBy)}
          </Text>
          {!access.writeOperations ? (
            <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} testID={`${testID}.readOnly`}>
              {opsStrings.noPermission.readOnlyHint}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Dialog
        visible={lockedOpen}
        onClose={() => setLockedOpen(false)}
        icon="lock"
        title={t.restrictionsLockedTitle}
        message={t.restrictionsLockedMessage}
        testID={`${testID}.lockedDialog`}
        actions={<Button label={opsStrings.common.close} chevron={false} onPress={() => setLockedOpen(false)} testID={`${testID}.lockedDialog.close`} />}
      />
      <ConfirmDialog
        visible={confirmOff}
        destructive
        title={o.confirmOffTitle}
        message={o.confirmOffMessage}
        confirmLabel={o.confirmOffAction}
        loading={editor.saving}
        onConfirm={() => {
          void editor.setMaster(false).then(() => setConfirmOff(false));
        }}
        onCancel={() => setConfirmOff(false)}
        testID={`${testID}.confirmOff`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  restrictionsGap: { marginTop: 9 },
  alertsGap: { marginTop: 9.5 },
  meta: { marginTop: 10, rowGap: 3, paddingHorizontal: 4 },
});
