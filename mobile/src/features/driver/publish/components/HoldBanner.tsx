import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";
import { holdMessage, type RequestCardView } from "../logic/requests";
import { publishStrings } from "../strings";

const copy = publishStrings.requests;

export interface HoldBannerProps {
  card: RequestCardView;
  testID: string;
}

/**
 * Plaza retenida tras aceptar: cuenta atrás hasta que el pasajero paga. Aceptar NO confirma la reserva (se confirma al
 * pagar), y aquí se dice con todas las letras. Sin cuenta atrás conocida solo se dice que se espera el pago.
 */
export function HoldBanner({ card, testID }: HoldBannerProps): React.JSX.Element {
  const expired = card.holdSeconds !== null && card.holdSeconds <= 0;
  const message = holdMessage(card);
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${copy.holdTitle}. ${message} ${copy.holdNotPaid}`}
      style={[styles.box, expired ? styles.boxExpired : null]}
    >
      <View style={[styles.disc, expired ? styles.discExpired : null]}>
        <Icon name="clock" size={30} color={expired ? colors.gray.icon : colors.primary} />
      </View>
      <View style={styles.texts}>
        <Text variant="rowTitle" color="heading" size={19} lineHeight={24} letterSpacing={-0.3}>
          {copy.holdTitle}
        </Text>
        <Text variant="body" color="heading" size={17.5} lineHeight={22} letterSpacing={-0.3} testID={`${testID}.message`}>
          {message}
        </Text>
        <Text variant="caption" color="muted" size={14.5} lineHeight={19} style={styles.note}>
          {copy.holdNotPaid}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 13,
    paddingLeft: 12,
    paddingRight: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.info.bg,
  },
  boxExpired: { backgroundColor: colors.bg.gray },
  disc: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg.tintStrong,
  },
  discExpired: { backgroundColor: colors.bg.disabled },
  texts: { flex: 1, marginLeft: 14 },
  note: { marginTop: 4 },
});
