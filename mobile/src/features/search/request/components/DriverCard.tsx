/**
 * Tarjeta «Conductor» de 15: foto, nombre, valoración y «Conduce este trayecto habitualmente.». Toda la tarjeta es
 * un botón (el chevron lo indica): abre la hoja con el vehículo, el mensaje opcional y el enlace al viaje.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Avatar, Text } from "@/ui";
import type { DriverCardModel } from "../logic/reviewModel";
import { requestStrings } from "../strings";

const copy = requestStrings.review;

export interface DriverCardProps {
  driver: DriverCardModel;
  /** Hay un mensaje añadido para el conductor. */
  hasMessage: boolean;
  onPress: () => void;
  testID?: string;
}

export function DriverCard({ driver, hasMessage, onPress, testID = "DriverCard" }: DriverCardProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={requestStrings.a11y.driverRow(driver.name)}
      accessibilityHint={[driver.rating !== null ? `${driver.rating} ${driver.ratings}` : driver.ratings, driver.habit].join(". ")}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <Text variant="heading" color="strong" size={19.5} lineHeight={24}>
        {copy.driver}
      </Text>
      <View style={styles.body}>
        <Avatar source={driver.photoUrl} name={driver.name} size={80} />
        <View style={styles.text}>
          <Text variant="titleSm" color="heading" size={24} lineHeight={28} numberOfLines={1}>
            {driver.name}
          </Text>
          <View style={styles.ratingRow}>
            {driver.rating !== null ? (
              <>
                <Icon name="star" size={20} color={colors.amber.star} />
                <Text variant="bodyStrong" color="strong" size={17} style={styles.rating}>
                  {driver.rating}
                </Text>
              </>
            ) : null}
            <Text variant="body" color="muted" size={17} numberOfLines={1} style={styles.count}>
              {driver.ratings}
            </Text>
          </View>
          <Text variant="body" color="body" size={16.5} lineHeight={20} numberOfLines={2}>
            {driver.habit}
          </Text>
          {hasMessage ? (
            <View style={styles.messageRow}>
              <Icon name="checkCircle" size={16} color={colors.success.solid} />
              <Text variant="caption" color="success" size={13.5} style={styles.message}>
                {copy.messageAdded}
              </Text>
            </View>
          ) : null}
        </View>
        <Icon name="chevronRight" size={26} color={colors.primary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border.soft,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
  },
  pressed: { backgroundColor: colors.bg.tintSoft },
  body: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  text: { flex: 1, marginLeft: 14, marginRight: 6 },
  ratingRow: { flexDirection: "row", alignItems: "center", marginTop: 1 },
  rating: { marginLeft: 4 },
  count: { marginLeft: 8, flexShrink: 1 },
  messageRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  message: { marginLeft: 5 },
});
