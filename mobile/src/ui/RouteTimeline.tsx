import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "@/theme";
import { Text } from "./Text";

/**
 * `current`: anillo con punto (en curso). `done`/`origin`: punto relleno. `upcoming`: anillo gris. `optional`: anillo azul
 * hueco (parada opcional). `destination`: punto relleno de destino.
 */
export type RouteStopState = "current" | "done" | "upcoming" | "optional" | "destination";

export interface RouteStop {
  title: string;
  /** Texto añadido al título en tamaño menor («(opcional)»). */
  titleSuffix?: string;
  /** Hora a la derecha del título («08:05»). */
  time?: string;
  /** Línea de apoyo bajo el título («En curso»). */
  caption?: string;
  /** Nota en una tercera columna («Tú te subes aquí», «Desvío aprox. 5 min»). */
  note?: string;
  state?: RouteStopState;
}

export interface RouteTimelineProps {
  stops: readonly RouteStop[];
  /** `table` (12): título · hora · nota en columnas. `compact` (23, 30): título y hora a la derecha. */
  variant?: "table" | "compact";
  /** Alto mínimo de cada fila en pt. */
  rowHeight?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const DOT = 18;

/** Línea de tiempo vertical de paradas con puntos y conector (12, 19, 23, 30). */
export function RouteTimeline({ stops, variant = "table", rowHeight, testID, style }: RouteTimelineProps): React.JSX.Element {
  const minHeight = rowHeight ?? (variant === "table" ? 36 : 44);
  return (
    <View testID={testID} style={style}>
      {stops.map((stop, i) => {
        const state: RouteStopState = stop.state ?? (i === stops.length - 1 ? "destination" : i === 0 ? "current" : "optional");
        const last = i === stops.length - 1;
        const next = stops[i + 1];
        const connectorTone = (next?.state ?? "") === "upcoming" || state === "upcoming" ? colors.gray.line : colors.primary;
        return (
          <View key={`${stop.title}-${i}`} style={[styles.row, { minHeight }]} accessible accessibilityLabel={[stop.title, stop.titleSuffix, stop.time, stop.caption, stop.note].filter(Boolean).join(", ")}>
            <View style={styles.rail}>
              {!last ? <View style={[styles.connector, { backgroundColor: connectorTone }]} /> : null}
              <Dot state={state} />
            </View>
            <View style={styles.titleCol}>
              <Text variant="rowTitle" color="heading" size={variant === "table" ? 17 : 17} numberOfLines={1}>
                {stop.title}
                {stop.titleSuffix !== undefined ? (
                  <Text variant="rowText" color="muted" size={14}>
                    {" "}
                    {stop.titleSuffix}
                  </Text>
                ) : null}
              </Text>
              {stop.caption !== undefined ? (
                <Text variant="rowText" color="subtle" size={14}>
                  {stop.caption}
                </Text>
              ) : null}
            </View>
            {stop.time !== undefined ? (
              <Text variant="body" color="strong" size={17} style={variant === "table" ? styles.timeTable : styles.timeCompact}>
                {stop.time}
              </Text>
            ) : null}
            {variant === "table" && stop.note !== undefined ? (
              <Text variant="rowText" color={state === "optional" ? "muted" : "body"} size={14.5} style={styles.note} numberOfLines={2}>
                {stop.note}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Dot({ state }: { state: RouteStopState }): React.JSX.Element {
  switch (state) {
    case "current":
      return (
        <View style={[styles.dot, { borderWidth: 3, borderColor: colors.primary, backgroundColor: colors.bg.white }]}>
          <View style={styles.inner} />
        </View>
      );
    case "done":
    case "destination":
      return <View style={[styles.dot, { backgroundColor: colors.primary }]} />;
    case "optional":
      return <View style={[styles.dot, { borderWidth: 3, borderColor: colors.primary, backgroundColor: colors.bg.white }]} />;
    case "upcoming":
      return <View style={[styles.dot, { borderWidth: 3, borderColor: colors.gray.ring, backgroundColor: colors.bg.white }]} />;
  }
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  rail: { width: 28, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  connector: { position: "absolute", width: 3, top: "50%", bottom: "-50%", left: 12.5, zIndex: 0 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, alignItems: "center", justifyContent: "center", zIndex: 1 },
  inner: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  titleCol: { flex: 1, marginLeft: 10 },
  timeTable: { width: 66, textAlign: "left" },
  timeCompact: { marginLeft: 12 },
  note: { width: 118 },
});
