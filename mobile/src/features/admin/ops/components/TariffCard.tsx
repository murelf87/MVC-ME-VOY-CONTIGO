/**
 * Tarjeta «Configuración de tarifas (propuesta)» (lámina 40a/40b): tarifa por km, comisiones, cuota Premium y el
 * ejemplo calculado. Dos aspectos según el DATO del borrador:
 *  · `pending` (40a): comisiones y Premium en cajas «Por definir ⌄» que abren la hoja donde se definen.
 *  · `inputs` (40b): cajas numéricas con «%» para las comisiones y cuota Premium como número.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import type { TariffField, TariffForm, TariffLook } from "../model/tariff";
import { opsStrings } from "../strings";
import { FieldError, FieldLabel, InputBox, SelectBox, Suffix, FIELD_HEIGHT } from "./TariffFields";

export type DefinableField = "driverCommission" | "passengerCommission" | "premium";

export interface TariffCardProps {
  form: TariffForm;
  errors: Partial<Record<TariffField, string>>;
  look: TariffLook;
  /** Sin permiso de escritura o guardando: los campos no se pueden cambiar. */
  disabled: boolean;
  onChange: (field: TariffField, text: string) => void;
  /** Al salir de un campo (los errores se enseñan después de tocarlo). */
  onBlurField?: (field: TariffField) => void;
  onOpenDefinition: (field: DefinableField) => void;
  /** La tarjeta de ejemplo (va dentro de la tarjeta, bajo la cuota Premium). */
  example: React.ReactNode;
  testID: string;
}

export function TariffCard({ form, errors, look, disabled, onChange, onBlurField, onOpenDefinition, example, testID }: TariffCardProps): React.JSX.Element {
  const s = opsStrings.tariffs;
  const inputs = look === "inputs";
  const commissionLabelSize = inputs ? 12.9 : 15.3;

  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.titleRow}>
        <Icon name="opsTagCheck" size={25} color={colors.heading} />
        <Text variant="rowTitle" size={16.4} lineHeight={22} color={colors.heading} numberOfLines={1} style={styles.title} accessibilityRole="header">
          {s.cardTitle}
        </Text>
      </View>

      <FieldLabel text={inputs ? s.rateInputs : s.ratePending} size={inputs ? 14.1 : 15.7} style={styles.rateLabel} />
      <View style={styles.row}>
        <InputBox
          testID={`${testID}.rate`}
          value={form.rate}
          onChangeText={(text) => onChange("rate", text)}
          accessibilityLabel={s.rateA11y}
          error={errors.rate !== undefined}
          disabled={disabled}
          onBlur={() => onBlurField?.("rate")}
          style={styles.flex}
        />
        <Suffix text={s.rateSuffix} width={52} paddingLeft={12} />
      </View>
      {errors.rate !== undefined ? <FieldError message={errors.rate} testID={`${testID}.rate.error`} /> : null}

      <View style={styles.infoRow}>
        <Icon name="infoOutline" size={16} color={colors.primary} />
        <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} style={styles.infoText} numberOfLines={1}>
          {s.provinceInfo}
        </Text>
      </View>

      {inputs ? (
        <View style={styles.commissionRowInputs}>
          <CommissionInputs
            label={s.driverInputs}
            labelSize={commissionLabelSize}
            a11y={s.commissionA11yDriver}
            value={form.driverCommission}
            error={errors.driverCommission}
            disabled={disabled}
            onChange={(text) => onChange("driverCommission", text)}
            onBlur={() => onBlurField?.("driverCommission")}
            widthStyle={styles.colLeftInputs}
            inputWidth={127.5}
            testID={`${testID}.driverCommission`}
          />
          <CommissionInputs
            label={s.passengerInputs}
            labelSize={commissionLabelSize}
            a11y={s.commissionA11yPassenger}
            value={form.passengerCommission}
            error={errors.passengerCommission}
            disabled={disabled}
            onChange={(text) => onChange("passengerCommission", text)}
            onBlur={() => onBlurField?.("passengerCommission")}
            widthStyle={styles.colRightInputs}
            inputWidth={126.5}
            testID={`${testID}.passengerCommission`}
          />
        </View>
      ) : (
        <View style={styles.commissionRowPending}>
          <View style={styles.colPending}>
            <FieldLabel text={s.driverPending} size={commissionLabelSize} />
            <View style={styles.row}>
              <SelectBox
                testID={`${testID}.driverCommission`}
                valueText={form.driverCommission.trim() === "" ? null : form.driverCommission.trim()}
                pendingText={s.pending}
                accessibilityLabel={`${s.driverPending}. ${form.driverCommission.trim() === "" ? s.pending : form.driverCommission}`}
                accessibilityHint={s.selectHint}
                disabled={disabled}
                onPress={() => onOpenDefinition("driverCommission")}
                style={styles.selectLeft}
              />
              <Suffix text={form.driverCommission.trim() === "" ? s.pendingUnit : s.commissionSuffix} width={24} paddingLeft={11.5} />
            </View>
          </View>
          <View style={[styles.colPending, styles.colPendingRight]}>
            <FieldLabel text={s.passengerPending} size={commissionLabelSize} style={styles.labelNudge} />
            <View style={styles.row}>
              <SelectBox
                testID={`${testID}.passengerCommission`}
                valueText={form.passengerCommission.trim() === "" ? null : form.passengerCommission.trim()}
                pendingText={s.pending}
                accessibilityLabel={`${s.passengerPending}. ${form.passengerCommission.trim() === "" ? s.pending : form.passengerCommission}`}
                accessibilityHint={s.selectHint}
                disabled={disabled}
                onPress={() => onOpenDefinition("passengerCommission")}
                style={styles.selectRight}
              />
              <Suffix text={form.passengerCommission.trim() === "" ? s.pendingUnit : s.commissionSuffix} width={27} paddingLeft={14.5} />
            </View>
          </View>
        </View>
      )}
      {errors.driverCommission !== undefined && !inputs ? <FieldError message={errors.driverCommission} testID={`${testID}.driverCommission.error`} /> : null}
      {errors.passengerCommission !== undefined && !inputs ? <FieldError message={errors.passengerCommission} testID={`${testID}.passengerCommission.error`} /> : null}

      <FieldLabel text={s.premiumLabel} size={15} style={styles.premiumLabel} />
      <View style={styles.row}>
        {inputs ? (
          <InputBox
            testID={`${testID}.premium`}
            value={form.premium}
            onChangeText={(text) => onChange("premium", text)}
            placeholder={s.pending}
            placeholderStrong
            accessibilityLabel={s.premiumA11y}
            error={errors.premium !== undefined}
            disabled={disabled}
            onBlur={() => onBlurField?.("premium")}
            style={styles.premiumBox}
          />
        ) : (
          <SelectBox
            testID={`${testID}.premium`}
            valueText={form.premium.trim() === "" ? null : form.premium.trim()}
            pendingText={s.pending}
            accessibilityLabel={`${s.premiumLabel}. ${form.premium.trim() === "" ? s.pending : form.premium}`}
            accessibilityHint={s.selectHint}
            disabled={disabled}
            onPress={() => onOpenDefinition("premium")}
            style={styles.premiumBox}
          />
        )}
        <Suffix text={s.premiumSuffix} width={58} paddingLeft={14} />
      </View>
      {errors.premium !== undefined ? <FieldError message={errors.premium} testID={`${testID}.premium.error`} /> : null}

      {example}
    </View>
  );
}

interface CommissionInputsProps {
  label: string;
  labelSize: number;
  a11y: string;
  value: string;
  error: string | undefined;
  disabled: boolean;
  onChange: (text: string) => void;
  onBlur: () => void;
  widthStyle: object;
  inputWidth: number;
  testID: string;
}

/** Caja numérica + sufijo «%» sobre fondo tintado (lámina 40b): la caja blanca va encima de una pastilla tintada más ancha. */
function CommissionInputs({ label, labelSize, a11y, value, error, disabled, onChange, onBlur, widthStyle, inputWidth, testID }: CommissionInputsProps): React.JSX.Element {
  return (
    <View style={widthStyle}>
      <FieldLabel text={label} size={labelSize} />
      <View style={styles.compound}>
        <View style={styles.addon}>
          <Text variant="label" size={17} lineHeight={20} color={colors.text.muted} style={styles.addonText}>
            {opsStrings.tariffs.commissionSuffix}
          </Text>
        </View>
        <InputBox
          testID={testID}
          value={value}
          onChangeText={onChange}
          accessibilityLabel={a11y}
          error={error !== undefined}
          disabled={disabled}
          maxLength={6}
          onBlur={onBlur}
          style={{ width: inputWidth, position: "absolute", left: 0, top: 0 }}
        />
      </View>
      {error !== undefined ? <FieldError message={error} testID={`${testID}.error`} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.white,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 16,
    paddingTop: 6.5,
    paddingBottom: 7,
    paddingHorizontal: 13,
  },
  titleRow: { height: 24, flexDirection: "row", alignItems: "center" },
  title: { marginLeft: 11, flex: 1 },
  rateLabel: { marginTop: 5 },
  row: { flexDirection: "row", alignItems: "center", height: FIELD_HEIGHT },
  flex: { flex: 1 },
  infoRow: { flexDirection: "row", alignItems: "center", height: 16, marginTop: 5.5, marginLeft: -1 },
  infoText: { marginLeft: 8, flex: 1 },
  commissionRowPending: { flexDirection: "row", marginTop: 13 },
  colPending: { width: 157 },
  colPendingRight: { marginLeft: 28 },
  labelNudge: { marginLeft: 1 },
  selectLeft: { width: 133, marginLeft: -0.5 },
  selectRight: { width: 129.5 },
  commissionRowInputs: { flexDirection: "row", marginTop: 13 },
  colLeftInputs: { width: 165, marginLeft: -1 },
  colRightInputs: { width: 163.5, marginLeft: 20, marginRight: -5.5 },
  compound: { height: FIELD_HEIGHT, justifyContent: "center" },
  addon: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    height: FIELD_HEIGHT,
    borderRadius: 10,
    backgroundColor: colors.bg.tint,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  addonText: { width: 38, textAlign: "center" },
  premiumLabel: { marginTop: 14 },
  premiumBox: { flex: 1, marginLeft: -1.5 },
});
