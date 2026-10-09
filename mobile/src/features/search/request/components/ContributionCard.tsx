/**
 * «Detalle de la aportación» de 15 (y su variante semanal): tarjeta tintada con el desglose dentro de una tarjeta
 * blanca y la barra «Total». Solo da formato a un `QuoteView` (el servidor decide cada importe); mientras la economía
 * no está definida enseña «Por definir», nunca un importe inventado.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";
import type { QuoteView } from "../logic/quoteView";
import { requestStrings } from "../strings";

const SEPARATOR = " · ";

/** «Gestión MVC · Por definir» → la segunda parte va en seminegrita, como la lámina. */
function SplitLabel({ label, size }: { label: string; size: number }): React.JSX.Element {
  const at = label.indexOf(SEPARATOR);
  if (at < 0) {
    return (
      <Text variant="body" color="body" size={size} lineHeight={Math.round(size * 1.25)}>
        {label}
      </Text>
    );
  }
  return (
    <Text variant="body" color="body" size={size} lineHeight={Math.round(size * 1.25)}>
      {label.slice(0, at + SEPARATOR.length)}
      <Text variant="bodyStrong" color="strong" size={size} lineHeight={Math.round(size * 1.25)}>
        {label.slice(at + SEPARATOR.length)}
      </Text>
    </Text>
  );
}

export interface ContributionCardProps {
  view: QuoteView;
  onFeeHelp: () => void;
  testID?: string;
}

export function ContributionCard({ view, onFeeHelp, testID = "ContributionCard" }: ContributionCardProps): React.JSX.Element {
  return (
    <View testID={testID} style={styles.card}>
      <Text variant="heading" color="strong" size={19.5} lineHeight={24} accessibilityRole="header" style={styles.title}>
        {view.heading}
      </Text>
      <View style={styles.inner}>
        {view.lines.map((line, index) => (
          <View key={line.key} style={[styles.line, index > 0 ? styles.lineGap : null]}>
            <View style={styles.lineText}>
              <Text variant="body" color="body" size={18.5} lineHeight={23}>
                {line.label}
              </Text>
              {line.caption !== undefined ? (
                <Text variant="caption" color="subtle" size={15} lineHeight={19}>
                  {line.caption}
                </Text>
              ) : null}
            </View>
            {line.value !== undefined ? (
              <Text variant="bodyStrong" color="strong" size={19} align="right" style={styles.value}>
                {line.value}
              </Text>
            ) : null}
          </View>
        ))}
        {view.layout === "perTrip" ? <View style={styles.rule} /> : null}
        <View style={[styles.fee, view.layout === "weekly" ? styles.feeWeekly : null]}>
          <View style={styles.lineText}>
            <SplitLabel label={view.fee.label} size={18.5} />
          </View>
          {view.fee.value !== null ? (
            <Text variant="bodyStrong" color="strong" size={19} align="right" style={styles.value}>
              {view.fee.value}
            </Text>
          ) : null}
          <Pressable
            testID={`${testID}.feeHelp`}
            accessibilityRole="button"
            accessibilityLabel={requestStrings.review.feeHelpTitle}
            onPress={onFeeHelp}
            hitSlop={12}
            style={styles.help}
          >
            <Icon name="help" size={26} color={colors.gray.help} />
          </Pressable>
        </View>
      </View>
      <View testID={`${testID}.total`} accessible accessibilityLabel={`${view.total.label}: ${view.total.value}`} style={styles.total}>
        <Text variant="heading" color="heading" size={21} lineHeight={26} style={styles.totalLabel}>
          {view.total.label}
        </Text>
        <Text variant="heading" color="heading" size={21} lineHeight={26} align="right">
          {view.total.value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bg.tint, borderRadius: radii.xl, paddingHorizontal: 6, paddingTop: 11, paddingBottom: 6 },
  title: { marginLeft: 8, marginBottom: 9 },
  inner: { backgroundColor: colors.bg.white, borderRadius: radii.lg, paddingHorizontal: 14, paddingVertical: 10 },
  line: { flexDirection: "row", alignItems: "flex-start" },
  lineGap: { marginTop: 4 },
  lineText: { flex: 1 },
  value: { marginLeft: 10 },
  rule: { height: 1, backgroundColor: colors.border.divider, marginTop: 8, marginBottom: 6 },
  fee: { flexDirection: "row", alignItems: "center", minHeight: 40 },
  feeWeekly: { marginTop: 4 },
  help: { marginLeft: 10, minWidth: 28, minHeight: 28, alignItems: "center", justifyContent: "center" },
  total: {
    minHeight: 46,
    marginTop: 4,
    borderRadius: radii.md,
    backgroundColor: colors.bg.tintStrong,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  totalLabel: { flex: 1, marginRight: 8 },
});
