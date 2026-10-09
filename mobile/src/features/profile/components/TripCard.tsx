/**
 * Tarjeta de «Mis viajes» (lámina 30) en sus dos formas:
 *  · reserva semanal: disco de categoría + «Universidad / Lun - Vie · Recurrente», trayecto, avatares, «3/4 plazas ›» y franja de
 *    estado («Confirmada ›»);
 *  · viaje suelto: cúpula con el coche + píldora «✓ En 12 min», título y día («Hoy · 07:30 – 07:50»), trayecto, avatares,
 *    «3/4 plazas ›» y franja de llegada («El conductor llegará en unos 10 min ›»).
 * El cuerpo abre la acción principal; el ⋮ abre las demás; la franja abre la suya. No hay botones decorativos: cada zona
 * pulsable lleva su `testID` y su etiqueta accesible.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Text, tripCategoryIcon } from "@/ui";
import type { CardAction, CardPill, CardStrip, CardTone, TripCardView } from "../model/tripCards";
import { profileStrings } from "../strings";
import { AvatarStack } from "./AvatarStack";
import { lamina } from "./palette";
import { TripRoute } from "./TripRoute";

const copy = profileStrings.myTrips;

export interface TripCardProps {
  view: TripCardView;
  /** Se llama con la acción de la zona pulsada (cuerpo o franja). */
  onOpen: (action: CardAction) => void;
  /** Se llama al pulsar el ⋮ (la pantalla abre la hoja con las demás acciones). */
  onMenu: (view: TripCardView) => void;
  testID: string;
}

export function TripCard({ view, onOpen, onMenu, testID }: TripCardProps): React.JSX.Element {
  const weekly = view.kind === "weekly";
  const primary = view.primary;
  const hasPeople = view.people.length > 0;
  return (
    <View testID={testID} style={styles.card}>
      <Pressable
        testID={`${testID}.open`}
        accessibilityRole="button"
        accessibilityLabel={view.a11yLabel}
        accessibilityHint={copy.statusHint}
        disabled={primary === null}
        onPress={() => {
          if (primary !== null) onOpen(primary);
        }}
        style={styles.body}
      >
        {weekly ? <WeeklyHeader view={view} /> : <TripHeader view={view} />}
        <TripRoute from={view.from} to={view.to} variant={weekly ? "weekly" : "trip"} style={weekly ? styles.routeWeekly : styles.routeTrip} testID={`${testID}.route`} />
        {hasPeople || view.seats !== null ? (
          <View style={[styles.people, weekly ? styles.peopleWeekly : styles.peopleTrip, !hasPeople ? styles.peopleEmpty : null]}>
            <AvatarStack people={view.people} testID={`${testID}.riders`} />
            <View style={styles.spacer} />
            {view.seats !== null ? (
              <Text variant="bodyStrong" weight="bold" color="heading" size={19.5} lineHeight={24} accessibilityLabel={view.seats.a11y} testID={`${testID}.seats`}>
                {view.seats.label}
              </Text>
            ) : null}
            {primary !== null ? (
              <View style={styles.seatsChevron}>
                <Icon name="chevronRight" size={28} color={colors.heading} />
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      {view.menu.length > 0 ? (
        <Pressable testID={`${testID}.menu`} accessibilityRole="button" accessibilityLabel={copy.cardMenu} onPress={() => onMenu(view)} hitSlop={4} style={styles.kebab}>
          <Icon name="more" size={28} color={colors.primary} />
        </Pressable>
      ) : null}

      {view.strip !== null ? <Strip strip={view.strip} onOpen={onOpen} weekly={weekly} testID={`${testID}.strip`} /> : null}
    </View>
  );
}

// ── Cabeceras ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function WeeklyHeader({ view }: { view: TripCardView }): React.JSX.Element {
  return (
    <View style={styles.weeklyHeader}>
      <View style={styles.categoryDisc}>
        <Icon name={tripCategoryIcon[view.category]} size={38} color={colors.primary} />
      </View>
      <View style={styles.weeklyTexts}>
        <Text variant="title" weight="bold" color="heading" size={23.6} lineHeight={28} numberOfLines={1}>
          {view.title}
        </Text>
        <Text variant="subtitle" color="muted" size={19} lineHeight={24} numberOfLines={1}>
          {view.subtitle}
        </Text>
      </View>
    </View>
  );
}

function TripHeader({ view }: { view: TripCardView }): React.JSX.Element {
  return (
    <View>
      <View style={styles.tripTop}>
        <View style={styles.dome}>
          <View style={styles.domeDisc} />
          <View style={styles.domeGlyph}>
            <Icon name="car" size={37} color={colors.primary} />
          </View>
        </View>
        {view.pill !== null ? <Pill pill={view.pill} /> : null}
      </View>
      <Text variant="title" weight="bold" color="strong" size={23.1} lineHeight={28} numberOfLines={2} style={styles.tripTitle}>
        {view.title}
      </Text>
      <Text variant="subtitle" color="body" size={21.3} lineHeight={26} numberOfLines={1} style={styles.tripSubtitle}>
        {view.subtitle}
      </Text>
    </View>
  );
}

function pillColors(tone: CardTone): { bg: string; fg: string; icon: string } {
  if (tone === "green") return { bg: lamina.pillMint, fg: lamina.pillMintText, icon: lamina.pillMintCheck };
  const pill = colors.pill[tone];
  return { bg: pill.bg, fg: pill.fg, icon: pill.fg };
}

function Pill({ pill }: { pill: CardPill }): React.JSX.Element {
  const tone = pillColors(pill.tone);
  return (
    <View accessible accessibilityLabel={pill.label} style={[styles.pill, { backgroundColor: tone.bg }]}>
      {pill.icon !== undefined ? <Icon name={pill.icon} size={20} color={tone.icon} /> : null}
      <Text variant="bodyStrong" weight="semibold" color={tone.fg} size={18.3} lineHeight={22} numberOfLines={1} style={pill.icon !== undefined ? styles.pillText : null}>
        {pill.label}
      </Text>
    </View>
  );
}

// ── Franja inferior ───────────────────────────────────────────────────────────────────────────────────────────────────

function stripColors(strip: CardStrip): { bg: string; fg: string; icon: string } {
  if (strip.kind === "eta") return { bg: lamina.stripBlue, fg: strip.stale ? colors.text.muted : colors.primary, icon: colors.primary };
  if (strip.tone === "green") return { bg: lamina.stripGreen, fg: lamina.stripGreenText, icon: lamina.stripGreenIcon };
  const pill = colors.pill[strip.tone];
  return { bg: pill.bg, fg: pill.fg, icon: pill.fg };
}

interface StripProps {
  strip: CardStrip;
  weekly: boolean;
  onOpen: (action: CardAction) => void;
  testID: string;
}

function Strip({ strip, weekly, onOpen, testID }: StripProps): React.JSX.Element {
  const tone = stripColors(strip);
  const eta = strip.kind === "eta";
  const iconName = eta ? "clock" : strip.icon;
  const action = strip.action;
  const content = (
    <>
      <View style={eta ? styles.etaIcon : styles.statusIcon}>
        <Icon name={iconName} size={eta ? 32 : 30} color={tone.icon} />
      </View>
      <Text variant="body" weight={eta ? "regular" : "semibold"} color={tone.fg} size={eta ? 18.1 : 18.7} lineHeight={22} numberOfLines={1} style={eta ? styles.etaLabel : styles.statusLabel}>
        {strip.label}
      </Text>
      {action !== null ? (
        <View style={styles.stripChevron}>
          <Icon name="chevronRight" size={28} color={eta ? colors.heading : tone.icon} />
        </View>
      ) : null}
    </>
  );
  const style = [styles.strip, weekly ? styles.stripWeekly : styles.stripTrip, { backgroundColor: tone.bg }];
  if (action === null) {
    return (
      <View testID={testID} accessible accessibilityLabel={strip.label} style={style}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={strip.label}
      accessibilityHint={eta ? copy.etaHint : copy.statusHint}
      onPress={() => onOpen(action)}
      style={style}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 13.5,
    borderRadius: 18,
    backgroundColor: colors.bg.white,
    paddingBottom: 13,
    boxShadow: `0px 3px 16px ${lamina.cardGlow}`,
    overflow: "hidden",
  },
  body: { paddingTop: 0 },
  // — reserva semanal
  weeklyHeader: { height: 56.5, marginTop: 10.5, marginLeft: 16, flexDirection: "row" },
  categoryDisc: { width: 56.5, height: 56.5, borderRadius: 28.25, backgroundColor: lamina.categoryDisc, alignItems: "center", justifyContent: "center" },
  weeklyTexts: { flex: 1, marginLeft: 15, marginTop: -1.4, marginRight: 52 },
  routeWeekly: { marginTop: 10.2 },
  peopleWeekly: { marginTop: 14.8 },
  // — viaje suelto
  tripTop: { height: 33.5, marginTop: 11.5, marginLeft: 16.5, flexDirection: "row", alignItems: "flex-start" },
  dome: { width: 54, height: 33.5, overflow: "hidden" },
  domeDisc: { position: "absolute", left: 0, top: 0, width: 54, height: 54, borderRadius: 27, backgroundColor: lamina.dome },
  domeGlyph: { position: "absolute", left: 8, top: 9 },
  pill: { height: 32, marginLeft: 20.5, borderRadius: 16, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 10.5 },
  pillText: { marginLeft: 6.5 },
  tripTitle: { marginTop: 5.4, marginLeft: 18.5, marginRight: 16 },
  tripSubtitle: { marginLeft: 18.5, marginRight: 16 },
  routeTrip: { marginTop: 8.6 },
  peopleTrip: { marginTop: 15 },
  // — comunes
  people: { flexDirection: "row", alignItems: "center", paddingLeft: 19, paddingRight: 12.3 },
  peopleEmpty: { minHeight: 28 },
  spacer: { flex: 1 },
  seatsChevron: { marginLeft: 13.7 },
  kebab: { position: "absolute", top: 8.5, right: 6.5, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  strip: { height: 45.5, marginTop: 8, flexDirection: "row", alignItems: "center", borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  stripWeekly: { paddingLeft: 25.25, paddingRight: 11.75 },
  stripTrip: { height: 46.5, paddingLeft: 18.75, paddingRight: 11.75 },
  statusIcon: { width: 30, alignItems: "center" },
  statusLabel: { flex: 1, marginLeft: 11.75 },
  etaIcon: { width: 32, alignItems: "center" },
  etaLabel: { flex: 1, marginLeft: 11.25 },
  stripChevron: { marginLeft: 8 },
});
