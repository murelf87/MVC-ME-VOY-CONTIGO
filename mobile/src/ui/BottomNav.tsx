import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/icons";
import { colors, radii, shadows } from "@/theme";
import { CountBadge } from "./Badge";
import { Text } from "./Text";

/** Las cinco pestañas de la barra inferior (09): Mapa · Viajes · Publicar(+) · Mensajes · Perfil. */
export type BottomNavKey = "map" | "trips" | "publish" | "messages" | "profile";

interface NavItemSpec {
  key: BottomNavKey;
  label: string;
  icon: IconName;
  activeIcon: IconName;
}

/** pt del margen seguro inferior que la barra comparte con el indicador de inicio (medido en la lámina 09). */
const HOME_INDICATOR_OVERLAP = 21;

const navItems: readonly NavItemSpec[] = [
  { key: "map", label: "Mapa", icon: "mapOutline", activeIcon: "map" },
  { key: "trips", label: "Viajes", icon: "calendarOutline", activeIcon: "calendar" },
  { key: "publish", label: "Publicar", icon: "add", activeIcon: "add" },
  { key: "messages", label: "Mensajes", icon: "chat", activeIcon: "chatFilled" },
  { key: "profile", label: "Perfil", icon: "personOutline", activeIcon: "person" },
];

export interface BottomNavProps {
  /** Pestaña activa; `undefined` = ninguna (p. ej. en pantallas empujadas). */
  active?: BottomNavKey;
  onNavigate: (key: BottomNavKey) => void;
  /** Contadores por pestaña (p. ej. mensajes sin leer). */
  badges?: Partial<Record<BottomNavKey, number>>;
  /** Suma el margen seguro inferior del dispositivo (por defecto sí). */
  safeArea?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Barra inferior de la lámina 09. Blanca, esquinas superiores redondeadas y sombra hacia arriba; «Publicar» es un círculo
 * azul con «+». Sus `testID` son `${testID}.tab.<clave>` (por defecto `BottomNav.tab.map`…).
 */
export function BottomNav({ active, onNavigate, badges, safeArea = true, testID = "BottomNav", style }: BottomNavProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  // En la lámina 09 la barra mide ≈ 67 pt en total: la etiqueta queda a ≈ 10 pt del borde inferior, ya dentro de la zona del
  // indicador de inicio. Se descuenta ese solape del margen seguro para no inflar la barra (iPhone con isla: 34 − 21 = 13 pt).
  const bottom = safeArea ? Math.max(insets.bottom - HOME_INDICATOR_OVERLAP, 8) : 8;
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={[styles.bar, { paddingBottom: bottom }, style]}
    >
      {navItems.map((item) => {
        const selected = active === item.key;
        const count = badges?.[item.key] ?? 0;
        const label = count > 0 ? `${item.label}, ${count} sin leer` : item.label;
        const isPublish = item.key === "publish";
        const iconColor = selected ? colors.primary : colors.nav.iconInactive;
        return (
          <Pressable
            key={item.key}
            testID={`${testID}.tab.${item.key}`}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => onNavigate(item.key)}
            style={({ pressed }) => [styles.tab, pressed ? styles.pressed : null]}
          >
            <View style={styles.iconSlot}>
              {isPublish ? (
                <View style={styles.publish}>
                  <Icon name="add" size={26} color={colors.onPrimary} />
                </View>
              ) : (
                <Icon name={selected ? item.activeIcon : item.icon} size={28} color={iconColor} />
              )}
              {count > 0 ? <CountBadge count={count} size="sm" style={styles.badge} /> : null}
            </View>
            <Text
              variant="navLabel"
              weight={selected ? "bold" : "regular"}
              color={selected ? colors.primary : colors.nav.labelInactive}
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.bg.white,
    borderTopLeftRadius: radii.xxl - 4,
    borderTopRightRadius: radii.xxl - 4,
    paddingTop: 8,
    paddingHorizontal: 6,
    boxShadow: shadows.nav,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "flex-start", minHeight: 48 },
  pressed: { opacity: 0.6 },
  iconSlot: { height: 28, width: 40, alignItems: "center", justifyContent: "center", marginBottom: 3 },
  publish: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: { position: "absolute", top: -4, right: -6 },
});
