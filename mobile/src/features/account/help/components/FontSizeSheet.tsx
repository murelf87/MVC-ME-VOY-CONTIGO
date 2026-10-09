import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { FontScale } from "@/api/types";
import { colors, radii } from "@/theme";
import { BottomSheet, Button, Radio, Text } from "@/ui";
import { fontScaleOptions } from "../logic/settings";
import { helpStrings } from "../strings";

export interface FontSizeSheetProps {
  visible: boolean;
  value: FontScale;
  onChoose: (scale: FontScale) => void;
  onClose: () => void;
  /** Sin cuenta: el tamaño solo se guarda en este móvil (se explica bajo las opciones). */
  localOnly?: boolean;
}

/**
 * Hoja «Tamaño de letra»: cuatro opciones y una vista previa. Al elegir, el tamaño se aplica a TODA la app al instante
 * (también a esta hoja: la vista previa es texto real de la app, así que se agranda o se encoge a la vez).
 */
export function FontSizeSheet({ visible, value, onChoose, onClose, localOnly = false }: FontSizeSheetProps): React.JSX.Element {
  const options = fontScaleOptions();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={helpStrings.fontSheet.title}
      subtitle={helpStrings.fontSheet.subtitle}
      testID="FontSizeSheet"
      footer={<Button label={helpStrings.fontSheet.done} chevron={false} onPress={onClose} testID="FontSizeSheet.done" />}
    >
      <View style={styles.preview} accessible accessibilityLabel={`${helpStrings.fontSheet.previewTitle}. ${helpStrings.fontSheet.preview}`}>
        <Text variant="caption" color="subtle">
          {helpStrings.fontSheet.previewTitle}
        </Text>
        <Text variant="heading" color="heading" style={styles.previewTitle}>
          {helpStrings.fontSheet.preview}
        </Text>
        <Text variant="body" color="muted">
          {helpStrings.fontSheet.previewBody}
        </Text>
      </View>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              testID={`FontSizeSheet.option.${option.value}`}
              accessibilityRole="radio"
              accessibilityLabel={`${option.label}. ${option.description}`}
              accessibilityState={{ selected }}
              onPress={() => onChoose(option.value)}
              style={({ pressed }) => [
                styles.option,
                { backgroundColor: selected || pressed ? colors.bg.tintStrong : colors.bg.tint },
              ]}
            >
              <Radio selected={selected} look="strong" />
              <View style={styles.optionText}>
                <Text variant="rowTitle" color="heading" size={18} lineHeight={22}>
                  {option.label}
                </Text>
                <Text variant="body" color="muted" size={15.5} lineHeight={20}>
                  {option.description}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {localOnly ? (
        <Text variant="rowText" color="subtle" style={styles.note} testID="FontSizeSheet.localNote">
          {helpStrings.fontSheet.localNote}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  preview: {
    backgroundColor: colors.bg.white,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  previewTitle: { marginTop: 2, marginBottom: 4 },
  options: { marginTop: 14 },
  option: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.lg,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  optionText: { flex: 1, marginLeft: 14 },
  note: { marginTop: 4, marginBottom: 4 },
});
