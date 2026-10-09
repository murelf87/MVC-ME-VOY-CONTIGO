import React from "react";
import { StyleSheet, View } from "react-native";
import type { LivePosition, LiveSignal } from "@/api/types";
import { Banner, OfflineBanner, Text } from "@/ui";
import { useNow } from "../hooks/useNow";
import { effectiveSignal, formatAge, positionAgeSeconds } from "../logic/console";
import { opsStrings } from "../strings";

const M = opsStrings.console.map;

export interface UpdateStripProps {
  /** Señal que ve el servidor para ESTE conductor. */
  signal: LiveSignal;
  position: LivePosition | null;
  /** Instante (reloj del móvil) en que llegó la consola que se está mostrando. */
  receivedAtMs: number;
  /** Segunda línea bajo la actualización («Tus pasajeros te ven en directo.»). */
  caption?: string | null;
  /** Solo vista previa: las posiciones son un recorrido simulado. */
  simulated?: boolean;
  testID?: string;
}

/**
 * Franja bajo el mapa: «Última actualización: hace 5 s» (lámina 21) o, si la posición es vieja, «Sin señal · Última
 * posición: hace 2 min» (lámina 22). Lleva su propio reloj: avanza sin volver a pedir nada al servidor.
 */
export function UpdateStrip({ signal, position, receivedAtMs, caption, simulated = false, testID = "UpdateStrip" }: UpdateStripProps): React.JSX.Element {
  const now = useNow(5_000);
  const age = positionAgeSeconds(position, receivedAtMs, now);
  const effective = effectiveSignal(signal, age);

  let strip: React.ReactNode;
  if (effective === "stale" && age !== null) {
    strip = <OfflineBanner testID={`${testID}.stale`} title={M.staleTitle} detail={M.staleDetail(formatAge(age, now))} />;
  } else if (effective === "none" || age === null) {
    strip = <Banner testID={`${testID}.none`} kind="info" size="xs" tileTone="slate" message={M.noneUpdate} />;
  } else {
    strip = (
      <Banner testID={`${testID}.live`} kind="info" size="xs" tileTone="slate">
        <Text variant="body" color="deep" size={16.5} lineHeight={21}>
          {M.lastUpdate(formatAge(age, now))}
        </Text>
        {caption ? (
          <Text variant="rowText" color="muted" size={14} lineHeight={17}>
            {caption}
          </Text>
        ) : null}
      </Banner>
    );
  }

  return (
    <View testID={testID}>
      {strip}
      {simulated ? (
        <Text testID={`${testID}.simulation`} variant="caption" color="warning" align="center" style={styles.simulation}>
          {opsStrings.sharing.simulation}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  simulation: { marginTop: 6 },
});
