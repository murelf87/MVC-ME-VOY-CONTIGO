/**
 * «Mis roles en MVC» (lámina 29): dos tarjetas lado a lado, «Pasajero · Busco plaza» y «Conductor · Ofrezco plazas».
 * La del modo activo lleva borde azul de 1,5 pt, glifo azul y texto azul más grande; la otra, el glifo pizarra sobre un
 * disco blanco. Pulsar una tarjeta cambia de modo (o ofrece activarlo si la persona aún no lo tiene).
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { Role } from "@/api/types";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import type { RoleCardState } from "../model/profileHeader";
import { profileStrings } from "../strings";
import { lamina } from "./palette";

const copy = profileStrings.myProfile;

export interface RoleCardsProps {
  cards: readonly RoleCardState[];
  onSelect: (role: Role) => void;
  /** Rol que se está activando ahora mismo (se muestra un indicador y se ignoran más pulsaciones). */
  busyRole?: Role | null;
  testID?: string;
}

export function RoleCards({ cards, onSelect, busyRole = null, testID = "MyProfile.roles" }: RoleCardsProps): React.JSX.Element {
  return (
    <View testID={testID} accessibilityRole="radiogroup" style={styles.row}>
      {cards.map((card) => (
        <RoleCard key={card.role} card={card} busy={busyRole === card.role} disabled={busyRole !== null} onSelect={onSelect} testID={`${testID}.${card.role}`} />
      ))}
    </View>
  );
}

interface RoleCardProps {
  card: RoleCardState;
  busy: boolean;
  disabled: boolean;
  onSelect: (role: Role) => void;
  testID: string;
}

function RoleCard({ card, busy, disabled, onSelect, testID }: RoleCardProps): React.JSX.Element {
  const text = card.role === "passenger" ? copy.passenger : copy.driver;
  const glyph = card.role === "passenger" ? "person" : "car";
  const active = card.active;
  const hint = active ? copy.roleActive : card.owned ? copy.roleSwitchHint : copy.activate[card.role === "passenger" ? "passenger" : "driver"].title;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={`${text.title}. ${text.subtitle}`}
      accessibilityHint={hint}
      accessibilityState={{ selected: active, disabled, busy }}
      disabled={disabled}
      onPress={() => onSelect(card.role)}
      style={({ pressed }) => [styles.card, active ? styles.cardActive : null, pressed ? styles.pressed : null]}
    >
      {active ? (
        <View style={styles.glyphSlot}>
          <Icon name={glyph} size={glyph === "person" ? 56 : 52} color={colors.primary} />
        </View>
      ) : (
        <View style={styles.disc}>
          <Icon name={glyph} size={glyph === "car" ? 42 : 40} color={lamina.roleGlyphIdle} />
        </View>
      )}
      <View style={styles.texts}>
        <Text variant="rowTitle" weight="bold" color={active ? "primary" : "strong"} size={active ? 22 : 19.6} lineHeight={26} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {text.title}
        </Text>
        <Text variant="rowText" color={active ? colors.primary : "muted"} size={active ? 16.6 : 15.1} lineHeight={20} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {text.subtitle}
        </Text>
      </View>
      {busy ? <ActivityIndicator size="small" color={colors.primary} style={styles.busy} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", columnGap: 12 },
  card: {
    flex: 1,
    height: 88,
    borderRadius: 18,
    backgroundColor: colors.bg.tint,
    borderWidth: 1.5,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    paddingRight: 8,
  },
  cardActive: { borderColor: colors.primary },
  pressed: { backgroundColor: colors.bg.tintPressed },
  glyphSlot: { width: 60, alignItems: "center", justifyContent: "center" },
  disc: { width: 53, height: 53, borderRadius: 26.5, backgroundColor: colors.bg.white, alignItems: "center", justifyContent: "center", marginRight: 7 },
  texts: { flex: 1, marginLeft: 6 },
  busy: { position: "absolute", top: 8, right: 8 },
});
