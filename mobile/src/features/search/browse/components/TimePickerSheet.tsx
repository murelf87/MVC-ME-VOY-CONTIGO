import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { LocalTime } from "@/api/types";
import { colors, radii } from "@/theme";
import { BottomSheet, Button, Text } from "@/ui";
import { HOURS, MINUTE_STEPS, clockString, pad, parseClock } from "../logic/schedule";
import { browseStrings } from "../strings";

const copy = browseStrings.defineRoute;

export interface TimePickerSheetProps {
  visible: boolean;
  /** `arrival` (llegada, obligatoria) o `return` (regreso, opcional: ofrece «Sin regreso»). */
  kind: "arrival" | "return";
  value: LocalTime | null;
  onApply: (time: LocalTime | null) => void;
  onClose: () => void;
  /** Textos propios (p. ej. el conductor: «Hora de salida»). Por defecto, los de «Define tu recorrido». */
  title?: string;
  subtitle?: string;
  /** Texto del botón que quita la hora (solo `kind="return"`). */
  noneLabel?: string;
}

/**
 * Selector de hora de «Define tu recorrido»: cuadrícula de horas (00–23) y de minutos (de cinco en cinco). No usa el
 * reloj del sistema para que se vea y se lea igual en iOS, Android y la vista previa. El regreso es opcional.
 */
export function TimePickerSheet({ visible, kind, value, onApply, onClose, title: titleOverride, subtitle: subtitleOverride, noneLabel }: TimePickerSheetProps): React.JSX.Element {
  const parsed = value !== null ? parseClock(value) : null;
  const [hour, setHour] = useState<number>(parsed?.hour ?? (kind === "arrival" ? 8 : 18));
  const [minute, setMinute] = useState<number>(parsed?.minute ?? 0);

  useEffect(() => {
    if (!visible) return;
    const next = value !== null ? parseClock(value) : null;
    setHour(next?.hour ?? (kind === "arrival" ? 8 : 18));
    setMinute(next?.minute ?? 0);
  }, [visible, value, kind]);

  const selected = clockString({ hour, minute });
  const title = titleOverride ?? (kind === "arrival" ? copy.timeSheetTitleArrival : copy.timeSheetTitleReturn);
  const subtitle = subtitleOverride ?? (kind === "arrival" ? copy.timeSheetSubtitleArrival : copy.timeSheetSubtitleReturn);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      testID="TimePickerSheet"
      footer={
        <View style={styles.footer}>
          <Button label={`${copy.timeApply} · ${selected}`} onPress={() => onApply(selected)} testID="TimePickerSheet.apply" />
          {kind === "return" ? <Button label={noneLabel ?? copy.returnNone} variant="ghost" onPress={() => onApply(null)} testID="TimePickerSheet.none" /> : null}
        </View>
      }
    >
      <Text variant="rowTitle" color="heading" style={styles.label}>{copy.timeHours}</Text>
      <View style={styles.grid} accessibilityRole="radiogroup">
        {HOURS.map((h) => (
          <Cell key={h} label={pad(h)} selected={h === hour} a11y={copy.timeHourA11y(pad(h))} onPress={() => setHour(h)} testID={`TimePickerSheet.hour.${pad(h)}`} />
        ))}
      </View>
      <Text variant="rowTitle" color="heading" style={styles.label}>{copy.timeMinutes}</Text>
      <View style={styles.grid} accessibilityRole="radiogroup">
        {MINUTE_STEPS.map((m) => (
          <Cell key={m} label={pad(m)} selected={m === minute} a11y={copy.timeMinuteA11y(pad(m))} onPress={() => setMinute(m)} testID={`TimePickerSheet.minute.${pad(m)}`} />
        ))}
      </View>
    </BottomSheet>
  );
}

function Cell({ label, selected, a11y, onPress, testID }: { label: string; selected: boolean; a11y: string; onPress: () => void; testID: string }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={a11y}
      onPress={onPress}
      testID={testID}
      style={[styles.cell, selected ? styles.cellOn : null]}
    >
      <Text variant="button" size={18} color={selected ? colors.onPrimary : colors.heading}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: 8, marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: { width: 48, height: 44, borderRadius: radii.md, backgroundColor: colors.bg.tint, alignItems: "center", justifyContent: "center" },
  cellOn: { backgroundColor: colors.primary },
  footer: { gap: 4 },
});
