import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { IsoDate } from "@/api/types";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { BottomSheet, Button, Text } from "@/ui";
import { MAX_ADVANCE_DAYS, addDaysIso, compareMonths, dayA11yLabel, monthGrid, monthOf, monthTitle, shiftMonth, todayIso, type MonthRef } from "../logic/schedule";
import { browseStrings } from "../strings";

const copy = browseStrings.defineRoute;
const HEAD = ["L", "M", "X", "J", "V", "S", "D"] as const;

export interface DatePickerSheetProps {
  visible: boolean;
  value: IsoDate | null;
  /** Instante actual (se inyecta para que las pruebas y la vista previa usen el reloj simulado). */
  now: Date;
  onApply: (date: IsoDate) => void;
  onClose: () => void;
}

/** Calendario de un mes (lunes a domingo) con los días de hoy a 90 días vista; los demás se ven apagados. */
export function DatePickerSheet({ visible, value, now, onApply, onClose }: DatePickerSheetProps): React.JSX.Element {
  const today = todayIso(now);
  const last = addDaysIso(today, MAX_ADVANCE_DAYS);
  const [month, setMonth] = useState<MonthRef>(monthOf(value ?? today));
  const [picked, setPicked] = useState<IsoDate | null>(value);

  useEffect(() => {
    if (!visible) return;
    setMonth(monthOf(value ?? today));
    setPicked(value);
  }, [visible, value, today]);

  const weeks = useMemo(() => monthGrid(month, today, picked), [month, today, picked]);
  const canPrev = compareMonths(month, monthOf(today)) > 0;
  const canNext = compareMonths(month, monthOf(last)) < 0;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={copy.dateSheetTitle}
      subtitle={copy.dateSheetSubtitle}
      testID="DatePickerSheet"
      footer={<Button label={copy.dateApply} onPress={() => picked !== null && onApply(picked)} disabled={picked === null} testID="DatePickerSheet.apply" />}
    >
      <View style={styles.nav}>
        <Pressable accessibilityRole="button" accessibilityLabel={copy.datePrevMonth} disabled={!canPrev} onPress={() => setMonth(shiftMonth(month, -1))} style={[styles.arrow, !canPrev ? styles.off : null]} testID="DatePickerSheet.prev">
          <Icon name="chevronRight" size={24} color={colors.primary} style={styles.flip} />
        </Pressable>
        <Text variant="rowTitle" color="heading" size={19} accessibilityRole="header">{monthTitle(month)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={copy.dateNextMonth} disabled={!canNext} onPress={() => setMonth(shiftMonth(month, 1))} style={[styles.arrow, !canNext ? styles.off : null]} testID="DatePickerSheet.next">
          <Icon name="chevronRight" size={24} color={colors.primary} />
        </Pressable>
      </View>
      <View style={styles.row}>
        {HEAD.map((letter, index) => (
          <Text key={`${letter}-${index}`} variant="caption" color="muted" align="center" style={styles.cellBox}>{letter}</Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0]?.iso} style={styles.row}>
          {week.map((day) => (
            <Pressable
              key={day.iso}
              accessibilityRole="button"
              accessibilityLabel={day.disabled ? copy.dateDayDisabledA11y(dayA11yLabel(day.iso)) : copy.dateDayA11y(dayA11yLabel(day.iso), day.selected)}
              accessibilityState={{ selected: day.selected, disabled: day.disabled }}
              disabled={day.disabled || !day.inMonth}
              onPress={() => setPicked(day.iso)}
              style={styles.cellBox}
              testID={`DatePickerSheet.day.${day.iso}`}
            >
              {day.inMonth ? (
                <View style={[styles.day, day.selected ? styles.daySelected : null, day.today && !day.selected ? styles.dayToday : null]}>
                  <Text variant="body" size={17} color={day.selected ? colors.onPrimary : day.disabled ? colors.text.disabled : colors.heading}>{String(day.day)}</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  arrow: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  off: { opacity: 0.3 },
  flip: { transform: [{ scaleX: -1 }] },
  row: { flexDirection: "row" },
  cellBox: { flex: 1, height: 44, alignItems: "center", justifyContent: "center" },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  daySelected: { backgroundColor: colors.primary },
  dayToday: { borderWidth: 1.5, borderColor: colors.primary },
});
