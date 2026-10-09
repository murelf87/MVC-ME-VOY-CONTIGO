import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { MvcMap, type EdgePadding } from "@/maps";
import { Button, Spinner, Text } from "@/ui";
import { strings } from "@/i18n";
import type { LiveMapModel } from "../model/mapModel";
import { liveStrings } from "../strings";

export type LiveMapStatus = "ready" | "loading" | "unavailable";

export interface LiveMapProps {
  model: LiveMapModel;
  status: LiveMapStatus;
  /** `true`: se puede mover y ampliar (pantalla completa). `false`: mapa de tarjeta, sin gestos. */
  interactive?: boolean;
  /** Cambia para volver a encuadrar (p. ej. al moverse el coche en el mapa de tarjeta). */
  fitKey?: string | number;
  edgePadding?: Partial<EdgePadding>;
  onRetry?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

const DEFAULT_PADDING: Partial<EdgePadding> = { top: 64, right: 44, bottom: 40, left: 44 };

/**
 * Mapa del coche y de la recogida. Ocupa todo el espacio de su contenedor (el padre fija el alto). Dibuja SOLO lo que
 * dicen `liveMapModel` y el servidor: el coche nunca con más precisión de la recibida. Sin datos o sin proveedor de mapas
 * muestra «Mapa no disponible» con reintento.
 */
export function LiveMap({ model, status, interactive = false, fitKey, edgePadding = DEFAULT_PADDING, onRetry, accessibilityLabel, testID }: LiveMapProps): React.JSX.Element {
  if (status === "loading") {
    return (
      <View testID={testID} style={styles.center} accessible accessibilityLabel={strings.common.loading} accessibilityState={{ busy: true }}>
        <Spinner />
      </View>
    );
  }
  if (status === "unavailable") {
    return (
      <View testID={testID} style={styles.center}>
        <Icon name="mapOutline" size={40} color={colors.empty.icon} />
        <Text variant="rowTitle" color={colors.empty.text} align="center" size={18} style={styles.title}>
          {liveStrings.waiting.mapUnavailableTitle}
        </Text>
        <Text variant="rowText" color={colors.empty.text} align="center" size={15.5} lineHeight={20}>
          {liveStrings.waiting.mapUnavailableMessage}
        </Text>
        {onRetry !== undefined ? (
          <Button label={strings.common.retry} variant="outline" size="xs" inline chevron={false} onPress={onRetry} style={styles.retry} testID={testID !== undefined ? `${testID}.retry` : undefined} />
        ) : null}
      </View>
    );
  }
  return (
    <MvcMap
      testID={testID}
      style={styles.map}
      markers={model.markers}
      routes={model.routes}
      fit={model.fit}
      fitKey={fitKey}
      edgePadding={edgePadding}
      interactive={interactive}
      lite={!interactive}
      recenter={interactive}
      accessibilityLabel={accessibilityLabel ?? liveStrings.waiting.mapA11y}
    />
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, backgroundColor: colors.empty.bg },
  title: { marginTop: 8 },
  retry: { marginTop: 12 },
});
