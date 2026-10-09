/**
 * Tarjeta de ejemplo de la tarifa (lámina 40a/40b). Los importes los CALCULA el servidor (`POST /v1/admin/tariffs/example`,
 * sin guardar nada); aquí solo se presentan:
 *  · aspecto «pending» (40a): «Ejemplo de aportación» · «18 km × 0,30 €/km» · «5,40 €» · «Antes de gestión y del límite…».
 *  · aspecto «inputs» (40b): «Precio final para el pasajero (ejemplo)» · «Trayecto de 18 km (propuesta)» · total para el
 *    pasajero. La lámina muestra 3,24 € (que es solo la aportación); con la comisión del pasajero el total es 3,56 €: se
 *    muestra lo que devuelve la API y, al tocar, el desglose completo (aportación, comisiones, total y neto).
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { AdminTariffExample } from "@/api/types";
import { formatMoney, moneyParts } from "@/i18n";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import { exampleLine, exampleTripLine, type TariffLook } from "../model/tariff";
import { opsStrings } from "../strings";

export interface ExampleCardProps {
  look: TariffLook;
  example: AdminTariffExample | undefined;
  /** Distancia del ejemplo en metros. */
  distanceMeters: number;
  /** Tarifa escrita en el formulario (micro-euros) para el rótulo cuando aún no hay respuesta. */
  rateMicros: number | null;
  /** Se está calculando y todavía no hay ningún resultado. */
  loading: boolean;
  /** El formulario tiene errores: no se calcula nada a medias. */
  invalid: boolean;
  /** El cálculo falló (y no hay resultado anterior). */
  failed: boolean;
  expanded: boolean;
  onToggle: () => void;
  testID: string;
  children?: React.ReactNode;
}

interface BreakdownLine {
  key: string;
  label: string;
  value: string;
  strong?: boolean;
}

function breakdown(example: AdminTariffExample): BreakdownLine[] {
  const s = opsStrings.tariffs.breakdown;
  return [
    { key: "contribution", label: s.contribution, value: formatMoney(example.contribution) },
    { key: "passengerCommission", label: s.passengerCommission, value: formatMoney(example.passengerCommission) },
    { key: "passengerTotal", label: s.passengerTotal, value: formatMoney(example.passengerTotal), strong: true },
    { key: "driverCommission", label: s.driverCommission, value: formatMoney(example.driverCommission) },
    { key: "driverNet", label: s.driverNet, value: formatMoney(example.driverNet), strong: true },
  ];
}

export function ExampleCard({
  look,
  example,
  distanceMeters,
  rateMicros,
  loading,
  invalid,
  failed,
  expanded,
  onToggle,
  testID,
  children,
}: ExampleCardProps): React.JSX.Element {
  const s = opsStrings.tariffs;
  const inputs = look === "inputs";
  const title = inputs ? s.exampleTitleInputs : s.exampleTitlePending;

  const money = example === undefined ? null : inputs ? example.passengerTotal : example.contribution;
  const parts = money === null ? null : moneyParts(money);
  let amount: string;
  if (parts !== null) amount = parts.text;
  else if (invalid) amount = s.pending;
  else if (loading) amount = "…";
  else amount = s.pending;

  const line = inputs ? exampleTripLine(distanceMeters, s.exampleTrip) : exampleLine(distanceMeters, example?.ratePerKmMicros ?? rateMicros, s.rateShortPending);
  let caption: string;
  if (invalid) caption = s.exampleInvalid;
  else if (failed) caption = s.exampleUnavailable;
  else if (loading && example === undefined) caption = s.exampleLoading;
  else caption = inputs ? s.exampleCaptionInputs : (example?.disclaimer ?? s.exampleCaptionInputs);

  const body = (
    <>
      <View style={styles.titleRow}>
        <Text variant="rowTitle" weight={inputs ? "semibold" : "bold"} size={inputs ? 15.2 : 17.5} lineHeight={21} color={colors.heading} numberOfLines={1} style={styles.titleText}>
          {title}
        </Text>
        {inputs ? <Icon name={expanded ? "chevronUp" : "chevronDown"} size={18} color={colors.heading} /> : null}
      </View>
      <View style={styles.valueRow}>
        <Text variant="lead" size={inputs ? 17.5 : 19} lineHeight={24} color={colors.text.body} numberOfLines={1} style={styles.line}>
          {line}
        </Text>
        <Text variant="kpi" size={parts !== null && !parts.pending ? 31 : 22} lineHeight={36} color={colors.text.strong} numberOfLines={1} testID={`${testID}.amount`}>
          {amount}
        </Text>
      </View>
      <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} numberOfLines={2} testID={`${testID}.caption`}>
        {caption}
      </Text>
    </>
  );

  return (
    <View style={styles.card} testID={testID}>
      {inputs ? (
        <Pressable
          testID={`${testID}.toggle`}
          accessibilityRole="button"
          accessibilityLabel={`${title}. ${line}. ${amount}`}
          accessibilityHint={s.exampleExpandHint}
          accessibilityState={{ expanded }}
          onPress={onToggle}
        >
          {body}
        </Pressable>
      ) : (
        <View>{body}</View>
      )}
      {inputs && expanded && example !== undefined ? (
        <View style={styles.breakdown} testID={`${testID}.breakdown`}>
          <Text variant="rowTitle" size={14} lineHeight={18} color={colors.heading}>
            {`${s.breakdownTitle} (${s.breakdownTag})`}
          </Text>
          {breakdown(example).map((row) => (
            <View key={row.key} style={styles.breakdownRow}>
              <Text variant="rowText" size={14.5} lineHeight={18} color={colors.text.muted} style={styles.breakdownLabel}>
                {row.label}
              </Text>
              <Text variant="rowTextStrong" weight={row.strong === true ? "bold" : "medium"} size={14.5} lineHeight={18} color={colors.text.strong}>
                {row.value}
              </Text>
            </View>
          ))}
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginLeft: -1,
    marginRight: -13,
    marginTop: 11,
    backgroundColor: colors.tile.blue,
    borderRadius: 14,
    paddingTop: 10,
    paddingBottom: 7,
    paddingLeft: 14.5,
    paddingRight: 16.5,
  },
  titleRow: { flexDirection: "row", alignItems: "center", height: 21 },
  titleText: { flex: 1 },
  valueRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 36, marginTop: 0 },
  line: { flex: 1, paddingRight: 8 },
  breakdown: { marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border.tint },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 26 },
  breakdownLabel: { flex: 1, paddingRight: 8 },
});
