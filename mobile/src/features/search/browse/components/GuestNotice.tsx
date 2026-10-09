import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Button, Text } from "@/ui";
import { browseStrings } from "../strings";

export interface GuestNoticeProps {
  title: string;
  message: string;
  onCreateAccount: () => void;
  /** Alternativa: seguir explorando sin cuenta. Si no se pasa, no se dibuja. */
  onKeepExploring?: () => void;
  testID?: string;
}

/**
 * Aviso para quien explora sin cuenta cuando una acción la necesita. Siempre deja una salida: crear la cuenta (la app
 * lo devuelve después a donde estaba) o seguir explorando. Mismo aspecto que `EmptyState` (tarjeta lavanda).
 */
export function GuestNotice({ title, message, onCreateAccount, onKeepExploring, testID }: GuestNoticeProps): React.JSX.Element {
  return (
    <View testID={testID} style={styles.card} accessibilityRole="summary">
      <Icon name="person" size={52} color={colors.empty.icon} />
      <Text variant="heading" weight="bold" color={colors.empty.text} align="center" size={20} lineHeight={26} style={styles.title}>
        {title}
      </Text>
      <Text variant="body" color={colors.empty.text} align="center" size={16.5} lineHeight={21} style={styles.message}>
        {message}
      </Text>
      <Button
        label={browseStrings.common.createAccount}
        onPress={onCreateAccount}
        size="sm"
        inline
        chevron={false}
        style={styles.primary}
        testID={testID !== undefined ? `${testID}.createAccount` : undefined}
      />
      {onKeepExploring !== undefined ? (
        <Button
          label={browseStrings.common.keepExploring}
          variant="link"
          size="sm"
          onPress={onKeepExploring}
          style={styles.link}
          testID={testID !== undefined ? `${testID}.explore` : undefined}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.empty.bg,
    borderRadius: radii.lg,
    paddingVertical: 24,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  title: { marginTop: 8 },
  message: { marginTop: 4 },
  primary: { marginTop: 16, alignSelf: "center" },
  link: { marginTop: 6 },
});
