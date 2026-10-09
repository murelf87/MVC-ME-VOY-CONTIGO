/**
 * «¿Desde dónde sales?» (13 sin punto de partida): sin saber de dónde sale la persona no se pueden proponer puntos de
 * recogida. Ofrece usar la ubicación del móvil o buscar un lugar a mano; si la ubicación no está disponible lo explica
 * sin culpar a nadie y deja siempre la salida de buscar el lugar.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Banner, Button, Text } from "@/ui";
import { locationProblem } from "../logic/pickup";
import { requestStrings } from "../strings";
import type { OriginStatus } from "../types";

const copy = requestStrings.pickup;

export interface OriginCardProps {
  status: OriginStatus;
  onUseLocation: () => void;
  onSearch: () => void;
  onOpenSettings: () => void;
  testID?: string;
}

export function OriginCard({ status, onUseLocation, onSearch, onOpenSettings, testID = "OriginCard" }: OriginCardProps): React.JSX.Element {
  const locating = status === "locating";
  const problem = locationProblem(status);
  return (
    <View testID={testID} style={styles.root}>
      <Text variant="heading" color="strong" size={22} lineHeight={26} accessibilityRole="header">
        {copy.originTitle}
      </Text>
      <Text variant="body" color="body" size={18} lineHeight={23} style={styles.message}>
        {copy.originMessage}
      </Text>
      {problem !== null ? (
        <Banner
          kind="notice"
          size="xs"
          title={problem.title}
          message={problem.message}
          actionLabel={problem.settings ? copy.locationSettings : undefined}
          onAction={problem.settings ? onOpenSettings : undefined}
          style={styles.problem}
          testID={`${testID}.problem`}
        />
      ) : null}
      {locating ? (
        <Text variant="body" color="muted" size={16} lineHeight={20} style={styles.locating} accessibilityLiveRegion="polite">
          {copy.locating}
        </Text>
      ) : null}
      <Button
        label={copy.originUseLocation}
        leadingIcon="locate"
        chevron={false}
        loading={locating}
        onPress={onUseLocation}
        style={styles.primary}
        testID={`${testID}.useLocation`}
      />
      <Button
        label={copy.originSearch}
        variant="outline"
        leadingIcon="search"
        chevron={false}
        disabled={locating}
        onPress={onSearch}
        style={styles.secondary}
        testID={`${testID}.search`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 5 },
  message: { marginTop: 4 },
  problem: { marginTop: 10 },
  locating: { marginTop: 8 },
  primary: { marginTop: 14 },
  secondary: { marginTop: 10 },
});
