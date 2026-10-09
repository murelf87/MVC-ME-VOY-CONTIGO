/**
 * Tarjeta de un punto de recogida propuesto (13): gota con la letra, nombre, dirección, «4 min a pie» y «Desvío +2 min»,
 * y un radio a la derecha. Toda la tarjeta es el control (única selección).
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Radio, Text } from "@/ui";
import { proposalA11y, type ProposalView } from "../logic/pickup";
import { requestStrings } from "../strings";
import { PinBadge, type PinTone } from "./PinBadge";

const copy = requestStrings.pickup;

export interface ProposalCardProps {
  view: ProposalView;
  tone: PinTone;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

export function ProposalCard({ view, tone, selected, onPress, testID }: ProposalCardProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, selected }}
      accessibilityLabel={proposalA11y(view, selected)}
      accessibilityHint={selected ? undefined : copy.selectHint}
      onPress={onPress}
      style={({ pressed }) => [styles.card, selected ? styles.cardSelected : null, pressed ? styles.pressed : null]}
    >
      <View style={styles.pin}>
        <PinBadge letter={view.code} tone={tone} width={40} />
      </View>
      <View style={styles.text}>
        <Text variant="rowTitle" color="strong" size={18} lineHeight={22} letterSpacing={-0.3} numberOfLines={1}>
          {view.title}
        </Text>
        {view.subtitle !== null ? (
          <Text variant="body" color="body" size={18} lineHeight={22} letterSpacing={-0.3} numberOfLines={1}>
            {view.subtitle}
          </Text>
        ) : null}
        <View style={styles.details}>
          <View style={styles.detail}>
            <Icon name="walk" size={22} color={colors.text.deep} />
            <Text variant="body" color="body" size={16} lineHeight={20} letterSpacing={-0.3} numberOfLines={1}>
              {copy.walk(view.walkMinutes)}
            </Text>
          </View>
          <View style={styles.detail}>
            <Icon name="car" size={22} color={colors.text.deep} />
            <Text variant="body" color="body" size={16} lineHeight={20} letterSpacing={-0.3} numberOfLines={1}>
              {copy.detour(view.detourMinutes)}
            </Text>
          </View>
        </View>
      </View>
      <Radio selected={selected} size={24} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 89,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 15,
    paddingRight: 14,
    paddingVertical: 10,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border.soft,
    backgroundColor: colors.bg.screen,
  },
  cardSelected: { borderColor: colors.border.default },
  pressed: { backgroundColor: colors.bg.tintSoft },
  pin: { width: 40, alignItems: "center", marginRight: 21 },
  text: { flex: 1, marginRight: 8 },
  details: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 12 },
  detail: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
});
