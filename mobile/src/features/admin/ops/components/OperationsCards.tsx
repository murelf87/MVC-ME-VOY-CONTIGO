/**
 * Tarjetas «Restricciones de operación» y «Alertas en tiempo real» (lámina 40). Se usan en la pestaña Tarifas
 * (variante `summary`, filas de 28,5 pt como la lámina) y en la pestaña Operaciones (variante `detail`, con los
 * umbrales de cada regla editables). Los cambios los guarda el padre con `PUT /v1/admin/operations` (solo Administración).
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { AdminAlertKind, AdminAlertRule, AdminAlertRuleParams, AdminOperations } from "@/api/types";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Button, Text, TextField } from "@/ui";
import {
  RULE_PARAM_SPECS,
  paramsToDraft,
  ruleSummary,
  sameParams,
  validateParams,
  type ParamDraft,
  type ParamErrors,
} from "../model/operations";
import { opsStrings } from "../strings";
import { OpsCheckbox } from "./OpsCheckbox";
import { OpsSwitch } from "./OpsSwitch";

// ── Restricciones ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface RestrictionsCardProps {
  /** Texto de `provinceOnly.label` del servidor (cae en el literal de la lámina si falta). */
  label: string | null;
  onLockedPress: () => void;
  testID: string;
}

export function RestrictionsCard({ label, onLockedPress, testID }: RestrictionsCardProps): React.JSX.Element {
  const s = opsStrings.tariffs;
  return (
    <View style={styles.restrictions} testID={testID}>
      <View style={styles.pin}>
        <Icon name="pin" size={28} color={colors.heading} />
      </View>
      <View style={styles.restrictionsTexts}>
        <Text variant="rowTitle" size={16.3} lineHeight={21} color={colors.heading} numberOfLines={1} accessibilityRole="header">
          {s.restrictionsTitle}
        </Text>
        <Text variant="rowText" size={15.4} lineHeight={20} color={colors.text.muted} numberOfLines={1} style={styles.restrictionsSub}>
          {label ?? s.restrictionsSubtitle}
        </Text>
      </View>
      <View style={styles.restrictionsSwitch}>
        <OpsSwitch
          testID={`${testID}.switch`}
          value
          locked
          onValueChange={() => undefined}
          onLockedPress={onLockedPress}
          accessibilityLabel={`${label ?? s.restrictionsSubtitle}. ${s.restrictionsLockedTitle}`}
        />
      </View>
    </View>
  );
}

// ── Alertas en tiempo real ────────────────────────────────────────────────────────────────────────────────────────

export interface AlertRulesCardProps {
  operations: AdminOperations;
  variant: "summary" | "detail";
  /** Solo Administración puede editar la operación. */
  canWrite: boolean;
  /** Se está guardando un cambio: todo queda quieto hasta que termine. */
  saving: boolean;
  onToggleMaster: (enabled: boolean) => void;
  onToggleRule: (kind: AdminAlertKind, enabled: boolean) => void;
  /** Guarda los umbrales de una regla; resuelve `true` si el servidor los aceptó. */
  onSaveParams: (kind: AdminAlertKind, params: AdminAlertRuleParams) => Promise<boolean>;
  testID: string;
}

export function AlertRulesCard({ operations, variant, canWrite, saving, onToggleMaster, onToggleRule, onSaveParams, testID }: AlertRulesCardProps): React.JSX.Element {
  const s = opsStrings.tariffs;
  const master = operations.realtimeAlerts.enabled;
  const detail = variant === "detail";
  const lockedForRole = !canWrite;
  return (
    <View style={styles.alerts} testID={testID}>
      <View style={styles.alertsHeader}>
        <Icon name="bell" size={28} color={colors.heading} />
        <Text variant="rowTitle" size={16.1} lineHeight={21} color={colors.heading} numberOfLines={1} style={styles.alertsTitle} accessibilityRole="header">
          {s.alertsTitle}
        </Text>
        <OpsSwitch
          testID={`${testID}.master`}
          value={master}
          disabled={lockedForRole || saving}
          onValueChange={onToggleMaster}
          accessibilityLabel={master ? opsStrings.operations.masterOnA11y : opsStrings.operations.masterOffA11y}
        />
      </View>
      <View style={styles.rules}>
        {operations.realtimeAlerts.rules.map((rule) =>
          detail ? (
            <RuleDetailRow
              key={rule.kind}
              rule={rule}
              canWrite={canWrite}
              saving={saving}
              masterOn={master}
              onToggle={(enabled) => onToggleRule(rule.kind, enabled)}
              onSaveParams={(params) => onSaveParams(rule.kind, params)}
              testID={`${testID}.rule.${rule.kind}`}
            />
          ) : (
            <OpsCheckbox
              key={rule.kind}
              compact
              checked={rule.enabled}
              disabled={lockedForRole || saving}
              onChange={(enabled) => onToggleRule(rule.kind, enabled)}
              label={rule.label}
              accessibilityLabel={opsStrings.operations.ruleA11y(rule.label)}
              testID={`${testID}.rule.${rule.kind}`}
            />
          ),
        )}
      </View>
    </View>
  );
}

interface RuleDetailRowProps {
  rule: AdminAlertRule;
  canWrite: boolean;
  saving: boolean;
  masterOn: boolean;
  onToggle: (enabled: boolean) => void;
  onSaveParams: (params: AdminAlertRuleParams) => Promise<boolean>;
  testID: string;
}

/** Una regla con su casilla, el resumen de su umbral y, desplegable, la edición de los umbrales. */
function RuleDetailRow({ rule, canWrite, saving, masterOn, onToggle, onSaveParams, testID }: RuleDetailRowProps): React.JSX.Element {
  const o = opsStrings.operations;
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<ParamDraft>(() => paramsToDraft(rule.kind, rule.params));
  const [errors, setErrors] = React.useState<ParamErrors>({});

  // Si el servidor cambia los umbrales (guardado propio o de otra persona), el borrador se alinea.
  const serverKey = JSON.stringify(rule.params);
  React.useEffect(() => {
    setDraft(paramsToDraft(rule.kind, rule.params));
    setErrors({});
  }, [serverKey, rule.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const validation = validateParams(rule.kind, draft);
  const dirty = validation.ok ? !sameParams(rule.kind, validation.params, rule.params) : true;
  const labels = o.paramLabels[rule.kind] ?? {};

  const save = async (): Promise<void> => {
    const result = validateParams(rule.kind, draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    await onSaveParams(result.params);
  };

  return (
    <View style={styles.ruleBlock} testID={testID}>
      <OpsCheckbox
        checked={rule.enabled}
        disabled={!canWrite || saving}
        onChange={onToggle}
        label={rule.label}
        accessibilityLabel={o.ruleA11y(rule.label)}
        note={rule.source === "unavailable" ? (rule.sourceNote ?? o.sourceUnavailable) : masterOn ? ruleSummary(rule) : undefined}
        testID={`${testID}.check`}
      />
      {canWrite ? (
        <Pressable
          testID={`${testID}.toggle`}
          accessibilityRole="button"
          accessibilityLabel={`${open ? o.editClose : o.edit}: ${rule.label}`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((v) => !v)}
          style={styles.editToggle}
        >
          <Text variant="rowTextStrong" size={14.5} lineHeight={18} color={colors.text.link} underline>
            {open ? o.editClose : o.edit}
          </Text>
          <Icon name={open ? "chevronUp" : "chevronDown"} size={16} color={colors.text.link} />
        </Pressable>
      ) : null}
      {canWrite && open ? (
        <View style={styles.paramBox}>
          {RULE_PARAM_SPECS[rule.kind].map((spec) => (
            <TextField
              key={spec.key}
              testID={`${testID}.param.${spec.key}`}
              label={labels[spec.key] ?? spec.key}
              variant="labeled"
              value={draft[spec.key] ?? ""}
              onChangeText={(text) => setDraft((d) => ({ ...d, [spec.key]: text.replace(/[^\d]/g, "").slice(0, 5) }))}
              keyboardType="number-pad"
              maxLength={5}
              disabled={saving}
              error={errors[spec.key]}
              helper={`Entre ${spec.min} y ${spec.max}.`}
              style={styles.paramField}
            />
          ))}
          <View style={styles.paramActions}>
            <Button
              testID={`${testID}.save`}
              label={o.paramSave}
              size="sm"
              chevron={false}
              inline
              loading={saving}
              disabled={!dirty || saving}
              onPress={() => {
                void save();
              }}
            />
            <Button
              testID={`${testID}.reset`}
              label={o.paramReset}
              size="sm"
              variant="ghost"
              inline
              disabled={saving}
              onPress={() => {
                setDraft(paramsToDraft(rule.kind, rule.params));
                setErrors({});
              }}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  restrictions: {
    height: 67.5,
    backgroundColor: colors.bg.white,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 16,
  },
  pin: { position: "absolute", left: 16, top: 9.5, width: 26, height: 30, alignItems: "center", justifyContent: "center" },
  restrictionsTexts: { position: "absolute", left: 50, top: 8.5, right: 60 },
  restrictionsSub: { marginTop: 4.5 },
  restrictionsSwitch: { position: "absolute", right: 7, top: 30.5 },

  alerts: {
    marginTop: 9.5,
    backgroundColor: colors.bg.white,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 16,
    paddingTop: 6.5,
    paddingBottom: 6.25,
    paddingLeft: 16,
    paddingRight: 7,
  },
  alertsHeader: { height: 29, flexDirection: "row", alignItems: "center" },
  alertsTitle: { flex: 1, marginLeft: 12, marginTop: -1 },
  rules: { marginTop: 4.25, paddingLeft: 1 },

  ruleBlock: { marginBottom: 4 },
  editToggle: { minHeight: 44, flexDirection: "row", alignItems: "center", columnGap: 4, marginLeft: 33 },
  paramBox: { marginLeft: 33, marginBottom: 6 },
  paramField: { marginBottom: 10 },
  paramActions: { flexDirection: "row", columnGap: 8, alignItems: "center" },
});
