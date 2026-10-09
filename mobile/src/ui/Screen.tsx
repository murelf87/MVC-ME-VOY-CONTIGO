import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, layout } from "@/theme";

export interface ScreenProps {
  children?: React.ReactNode;
  /** Cabecera fija (normalmente `<ScreenHeader/>`); queda por debajo del margen seguro superior. */
  header?: React.ReactNode;
  /** Zona de acción fija al pie (botón principal…); queda por encima del margen seguro inferior y del teclado. */
  footer?: React.ReactNode;
  /** Barra inferior de navegación (`<BottomNav/>`); va debajo del pie. `BottomNav` ya cubre el margen seguro inferior. */
  bottomBar?: React.ReactNode;
  /** `true` (por defecto): el contenido se desplaza. `false`: el contenido llena el espacio (mapas, listas propias). */
  scroll?: boolean;
  /** Aplica el margen horizontal de pantalla de 30 pt (por defecto `true`). */
  padded?: boolean;
  /** Margen horizontal en pt si se quiere distinto de 30 (las láminas varían entre 29 y 34). */
  paddingX?: number;
  /** Margen seguro superior (por defecto `true`; ponlo a `false` si el contenido sube bajo la barra de estado). */
  topInset?: boolean;
  background?: string;
  /** Pull-to-refresh del contenido desplazable. */
  refreshing?: boolean;
  onRefresh?: () => void;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Esqueleto de pantalla: márgenes seguros reales, cabecera fija, contenido (con o sin desplazamiento), pie fijo que
 * sube con el teclado y barra inferior opcional. Es puramente de presentación.
 */
export function Screen({
  children,
  header,
  footer,
  bottomBar,
  scroll = true,
  padded = true,
  paddingX = layout.screenX,
  topInset = true,
  background = colors.bg.screen,
  refreshing,
  onRefresh,
  contentContainerStyle,
  testID,
}: ScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const horizontal = padded ? paddingX : 0;
  const hasBottomBar = bottomBar !== undefined && bottomBar !== null;
  const refreshControl =
    onRefresh !== undefined ? <RefreshControl refreshing={refreshing === true} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined;

  return (
    <View
      testID={testID}
      style={[
        styles.root,
        {
          backgroundColor: background,
          paddingTop: topInset ? insets.top : 0,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {scroll ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[{ paddingHorizontal: horizontal, paddingBottom: 24 }, contentContainerStyle]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
            refreshControl={refreshControl}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.flex, { paddingHorizontal: horizontal }, contentContainerStyle]}>{children}</View>
        )}
        {footer !== undefined && footer !== null ? (
          <View
            style={[
              styles.footer,
              { paddingHorizontal: horizontal, paddingBottom: hasBottomBar ? 8 : Math.max(insets.bottom, 16) },
            ]}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
      {hasBottomBar ? bottomBar : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  footer: { paddingTop: 10, backgroundColor: colors.bg.screen },
});
