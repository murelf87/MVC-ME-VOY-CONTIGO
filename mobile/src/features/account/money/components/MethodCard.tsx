import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { PaymentMethod } from "@/api/types/money";
import { Icon, type IconName } from "@/icons";
import { colors } from "@/theme";
import { StatusPill, Text, surfaces } from "@/ui";
import { methodStatusChip, methodSubtitle } from "../model";
import { ink, lineTop } from "./metrics";

export type MethodCardDensity = "regular" | "compact";

interface Spec {
  height: number;
  iconLeft: number;
  textLeft: number;
  title: { baseline: number };
  subtitle: { baseline: number };
  chevronRight: number;
}

/**
 * 33b «Método de pago» (603..671,5): icono de tarjeta de 40×31 en x 32..72, título «Cuenta bancaria» (negrita de 22 pt) con la
 * línea base a 633 y subtítulo a 658; texto desde x 95. 33a (677,5..737,5): texto desde x 100, líneas base a 704 y 727.
 */
const SPECS: Record<MethodCardDensity, Spec> = {
  regular: { height: 68.5, iconLeft: 16, textLeft: 81, title: { baseline: 30 }, subtitle: { baseline: 55 }, chevronRight: 8 },
  compact: { height: 60, iconLeft: 16.5, textLeft: 86, title: { baseline: 26.5 }, subtitle: { baseline: 49.5 }, chevronRight: 16 },
};

const TITLE_SIZE = 22;
const TITLE_LINE = 26;
const SUBTITLE_SIZE = 20;
const SUBTITLE_LINE = 24;

export interface MethodCardProps {
  /** Método guardado, o `null` si no hay ninguno (se muestra `emptyTitle` / `emptyMessage`). */
  method: PaymentMethod | null;
  emptyTitle: string;
  emptyMessage: string;
  density?: MethodCardDensity;
  onPress: () => void;
  accessibilityHint?: string;
  testID: string;
}

function iconFor(method: PaymentMethod | null): IconName {
  return method !== null && method.kind === "apple_pay" ? "apple" : "card";
}

/**
 * «Método de pago» (o «Cuenta de cobro» del conductor): una sola línea con el icono de tarjeta, el nombre y el dato
 * enmascarado (`ES** **** **** 4589`). Nunca contiene el número completo: solo lo que devuelve el servidor para mostrar.
 */
export function MethodCard({ method, emptyTitle, emptyMessage, density = "regular", onPress, accessibilityHint, testID }: MethodCardProps): React.JSX.Element {
  const spec = SPECS[density];
  const title = method !== null ? method.title : emptyTitle;
  const subtitle = method !== null ? methodSubtitle(method) : emptyMessage;
  const chip = method !== null ? methodStatusChip(method.status) : null;
  const titleTop = lineTop(spec.title.baseline, TITLE_SIZE, TITLE_LINE);
  const subtitleTop = lineTop(spec.subtitle.baseline, SUBTITLE_SIZE, SUBTITLE_LINE);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, chip?.label].filter((part): part is string => part !== undefined && part !== "").join(". ")}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { minHeight: spec.height, backgroundColor: pressed ? surfaces.blue.pressed : surfaces.blue.background, borderColor: surfaces.blue.border },
      ]}
    >
      <View style={[styles.icon, { left: spec.iconLeft, top: (spec.height - 44) / 2 }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Icon name={iconFor(method)} size={44} color={method !== null ? ink.cardIcon : colors.text.muted} />
      </View>
      <View style={{ paddingLeft: spec.textLeft, paddingTop: titleTop - 1, paddingRight: chip !== null ? 140 : 44, paddingBottom: 10 }}>
        <Text variant="titleSm" weight="bold" color={method !== null ? colors.text.deep : colors.heading} size={TITLE_SIZE} lineHeight={TITLE_LINE} letterSpacing={-0.2} numberOfLines={1}>
          {title}
        </Text>
        <Text
          variant="subtitle"
          color="deep"
          size={SUBTITLE_SIZE}
          lineHeight={SUBTITLE_LINE}
          numberOfLines={method !== null ? 1 : 2}
          style={{ marginTop: subtitleTop - (titleTop + TITLE_LINE) }}
        >
          {subtitle}
        </Text>
      </View>
      {chip !== null ? (
        <View style={styles.chip}>
          <StatusPill label={chip.label} tone={chip.tone} size="sm" />
        </View>
      ) : null}
      <View style={[styles.chevron, { right: spec.chevronRight, top: (spec.height - 26) / 2 }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Icon name="chevronRight" size={26} color={colors.primary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  icon: { position: "absolute", width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  chip: { position: "absolute", right: 44, top: 0, bottom: 0, justifyContent: "center" },
  chevron: { position: "absolute", width: 26, height: 26, alignItems: "center", justifyContent: "center" },
});
