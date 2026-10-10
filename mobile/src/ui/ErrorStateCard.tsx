import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { IconTile, type IconName, type IconTileTone } from "@/icons";
import { radii } from "@/theme";
import { strings } from "@/i18n";
import { Button } from "./Button";
import { Card } from "./Card";
import type { SurfaceTone } from "./tones";
import { Text } from "./Text";

/** Las cuatro tarjetas de «Si algo no va bien» (36a). */
export type ErrorStateKind = "noSeats" | "outOfProvince" | "paymentRejected" | "gpsOff";

interface KindSpec {
  surface: SurfaceTone;
  icon: IconName;
  tile: IconTileTone;
}

const kinds: Record<ErrorStateKind, KindSpec> = {
  noSeats: { surface: "red", icon: "exclaim", tile: "solidRose" },
  outOfProvince: { surface: "amber", icon: "pin", tile: "solidAmber" },
  paymentRejected: { surface: "red", icon: "card", tile: "solidCoral" },
  gpsOff: { surface: "blue", icon: "gpsOff", tile: "solidBlue" },
};

export interface ErrorStateCardProps {
  /** Usa los textos del catálogo (`strings.errorStates`) y el aspecto de la lámina 36a. */
  kind?: ErrorStateKind;
  title?: string;
  message?: string;
  /** Texto del botón; sin él no se dibuja botón. */
  actionLabel?: string;
  onAction?: () => void;
  /** Para estados propios (sin `kind`): tono de la tarjeta e icono. */
  tone?: SurfaceTone;
  icon?: IconName;
  iconTone?: IconTileTone;
  /** Medidas de la lámina 36a a tamaño completo (texto y botón mayores); el resto de pantallas usan el tamaño normal. */
  large?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Tarjeta de estado de error con icono grande, explicación y una acción (36a). */
export function ErrorStateCard({
  kind,
  title,
  message,
  actionLabel,
  onAction,
  tone,
  icon,
  iconTone,
  large = false,
  testID,
  style,
}: ErrorStateCardProps): React.JSX.Element {
  const preset = kind !== undefined ? kinds[kind] : undefined;
  const copy = kind !== undefined ? strings.errorStates[kind] : undefined;
  const heading = title ?? copy?.title ?? "";
  const text = message ?? copy?.message ?? "";
  const action = actionLabel ?? (onAction !== undefined ? copy?.action : undefined);
  return (
    <Card
      testID={testID}
      tone={tone ?? preset?.surface ?? "red"}
      padding={0}
      radius={radii.lg + 2}
      style={style}
    >
      <View style={styles.head}>
        <IconTile name={icon ?? preset?.icon ?? "exclaim"} tone={iconTone ?? preset?.tile ?? "solidRed"} size={large ? 71 : 62} iconSize={large ? 39 : 34} />
        <View style={[styles.text, large ? styles.textLarge : null]}>
          <Text variant="title" color="deep" size={large ? 24 : 22} lineHeight={large ? 28 : 26} letterSpacing={-0.5} accessibilityRole="header">
            {heading}
          </Text>
          <Text variant="body" color="deep" size={large ? 17.5 : 16} lineHeight={large ? 23 : 21} letterSpacing={-0.2} style={styles.message}>
            {text}
          </Text>
        </View>
      </View>
      {action !== undefined ? (
        <View style={styles.buttonSlot}>
          <Button label={action} onPress={onAction} size="md" style={large ? styles.buttonLarge : styles.button} testID={testID !== undefined ? `${testID}.action` : undefined} />
        </View>
      ) : (
        <View style={styles.bottomPad} />
      )}
    </Card>
  );
}

/** Medidas de la 36a: tarjeta de 332 pt, disco de 62 pt a 16 pt del borde, botón de 48 pt a 10 pt de los lados. */
const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "flex-start", paddingTop: 16, paddingHorizontal: 16, paddingBottom: 12 },
  text: { flex: 1, marginLeft: 19, marginTop: -4 },
  textLarge: { marginLeft: 20, marginTop: 0 },
  message: { marginTop: 3 },
  buttonSlot: { paddingHorizontal: 10, paddingBottom: 11 },
  button: { height: 48, borderRadius: 12 },
  buttonLarge: { height: 53, borderRadius: 12 },
  bottomPad: { height: 8 },
});
