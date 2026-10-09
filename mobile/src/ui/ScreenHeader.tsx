import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { NavigationContext } from "@react-navigation/native";
import { Icon } from "@/icons";
import { colors, layout } from "@/theme";
import { strings } from "@/i18n";
import { IconButton } from "./IconButton";
import { Text } from "./Text";

export interface ScreenHeaderRightAction {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

export interface ScreenHeaderRightAvatar {
  /** Iniciales mostradas (una o dos letras). */
  initials: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

export interface ScreenHeaderProps {
  title: string;
  /** Segunda línea (37–40 «Resumen de administración»; en `large`, la frase bajo el título). */
  subtitle?: string;
  /**
   * `default`: una fila con chevron a la izquierda y título centrado (la mayoría de pantallas).
   * `large`: chevron arriba y título grande centrado debajo, con frase opcional (01–04).
   */
  variant?: "default" | "large";
  /** Acción al pulsar «atrás». Por defecto `navigation.goBack()` si hay historial. */
  onBack?: () => void;
  /** Oculta el chevron (pantallas raíz como 09). */
  hideBack?: boolean;
  /** Texto de acción a la derecha (31 «Editar», 2 «Editar» de 11). */
  rightAction?: ScreenHeaderRightAction;
  /** Avatar con inicial a la derecha (37–40 «A»). */
  rightAvatar?: ScreenHeaderRightAvatar;
  /** Botón ⋮ a la derecha (26 «Chat de reserva»). */
  onMenu?: () => void;
  /** Contenido libre a la derecha (sustituye a los anteriores). */
  right?: React.ReactNode;
  testID?: string;
}

const SIDE = 56;

/**
 * Cabecera de pantalla de las láminas: chevron azul de volver + título centrado azul ultramarino.
 * Va dentro de `<Screen header={…}/>` (que ya aplica el margen seguro superior).
 */
export function ScreenHeader({
  title,
  subtitle,
  variant = "default",
  onBack,
  hideBack = false,
  rightAction,
  rightAvatar,
  onMenu,
  right,
  testID,
}: ScreenHeaderProps): React.JSX.Element {
  const navigation = React.useContext(NavigationContext);
  const goBack = onBack ?? (navigation !== undefined && navigation.canGoBack() ? () => navigation.goBack() : undefined);
  const showBack = !hideBack && goBack !== undefined;

  const back = showBack ? (
    <Pressable
      testID={testID !== undefined ? `${testID}.back` : undefined}
      accessibilityRole="button"
      accessibilityLabel={strings.a11y.back}
      onPress={goBack}
      hitSlop={6}
      style={styles.back}
    >
      <Icon name="back" size={33} color={colors.heading} />
    </Pressable>
  ) : null;

  let rightNode: React.ReactNode = right;
  if (rightNode === undefined) {
    if (rightAction !== undefined) {
      rightNode = (
        <Pressable
          testID={rightAction.testID}
          accessibilityRole="button"
          accessibilityLabel={rightAction.accessibilityLabel ?? rightAction.label}
          onPress={rightAction.onPress}
          hitSlop={10}
          style={styles.rightText}
        >
          <Text variant="subtitle" color="link" underline weight="medium" size={19}>
            {rightAction.label}
          </Text>
        </Pressable>
      );
    } else if (rightAvatar !== undefined) {
      const content = (
        <View style={styles.avatar}>
          <Text variant="titleSm" color="heading" size={19} lineHeight={22}>
            {rightAvatar.initials}
          </Text>
        </View>
      );
      rightNode =
        rightAvatar.onPress !== undefined ? (
          <Pressable
            testID={rightAvatar.testID}
            accessibilityRole="button"
            accessibilityLabel={rightAvatar.accessibilityLabel ?? rightAvatar.initials}
            onPress={rightAvatar.onPress}
            hitSlop={6}
          >
            {content}
          </Pressable>
        ) : (
          content
        );
    } else if (onMenu !== undefined) {
      rightNode = (
        <IconButton
          icon="more"
          size={44}
          iconSize={26}
          color={colors.heading}
          accessibilityLabel={strings.a11y.moreOptions}
          onPress={onMenu}
          testID={testID !== undefined ? `${testID}.menu` : undefined}
        />
      );
    }
  }

  if (variant === "large") {
    return (
      <View testID={testID} style={styles.large}>
        <View style={styles.largeBack}>{back}</View>
        {rightNode !== undefined && rightNode !== null ? <View style={styles.largeRight}>{rightNode}</View> : null}
        <Text variant="h1" color="heading" align="center" accessibilityRole="header">
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text variant="subtitle" color="muted" align="center" lineHeight={27} style={styles.largeSubtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View testID={testID} style={styles.row}>
      <View style={[styles.side, styles.sideLeft]}>{back}</View>
      <View style={styles.center}>
        <Text variant="title" color="heading" align="center" numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text variant="subtitle" color="heading" align="center" numberOfLines={1} size={21} lineHeight={24}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.side, styles.sideRight]}>{rightNode}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: layout.headerRow, flexDirection: "row", alignItems: "center", paddingHorizontal: 18 },
  side: { width: SIDE, minHeight: layout.headerRow, justifyContent: "center" },
  sideLeft: { alignItems: "flex-start" },
  sideRight: { alignItems: "flex-end" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  back: { width: 44, height: 44, justifyContent: "center", paddingLeft: 6 },
  rightText: { minHeight: 44, justifyContent: "center", paddingLeft: 4 },
  /** Disco de 39 pt con su borde derecho a 26 pt del borde de pantalla (37a, 38a). */
  avatar: {
    width: 39,
    height: 39,
    borderRadius: 19.5,
    marginRight: 8,
    backgroundColor: colors.bg.avatarTile,
    alignItems: "center",
    justifyContent: "center",
  },
  large: { paddingHorizontal: layout.screenX, paddingTop: 19, paddingBottom: 6 },
  largeBack: { position: "absolute", top: -13, left: 18 },
  largeRight: { position: "absolute", top: -4, right: 18 },
  largeSubtitle: { marginTop: 15 },
});
