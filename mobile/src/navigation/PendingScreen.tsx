/**
 * Pantalla provisional de ANDAMIAJE. Cada ruta de un slice nace apuntando aquí hasta que su agente escribe la
 * pantalla real (y entonces cambia el `component` en `features/<slice>/routes.ts`). Enseña el nombre de la ruta y
 * sus parámetros para poder comprobar la navegación; no es una pantalla de producto.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/theme/colors";
import { useAppNavigation } from "./hooks";

export interface PendingScreenProps {
  route: { name: string; params?: object | undefined };
}

export function PendingScreen({ route }: PendingScreenProps) {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const params = route.params === undefined ? "(sin parámetros)" : JSON.stringify(route.params, null, 2);
  return (
    <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]} testID={`${route.name}.pending`}>
      <Text style={styles.caption} accessibilityRole="text">
        Pantalla sin implementar
      </Text>
      <Text style={styles.title} accessibilityRole="header">
        {route.name}
      </Text>
      <ScrollView style={styles.params} contentContainerStyle={styles.paramsContent}>
        <Text style={styles.mono} selectable>
          {params}
        </Text>
      </ScrollView>
      {navigation.canGoBack() ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={navigation.goBack} style={styles.back} testID={`${route.name}.back`}>
          <Text style={styles.backLabel}>Volver</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.screen, paddingHorizontal: 24 },
  caption: { fontSize: 13, fontWeight: "600", color: colors.warning.text, textTransform: "uppercase", letterSpacing: 0.6 },
  title: { fontSize: 26, fontWeight: "800", color: colors.heading, marginTop: 4, marginBottom: 16 },
  params: { flex: 1, backgroundColor: colors.bg.tintSoft, borderRadius: 12 },
  paramsContent: { padding: 12 },
  mono: { fontFamily: "Courier", fontSize: 12, lineHeight: 18, color: colors.text.body },
  back: { minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 12, borderRadius: 14, backgroundColor: colors.primary },
  backLabel: { fontSize: 16, fontWeight: "700", color: colors.onPrimary },
});
