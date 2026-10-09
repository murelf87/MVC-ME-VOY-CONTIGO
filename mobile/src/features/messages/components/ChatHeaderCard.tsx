/**
 * Cabecera del chat (lámina 26): foto, nombre y rol de la otra persona, el día, la ruta con sus horas y tres filas
 * verdes tocables: «Tu reserva confirmada» (abre la reserva), «Punto de recogida» (abre el punto en el mapa) y «Aporte
 * del viaje» (explica el importe: «Por definir» mientras no haya tarifa aprobada). En un grupo de ruta no hay reserva
 * propia: foto de grupo, título, ruta y número de personas, con una fila «Miembros» que abre la información del grupo.
 *
 * Medidas de la lámina (pt): tarjeta de 366 de ancho (13,5 de margen) y 257 de alto, radio 20; foto de 72; filas verdes de
 * 43 (una línea) y 58,5 (dos líneas); iconos a 39 pt del borde, texto a 92 pt, chevron a 18 pt del borde derecho.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ConversationDetail } from "@/api/types";
import { formatDayRelative, formatTime, MONEY_ILLUSTRATIVE_TAG, moneyParts } from "@/i18n";
import { Icon, type IconName } from "@/icons";
import { colors, hexAlpha } from "@/theme";
import { Avatar, Text } from "@/ui";
import { peerRoleOf, roleWord } from "../model/people";
import { messagesStrings } from "../strings";

const copy = messagesStrings.chat;

export interface ChatHeaderCardProps {
  detail: ConversationDetail;
  /** «Ahora» para decir «Hoy» / «Mañana». */
  now: number;
  /** Fila «Tu reserva confirmada». */
  onOpenBooking: () => void;
  /** Fila «Punto de recogida». */
  onOpenPickup: () => void;
  /** Fila «Aporte del viaje». */
  onOpenContribution: () => void;
  /** Fila «Miembros» de un grupo. */
  onOpenMembers: () => void;
  testID?: string;
}

interface InfoRowProps {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  accessibilityLabel: string;
  first?: boolean;
  disabled?: boolean;
  testID: string;
}

function InfoRow({ icon, title, subtitle, onPress, accessibilityLabel, first = false, disabled = false, testID }: InfoRowProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, first ? null : styles.rowDivider, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.rowIcon}>
        <Icon name={icon} size={27} color={colors.primary} />
      </View>
      <View style={styles.rowText}>
        <Text variant="rowTitle" color="strong" size={19} lineHeight={23} numberOfLines={1}>
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text variant="body" color="body" size={18} lineHeight={22} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {disabled ? null : <Icon name="chevronRight" size={24} color={colors.primary} />}
    </Pressable>
  );
}

export function ChatHeaderCard({ detail, now, onOpenBooking, onOpenPickup, onOpenContribution, onOpenMembers, testID = "BookingChat.header" }: ChatHeaderCardProps): React.JSX.Element {
  if (detail.kind === "group") {
    const members = detail.memberCount ?? detail.members?.length ?? 0;
    return (
      <View testID={testID} style={styles.card}>
        <View style={styles.top}>
          <View style={styles.groupTile} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Icon name="people" size={42} color={colors.primary} />
          </View>
          <View style={styles.info}>
            <Text variant="titleSm" color="strong" size={21} lineHeight={26} numberOfLines={1}>
              {detail.title}
            </Text>
            {detail.routeLabel !== null ? (
              <Text variant="rowTitle" color="strong" size={19.5} lineHeight={24} numberOfLines={1} style={styles.routeLine}>
                {detail.routeLabel}
              </Text>
            ) : null}
            <Text variant="body" color="body" size={18.5} lineHeight={22} numberOfLines={1}>
              {copy.memberCount(members)}
            </Text>
          </View>
        </View>
        <View style={styles.rows}>
          <InfoRow
            first
            testID={`${testID}.members`}
            icon="people"
            title={messagesStrings.info.membersSection(members)}
            onPress={onOpenMembers}
            accessibilityLabel={messagesStrings.info.membersSection(members)}
          />
        </View>
      </View>
    );
  }

  const peer = detail.peer;
  const firstName = peer?.firstName ?? detail.title;
  const peerRole = peerRoleOf(detail.myRole);
  const trip = detail.trip;
  const day = trip?.departureAt != null ? formatDayRelative(trip.departureAt, now) : null;
  const from = trip?.departureAt != null ? formatTime(trip.departureAt) : null;
  const to = trip?.arrivalEstimateAt != null ? formatTime(trip.arrivalEstimateAt) : null;
  const seats = detail.booking !== null ? copy.seatsCount(detail.booking.seats) : null;
  const timeLine = [from !== null ? copy.timeRange(from, to) : null, seats].filter((part): part is string => part !== null).join(" · ");

  const completed = detail.booking?.status === "completed";
  const asDriver = detail.myRole === "driver";
  const bookingTitle = asDriver
    ? completed
      ? copy.bookingCompletedDriver
      : copy.bookingConfirmedDriver
    : completed
      ? copy.bookingCompleted
      : copy.bookingConfirmed;

  const pickupLabel = detail.pickupPoint?.label ?? null;

  const money = detail.contribution;
  const parts = money !== null ? moneyParts(money) : null;
  const defined = money?.status === "defined";
  const contributionTitle = `${copy.contribution}${defined ? "" : copy.contributionPending}`;
  const contributionSubtitle =
    parts === null || parts.pending ? undefined : defined ? parts.text : copy.proposal(parts.illustrative ? `${parts.text} (${MONEY_ILLUSTRATIVE_TAG})` : parts.text);

  return (
    <View testID={testID} style={styles.card}>
      <View style={styles.top}>
        <Avatar size={72} source={peer?.photoUrl ?? null} name={peer?.displayName ?? detail.title} />
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text variant="titleSm" color="strong" size={21} lineHeight={26} numberOfLines={1} style={styles.name}>
              {firstName}
            </Text>
            <Text variant="body" color="body" size={19} lineHeight={26} numberOfLines={1} style={styles.role}>
              {`(${roleWord(peerRole, firstName)})`}
            </Text>
            <View style={styles.spacer} />
            {day !== null ? (
              <Text variant="body" color="muted" size={19} lineHeight={26} numberOfLines={1}>
                {day}
              </Text>
            ) : null}
          </View>
          {trip !== null && (trip.originLabel !== null || trip.destinationLabel !== null) ? (
            <View style={styles.routeRow} accessible accessibilityLabel={copy.routeA11y(trip.originLabel ?? "", trip.destinationLabel ?? "")}>
              <Text variant="rowTitle" color="strong" size={19.5} lineHeight={24} numberOfLines={1} style={styles.origin}>
                {trip.originLabel ?? ""}
              </Text>
              <Icon name="arrowRight" size={22} color={colors.primary} style={styles.arrow} />
              <Text variant="body" color="body" size={19.5} lineHeight={24} numberOfLines={1} style={styles.destination}>
                {trip.destinationLabel ?? ""}
              </Text>
            </View>
          ) : null}
          {timeLine !== "" ? (
            <Text variant="body" color="body" size={18.5} lineHeight={22} numberOfLines={1}>
              {timeLine}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.rows}>
        <InfoRow
          first
          testID={`${testID}.booking`}
          icon="car"
          title={bookingTitle}
          onPress={onOpenBooking}
          accessibilityLabel={copy.reservationA11y(bookingTitle)}
        />
        <InfoRow
          testID={`${testID}.pickup`}
          icon="people"
          title={copy.pickupPoint}
          subtitle={pickupLabel ?? copy.pickupUnknown}
          disabled={detail.pickupPoint === null}
          onPress={onOpenPickup}
          accessibilityLabel={pickupLabel !== null ? copy.pickupA11y(pickupLabel) : `${copy.pickupPoint}. ${copy.pickupUnknown}`}
        />
        <InfoRow
          testID={`${testID}.contribution`}
          icon="coins"
          title={contributionTitle}
          subtitle={contributionSubtitle}
          onPress={onOpenContribution}
          accessibilityLabel={copy.contributionA11y(parts === null ? copy.pending : parts.text)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 13.5, borderRadius: 20, overflow: "hidden", backgroundColor: colors.bg.tint },
  top: { flexDirection: "row", alignItems: "flex-start", paddingTop: 10, paddingBottom: 8, paddingLeft: 6.5, paddingRight: 12.5 },
  info: { flex: 1, marginLeft: 18, marginTop: 3.5 },
  nameRow: { flexDirection: "row", alignItems: "center" },
  name: { flexShrink: 1 },
  role: { marginLeft: 8, flexShrink: 0 },
  spacer: { flex: 1 },
  routeRow: { flexDirection: "row", alignItems: "center", marginTop: 2.5 },
  routeLine: { marginTop: 2.5 },
  origin: { flexShrink: 1 },
  arrow: { marginHorizontal: 10 },
  destination: { flexShrink: 1 },
  groupTile: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.bg.white, alignItems: "center", justifyContent: "center" },
  rows: { backgroundColor: colors.success.bg },
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", paddingVertical: 7, paddingLeft: 25.5, paddingRight: 18 },
  rowDivider: { borderTopWidth: 1.5, borderTopColor: hexAlpha(colors.bg.white, 0.7) },
  rowPressed: { backgroundColor: colors.tile.green },
  rowIcon: { width: 27, alignItems: "center" },
  rowText: { flex: 1, marginLeft: 25.5, marginRight: 8 },
});
