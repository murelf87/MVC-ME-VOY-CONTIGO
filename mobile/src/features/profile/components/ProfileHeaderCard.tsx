/**
 * Cabecera de «Mi perfil» (lámina 29): foto redonda de ≈ 124 pt, nombre, «municipio, provincia» y la nota con
 * «(32 valoraciones)». SOLO se pintan las líneas que existen: sin foto aprobada, iniciales; sin valoraciones, ninguna
 * estrella. Toda la cabecera abre «Editar perfil».
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { formatRating } from "@/i18n";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Avatar, Text } from "@/ui";
import type { OwnRating } from "../model/profileHeader";
import { profileStrings } from "../strings";
import { lamina } from "./palette";

const copy = profileStrings.myProfile;

export interface ProfileHeaderCardProps {
  name: string;
  photoUrl: string | null;
  /** «Sevilla, Sevilla»; `null` si no se conoce. */
  location: string | null;
  rating: OwnRating | null;
  onPress: () => void;
  testID?: string;
}

export function ProfileHeaderCard({ name, photoUrl, location, rating, onPress, testID = "MyProfile.header" }: ProfileHeaderCardProps): React.JSX.Element {
  const displayName = name.trim() !== "" ? name.trim() : copy.unnamed;
  const summary = [displayName, location, rating !== null ? copy.ratingA11y(formatRating(rating.average), rating.count) : null].filter((part): part is string => part !== null && part !== "").join(". ");
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={summary} accessibilityHint={copy.openProfileHint} onPress={onPress} style={styles.row}>
      <Avatar source={photoUrl} name={name.trim() !== "" ? name : undefined} size={124} testID={`${testID}.avatar`} />
      <View style={styles.texts}>
        <Text variant="title" weight="bold" color="strong" size={29.5} lineHeight={34} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} testID={`${testID}.name`}>
          {displayName}
        </Text>
        {location !== null ? (
          <Text variant="subtitle" color="muted" size={19.4} lineHeight={24} numberOfLines={1} style={styles.location} testID={`${testID}.location`}>
            {location}
          </Text>
        ) : null}
        {rating !== null ? (
          <View style={styles.rating} testID={`${testID}.rating`}>
            <Icon name="star" size={23} color={lamina.star} />
            <Text variant="bodyStrong" weight="bold" color={lamina.ratingInk} size={20.3} lineHeight={24} style={styles.ratingValue}>
              {formatRating(rating.average)}
            </Text>
            <Text variant="rowText" color="muted" size={17.6} lineHeight={24} numberOfLines={1} style={styles.ratingCount}>
              {copy.ratingCount(rating.count)}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.chevron}>
        <Icon name="chevronRight" size={30} color={colors.primary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", minHeight: 125 },
  texts: { flex: 1, marginLeft: 18.5, paddingTop: 17.2 },
  location: { marginTop: 3.5 },
  rating: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  ratingValue: { marginLeft: 5.5 },
  ratingCount: { marginLeft: 8.5, flexShrink: 1 },
  chevron: { alignSelf: "center" },
});
