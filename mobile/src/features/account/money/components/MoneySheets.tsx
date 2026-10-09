import React from "react";
import { StyleSheet, View } from "react-native";
import { BottomSheet, Button, OptionSheet, Text, type OptionSheetOption } from "@/ui";
import { isCurrentMonth, monthLongLabel, recentMonthKeys } from "../model";
import { moneyStrings } from "../strings";

// ── Selector de mes ──────────────────────────────────────────────────────────────────────────────────────────────

export interface MonthSheetProps {
  visible: boolean;
  /** Mes mostrado (`YYYY-MM`). */
  month: string;
  /** Instante de referencia: define cuál es el mes actual y los doce meses que se ofrecen. */
  now: number;
  onSelect: (month: string) => void;
  onClose: () => void;
  testID?: string;
}

/** Hoja con los últimos doce meses para cambiar el resumen de pagos y cobros. */
export function MonthSheet({ visible, month, now, onSelect, onClose, testID = "MonthSheet" }: MonthSheetProps): React.JSX.Element {
  const options: OptionSheetOption<string>[] = recentMonthKeys(now, 12).map((key) => ({
    value: key,
    label: monthLongLabel(key),
    ...(isCurrentMonth(key, now) ? { description: moneyStrings.overview.currentMonthTag } : {}),
  }));
  return <OptionSheet visible={visible} title={moneyStrings.overview.monthSheetTitle} options={options} selected={month} onSelect={onSelect} onClose={onClose} testID={testID} />;
}

// ── Hoja informativa ─────────────────────────────────────────────────────────────────────────────────────────────

export interface InfoSheetProps {
  visible: boolean;
  title: string;
  /** Párrafos de la hoja. */
  paragraphs: readonly string[];
  /** Texto del botón de cierre (por defecto «Entendido»). */
  closeLabel?: string;
  /** Acción opcional encima del botón de cierre (por ejemplo «Ver liquidaciones»). */
  actionLabel?: string;
  onAction?: () => void;
  onClose: () => void;
  testID?: string;
}

/** Hoja de texto corto con un botón: explica «Comisión de la plataforma», «Próximo abono»… sin llevar a otra pantalla. */
export function InfoSheet({ visible, title, paragraphs, closeLabel = moneyStrings.commissionSheet.understood, actionLabel, onAction, onClose, testID = "InfoSheet" }: InfoSheetProps): React.JSX.Element {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      testID={testID}
      footer={
        <View style={styles.footer}>
          {actionLabel !== undefined && onAction !== undefined ? (
            <Button label={actionLabel} variant="tint" chevron={false} onPress={onAction} testID={`${testID}.action`} style={styles.actionGap} />
          ) : null}
          <Button label={closeLabel} chevron={false} onPress={onClose} testID={`${testID}.close`} />
        </View>
      }
    >
      <View style={styles.body}>
        {paragraphs.map((text, index) => (
          <Text key={index} variant="body" color="body" size={17} lineHeight={23} style={index > 0 ? styles.paragraph : undefined}>
            {text}
          </Text>
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: 4 },
  paragraph: { marginTop: 12 },
  footer: { paddingTop: 4 },
  actionGap: { marginBottom: 10 },
});
