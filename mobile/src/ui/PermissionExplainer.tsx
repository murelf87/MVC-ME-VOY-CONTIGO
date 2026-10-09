import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { IconTile, type IconName } from "@/icons";
import { strings } from "@/i18n";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Text } from "./Text";

/** Permisos del sistema que usa la app. */
export type PermissionKind = "location" | "camera" | "notifications" | "photos";

/**
 * `undetermined`: aún no se ha pedido · `denied`: el usuario dijo no, pero se puede volver a pedir ·
 * `blocked`: denegado definitivamente; solo se puede cambiar en los ajustes del sistema.
 */
export type PermissionStatus = "undetermined" | "denied" | "blocked";

const kindIcon: Record<PermissionKind, IconName> = {
  location: "pin",
  camera: "camera",
  notifications: "bell",
  photos: "image",
};

export interface PermissionExplainerProps {
  kind: PermissionKind;
  status: PermissionStatus;
  /** Pide el permiso al sistema (`undetermined` y `denied`). */
  onRequest?: () => void;
  /** Abre los ajustes del sistema (`blocked`). */
  onOpenSettings?: () => void;
  /** Continuar sin el permiso. Si no se pasa, no se dibuja la alternativa. */
  onSkip?: () => void;
  skipLabel?: string;
  /** Sustituyen a los textos del catálogo (`strings.permissions[kind]`). */
  title?: string;
  message?: string;
  /** Muestra progreso en el botón principal mientras el sistema responde. */
  loading?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Explica por qué se necesita un permiso ANTES de pedirlo y ofrece siempre una alternativa: pedirlo, ir a los ajustes si
 * está bloqueado o continuar sin él. Nunca bloquea al usuario.
 */
export function PermissionExplainer({
  kind,
  status,
  onRequest,
  onOpenSettings,
  onSkip,
  skipLabel = strings.permissions.notNow,
  title,
  message,
  loading = false,
  testID,
  style,
}: PermissionExplainerProps): React.JSX.Element {
  const copy = strings.permissions[kind];
  const blocked = status === "blocked";
  return (
    <View testID={testID} style={[styles.root, style]}>
      <IconTile name={kindIcon[kind]} tone="blue" size={92} iconSize={46} style={styles.tile} />
      <Text variant="title" color="heading" align="center" accessibilityRole="header">
        {title ?? copy.title}
      </Text>
      <Text variant="body" color="body" align="center" size={18} lineHeight={24} style={styles.message}>
        {message ?? copy.message}
      </Text>
      {status === "denied" ? (
        <Banner
          kind="warning"
          message={strings.permissions.deniedRetry}
          style={styles.banner}
          testID={testID !== undefined ? `${testID}.hint` : undefined}
        />
      ) : null}
      {blocked ? (
        <Banner
          kind="notice"
          message={strings.permissions.deniedHint}
          style={styles.banner}
          testID={testID !== undefined ? `${testID}.hint` : undefined}
        />
      ) : null}
      <View style={styles.actions}>
        {blocked ? (
          <Button
            label={strings.permissions.openSettings}
            onPress={onOpenSettings}
            testID={testID !== undefined ? `${testID}.settings` : undefined}
          />
        ) : (
          <Button
            label={strings.permissions.allow}
            onPress={onRequest}
            loading={loading}
            testID={testID !== undefined ? `${testID}.allow` : undefined}
          />
        )}
        {onSkip !== undefined ? (
          <Button
            label={skipLabel}
            variant="link"
            onPress={onSkip}
            testID={testID !== undefined ? `${testID}.skip` : undefined}
            style={styles.skip}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "stretch" },
  tile: { alignSelf: "center", marginBottom: 22 },
  message: { marginTop: 10 },
  banner: { marginTop: 18 },
  actions: { marginTop: 26 },
  skip: { marginTop: 10 },
});
