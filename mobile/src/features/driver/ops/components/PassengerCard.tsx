import React from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "@/theme";
import { Avatar, Button, Card, RatingBadge, StatusPill, Text } from "@/ui";
import type { PassengerRowView } from "../logic/console";
import { opsStrings } from "../strings";

const P = opsStrings.console.passengers;

export interface PassengerCardProps {
  row: PassengerRowView;
  /** Abre «Verificar código» de este pasajero (solo si la fila lo permite). */
  onVerify?: () => void;
  /** «Escribir a Laura». Sin esta función no se ofrece el chat. */
  onMessage?: () => void;
  messageBusy?: boolean;
  testID?: string;
}

/** Pasajero en la consola: quién es, dónde y cuándo sube, en qué estado está y qué puede hacer el conductor. */
export function PassengerCard({ row, onVerify, onMessage, messageBusy = false, testID }: PassengerCardProps): React.JSX.Element {
  const { passenger } = row;
  const showVerify = row.canVerify && onVerify !== undefined;
  const showMessage = onMessage !== undefined;
  return (
    <Card tone={row.isNext ? "blueStrong" : "blue"} padding={14} style={row.isNext ? styles.next : undefined} testID={testID}>
      <View style={styles.head}>
        <Avatar source={passenger.photoUrl} name={passenger.displayName} size={52} />
        <View style={styles.nameColumn}>
          <Text variant="titleSm" color="heading" size={20} lineHeight={24} numberOfLines={1}>
            {passenger.firstName}
          </Text>
          <RatingBadge average={passenger.ratingAverage} count={passenger.ratingCount} size={15} />
        </View>
        <StatusPill label={row.statusLabel} tone={row.tone} size="sm" testID={testID !== undefined ? `${testID}.status` : undefined} />
      </View>
      <Text variant="rowTitle" color="strong" size={16.5} lineHeight={21} style={styles.detail}>
        {row.detail}
      </Text>
      {row.secondary ? (
        <Text variant="body" color="muted" size={15.5} lineHeight={20}>
          {row.secondary}
        </Text>
      ) : null}
      {showVerify || showMessage ? (
        <View style={styles.actions}>
          {showVerify ? (
            <View style={styles.action}>
              <Button
                testID={testID !== undefined ? `${testID}.verify` : undefined}
                label={P.actions.verify}
                accessibilityLabel={P.actions.verifyOf(passenger.firstName)}
                size="sm"
                chevron={false}
                onPress={onVerify}
              />
            </View>
          ) : null}
          {showMessage ? (
            <View style={[styles.action, showVerify ? styles.secondAction : null]}>
              <Button
                testID={testID !== undefined ? `${testID}.message` : undefined}
                label={P.actions.message}
                accessibilityLabel={P.actions.messageOf(passenger.firstName)}
                variant="outline"
                size="sm"
                leadingIcon="chat"
                chevron={false}
                loading={messageBusy}
                onPress={onMessage}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  next: { borderColor: colors.primary, borderWidth: 1.5 },
  head: { flexDirection: "row", alignItems: "center" },
  nameColumn: { flex: 1, marginLeft: 12, marginRight: 8 },
  detail: { marginTop: 10 },
  actions: { flexDirection: "row", marginTop: 12 },
  action: { flex: 1 },
  secondAction: { marginLeft: 10 },
});
