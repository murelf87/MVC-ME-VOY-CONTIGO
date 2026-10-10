/**
 * Tarjeta de «Reservas y devoluciones» (39a/39b): persona y fecha del viaje, estado, origen y destino, la tabla de
 * importes (pagado · devolución propuesta · comisión · coste final), quién canceló y cuándo, y «Revisar devolución ›».
 *
 * Los importes llegan como `Money`: un importe sin definir dice «Por definir» (en el color de aviso de la lámina) y uno de
 * ejemplo lleva la etiqueta «ilustrativo». Nada se pinta como «devuelto» salvo lo que el servidor confirma.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { MONEY_ILLUSTRATIVE_TAG } from "@/i18n";
import { Icon, type IconName } from "@/icons";
import { colors } from "@/theme";
import { Avatar, Text } from "@/ui";
import type { BillingCardView, MoneyRowView, RefundLineView } from "../logic/refunds";
import { reviewStrings } from "../strings";
import { CardStatusPill } from "./ReviewQueueCard";

const b = reviewStrings.bookings;

function RouteLine({ text, testID }: { text: string; testID: string }): React.JSX.Element {
  return (
    <View testID={testID} style={styles.routeLine}>
      <View style={styles.routeIcon}>
        <Icon name="pin" size={20} color={colors.primary} />
      </View>
      <Text variant="body" color="body" size={16.2} lineHeight={22} letterSpacing={-0.2} numberOfLines={1} style={styles.routeText}>
        {text}
      </Text>
    </View>
  );
}

function MoneyLine({ row, divider, testID }: { row: MoneyRowView; divider: boolean; testID: string }): React.JSX.Element {
  const valueColor = row.pending ? colors.error.text : row.emphasis ? colors.text.strong : colors.text.muted;
  return (
    <View testID={testID} accessible accessibilityLabel={`${row.label}: ${row.text}${row.illustrative ? ` (${MONEY_ILLUSTRATIVE_TAG})` : ""}`} style={[styles.moneyRow, divider ? styles.moneyDivider : null]}>
      <Text variant="body" color={row.emphasis ? colors.text.body : colors.text.muted} weight={row.emphasis ? "semibold" : "regular"} size={15.6} lineHeight={22} letterSpacing={-0.2} numberOfLines={1} style={styles.moneyLabel}>
        {row.label}
      </Text>
      {row.illustrative ? (
        <Text variant="caption" color="subtle" size={12.5} style={styles.tag}>
          {MONEY_ILLUSTRATIVE_TAG}
        </Text>
      ) : null}
      <Text variant="body" color={valueColor} weight={row.emphasis ? "semibold" : "regular"} size={16.5} lineHeight={22} letterSpacing={-0.2} numberOfLines={1}>
        {row.text}
      </Text>
    </View>
  );
}

const LINE_ICON: Record<RefundLineView["tone"], { icon: IconName; color: string; text: string }> = {
  info: { icon: "infoOutline", color: colors.primary, text: colors.text.deep },
  success: { icon: "checkCircle", color: colors.success.solid, text: colors.success.text },
  warning: { icon: "alertCircle", color: colors.warning.solid, text: colors.warning.textStrong },
  error: { icon: "alertCircle", color: colors.error.solid, text: colors.error.text },
  muted: { icon: "infoOutline", color: colors.gray.icon, text: colors.text.subtle },
};

function RefundStateLine({ line, testID }: { line: RefundLineView; testID: string }): React.JSX.Element {
  const look = LINE_ICON[line.tone];
  return (
    <View testID={testID} style={styles.stateLine} accessible accessibilityLabel={line.text}>
      <Icon name={look.icon} size={19} color={look.color} />
      <Text variant="rowText" color={look.text} size={15.5} lineHeight={20} style={styles.stateText}>
        {line.text}
      </Text>
    </View>
  );
}

export interface BillingCardProps {
  card: BillingCardView;
  /** Abre el detalle de la devolución (solo Finanzas y Administración). */
  onReview?: (refundId: string) => void;
  testID: string;
}

export function BillingCard({ card, onReview, testID }: BillingCardProps): React.JSX.Element {
  const canReview = card.refundId !== null && onReview !== undefined;
  return (
    <View testID={testID} style={styles.card}>
      <View testID={`${testID}.head`} accessible accessibilityLabel={card.a11y} style={styles.head}>
        <Avatar source={card.photoUrl} name={card.name} size={56} />
        <View style={styles.headText}>
          <Text variant="titleSm" color="body" size={17.8} lineHeight={24} letterSpacing={-0.2} numberOfLines={1} style={styles.name}>
            {card.name}
          </Text>
          <Text variant="body" color="muted" size={17.3} lineHeight={22} letterSpacing={-0.2} numberOfLines={1}>
            {card.whenText}
          </Text>
        </View>
        <View style={styles.pillSlot} pointerEvents="none">
          <CardStatusPill label={card.statusLabel} tone={card.statusTone} testID={`${testID}.status`} />
        </View>
      </View>

      <View style={styles.route}>
        <RouteLine text={card.origin} testID={`${testID}.origin`} />
        <RouteLine text={card.destination} testID={`${testID}.destination`} />
      </View>

      <View testID={`${testID}.money`} style={styles.money}>
        {card.rows.map((row, index) => (
          <MoneyLine key={row.key} row={row} divider={index > 0} testID={`${testID}.money.${row.key}`} />
        ))}
      </View>

      {card.cancellation !== null ? (
        <View testID={`${testID}.cancellation`} style={styles.cancelLine} accessible accessibilityLabel={card.cancellation}>
          <Icon name="clock" size={22} color={colors.text.body} />
          <Text variant="body" color="subtle" size={16.2} lineHeight={20} letterSpacing={-0.2} numberOfLines={2} style={styles.cancelText}>
            {card.cancellation}
          </Text>
        </View>
      ) : null}

      {card.refundLine !== null ? <RefundStateLine line={card.refundLine} testID={`${testID}.refundLine`} /> : null}

      {canReview ? (
        <Pressable
          testID={`${testID}.review`}
          accessibilityRole="button"
          accessibilityLabel={b.reviewA11y(card.name)}
          onPress={() => onReview(card.refundId ?? "")}
          style={({ pressed }) => [styles.review, pressed ? styles.reviewPressed : null]}
        >
          <Icon name="addCircle" size={26} color={colors.primary} />
          <Text variant="buttonSm" color="heading" size={15.6} lineHeight={23} letterSpacing={-0.2} numberOfLines={1} style={styles.reviewLabel}>
            {b.review}
          </Text>
          <View style={styles.reviewChevron}>
            <Icon name="chevronRight" size={24} color={colors.primary} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Medidas de 39a (pt): tarjeta de 372 × 324 con el contenido entre x = 26 y x = 369; avatar de 56; tabla de importes de 115
 * con filas de 26,7; «Revisar devolución» de 40 pt y 198 de ancho pegado a la derecha (llega hasta x = 374).
 */
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.soft,
    paddingTop: 14,
    paddingBottom: 10,
    paddingLeft: 14,
    paddingRight: 13,
  },
  head: { flexDirection: "row", alignItems: "flex-start", height: 56 },
  headText: { flex: 1, marginLeft: 13.5, paddingRight: 108 },
  name: { marginTop: 2.5 },
  pillSlot: { position: "absolute", top: 4.5, right: 0 },
  route: { marginTop: 3 },
  routeLine: { height: 23, flexDirection: "row", alignItems: "center" },
  routeIcon: { width: 35, alignItems: "flex-start", paddingLeft: 4 },
  routeText: { flex: 1 },
  money: { marginTop: 4.5, backgroundColor: colors.bg.tint, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 4 },
  moneyRow: { height: 26.7, flexDirection: "row", alignItems: "center" },
  moneyDivider: { borderTopWidth: 1, borderTopColor: colors.border.divider },
  moneyLabel: { flex: 1, paddingRight: 8 },
  tag: { marginRight: 6 },
  cancelLine: { marginTop: 8, minHeight: 22, flexDirection: "row", alignItems: "center" },
  cancelText: { flex: 1, marginLeft: 6 },
  stateLine: { marginTop: 6, flexDirection: "row", alignItems: "center" },
  stateText: { flex: 1, marginLeft: 6 },
  review: {
    alignSelf: "flex-end",
    width: 198,
    height: 40,
    marginTop: 2.5,
    marginRight: -5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.bg.white,
    paddingLeft: 8,
    paddingRight: 8,
  },
  reviewPressed: { backgroundColor: colors.bg.tint },
  reviewLabel: { marginLeft: 12 },
  reviewChevron: { position: "absolute", right: 10, top: 0, bottom: 0, justifyContent: "center" },
});
