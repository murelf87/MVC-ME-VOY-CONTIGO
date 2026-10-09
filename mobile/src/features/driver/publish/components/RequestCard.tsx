import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors, radii } from "@/theme";
import { Avatar, StatusPill, Text } from "@/ui";
import type { RequestCardView } from "../logic/requests";
import { publishStrings } from "../strings";
import { OccupancyStrip } from "./OccupancyStrip";
import { RatingLine } from "./RatingLine";

const copy = publishStrings.requests;

export interface RequestCardProps {
  card: RequestCardView;
  /** Abre el detalle de la solicitud (perfil del pasajero y conversación). */
  onOpenDetail: () => void;
  testID: string;
}

/**
 * Tarjeta de una solicitud (lámina 20): pasajero con su valoración y estado, tramo que pide (con horas), desvío estimado,
 * plazas ocupadas por tramo y acceso a su perfil. Las decisiones (aceptar / rechazar) van debajo, fuera de la tarjeta.
 * La foto solo llega si el pasajero la tiene aprobada; si no, se muestran sus iniciales.
 */
export function RequestCard({ card, onOpenDetail, testID }: RequestCardProps): React.JSX.Element {
  return (
    <View style={styles.card} testID={testID} accessibilityLabel={card.accessibilityLabel}>
      <Pressable
        testID={`${testID}.head`}
        accessibilityRole="button"
        accessibilityLabel={copy.openDetailA11y(card.name)}
        onPress={onOpenDetail}
        style={({ pressed }) => [styles.head, pressed ? styles.pressedHead : null]}
      >
        <Avatar source={card.photoUrl} name={card.name} size={100} testID={`${testID}.avatar`} />
        <View style={styles.identity}>
          <Text variant="rowTitle" color="heading" size={29} lineHeight={34} letterSpacing={-0.6} numberOfLines={1} testID={`${testID}.name`}>
            {card.name}
          </Text>
          <View style={styles.rating}>
            <RatingLine average={card.ratingAverage} count={card.ratingCount} testID={`${testID}.rating`} />
          </View>
        </View>
        <StatusPill
          label={card.pill.label}
          tone={card.pill.tone}
          style={styles.pill}
          testID={`${testID}.status`}
        />
        <View style={styles.headChevron}>
          <Icon name="chevronRight" size={26} color={colors.primary} />
        </View>
      </Pressable>

      {card.message !== null ? (
        <View style={styles.message} testID={`${testID}.message`}>
          <Text variant="rowTextStrong" color="muted" size={15} lineHeight={19}>
            {copy.messageTitle(card.name)}
          </Text>
          <Text variant="body" color="body" size={17} lineHeight={22} numberOfLines={4} style={styles.messageText}>
            {card.message}
          </Text>
        </View>
      ) : null}

      <View style={styles.route} testID={`${testID}.route`}>
        <StopRow tone="from" label={card.fromLabel} time={card.fromTime} testID={`${testID}.from`} />
        <View style={styles.connector}>
          <Icon name="arrowDown" size={18} color={colors.heading} />
        </View>
        <StopRow tone="to" label={card.toLabel} time={card.toTime} testID={`${testID}.to`} />
      </View>

      {card.weekly !== null ? (
        <View style={styles.weekly} testID={`${testID}.weekly`}>
          <Icon name="calendar" size={30} color={colors.primary} />
          <View style={styles.weeklyText}>
            <Text variant="rowTitle" color="heading" size={20} lineHeight={24} letterSpacing={-0.3} numberOfLines={2}>
              {card.weekly.summary}
            </Text>
            <Text variant="body" color="deep" size={17} lineHeight={22} numberOfLines={2}>
              {`${card.weekly.legs} · ${card.weekly.start}`}
            </Text>
          </View>
        </View>
      ) : null}

      {card.detourText !== null ? (
        <View style={styles.detour} testID={`${testID}.detour`} accessible accessibilityLabel={`${copy.detourLabel}: ${card.detourText}`}>
          <Icon name="clock" size={34} color={colors.primary} />
          <Text variant="body" color="heading" size={20} lineHeight={25} letterSpacing={-0.4} style={styles.detourLabel} numberOfLines={1}>
            {copy.detourLabel}
          </Text>
          <Text variant="rowTitle" color="heading" size={24} lineHeight={29} letterSpacing={-0.5} numberOfLines={1}>
            {card.detourText}
          </Text>
        </View>
      ) : null}

      <View style={styles.occupancy}>
        <OccupancyStrip occupancy={card.occupancy} testID={`${testID}.occupancy`} />
      </View>

      <Pressable
        testID={`${testID}.profile`}
        accessibilityRole="button"
        accessibilityLabel={copy.profileAndTalkA11y(card.name)}
        onPress={onOpenDetail}
        style={({ pressed }) => [styles.profile, pressed ? styles.pressedProfile : null]}
      >
        <Icon name="chatEllipses" size={27} color={colors.primary} />
        <Text variant="rowTitle" color="heading" size={22} lineHeight={27} letterSpacing={-0.5} numberOfLines={1} style={styles.profileLabel}>
          {copy.profileAndTalk}
        </Text>
        <Icon name="chevronRight" size={26} color={colors.primary} />
      </Pressable>
    </View>
  );
}

interface StopRowProps {
  tone: "from" | "to";
  label: string;
  time: string;
  testID: string;
}

function StopRow({ tone, label, time, testID }: StopRowProps): React.JSX.Element {
  return (
    <View style={styles.stop} testID={testID}>
      <View style={[styles.dot, { backgroundColor: tone === "from" ? colors.success.solid : colors.primary }]} />
      <Text variant="rowTitle" color="heading" size={22} lineHeight={27} letterSpacing={-0.5} numberOfLines={1} style={styles.stopName}>
        {label}
      </Text>
      <Text variant="rowTitle" color="heading" size={22} lineHeight={27} letterSpacing={-0.5} numberOfLines={1} style={styles.stopTime}>
        {time}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingTop: 9.5,
    paddingBottom: 0,
    paddingLeft: 7,
    paddingRight: 4.75,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border.soft,
    backgroundColor: colors.bg.white,
  },
  head: { height: 100, flexDirection: "row", alignItems: "center", paddingLeft: 3, borderRadius: radii.lg },
  pressedHead: { opacity: 0.85 },
  identity: { flex: 1, marginLeft: 16, paddingRight: 118, justifyContent: "center" },
  rating: { marginTop: 5 },
  pill: { position: "absolute", top: 9, right: 0, minHeight: 28.5, paddingHorizontal: 19 },
  headChevron: { position: "absolute", top: 52, right: 3 },

  message: {
    marginTop: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.chip,
  },
  messageText: { marginTop: 3 },

  route: {
    marginTop: 10,
    paddingTop: 7,
    paddingBottom: 5,
    paddingLeft: 15,
    paddingRight: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.tint,
  },
  stop: { height: 36, flexDirection: "row", alignItems: "center" },
  dot: { width: 20, height: 20, borderRadius: 10 },
  stopName: { flex: 1, marginLeft: 23.5, marginRight: 8 },
  stopTime: { textAlign: "right" },
  connector: { height: 20, paddingLeft: 1, justifyContent: "center" },

  weekly: {
    marginTop: 8.5,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.tintStrong,
  },
  weeklyText: { flex: 1, marginLeft: 16 },

  detour: {
    marginTop: 8.5,
    height: 57.5,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 17,
    paddingRight: 20.75,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.tintStrong,
  },
  detourLabel: { flex: 1, marginLeft: 21.5, marginRight: 8 },

  occupancy: { marginTop: 10 },

  profile: {
    marginTop: 10,
    height: 58.5,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 70.5,
    paddingRight: 14.5,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.bg.white,
  },
  pressedProfile: { backgroundColor: colors.bg.tintSoft },
  profileLabel: { flex: 1, marginLeft: 19 },
});
