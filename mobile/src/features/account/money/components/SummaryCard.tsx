import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, IconTile } from "@/icons";
import { colors } from "@/theme";
import { Text, surfaces } from "@/ui";
import type { AmountView } from "../model";
import { ink, lineTop, summarySpec, type SummaryDensity, type SummaryLeading } from "./metrics";

export interface SummaryCardProps {
  /** `blue` = «Pendiente este mes» (lo que pagarás); `green` = «A cobrar este mes» (lo que cobrarás). */
  tone: "blue" | "green";
  leading: SummaryLeading;
  /** `compact` = la versión de dos tarjetas apiladas de la lámina 33a. */
  density?: SummaryDensity;
  title: string;
  amount: AmountView;
  caption: string;
  onPress: () => void;
  accessibilityHint?: string;
  testID: string;
}

interface Palette {
  background: string;
  border: string;
  pressed: string;
  title: string;
  amount: string;
  caption: string;
  icon: string;
}

function paletteOf(tone: "blue" | "green", density: SummaryDensity): Palette {
  if (tone === "blue") {
    return {
      background: surfaces.blue.background,
      border: surfaces.blue.border,
      pressed: surfaces.blue.pressed,
      title: colors.heading,
      amount: colors.heading,
      caption: colors.text.deep,
      icon: colors.heading,
    };
  }
  const text = density === "compact" ? ink.greenCard33 : ink.greenCard34;
  return {
    background: colors.tile.green,
    border: surfaces.green.border,
    pressed: surfaces.green.pressed,
    title: text.title,
    amount: text.amount,
    caption: text.caption,
    icon: colors.success.solid,
  };
}

/**
 * Tarjeta grande de la lámina 33: «Pendiente este mes · 24,00 € · 2 próximos viajes» (azul) y «A cobrar este mes ·
 * 48,00 € · 4 viajes realizados» (verde). Una pulsación abre el historial. Con el importe sin definir enseña `--,-- €`
 * (nunca un importe inventado).
 */
export function SummaryCard({ tone, leading, density = "regular", title, amount, caption, onPress, accessibilityHint, testID }: SummaryCardProps): React.JSX.Element {
  const spec = summarySpec(leading, density);
  const palette = paletteOf(tone, density);
  const titleTop = lineTop(spec.title.baseline, spec.title.size, spec.title.line);
  const amountTop = lineTop(spec.amount.baseline, spec.amount.size, spec.amount.line);
  const captionTop = lineTop(spec.caption.baseline, spec.caption.size, spec.caption.line);
  const label = `${title}. ${amount.spoken}. ${caption}`;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { minHeight: spec.height, borderRadius: spec.radius, backgroundColor: pressed ? palette.pressed : palette.background, borderColor: palette.border },
      ]}
    >
      <View style={[styles.icon, { left: spec.icon.left - 1, top: spec.icon.top - 1, width: spec.icon.size, height: spec.icon.size }]} aria-hidden>
        {leading === "clock" ? (
          <Icon name="clock" size={spec.icon.size} color={palette.icon} />
        ) : (
          <IconTile name="coins" tone="solidGreen" size={spec.icon.size} iconSize={spec.icon.glyph ?? Math.round(spec.icon.size * 0.55)} />
        )}
      </View>

      <View style={{ paddingLeft: spec.textLeft - 1, paddingTop: titleTop - 1, paddingRight: 44, paddingBottom: 12 }}>
        <Text variant="heading" weight="bold" color={palette.title} size={spec.title.size} lineHeight={spec.title.line} letterSpacing={-0.2} numberOfLines={1}>
          {title}
        </Text>
        <Text
          variant="kpi"
          weight="bold"
          color={amount.pending ? colors.heading : palette.amount}
          size={spec.amount.size}
          lineHeight={spec.amount.line}
          letterSpacing={-0.4}
          numberOfLines={1}
          style={{ marginTop: amountTop - (titleTop + spec.title.line) }}
        >
          {amount.hero}
        </Text>
        <Text
          variant="subtitle"
          color={palette.caption}
          size={spec.caption.size}
          lineHeight={spec.caption.line}
          numberOfLines={1}
          style={{ marginTop: captionTop - (amountTop + spec.amount.line) }}
        >
          {caption}
        </Text>
      </View>

      <View style={[styles.chevron, { right: spec.chevron.right - 1, top: spec.chevron.centerY - spec.chevron.size / 2 - 1, width: spec.chevron.size, height: spec.chevron.size }]} aria-hidden>
        <Icon name="chevronRight" size={spec.chevron.size} color={colors.primary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, overflow: "hidden" },
  icon: { position: "absolute", alignItems: "center", justifyContent: "center" },
  chevron: { position: "absolute", alignItems: "center", justifyContent: "center" },
});
