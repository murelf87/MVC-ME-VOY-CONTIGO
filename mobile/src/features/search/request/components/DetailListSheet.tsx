/**
 * Hoja con una lista de elementos con estado («Días de tu reserva»: una fila por día y trayecto con su plaza, o «Tu plaza»
 * de una solicitud suelta). Solo enseña lo que dice el servidor.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { colors, radii } from "@/theme";
import { BottomSheet, Button, StatusPill, Text, type StatusTone } from "@/ui";

export interface DetailItem {
  key: string;
  title: string;
  detail?: string | null;
  state?: string | null;
  tone?: "success" | "warning" | "muted" | "info";
}

const pillTone: Record<NonNullable<DetailItem["tone"]>, StatusTone> = {
  success: "green",
  warning: "orange",
  muted: "gray",
  info: "blue",
};

export interface DetailListSheetProps {
  visible: boolean;
  title: string;
  hint?: string;
  items: readonly DetailItem[];
  closeLabel: string;
  onClose: () => void;
  testID?: string;
}

export function DetailListSheet({ visible, title, hint, items, closeLabel, onClose, testID = "DetailListSheet" }: DetailListSheetProps): React.JSX.Element {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={hint}
      testID={testID}
      footer={<Button label={closeLabel} chevron={false} onPress={onClose} testID={`${testID}.close`} />}
    >
      {items.map((item, index) => (
        <View
          key={item.key}
          testID={`${testID}.item.${index}`}
          accessible
          accessibilityLabel={[item.title, item.detail, item.state].filter((part): part is string => typeof part === "string" && part !== "").join(". ")}
          style={[styles.row, index > 0 ? styles.gap : null]}
        >
          <View style={styles.text}>
            <Text variant="rowTitle" color="strong" size={17.5} lineHeight={22}>
              {item.title}
            </Text>
            {item.detail !== undefined && item.detail !== null ? (
              <Text variant="body" color="muted" size={15.5} lineHeight={20}>
                {item.detail}
              </Text>
            ) : null}
          </View>
          {item.state !== undefined && item.state !== null ? <StatusPill label={item.state} tone={pillTone[item.tone ?? "muted"]} /> : null}
        </View>
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg.tint,
    borderRadius: radii.lg,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  gap: { marginTop: 8 },
  text: { flex: 1, marginRight: 8 },
});
