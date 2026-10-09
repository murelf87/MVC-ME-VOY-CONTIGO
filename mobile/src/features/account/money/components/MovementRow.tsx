import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Avatar, StatusPill, Text } from "@/ui";
import { amountView, tripDateText, tripRouteText, withPerson, type Movement } from "../model";
import { moneyStrings } from "../strings";
import { ink, rowSpec, type RowVariant } from "./metrics";

export interface MovementRowProps {
  movement: Movement;
  variant: RowVariant;
  /** Fecha de referencia para «Hoy» / «Mañana». */
  now: number;
  /**
   * `true` = lista mixta de la lámina 33a: sobre el importe va «Viaje» (lo que pagas) o «Cobro» (lo que cobras) en vez de
   * la píldora de estado.
   */
  tagged?: boolean;
  /** Fila de una lista agrupada: dibuja una línea separadora debajo salvo en la última. */
  last?: boolean;
  onPress: () => void;
  testID: string;
}

/**
 * Fila de movimiento de la lámina 33: foto, «Con Ana», fecha, trayecto, importe y estado. La misma fila sirve para pagos
 * como pasajero y cobros como conductor (`movement.role`). El estado sale del servidor; nada se pinta «pagado» por defecto.
 */
export function MovementRow({ movement, variant, now, tagged = false, last = false, onPress, testID }: MovementRowProps): React.JSX.Element {
  const spec = rowSpec(variant);
  const amount = amountView(movement.amount);
  const name = withPerson(movement.person);
  const date = tripDateText(movement.trip, movement.occurredAt, now);
  const route = tripRouteText(movement.trip);
  const tag = movement.role === "passenger" ? moneyStrings.overview.tripTag : moneyStrings.overview.earningTag;
  const tagA11y = movement.role === "passenger" ? moneyStrings.a11y.mixedTrip : moneyStrings.a11y.mixedEarning;
  const status = tagged ? tagA11y : movement.chip.label;
  const label = [name, date, route, amount.spoken, status].filter((part) => part !== "").join(". ");
  const textTop = spec.text.top - 1;
  const amountColor = amount.pending ? colors.heading : ink.rowAmount;
  const grouped = variant === "grouped";

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={moneyStrings.a11y.openDetail(name)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        grouped
          ? { minHeight: spec.height, backgroundColor: pressed ? colors.bg.tintSoft : "transparent" }
          : {
              minHeight: spec.height,
              borderRadius: spec.radius,
              borderWidth: 1,
              borderColor: ink.rowBorder,
              backgroundColor: pressed ? colors.bg.tintSoft : colors.bg.white,
            },
      ]}
    >
      <View style={[styles.rowInner, { minHeight: spec.height - (grouped ? 0 : 2) }]}>
        <View style={{ marginLeft: spec.avatar.left, marginTop: spec.avatar.top - (grouped ? 0 : 1) }}>
          <Avatar source={movement.person.photoUrl} name={movement.person.displayName} size={spec.avatar.size} />
        </View>

        <View style={{ flex: 1, marginLeft: spec.gap, paddingTop: textTop }}>
          <Text variant="titleSm" weight="bold" color="heading" size={spec.text.nameSize} lineHeight={spec.text.nameLine} letterSpacing={-0.2} numberOfLines={1}>
            {name}
          </Text>
          <Text variant="subtitle" color="deep" size={spec.text.lineSize} lineHeight={spec.text.lineHeight} numberOfLines={1}>
            {date}
          </Text>
          <Text variant="subtitle" color="deep" size={spec.text.lineSize} lineHeight={spec.text.lineHeight} numberOfLines={1}>
            {route}
          </Text>
        </View>

        <View style={[styles.right, { paddingTop: tagged ? spec.right.tagTop - 1 : spec.right.amountTop - 1 }]}>
          {tagged ? (
            <>
              <Text variant="subtitle" weight="medium" color={movement.role === "passenger" ? colors.primary : ink.earningTag} size={spec.right.tagSize} lineHeight={24} letterSpacing={-0.2}>
                {tag}
              </Text>
              <Text
                variant="titleSm"
                weight="bold"
                color={amountColor}
                size={spec.right.amountSize}
                lineHeight={spec.right.amountLine}
                letterSpacing={-0.2}
                style={{ marginTop: spec.right.amountTop - (spec.right.tagTop + 24) }}
              >
                {amount.hero}
              </Text>
            </>
          ) : (
            <>
              <Text variant="titleSm" weight="bold" color={amountColor} size={spec.right.amountSize} lineHeight={spec.right.amountLine} letterSpacing={-0.2}>
                {amount.hero}
              </Text>
              <StatusPill label={movement.chip.label} tone={movement.chip.tone} style={{ marginTop: spec.right.chipTop - (spec.right.amountTop + spec.right.amountLine) }} />
            </>
          )}
        </View>

        <View style={{ marginLeft: spec.rightGap, marginTop: spec.chevron.top - (grouped ? 0 : 1), marginRight: spec.chevron.right }}>
          <Icon name="chevronRight" size={spec.chevron.size} color={colors.primary} />
        </View>
      </View>
      {grouped && !last ? <View style={styles.divider} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { overflow: "hidden" },
  rowInner: { flexDirection: "row", alignItems: "flex-start" },
  right: { alignItems: "flex-end", marginLeft: 8 },
  divider: { position: "absolute", left: 0, right: 0, bottom: 0, height: 1, backgroundColor: colors.border.divider },
});
