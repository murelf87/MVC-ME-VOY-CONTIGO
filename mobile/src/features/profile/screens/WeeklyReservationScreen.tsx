/**
 * Reserva semanal. Estado agregado de la semana, cuenta atrás de las plazas retenidas, conductor, días y trayectos, una
 * fila por viaje con su propio estado (toca para abrir ese día), importe semanal y las acciones reales: confirmar y pagar
 * (la primera solicitud con el pago pendiente), retirar las solicitudes que aún esperan respuesta, o buscar otro viaje.
 *
 * Datos: `GET /v1/weekly-reservations/:id`. Estados: cargando · error · sin conexión (copia guardada). Nunca se promete
 * un reembolso; los importes salen del servidor («Por definir» sin tarifa aprobada).
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import { formatCountdown, formatDayShort, formatMoney } from "@/i18n";
import { useIsOnline } from "@/hooks";
import { Icon } from "@/icons";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { Avatar, Banner, Button, ConfirmDialog, Divider, KeyValueRow, RatingBadge, Screen, ScreenHeader, StatusPill, Text, showToast } from "@/ui";
import { ListSkeleton, LoadFailure, OfflineNotice } from "../components/ScreenStates";
import { SectionTitle } from "../components/SectionTitle";
import { useNow } from "../hooks/useNow";
import { useWeeklyReservation, useWithdrawWeekly } from "../hooks/useWeeklyReservation";
import { buildOccurrenceRows, canWithdrawWeekly, holdRemainingSeconds, weeklyBanner, weeklyPayRequestId } from "../model/booking";
import { profileStrings } from "../strings";

const copy = profileStrings.weekly;
const DAY_LABEL: Record<string, string> = { mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb", sun: "Dom" };

export function WeeklyReservationScreen({ navigation, route }: AppScreenProps<"WeeklyReservation">): React.JSX.Element {
  const { reservationId } = route.params;
  const online = useIsOnline();
  const now = useNow(1000);
  const query = useWeeklyReservation(reservationId);
  const withdraw = useWithdrawWeekly();
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const header = <ScreenHeader title={copy.title} testID="WeeklyReservation.header" />;
  const data = query.data;

  if (data === undefined) {
    return (
      <Screen testID="WeeklyReservation" header={header}>
        {query.isError || query.isOffline ? (
          <LoadFailure testID="WeeklyReservation.error" title={copy.loadErrorTitle} error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <ListSkeleton testID="WeeklyReservation.loading" count={4} />
        )}
      </Screen>
    );
  }

  const banner = weeklyBanner(data.status);
  const rows = buildOccurrenceRows(data.occurrences);
  const remaining = holdRemainingSeconds(data.hold, now);
  const payRequestId = weeklyPayRequestId(data, now);
  const canWithdraw = canWithdrawWeekly(data);
  const finished = data.status === "cancelled" || data.status === "rejected" || data.status === "expired";

  const doWithdraw = async (): Promise<void> => {
    try {
      await withdraw.mutateAsync(data.id);
      setConfirmWithdraw(false);
      showToast({ kind: "success", message: copy.withdraw.done, id: "weekly.withdraw" });
    } catch (error) {
      setConfirmWithdraw(false);
      showToast({ kind: "error", message: describeError(error).message, id: "weekly.withdraw" });
    }
  };

  return (
    <Screen testID="WeeklyReservation" header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      {query.isOffline || !online ? <OfflineNotice testID="WeeklyReservation.offline" detail={copy.stale} onRetry={() => void query.refetch()} style={styles.gap} /> : null}
      <Banner testID="WeeklyReservation.banner" kind={banner.kind} title={banner.title} message={banner.message} />

      {remaining !== null && remaining > 0 ? (
        <View style={styles.countdown} testID="WeeklyReservation.countdown" accessibilityLiveRegion="polite">
          <Text variant="titleSm" color="warning" size={22}>{formatCountdown(remaining)}</Text>
          <Text variant="body" color="body" size={16} style={styles.flex}>{copy.countdown(formatCountdown(remaining))}</Text>
        </View>
      ) : null}

      <SectionTitle title={copy.driverHeading} style={styles.section} />
      <View style={[styles.card, styles.row]} testID="WeeklyReservation.driver">
        <Avatar source={data.driver.photoUrl} name={data.driver.displayName} size="lg" />
        <View style={styles.flex}>
          <Text variant="titleSm" color="heading" size={19}>{data.driver.displayName}</Text>
          <RatingBadge average={data.driver.ratingAverage} count={data.driver.ratingCount} />
        </View>
      </View>

      <SectionTitle title={copy.daysHeading} style={styles.section} />
      <View style={styles.card} testID="WeeklyReservation.days">
        <Text variant="titleSm" color="heading" size={19}>{data.weekdays.map((day) => DAY_LABEL[day] ?? day).join(" · ")}</Text>
        <Text variant="body" color="muted" size={15.5}>
          {copy.startHeading}: {formatDayShort(data.startDate)} · {copy.weeks(data.weeks)}
        </Text>
        {data.exceptionDates.length > 0 ? (
          <Text variant="body" color="muted" size={15.5}>{copy.exceptions}: {data.exceptionDates.map((d) => formatDayShort(d)).join(", ")}</Text>
        ) : null}
      </View>

      <SectionTitle title={copy.legsHeading} style={styles.section} />
      <View style={styles.card} testID="WeeklyReservation.legs">
        {data.legs.map((leg, index) => (
          <View key={leg.leg} style={index > 0 ? styles.legGap : undefined}>
            <Text variant="titleSm" color="heading" size={17.5}>{leg.label}</Text>
            <Text variant="body" color="body" size={16}>{`${leg.fromLabel ?? ""} → ${leg.toLabel ?? ""}`}</Text>
            <Text variant="body" color="muted" size={15.5}>{copy.occurrenceTime(leg.boardsAtLocal, leg.arrivesAtLocal)}</Text>
          </View>
        ))}
      </View>

      <SectionTitle title={copy.occurrencesHeading} style={styles.section} />
      <View style={styles.list} testID="WeeklyReservation.occurrences">
        {rows.map((row) => {
          const body = (
            <>
              <View style={styles.flex}>
                <Text variant="titleSm" color="heading" size={17}>{`${row.dateLabel} · ${row.legLabel}`}</Text>
                {row.timeLabel !== "" ? <Text variant="body" color="muted" size={15.5}>{row.timeLabel}</Text> : null}
              </View>
              <StatusPill label={row.statusLabel} tone={row.tone} />
              {row.requestId !== null ? <Icon name="chevronRight" size={20} color={colors.primary} /> : null}
            </>
          );
          return row.requestId !== null ? (
            <Pressable
              key={row.key}
              testID={`WeeklyReservation.occurrence.${row.key}`}
              accessibilityRole="button"
              accessibilityLabel={`${row.dateLabel}, ${row.legLabel}, ${row.statusLabel}. ${copy.openOccurrence}`}
              onPress={() => navigation.navigate("BookingDetail", { requestId: row.requestId as string })}
              style={({ pressed }) => [styles.occurrence, pressed ? styles.pressed : null]}
            >
              {body}
            </Pressable>
          ) : (
            <View key={row.key} style={styles.occurrence} testID={`WeeklyReservation.occurrence.${row.key}`} accessible accessibilityLabel={`${row.dateLabel}, ${row.legLabel}, ${row.statusLabel}`}>
              {body}
            </View>
          );
        })}
      </View>

      <SectionTitle title={copy.quoteHeading} style={styles.section} />
      <View style={styles.card} testID="WeeklyReservation.quote">
        {data.quote.weekly !== null ? (
          <>
            <KeyValueRow label={copy.tripsPerWeek(data.quote.weekly.tripsPerWeek)} value="" />
            <KeyValueRow label={copy.contributionPerWeek} value={formatMoney(data.quote.weekly.contributionPerWeek)} />
            <Divider />
            <KeyValueRow label={copy.totalPerWeek} value={formatMoney(data.quote.weekly.totalPerWeek)} emphasis />
          </>
        ) : (
          <KeyValueRow label={copy.totalPerWeek} value={formatMoney(data.quote.total)} emphasis />
        )}
        <Text variant="body" color="muted" size={14.5} style={styles.note}>{profileStrings.booking.quoteNote}</Text>
      </View>

      <View style={styles.actions}>
        {payRequestId !== null ? <Button testID="WeeklyReservation.action.pay" label={copy.actionPay} onPress={() => navigation.navigate("RequestStatusPayment", { requestId: payRequestId, reservationId: data.id })} /> : null}
        {canWithdraw ? <Button testID="WeeklyReservation.action.withdraw" label={copy.actionWithdraw} variant="outline" chevron={false} onPress={() => setConfirmWithdraw(true)} /> : null}
        {finished ? <Button testID="WeeklyReservation.action.searchAgain" label={copy.actionSearchAgain} onPress={() => navigation.navigate("MapHome")} /> : null}
      </View>

      <ConfirmDialog
        testID="WeeklyReservation.withdrawDialog"
        visible={confirmWithdraw}
        loading={withdraw.isPending}
        title={copy.withdraw.title}
        message={copy.withdraw.message}
        confirmLabel={copy.withdraw.confirm}
        cancelLabel={profileStrings.common.cancel}
        onConfirm={() => void doWithdraw()}
        onCancel={() => (withdraw.isPending ? undefined : setConfirmWithdraw(false))}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { marginBottom: 12 },
  section: { marginTop: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  legGap: { marginTop: 12 },
  card: { marginTop: 8, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 4 },
  countdown: { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, backgroundColor: colors.amber.bg },
  list: { marginTop: 8, gap: 8 },
  occurrence: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, minHeight: 56, borderRadius: 12, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", justifyContent: "flex-start" },
  pressed: { opacity: 0.7 },
  note: { marginTop: 6 },
  actions: { marginTop: 24, gap: 12, paddingBottom: 12 },
});
