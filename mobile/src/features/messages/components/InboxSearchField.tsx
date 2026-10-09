/**
 * Campo «Buscar mensajes…» de la bandeja (lámina 25): píldora azul clara de 47 pt con lupa y texto escrito encima.
 * `TextField` del kit no tiene esta variante tintada, de ahí este componente propio.
 */
import React from "react";
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors, fontFamilies } from "@/theme";

export interface InboxSearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  clearLabel: string;
  maxLength?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function InboxSearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  clearLabel,
  maxLength = 60,
  testID = "Inbox.search",
  style,
}: InboxSearchFieldProps): React.JSX.Element {
  const inputRef = React.useRef<TextInput>(null);
  return (
    <View style={[styles.field, style]}>
      <Icon name="search" size={26} color={colors.primary} />
      <TextInput
        ref={inputRef}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.text.placeholder}
        accessibilityLabel={accessibilityLabel}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={maxLength}
        selectionColor={colors.primary}
        style={styles.input}
      />
      {value.length > 0 ? (
        <Pressable
          testID={`${testID}.clear`}
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          hitSlop={10}
          onPress={() => {
            onChangeText("");
            inputRef.current?.focus();
          }}
          style={styles.clear}
        >
          <Icon name="closeCircle" size={22} color={colors.gray.icon} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /** Lámina 25: campo de 363 × 47,5 pt (y 107 → 154,5), fondo azul claro `bg.chip`, lupa a 23 pt del borde. */
  field: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg.chip,
    borderRadius: 22,
    paddingLeft: 22,
    paddingRight: 8,
  },
  input: {
    flex: 1,
    height: 48,
    marginLeft: 14,
    paddingVertical: 0,
    fontFamily: fontFamilies.regular,
    fontSize: 20,
    color: colors.text.strong,
  },
  clear: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
