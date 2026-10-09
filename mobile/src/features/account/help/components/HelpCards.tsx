import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";
import { helpStrings } from "../strings";

/** Fondo de las tarjetas informativas de las láminas 35/36 (#ECF6FD…#EDF6FD). */
const CARD_BG = "#EDF6FD";
/** Disco claro de la «i» (#B3D6FE). */
const INFO_DISC = "#B3D6FE";

export interface HelpIntroCardProps {
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Tarjeta «¿En qué podemos ayudarte?» del Centro de ayuda (36b): disco azul con burbujas y dos líneas de texto. */
export function HelpIntroCard({ testID, style }: HelpIntroCardProps): React.JSX.Element {
  return (
    <View testID={testID} accessible accessibilityLabel={`${helpStrings.help.introTitle} ${helpStrings.help.introMessage}`} style={[styles.intro, style]}>
      <View style={styles.introDisc}>
        <Icon name="chatHelp" size={34} color={colors.onPrimary} />
      </View>
      <View style={styles.introText}>
        <Text variant="title" color="heading" size={22} lineHeight={27}>
          {helpStrings.help.introTitle}
        </Text>
        <Text variant="body" color="subtle" size={15.5} lineHeight={20} style={styles.introMessage}>
          {helpStrings.help.introMessage}
        </Text>
      </View>
    </View>
  );
}

export interface InfoCardProps {
  title: string;
  message: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Tarjeta informativa con disco claro y una «i» azul («Si es urgente», 36b). */
export function InfoCard({ title, message, testID, style }: InfoCardProps): React.JSX.Element {
  return (
    <View testID={testID} accessible accessibilityLabel={`${title}. ${message}`} style={[styles.info, style]}>
      <View style={styles.infoDisc}>
        <Icon name="infoMark" size={36} color={colors.text.link} />
      </View>
      <View style={styles.infoText}>
        <Text variant="rowTitle" color="deep" size={17.5} lineHeight={22}>
          {title}
        </Text>
        <Text variant="body" color="subtle" size={15.3} lineHeight={20} style={styles.infoMessage}>
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: {
    minHeight: 97,
    flexDirection: "row",
    alignItems: "flex-start",
    paddingTop: 13,
    paddingBottom: 11,
    paddingLeft: 13.5,
    paddingRight: 10,
    borderRadius: 16,
    backgroundColor: CARD_BG,
  },
  introDisc: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  introText: { flex: 1, marginLeft: 17.5 },
  introMessage: { marginTop: 5.5 },
  info: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 13,
    paddingRight: 12,
    borderRadius: radii.xl - 2,
    backgroundColor: CARD_BG,
  },
  infoDisc: {
    width: 44.5,
    height: 44.5,
    borderRadius: 22.25,
    backgroundColor: INFO_DISC,
    alignItems: "center",
    justifyContent: "center",
  },
  infoText: { flex: 1, marginLeft: 16 },
  infoMessage: { marginTop: 2 },
});
