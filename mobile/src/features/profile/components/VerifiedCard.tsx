/**
 * Tarjeta verde «Móvil verificado · Tu número está confirmado» (lámina 29). Toda cuenta de MVC entra con un código SMS,
 * así que el móvil siempre está confirmado; el resto de comprobaciones (foto, comprobación privada, documentos) se ven en
 * «Verificación y seguridad», adonde lleva esta tarjeta.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import { profileStrings } from "../strings";
import { lamina } from "./palette";

const copy = profileStrings.myProfile;

export interface VerifiedCardProps {
  onPress: () => void;
  testID?: string;
}

export function VerifiedCard({ onPress, testID = "MyProfile.phone" }: VerifiedCardProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${copy.phoneVerifiedTitle}. ${copy.phoneVerifiedMessage}`}
      accessibilityHint={copy.phoneVerifiedHint}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={styles.disc}>
        <Icon name="phone" size={27} color={colors.onPrimary} />
      </View>
      <View style={styles.texts}>
        <Text variant="rowTitle" weight="bold" color={lamina.verifiedTitle} size={22.3} lineHeight={26} numberOfLines={1}>
          {copy.phoneVerifiedTitle}
        </Text>
        <Text variant="rowText" color={lamina.verifiedSubtitle} size={18.5} lineHeight={22} numberOfLines={1} style={styles.subtitle}>
          {copy.phoneVerifiedMessage}
        </Text>
      </View>
      <View style={styles.check}>
        <Icon name="check" size={25} color={colors.onPrimary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 78,
    borderRadius: 17,
    backgroundColor: colors.success.bg,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12.5,
    paddingRight: 11.5,
  },
  pressed: { backgroundColor: colors.surface.greenPressed },
  disc: { width: 47.5, height: 47.5, borderRadius: 23.75, backgroundColor: lamina.verifiedDisc, alignItems: "center", justifyContent: "center" },
  texts: { flex: 1, marginLeft: 17.5, marginRight: 8 },
  subtitle: { marginTop: 2 },
  check: { width: 35, height: 35, borderRadius: 17.5, backgroundColor: lamina.verifiedDisc, alignItems: "center", justifyContent: "center" },
});
