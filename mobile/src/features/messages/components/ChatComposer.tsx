/**
 * Barra de redacción del chat (lámina 26): clip de adjuntar, campo redondeado y botón azul de 55 pt.
 *
 * La lámina dibuja el botón como micrófono (nota de voz) y otro micrófono dentro del campo (dictado). El servidor del chat
 * NO admite notas de voz (docs/contracts/comms.md §12) y un botón que no hace nada no se acepta, así que el botón azul es
 * siempre «Enviar» (desactivado mientras el campo está vacío) y no hay micrófono dentro del campo. El clip abre la hoja de
 * adjuntar, que solo ofrece compartir ubicación (lo único que el chat acepta además del texto).
 */
import React from "react";
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors, fontFamilies } from "@/theme";
import { IconButton } from "@/ui";

export interface ChatComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onAttach: () => void;
  placeholder: string;
  sendLabel: string;
  attachLabel: string;
  maxLength: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function ChatComposer({ value, onChangeText, onSend, onAttach, placeholder, sendLabel, attachLabel, maxLength, testID = "BookingChat.composer", style }: ChatComposerProps): React.JSX.Element {
  const canSend = value.trim().length > 0;
  return (
    <View style={[styles.composer, style]}>
      <IconButton icon="attach" accessibilityLabel={attachLabel} size={44} iconSize={30} color={colors.gray.help} onPress={onAttach} testID={`${testID}.attach`} />
      <View style={styles.field}>
        <TextInput
          testID={`${testID}.input`}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.text.placeholder}
          accessibilityLabel={placeholder}
          multiline
          maxLength={maxLength}
          selectionColor={colors.primary}
          style={styles.input}
        />
      </View>
      <Pressable
        testID={`${testID}.send`}
        accessibilityRole="button"
        accessibilityLabel={sendLabel}
        accessibilityState={{ disabled: !canSend }}
        disabled={!canSend}
        onPress={onSend}
        style={({ pressed }) => [styles.send, { backgroundColor: !canSend ? colors.primaryDisabled : pressed ? colors.primaryPressed : colors.primary }]}
      >
        <Icon name="send" size={27} color={colors.onPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { flexDirection: "row", alignItems: "center" },
  field: {
    flex: 1,
    minHeight: 52,
    marginLeft: 6,
    marginRight: 9,
    justifyContent: "center",
    backgroundColor: colors.bg.white,
    borderWidth: 1.5,
    borderColor: colors.border.soft,
    borderRadius: 26,
    paddingLeft: 16,
    paddingRight: 14,
  },
  input: {
    maxHeight: 120,
    paddingVertical: 10,
    fontFamily: fontFamilies.regular,
    fontSize: 19,
    color: colors.text.strong,
  },
  send: { width: 55, height: 55, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});
