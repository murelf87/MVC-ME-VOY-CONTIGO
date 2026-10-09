import React from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Icon } from "@/icons";
import { colors, fontFamilies, radii, scaleFontSize, useFontScaleFactor } from "@/theme";
import { BottomSheet, Text } from "@/ui";
import { cleanText, filterOptions, isListed } from "../logic/vehicle";
import { publishStrings } from "../strings";

const copy = publishStrings.vehicle;

export interface ChoiceSheetProps {
  visible: boolean;
  title: string;
  options: readonly string[];
  /** Valor actual (se marca en la lista). */
  value: string;
  /** Si es `false` solo se puede elegir de la lista (no se ofrece «Usar «…»»). */
  allowCustom?: boolean;
  onSelect: (value: string) => void;
  onClose: () => void;
  testID: string;
}

/**
 * Hoja para elegir marca o modelo: buscador, lista del catálogo y, si lo que se escribe no está, la opción «Usar «…»» para
 * quien conduce un coche poco habitual. Devuelve el texto elegido tal cual está en el catálogo o como lo escribió la persona.
 */
export function ChoiceSheet({ visible, title, options, value, allowCustom = true, onSelect, onClose, testID }: ChoiceSheetProps): React.JSX.Element {
  const factor = useFontScaleFactor();
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);

  const matches = React.useMemo(() => filterOptions(options, query), [options, query]);
  const typed = cleanText(query);
  const offerCustom = allowCustom && typed !== "" && !isListed(options, typed);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} testID={testID}>
      <View style={styles.search}>
        <Icon name="search" size={22} color={colors.text.muted} />
        <TextInput
          testID={`${testID}.search`}
          value={query}
          onChangeText={setQuery}
          placeholder={copy.searchPlaceholder}
          placeholderTextColor={colors.text.placeholder}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (offerCustom) onSelect(typed);
            else if (matches.length === 1 && matches[0] !== undefined) onSelect(matches[0]);
          }}
          accessibilityLabel={copy.searchPlaceholder}
          maxFontSizeMultiplier={1.3}
          style={[styles.searchInput, { fontSize: scaleFontSize(17, factor), lineHeight: scaleFontSize(22, factor), height: scaleFontSize(26, factor) }]}
        />
      </View>

      <View accessibilityRole="menu" style={styles.list}>
        {offerCustom ? (
          <Option
            testID={`${testID}.custom`}
            label={copy.useCustom(typed)}
            icon="add"
            selected={false}
            onPress={() => onSelect(typed)}
          />
        ) : null}
        {matches.map((option) => (
          <Option
            key={option}
            testID={`${testID}.option.${option}`}
            label={option}
            selected={isListed([option], value)}
            onPress={() => onSelect(option)}
          />
        ))}
        {matches.length === 0 && !offerCustom ? (
          <Text variant="body" color="muted" size={16} align="center" style={styles.empty}>
            {copy.noMatches}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

interface OptionProps {
  label: string;
  selected: boolean;
  icon?: "add";
  onPress: () => void;
  testID: string;
}

function Option({ label, selected, icon, onPress, testID }: OptionProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.option, { backgroundColor: selected || pressed ? colors.bg.tintStrong : colors.bg.tint }]}
    >
      {icon !== undefined ? <Icon name={icon} size={24} color={colors.primary} /> : null}
      <Text variant="rowTitle" color="heading" size={18} lineHeight={22} style={[styles.optionText, icon !== undefined ? styles.optionTextIcon : null]} numberOfLines={2}>
        {label}
      </Text>
      {selected ? <Icon name="check" size={24} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  search: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    marginBottom: 10,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.tint,
    borderWidth: 1,
    borderColor: colors.border.soft,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    padding: 0,
    color: colors.text.strong,
    fontFamily: fontFamilies.regular,
  },
  list: { paddingBottom: 8 },
  option: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 8,
    borderRadius: radii.lg,
  },
  optionText: { flex: 1 },
  optionTextIcon: { marginLeft: 12 },
  empty: { paddingVertical: 20 },
});
