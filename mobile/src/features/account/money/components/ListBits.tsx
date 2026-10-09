/**
 * Piezas pequeñas que comparten las pantallas de dinero (historial, recibos, devoluciones…): filtros en píldoras, pie de
 * lista con «Ver más» y error de carga de más, tarjeta de detalle y fila etiqueta/valor.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colors } from "@/theme";
import { Button, StatusPill, Text, type StatusTone } from "@/ui";
import type { TrackingStep } from "../model";

export interface FilterOption<T extends string> {
  value: T | null;
  label: string;
}

export function FilterPills<T extends string>({ options, value, onChange, a11yLabel, testID }: { options: readonly FilterOption<T>[]; value: T | null; onChange: (value: T | null) => void; a11yLabel: string; testID: string }): React.JSX.Element {
  return (
    <View style={styles.pills} accessibilityRole="tablist" accessibilityLabel={a11yLabel} testID={testID}>
      {options.map((option) => (
        <Pressable
          key={option.value ?? "all"}
          testID={`${testID}.opt-${option.value ?? "all"}`}
          accessibilityRole="tab"
          accessibilityState={{ selected: option.value === value }}
          onPress={() => onChange(option.value)}
          style={[styles.pill, option.value === value ? styles.pillOn : null]}
        >
          <Text variant="rowTextStrong" size={15.5} color={option.value === value ? "inverse" : "link"}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ListFooter({ hasMore, loading, error, errorText, moreLabel, onMore, testID }: { hasMore: boolean; loading: boolean; error: boolean; errorText: string; moreLabel: string; onMore: () => void; testID: string }): React.JSX.Element | null {
  if (!hasMore && !error) return null;
  return (
    <View style={styles.footer}>
      {error ? <Text variant="body" color="error" size={15} testID={`${testID}.error`}>{errorText}</Text> : null}
      <Button testID={testID} label={moreLabel} variant="outline" chevron={false} loading={loading} onPress={onMore} />
    </View>
  );
}

export function DetailCard({ children, testID }: { children: React.ReactNode; testID?: string }): React.JSX.Element {
  return <View style={styles.card} testID={testID}>{children}</View>;
}

export function DetailRow({ label, value, strong = false, tag }: { label: string; value: string; strong?: boolean; tag?: string }): React.JSX.Element {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}${tag ? `, ${tag}` : ""}`}>
      <Text variant="body" color="muted" size={16} style={styles.flex}>{label}</Text>
      <Text variant={strong ? "titleSm" : "body"} color={strong ? "heading" : "deep"} size={strong ? 19 : 16.5}>{value}</Text>
      {tag ? <Text variant="body" color="muted" size={13}>{tag}</Text> : null}
    </View>
  );
}

const STEP_TONE: Record<TrackingStep["state"], StatusTone> = { done: "green", current: "amber", upcoming: "gray", failed: "red", skipped: "gray" };
const STEP_MARK: Record<TrackingStep["state"], string> = { done: "✓", current: "●", upcoming: "○", failed: "✕", skipped: "–" };

export function TrackingList({ steps, testID }: { steps: readonly TrackingStep[]; testID: string }): React.JSX.Element {
  return (
    <View style={styles.tracking} testID={testID}>
      {steps.map((step) => (
        <View key={step.key} style={styles.step} accessible accessibilityLabel={`${step.title}. ${step.detail}`} testID={`${testID}.${step.key}`}>
          <StatusPill label={STEP_MARK[step.state]} tone={STEP_TONE[step.state]} size="sm" />
          <View style={styles.flex}>
            <Text variant="titleSm" color={step.state === "upcoming" || step.state === "skipped" ? "muted" : "heading"} size={17}>{step.title}</Text>
            <Text variant="body" color="body" size={15}>{step.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pill: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.primary, justifyContent: "center", backgroundColor: "#FFFFFF" },
  pillOn: { backgroundColor: colors.primary },
  footer: { marginTop: 14, gap: 8 },
  card: { marginTop: 12, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  tracking: { gap: 12, marginTop: 4 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
});
