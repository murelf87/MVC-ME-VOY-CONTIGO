import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { strings } from "@/i18n";
import { Button } from "./Button";
import { Spinner } from "./Skeleton";
import { Text } from "./Text";

export type MapCardStatus = "ready" | "loading" | "unavailable";

export interface MapCardProps {
  /** El mapa (`<MvcMap …/>` del módulo de mapas) o una imagen estática. */
  children?: React.ReactNode;
  /** Alto en pt (por defecto 210, como el mapa de la 22). */
  height?: number;
  /** Radio de esquina (por defecto 18). */
  radius?: number;
  status?: MapCardStatus;
  /** Textos del estado `unavailable` (sin conexión, sin proveedor de mapas, permiso denegado…). */
  unavailableTitle?: string;
  unavailableMessage?: string;
  onRetry?: () => void;
  /** Hace pulsable todo el mapa (p. ej. «Ver ruta en el mapa»). */
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Franja inferior sobre el mapa (leyenda, dirección…). */
  footer?: React.ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Marco redondeado para un mapa embebido. Resuelve los tres estados que cualquier pantalla con mapa debe diseñar:
 * mapa listo, cargando y «mapa no disponible» (con reintento). No contiene lógica de mapas.
 */
export function MapCard({
  children,
  height = 210,
  radius = radii.xl,
  status = "ready",
  unavailableTitle = "Mapa no disponible",
  unavailableMessage = strings.connectivity.offlineMessage,
  onRetry,
  onPress,
  accessibilityLabel,
  footer,
  testID,
  style,
}: MapCardProps): React.JSX.Element {
  const frame: ViewStyle = { height, borderRadius: radius };
  let body: React.ReactNode;
  if (status === "loading") {
    body = (
      <View style={styles.center} accessible accessibilityLabel={strings.common.loading} accessibilityState={{ busy: true }}>
        <Spinner />
      </View>
    );
  } else if (status === "unavailable") {
    body = (
      <View style={styles.center}>
        <Icon name="mapOutline" size={40} color={colors.empty.icon} />
        <Text variant="rowTitle" color={colors.empty.text} align="center" size={18} style={styles.title}>
          {unavailableTitle}
        </Text>
        <Text variant="rowText" color={colors.empty.text} align="center" size={15.5} lineHeight={20}>
          {unavailableMessage}
        </Text>
        {onRetry !== undefined ? (
          <Button label={strings.common.retry} variant="outline" size="xs" inline chevron={false} onPress={onRetry} style={styles.retry} />
        ) : null}
      </View>
    );
  } else {
    body = children;
  }
  const content = (
    <>
      {body}
      {footer !== undefined && status === "ready" ? <View style={styles.footer}>{footer}</View> : null}
    </>
  );
  if (onPress !== undefined && status === "ready") {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={[styles.frame, frame, style]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View testID={testID} style={[styles.frame, frame, style]}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden", backgroundColor: colors.empty.bg, borderWidth: 1, borderColor: colors.border.soft },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  title: { marginTop: 8 },
  retry: { marginTop: 12 },
  footer: { position: "absolute", left: 10, right: 10, bottom: 10 },
});
