/**
 * Contenedor de cada pestaña del panel: zona desplazable (con «tirar para actualizar») y, opcionalmente, un pie fijo
 * debajo (como el de «Guardar borrador» de la lámina 40). Los márgenes laterales de 13 pt son los de la lámina.
 */
import React from "react";
import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "@/theme";

export interface TabScrollProps {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Pie fijo bajo la zona desplazable. */
  footer?: React.ReactNode;
  scrollRef?: React.Ref<ScrollView>;
  contentStyle?: StyleProp<ViewStyle>;
  testID: string;
}

export function TabScroll({ children, refreshing = false, onRefresh, footer, scrollRef, contentStyle, testID }: TabScrollProps): React.JSX.Element {
  return (
    <View style={styles.flex} testID={testID}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[styles.content, contentStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={onRefresh !== undefined ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
      >
        {children}
      </ScrollView>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 13, paddingTop: 8.5, paddingBottom: 24 },
});
