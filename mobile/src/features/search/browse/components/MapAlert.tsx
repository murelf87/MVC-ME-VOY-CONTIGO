import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { IconTile, type IconName, type IconTileTone } from "@/icons";
import { colors, radii } from "@/theme";
import { Card, IconButton, Text, type SurfaceTone } from "@/ui";

export type MapAlertTone = "info" | "notice" | "warning";

const toneSpec: Record<MapAlertTone, { surface: SurfaceTone; tile: IconTileTone; title: string }> = {
  info: { surface: "blue", tile: "solidBlue", title: colors.heading },
  notice: { surface: "amber", tile: "solidAmber", title: colors.notice.title },
  warning: { surface: "orange", tile: "solidOrange", title: colors.warning.title },
};

export interface MapAlertProps {
  tone?: MapAlertTone;
  icon: IconName;
  title: string;
  message?: string;
  /** Acción en texto (p. ej. «Permitir ubicación», «Reintentar»). */
  actionLabel?: string;
  onAction?: () => void;
  /** Con `onDismiss` aparece una «×» de 44 pt para cerrar el aviso. */
  onDismiss?: () => void;
  dismissLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Aviso flotante sobre el mapa de inicio (sin conexión con datos de antes, ubicación denegada, fuera de provincia…): un icono,
 * el motivo, una acción y, si procede, una «×». Se anuncia a los lectores de pantalla como región viva educada.
 */
export function MapAlert({
  tone = "info",
  icon,
  title,
  message,
  actionLabel,
  onAction,
  onDismiss,
  dismissLabel,
  testID,
  style,
}: MapAlertProps): React.JSX.Element {
  const spec = toneSpec[tone];
  return (
    <Card tone={spec.surface} padding={0} radius={radii.lg} shadow="float" testID={testID} style={style}>
      <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.row}>
        <IconTile name={icon} tone={spec.tile} size={36} iconSize={20} />
        <View style={styles.text}>
          <Text variant="rowTitle" color={spec.title} size={15.5} lineHeight={19}>
            {title}
          </Text>
          {message !== undefined ? (
            <Text variant="rowText" color="body" size={14} lineHeight={18} style={styles.message}>
              {message}
            </Text>
          ) : null}
          {actionLabel !== undefined && onAction !== undefined ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={actionLabel}
              onPress={onAction}
              hitSlop={{ top: 6, bottom: 10, left: 8, right: 16 }}
              style={styles.action}
              testID={testID !== undefined ? `${testID}.action` : undefined}
            >
              <Text variant="rowTextStrong" color="link" underline size={15}>
                {actionLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {onDismiss !== undefined ? (
          <IconButton
            icon="close"
            size={44}
            iconSize={20}
            color={colors.text.muted}
            accessibilityLabel={dismissLabel ?? "Cerrar aviso"}
            onPress={onDismiss}
            testID={testID !== undefined ? `${testID}.dismiss` : undefined}
            style={styles.dismiss}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10, paddingLeft: 12, paddingRight: 8 },
  text: { flex: 1, marginLeft: 12, paddingRight: 4, paddingTop: 1 },
  message: { marginTop: 2 },
  action: { marginTop: 6, minHeight: 28, justifyContent: "center", alignSelf: "flex-start" },
  dismiss: { marginTop: -4, marginRight: -2 },
});
