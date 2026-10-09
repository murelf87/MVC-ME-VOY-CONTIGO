/**
 * Tarjeta de una alerta de operación: gravedad y estado, título, texto, cuándo se detectó, a qué provincia afecta y, si se
 * quiere, los datos que la originaron (solo identificadores y recuentos). Acciones: Reconocer y Resolver (A S).
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { AdminAlert, AdminAlertSeverity, AdminAlertStatus } from "@/api/types";
import { formatDateTime } from "@/i18n";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Button, StatusPill, Text, type StatusTone } from "@/ui";
import { metadataRows } from "../model/audit";
import { opsStrings } from "../strings";

const SEVERITY_TONE: Record<AdminAlertSeverity, StatusTone> = { info: "blue", warning: "amber", critical: "red" };
const STATUS_TONE: Record<AdminAlertStatus, StatusTone> = { open: "orange", acknowledged: "blue", resolved: "green" };

export interface AlertCardProps {
  alert: AdminAlert;
  canWrite: boolean;
  /** Hay una acción en curso sobre esta alerta. */
  busy: boolean;
  onAcknowledge: (alert: AdminAlert) => void;
  onResolve: (alert: AdminAlert) => void;
  testID: string;
}

export function AlertCard({ alert, canWrite, busy, onAcknowledge, onResolve, testID }: AlertCardProps): React.JSX.Element {
  const s = opsStrings.alerts;
  const [open, setOpen] = React.useState(false);
  const rows = metadataRows(alert.data);
  const handled =
    alert.resolvedAt !== null ? s.resolvedAt(formatDateTime(alert.resolvedAt)) : alert.acknowledgedAt !== null ? s.acknowledgedAt(formatDateTime(alert.acknowledgedAt)) : null;
  const canAcknowledge = canWrite && alert.status === "open";
  const canResolve = canWrite && alert.status !== "resolved";
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.pills}>
        <StatusPill label={s.severity[alert.severity]} tone={SEVERITY_TONE[alert.severity]} size="sm" testID={`${testID}.severity`} />
        <StatusPill label={s.status[alert.status]} tone={STATUS_TONE[alert.status]} size="sm" outlined testID={`${testID}.status`} />
      </View>
      <Text variant="rowTitle" size={16.3} lineHeight={21} color={colors.heading} style={styles.title} testID={`${testID}.title`}>
        {alert.title}
      </Text>
      <Text variant="rowText" size={14.5} lineHeight={19} color={colors.text.body} testID={`${testID}.body`}>
        {alert.body}
      </Text>
      <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted} style={styles.when}>
        {s.detected(formatDateTime(alert.detectedAt))}
        {alert.province !== null ? ` · ${s.province(alert.province.name)}` : ""}
      </Text>
      {handled !== null ? (
        <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted}>
          {handled}
        </Text>
      ) : null}

      <Pressable
        testID={`${testID}.dataToggle`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${open ? s.dataHide : s.dataShow}: ${alert.title}`}
        onPress={() => setOpen((v) => !v)}
        style={styles.toggle}
      >
        <Text variant="rowTextStrong" size={14.5} lineHeight={18} color={colors.text.link} underline>
          {open ? s.dataHide : s.dataShow}
        </Text>
        <Icon name={open ? "chevronUp" : "chevronDown"} size={16} color={colors.text.link} />
      </Pressable>
      {open ? (
        <View style={styles.data} testID={`${testID}.data`}>
          {rows.length === 0 ? (
            <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted}>
              {s.noData}
            </Text>
          ) : (
            rows.map((row) => (
              <View key={row.key} style={styles.dataRow}>
                <Text variant="rowText" size={13.5} lineHeight={17} color={colors.text.muted} style={styles.dataKey}>
                  {s.dataLabels[row.key] ?? row.key}
                </Text>
                <Text variant="rowTextStrong" size={13.5} lineHeight={17} color={colors.text.strong} style={styles.dataValue}>
                  {row.value}
                </Text>
              </View>
            ))
          )}
        </View>
      ) : null}

      {canAcknowledge || canResolve ? (
        <View style={styles.actions}>
          {canAcknowledge ? (
            <Button
              testID={`${testID}.acknowledge`}
              label={s.acknowledge}
              variant="outline"
              size="sm"
              chevron={false}
              inline
              disabled={busy}
              onPress={() => onAcknowledge(alert)}
            />
          ) : null}
          {canResolve ? (
            <Button testID={`${testID}.resolve`} label={s.resolve} size="sm" chevron={false} inline disabled={busy} loading={busy} onPress={() => onResolve(alert)} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.white,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 16,
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 13,
  },
  pills: { flexDirection: "row", columnGap: 6, marginBottom: 8 },
  title: { marginBottom: 3 },
  when: { marginTop: 8 },
  toggle: { minHeight: 44, flexDirection: "row", alignItems: "center", columnGap: 4 },
  data: { backgroundColor: colors.bg.tintSoft, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 4 },
  dataRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", minHeight: 24, columnGap: 10 },
  dataKey: { flex: 1 },
  dataValue: { flexShrink: 1, textAlign: "right" },
  actions: { flexDirection: "row", columnGap: 8, marginTop: 6 },
});
