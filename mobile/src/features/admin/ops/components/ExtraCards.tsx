/**
 * Tarjetas de la pestaña Tarifas que quedan bajo el pliegue de la lámina 40: otros datos del borrador (límite de gastos
 * compartidos, notas, distancia del ejemplo), tarifa en vigor y activación. La activación está BLOQUEADA mientras la
 * economía no esté activada (`ECONOMICS_ACTIVATION`): se muestra como estado, no como un botón que falla.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { AdminTariffOverview, AdminTariffPublishRequest, AdminTariffVersion } from "@/api/types";
import { formatDateTime } from "@/i18n";
import { colors } from "@/theme";
import { BottomSheet, Banner, Button, StatusPill, Text, TextArea, TextField } from "@/ui";
import { formatCapLabel, formatCommissionLabel, formatPremiumLabel, formatRateLabel } from "../model/money";
import { NOTES_MAX_LENGTH, validateActivation, type ActivationErrors } from "../model/tariff";
import { opsStrings } from "../strings";
import { PanelCard } from "./PanelCard";

// ── Otros datos del borrador ──────────────────────────────────────────────────────────────────────────────────────

export interface DraftExtrasCardProps {
  /** «Borrador v3 · actualizado 5 oct 2026 · 08:12 · Administración MVC» o el aviso de que aún no hay borrador. */
  meta: string;
  cap: string;
  capError?: string;
  notes: string;
  notesError?: string;
  distance: string;
  distanceError?: string;
  disabled: boolean;
  dirty: boolean;
  onChangeCap: (text: string) => void;
  onChangeNotes: (text: string) => void;
  onChangeDistance: (text: string) => void;
  onBlurField: (field: "cap" | "notes") => void;
  onDiscard: () => void;
  testID: string;
}

export function DraftExtrasCard({
  meta,
  cap,
  capError,
  notes,
  notesError,
  distance,
  distanceError,
  disabled,
  dirty,
  onChangeCap,
  onChangeNotes,
  onChangeDistance,
  onBlurField,
  onDiscard,
  testID,
}: DraftExtrasCardProps): React.JSX.Element {
  const s = opsStrings.tariffs;
  return (
    <PanelCard title={s.extrasTitle} icon="opsFileEdit" testID={testID}>
      <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} testID={`${testID}.meta`}>
        {meta}
      </Text>
      <TextField
        testID={`${testID}.cap`}
        label={s.capLabel}
        variant="labeled"
        value={cap}
        onChangeText={onChangeCap}
        onBlur={() => onBlurField("cap")}
        keyboardType="decimal-pad"
        maxLength={10}
        disabled={disabled}
        error={capError}
        helper={s.capHelper}
        trailing={
          <Text variant="label" size={15} lineHeight={20} color={colors.text.muted}>
            {s.capSuffix}
          </Text>
        }
        style={styles.field}
      />
      <TextField
        testID={`${testID}.distance`}
        label={s.distanceLabel}
        variant="labeled"
        value={distance}
        onChangeText={onChangeDistance}
        keyboardType="decimal-pad"
        maxLength={8}
        error={distanceError}
        helper={s.distanceHelper}
        trailing={
          <Text variant="label" size={15} lineHeight={20} color={colors.text.muted}>
            km
          </Text>
        }
        style={styles.field}
      />
      <Text variant="label" size={15} lineHeight={19} color={colors.text.muted} style={styles.notesLabel}>
        {s.notesLabel}
      </Text>
      <TextArea
        testID={`${testID}.notes`}
        value={notes}
        onChangeText={onChangeNotes}
        onBlur={() => onBlurField("notes")}
        placeholder={s.notesPlaceholder}
        maxLength={NOTES_MAX_LENGTH}
        minHeight={96}
        disabled={disabled}
        error={notesError}
        accessibilityLabel={s.notesLabel}
      />
      {dirty ? (
        <View style={styles.discardRow}>
          <StatusPill label={s.unsavedBadge} tone="amber" size="sm" testID={`${testID}.unsaved`} />
          <Button
            testID={`${testID}.discard`}
            label={s.discard}
            variant="ghost"
            size="sm"
            chevron={false}
            inline
            accessibilityLabel={s.discardA11y}
            onPress={onDiscard}
          />
        </View>
      ) : null}
    </PanelCard>
  );
}

// ── Tarifa en vigor ───────────────────────────────────────────────────────────────────────────────────────────────

export interface ActiveTariffCardProps {
  active: AdminTariffVersion | null;
  testID: string;
}

export function ActiveTariffCard({ active, testID }: ActiveTariffCardProps): React.JSX.Element {
  const s = opsStrings.tariffs;
  const pending = opsStrings.common.pending;
  if (active === null) {
    return (
      <PanelCard title={s.activeTitle} icon="opsTagCheck" testID={testID}>
        <Text variant="rowTitle" size={15.5} lineHeight={20} color={colors.heading} testID={`${testID}.none`}>
          {s.activeNone}
        </Text>
        <Text variant="rowText" size={14} lineHeight={19} color={colors.text.muted} style={styles.detail}>
          {s.activeNoneDetail}
        </Text>
      </PanelCard>
    );
  }
  const rows: Array<{ key: string; label: string; value: string }> = [
    { key: "rate", label: s.activeRate, value: formatRateLabel(active.ratePerKmMicros, pending) },
    { key: "driver", label: s.activeDriver, value: formatCommissionLabel(active.driverCommissionBps, pending) },
    { key: "passenger", label: s.activePassenger, value: formatCommissionLabel(active.passengerCommissionBps, pending) },
    { key: "premium", label: s.activePremium, value: formatPremiumLabel(active.premiumMonthlyCents, pending) },
    { key: "cap", label: s.activeCap, value: formatCapLabel(active.sharedCostCapCents, s.capNone) },
  ];
  return (
    <PanelCard
      title={s.activeTitle}
      icon="opsTagCheck"
      right={<StatusPill label={s.activeVersion(active.version)} tone="green" size="sm" />}
      testID={testID}
    >
      {active.effectiveFrom !== null ? (
        <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted}>
          {s.activeFrom(formatDateTime(active.effectiveFrom))}
        </Text>
      ) : null}
      <View style={styles.rows}>
        {rows.map((row) => (
          <View key={row.key} style={styles.kv} testID={`${testID}.${row.key}`} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
            <Text variant="rowText" size={14.5} lineHeight={18} color={colors.text.muted} style={styles.kvLabel}>
              {row.label}
            </Text>
            <Text variant="rowTextStrong" size={14.5} lineHeight={18} color={colors.text.strong}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>
      {active.approvalReference !== null ? (
        <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} style={styles.detail}>
          {s.approvalRef(active.approvalReference)}
        </Text>
      ) : null}
    </PanelCard>
  );
}

// ── Activación ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ActivationCardProps {
  activation: AdminTariffOverview["activation"];
  /** Solo Administración activa tarifas. */
  canActivate: boolean;
  /** Texto de por qué todavía no se puede activar (borrador incompleto, cambios sin guardar…); `null` = se puede. */
  notReadyReason: string | null;
  onActivate: () => void;
  testID: string;
}

export function ActivationCard({ activation, canActivate, notReadyReason, onActivate, testID }: ActivationCardProps): React.JSX.Element {
  const s = opsStrings.tariffs;
  const blocked = !activation.canPublish;
  return (
    <PanelCard
      title={s.activationTitle}
      icon="lock"
      right={
        blocked ? (
          <StatusPill label={s.activationBlocked} tone="amber" icon="lock" size="sm" testID={`${testID}.status`} />
        ) : (
          <StatusPill label={s.activationAvailable} tone="green" size="sm" testID={`${testID}.status`} />
        )
      }
      testID={testID}
    >
      <Text variant="rowText" size={14.5} lineHeight={19} color={colors.text.body} testID={`${testID}.message`}>
        {activation.message}
      </Text>
      {blocked ? (
        <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} style={styles.detail}>
          {s.activationBlockedFootnote}
        </Text>
      ) : canActivate ? (
        <View style={styles.activateBox}>
          <Button
            testID={`${testID}.activate`}
            label={s.activate}
            variant="outline"
            size="sm"
            chevron={false}
            disabled={notReadyReason !== null}
            onPress={onActivate}
          />
          {notReadyReason !== null ? (
            <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} style={styles.detail} testID={`${testID}.reason`}>
              {notReadyReason}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} style={styles.detail} testID={`${testID}.adminOnly`}>
          {s.activateAdminOnly}
        </Text>
      )}
    </PanelCard>
  );
}

// ── Hoja de activación ────────────────────────────────────────────────────────────────────────────────────────────

export interface ActivateSheetProps {
  visible: boolean;
  busy: boolean;
  /** Error que devolvió el servidor al intentar activar. */
  serverError: string | null;
  onClose: () => void;
  onSubmit: (request: AdminTariffPublishRequest) => void;
}

export function ActivateSheet({ visible, busy, serverError, onClose, onSubmit }: ActivateSheetProps): React.JSX.Element {
  const a = opsStrings.activate;
  const [reference, setReference] = React.useState("");
  const [date, setDate] = React.useState("");
  const [errors, setErrors] = React.useState<ActivationErrors>({});

  React.useEffect(() => {
    if (visible) {
      setReference("");
      setDate("");
      setErrors({});
    }
  }, [visible]);

  const submit = (): void => {
    const result = validateActivation(reference, date, Date.now());
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.request);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={busy ? () => undefined : onClose}
      dismissable={!busy}
      title={a.title}
      subtitle={a.message}
      testID="OpsActivateSheet"
      footer={
        <View>
          <Button label={a.confirm} chevron={false} loading={busy} onPress={submit} testID="OpsActivateSheet.confirm" />
          <Button label={opsStrings.common.cancel} variant="outline" chevron={false} disabled={busy} onPress={onClose} testID="OpsActivateSheet.cancel" style={styles.second} />
        </View>
      }
    >
      {serverError !== null ? <Banner kind="error" size="xs" message={serverError} testID="OpsActivateSheet.error" style={styles.field} /> : null}
      <TextField
        testID="OpsActivateSheet.reference"
        label={a.referenceLabel}
        variant="labeled"
        value={reference}
        onChangeText={(text) => {
          setReference(text);
          if (errors.reference !== undefined) setErrors((e) => ({ ...e, reference: undefined }));
        }}
        placeholder={a.referencePlaceholder}
        maxLength={300}
        autoCapitalize="characters"
        disabled={busy}
        error={errors.reference}
        style={styles.field}
      />
      <TextField
        testID="OpsActivateSheet.date"
        label={a.dateLabel}
        variant="labeled"
        value={date}
        onChangeText={(text) => {
          setDate(text);
          if (errors.effectiveFrom !== undefined) setErrors((e) => ({ ...e, effectiveFrom: undefined }));
        }}
        placeholder={a.datePlaceholder}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        disabled={busy}
        error={errors.effectiveFrom}
        style={styles.field}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  field: { marginTop: 12 },
  notesLabel: { marginTop: 14, marginBottom: 6 },
  discardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  detail: { marginTop: 6 },
  rows: { marginTop: 8 },
  kv: { minHeight: 32, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kvLabel: { flex: 1, paddingRight: 10 },
  activateBox: { marginTop: 10 },
  second: { marginTop: 10 },
});
