import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "@/theme";
import { Text } from "@/ui";

/** Bloque rotulado de la galería: pie pequeño con el nombre y, debajo, el componente en su estado. */
export function Demo({
  title,
  note,
  children,
  style,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <View style={[styles.demo, style]}>
      <Text variant="captionStrong" color="muted" size={13} style={styles.demoTitle}>
        {title}
      </Text>
      {note !== undefined ? (
        <Text variant="caption" color="subtle" size={12.5} style={styles.demoNote}>
          {note}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/** Subtítulo dentro de una sección. */
export function Group({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.group}>
      <Text variant="heading" color="heading" style={styles.groupTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** Fila horizontal que salta de línea. */
export function Wrap({ children, gap = 12 }: { children: React.ReactNode; gap?: number }): React.JSX.Element {
  return <View style={[styles.wrap, { gap }]}>{children}</View>;
}

export function Spacer({ height = 12 }: { height?: number }): React.JSX.Element {
  return <View style={{ height }} />;
}

/** Muestra de color: cuadro + ruta del token + valor. */
export function Swatch({ path, value }: { path: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.swatchRow} accessible accessibilityLabel={`${path} ${value}`}>
      <View style={[styles.swatch, { backgroundColor: value }]} />
      <View style={styles.swatchText}>
        <Text variant="rowTextStrong" color="strong" size={14.5}>
          {path}
        </Text>
        <Text variant="caption" color="muted" size={12.5}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  demo: { marginTop: 18 },
  demoTitle: { marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6 },
  demoNote: { marginBottom: 8 },
  group: { marginTop: 26 },
  groupTitle: { marginBottom: 2 },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  swatchRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  swatch: { width: 44, height: 32, borderRadius: 8, borderWidth: 1, borderColor: colors.border.default },
  swatchText: { marginLeft: 12, flex: 1 },
});
