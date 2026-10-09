import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors, radii } from "@/theme";
import { strings } from "@/i18n";
import { Text } from "./Text";

export interface OfflineBannerProps {
  /** Texto fuerte (por defecto «Sin conexión»). En vivo: «Sin señal». */
  title?: string;
  /** Texto en rojo tras un punto medio: «Última posición: hace 2 min» (22). */
  detail?: string;
  icon?: IconName;
  /** Botón «i» azul de la derecha (explica qué pasa sin señal). */
  onInfo?: () => void;
  /** Texto del enlace de reintento (por ejemplo «Reintentar»). */
  retryLabel?: string;
  onRetry?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Franja de aviso de falta de conexión o de señal GPS (22 «Sin señal · Última posición: hace 2 min»). Se anuncia a los
 * lectores de pantalla como región viva educada.
 */
export function OfflineBanner({
  title = strings.connectivity.offlineTitle,
  detail,
  icon = "offline",
  onInfo,
  retryLabel,
  onRetry,
  testID,
  style,
}: OfflineBannerProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={detail !== undefined ? `${title}. ${detail}` : title}
      style={[styles.base, style]}
    >
      <Icon name={icon} size={30} color={colors.notice.icon} />
      <Text variant="body" numberOfLines={2} style={styles.text}>
        <Text variant="bodyStrong" color={colors.notice.title} size={17}>
          {title}
        </Text>
        {detail !== undefined ? (
          <Text variant="body" color={colors.notice.detail} size={17}>
            {` · ${detail}`}
          </Text>
        ) : null}
      </Text>
      {onRetry !== undefined && retryLabel !== undefined ? (
        <Pressable accessibilityRole="button" accessibilityLabel={retryLabel} hitSlop={8} onPress={onRetry} style={styles.retry}>
          <Text variant="rowTextStrong" color="link" underline size={16}>
            {retryLabel}
          </Text>
        </Pressable>
      ) : null}
      {onInfo !== undefined ? (
        <Pressable accessibilityRole="button" accessibilityLabel={strings.a11y.moreInfo} hitSlop={10} onPress={onInfo} style={styles.info}>
          <Icon name="infoMark" size={16} color={colors.onPrimary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.notice.bg,
    borderRadius: radii.lg,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  text: { flex: 1, marginLeft: 12 },
  retry: { marginLeft: 10, minHeight: 32, justifyContent: "center" },
  info: {
    marginLeft: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.text.link,
    alignItems: "center",
    justifyContent: "center",
  },
});
