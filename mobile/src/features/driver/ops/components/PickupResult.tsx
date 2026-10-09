import React from "react";
import { StyleSheet, View } from "react-native";
import { IconTile } from "@/icons";
import { Banner, Card, Text } from "@/ui";
import { opsStrings } from "../strings";

const R = opsStrings.pickup.result;

export interface PickupResultProps {
  /** Nombre de pila del pasajero. */
  name: string;
  /** El servidor ya la tenía verificada (reintento o dos conductores a la vez): se cuenta tal cual, sin «éxito» nuevo. */
  alreadyVerified: boolean;
  /** Hora de la recogida ya formateada («07:26»). */
  time: string | null;
  /** Siguiente pasajero pendiente. `null` = no queda ninguno. */
  next: { name: string; place: string } | null;
  testID?: string;
}

/** Recogida verificada: confirmación grande en verde, hora y qué toca ahora (siguiente recogida o volver a la consola). */
export function PickupResult({ name, alreadyVerified, time, next, testID = "PickupResult" }: PickupResultProps): React.JSX.Element {
  const title = alreadyVerified ? R.alreadyTitle : R.successTitle;
  const message = alreadyVerified ? R.alreadyMessage(name, time) : R.successMessage(name);
  return (
    <View testID={testID}>
      <Card tone="green" padding={22} style={styles.card}>
        <IconTile name="checkBold" tone="solidGreen" size={76} iconSize={42} />
        <Text variant="title" color="success" size={26} lineHeight={31} align="center" accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text variant="body" color="deep" size={17.5} lineHeight={23} align="center" style={styles.message}>
          {message}
        </Text>
        {time !== null && !alreadyVerified ? (
          <Text testID={`${testID}.time`} variant="rowTextStrong" color="muted" size={16} lineHeight={20} align="center" style={styles.time}>
            {R.successTime(time)}
          </Text>
        ) : null}
      </Card>
      {next ? (
        <Banner testID={`${testID}.next`} kind="info" size="sm" icon="passenger" message={R.nextUp(next.name, next.place)} style={styles.next} />
      ) : (
        <Text testID={`${testID}.allDone`} variant="rowTitle" color="strong" size={17} lineHeight={22} align="center" style={styles.allDone}>
          {R.allDone}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: "center" },
  title: { marginTop: 16 },
  message: { marginTop: 6 },
  time: { marginTop: 10 },
  next: { marginTop: 14 },
  allDone: { marginTop: 18 },
});
