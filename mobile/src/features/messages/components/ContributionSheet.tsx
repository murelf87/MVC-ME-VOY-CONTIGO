/**
 * Hoja «Aporte del viaje» (tercera fila de la cabecera del chat). Cuenta con honestidad en qué estado está el importe:
 *  - `pending_definition` → «Por definir»: todavía no hay ninguna cantidad confirmada;
 *  - `illustrative` → «Propuesta: 4,00 € (ilustrativo)»: un ejemplo, no una cantidad confirmada;
 *  - `defined` → el importe acordado.
 * Nunca promete un cobro o una devolución: el dinero lo confirma el servidor, no esta hoja.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { Money } from "@/api/types";
import { MONEY_ILLUSTRATIVE_TAG, moneyParts } from "@/i18n";
import { colors, radii } from "@/theme";
import { BottomSheet, Button, Text } from "@/ui";
import { messagesStrings } from "../strings";

const copy = messagesStrings.chat;

export interface ContributionSheetProps {
  visible: boolean;
  onClose: () => void;
  contribution: Money | null;
  seats: number | null;
  /** Abre el detalle de la reserva (o del viaje, si soy conductor). */
  onOpenBooking: () => void;
  /** Texto del botón («Ver mi reserva» / «Ver mi viaje»). */
  openLabel: string;
  testID?: string;
}

export function ContributionSheet({ visible, onClose, contribution, seats, onOpenBooking, openLabel, testID = "BookingChat.contribution" }: ContributionSheetProps): React.JSX.Element | null {
  const parts = contribution !== null ? moneyParts(contribution) : null;
  const status = contribution?.status ?? "pending_definition";
  const explanation = status === "defined" ? copy.contributionSheetDefined : status === "illustrative" ? copy.contributionSheetIllustrative : copy.contributionSheetPending;
  const amount = parts === null ? copy.pending : parts.text;
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={copy.contributionSheetTitle}
      testID={testID}
      footer={<Button label={openLabel} onPress={onOpenBooking} chevron={false} testID={`${testID}.open`} />}
    >
      <View style={styles.amountBox} accessible accessibilityLabel={`${amount}${parts?.illustrative === true ? ` (${MONEY_ILLUSTRATIVE_TAG})` : ""}`}>
        <Text variant="kpi" color="heading" size={32} lineHeight={38}>
          {amount}
        </Text>
        {parts?.illustrative === true ? (
          <Text variant="rowTextStrong" color="muted" size={15} lineHeight={18}>
            {MONEY_ILLUSTRATIVE_TAG}
          </Text>
        ) : null}
      </View>
      <Text variant="body" color="body" size={17} lineHeight={22} style={styles.explanation}>
        {explanation}
      </Text>
      {seats !== null ? (
        <Text variant="rowText" color="muted" size={15.5} lineHeight={20} style={styles.seats}>
          {`${copy.contributionSheetSeats}: ${seats}`}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  amountBox: { alignItems: "center", paddingVertical: 14, borderRadius: radii.lg, backgroundColor: colors.bg.tint },
  explanation: { marginTop: 14 },
  seats: { marginTop: 8 },
});
