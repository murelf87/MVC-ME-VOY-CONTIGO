import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors, radii } from "@/theme";
import { Button } from "./Button";
import { Text } from "./Text";

export interface EmptyStateProps {
  /** Icono grande (por defecto una burbuja de mensaje). */
  icon?: IconName;
  title: string;
  message?: string;
  /** Texto del botón (opcional); sin él no se dibuja botón. */
  actionLabel?: string;
  onAction?: () => void;
  /** `card` = tarjeta lavanda de la lámina 25; `plain` = sin fondo, centrada en la pantalla. */
  variant?: "card" | "plain";
  /** Contenido libre bajo el texto. */
  children?: React.ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Estado vacío: «Aún no tienes más mensajes / Cuando reserves o te escriban, aparecerán aquí» (25). */
export function EmptyState({
  icon = "chatText",
  title,
  message,
  actionLabel,
  onAction,
  variant = "card",
  children,
  testID,
  style,
}: EmptyStateProps): React.JSX.Element {
  return (
    <View testID={testID} style={[variant === "card" ? styles.card : styles.plain, style]}>
      <Icon name={icon} size={variant === "card" ? 52 : 64} color={colors.empty.icon} />
      <Text variant="heading" weight="bold" color={colors.empty.text} align="center" size={20} lineHeight={26} style={styles.title}>
        {title}
      </Text>
      {message !== undefined ? (
        <Text variant="body" color={colors.empty.text} align="center" size={16.5} lineHeight={21} style={styles.message}>
          {message}
        </Text>
      ) : null}
      {children}
      {actionLabel !== undefined && onAction !== undefined ? (
        <Button label={actionLabel} onPress={onAction} variant="outline" size="sm" inline chevron={false} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.empty.bg,
    borderRadius: radii.lg,
    paddingVertical: 24,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  plain: { alignItems: "center", paddingVertical: 32, paddingHorizontal: 30 },
  title: { marginTop: 8 },
  message: { marginTop: 4 },
  action: { marginTop: 16 },
});
