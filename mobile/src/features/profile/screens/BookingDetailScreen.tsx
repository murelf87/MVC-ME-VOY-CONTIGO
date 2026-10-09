/**
 * Detalle de la reserva (se abre desde Mis viajes, avisos y chat). Banner de estado, pasos «Solicitud → Aceptada → Pago →
 * Confirmada», cuenta atrás de la plaza retenida, viaje, conductor, recorrido, mensaje, importes y las acciones que de
 * verdad caben según el estado: retirar, pagar, escribir al conductor, seguir, compartir, cancelar o buscar otro viaje.
 *
 * Datos: `GET /v1/ride-requests/:id`. Si solo se conoce la reserva (`bookingId`), la solicitud se busca en «Mis viajes».
 * Estados: cargando · error · sin conexión (copia guardada) · no encontrada. Los importes se muestran tal cual los da el
 * servidor («Por definir» mientras no haya tarifa aprobada); nunca se promete un reembolso.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import { formatCountdown, formatDateLong, formatDistance, formatMoney, formatTime } from "@/i18n";
import { useIsOnline } from "@/hooks";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { Avatar, Banner, Button, ConfirmDialog, Divider, EmptyState, KeyValueRow, RatingBadge, RouteTimeline, Screen, ScreenHeader, StepProgress, Text, showToast, type RouteStop } from "@/ui";
import { ListSkeleton, LoadFailure, OfflineNotice } from "../components/ScreenStates";
import { SectionTitle } from "../components/SectionTitle";
import { useBookingLookup, useOpenChat, useRequestDetail, useWithdrawRequest } from "../hooks/useBookingDetail";
import { useNow } from "../hooks/useNow";
import { bookingActions, bookingBanner, holdRemainingSeconds, stepperOf, type BookingActionId } from "../model/booking";
import { profileStrings } from "../strings";

const copy = profileStrings.booking;
const SIDE = 16;

export function BookingDetailScreen({ navigation, route }: AppScreenProps<"BookingDetail">): React.JSX.Element {
  const { bookingId, requestId: requestParam } = route.params ?? {};
  const online = useIsOnline();
  const now = useNow(1000);
  const lookup = useBookingLookup(requestParam === undefined ? bookingId : undefined);
  const requestId = requestParam ?? lookup.requestId ?? undefined;
  const detail = useRequestDetail(requestId);
  const withdraw = useWithdrawRequest();
  const openChat = useOpenChat();
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const header = <ScreenHeader title={copy.title} testID="BookingDetail.header" />;
  const data = detail.data;

  if (data === undefined) {
    if (lookup.error !== null) {
      return (
        <Screen testID="BookingDetail" header={header}>
          <LoadFailure testID="BookingDetail.error" title={copy.loadErrorTitle} error={lookup.error} onRetry={lookup.retry} />
        </Screen>
      );
    }
    if (lookup.notFound) {
      return (
        <Screen testID="BookingDetail" header={header}>
          <EmptyState testID="BookingDetail.notFound" icon="alertCircle" title={copy.notFoundTitle} message={copy.notFoundMessage} actionLabel={profileStrings.common.close} onAction={() => navigation.goBack()} variant="plain" />
        </Screen>
      );
    }
    if (detail.isError || detail.isOffline) {
      return (
        <Screen testID="BookingDetail" header={header}>
          <LoadFailure testID="BookingDetail.error" title={copy.loadErrorTitle} error={detail.error} onRetry={() => void detail.refetch()} />
        </Screen>
      );
    }
    return (
      <Screen testID="BookingDetail" header={header}>
        <ListSkeleton testID="BookingDetail.loading" count={4} />
      </Screen>
    );
  }

  const banner = bookingBanner(data.status);
  const steps = stepperOf(data.stepper);
  const remaining = holdRemainingSeconds(data.hold, now);
  const actions = bookingActions(data, now);
  const driver = data.trip.driver;
  const departure = data.trip.departureAt;

  const stops: RouteStop[] = [];
  if (data.pickup !== null) {
    stops.push({
      title: data.pickup.label ?? data.trip.originLabel ?? copy.pickup,
      caption: data.pickup.walkMinutes !== null ? copy.walk(data.pickup.walkMinutes) : copy.pickup,
      time: formatTime(data.pickup.at),
      state: "current",
    });
  }
  if (data.dropoff !== null) {
    stops.push({
      title: data.dropoff.label ?? data.trip.destinationLabel ?? copy.dropoff,
      caption: data.dropoff.walkMinutes !== null ? copy.walk(data.dropoff.walkMinutes) : copy.dropoff,
      time: formatTime(data.dropoff.at),
      state: "destination",
    });
  }

  const chat = async (): Promise<void> => {
    try {
      const conversation = await openChat.mutateAsync({ tripId: data.trip.id, peerUserId: driver.id });
      navigation.navigate("BookingChat", { conversationId: conversation.id });
    } catch (error) {
      showToast({ kind: "error", message: describeError(error).message || copy.chatError, id: "booking.chat" });
    }
  };

  const doWithdraw = async (): Promise<void> => {
    try {
      await withdraw.mutateAsync(data.id);
      setConfirmWithdraw(false);
      showToast({ kind: "success", message: copy.withdraw.done, id: "booking.withdraw" });
    } catch (error) {
      setConfirmWithdraw(false);
      showToast({ kind: "error", message: describeError(error).message, id: "booking.withdraw" });
    }
  };

  const run = (action: BookingActionId): void => {
    switch (action) {
      case "pay":
        navigation.navigate("RequestStatusPayment", { requestId: data.id });
        return;
      case "withdraw":
        setConfirmWithdraw(true);
        return;
      case "chat":
        void chat();
        return;
      case "follow":
        if (data.booking !== null) navigation.navigate("WaitingForCar", { bookingId: data.booking.id });
        return;
      case "share":
        if (data.booking !== null) navigation.navigate("ShareTrip", { bookingId: data.booking.id });
        return;
      case "cancel":
        if (data.booking !== null) navigation.navigate("CancelBooking", { bookingId: data.booking.id });
        return;
      case "weekly":
        if (data.weekly !== null) navigation.navigate("WeeklyReservation", { reservationId: data.weekly.reservationId });
        return;
      case "searchAgain":
        navigation.navigate("MapHome");
        return;
    }
  };

  const labelOf: Record<BookingActionId, string> = {
    pay: copy.actionPay,
    withdraw: copy.actionWithdraw,
    chat: copy.actionChat,
    follow: copy.actionFollow,
    share: copy.actionShare,
    cancel: copy.actionCancel,
    weekly: copy.weeklyLink,
    searchAgain: copy.actionSearchAgain,
  };
  const primary = actions.find((a) => a === "pay" || a === "follow" || a === "searchAgain") ?? null;
  const secondary = actions.filter((a) => a !== primary && a !== "weekly");

  return (
    <Screen testID="BookingDetail" header={header} refreshing={detail.isRefreshing} onRefresh={() => void detail.refetch()}>
      {detail.isOffline || !online ? <OfflineNotice testID="BookingDetail.offline" detail={copy.stale} onRetry={() => void detail.refetch()} style={styles.gap} /> : null}
      <Banner testID="BookingDetail.banner" kind={banner.kind} title={banner.title} message={banner.message} />

      {steps !== null ? <StepProgress testID="BookingDetail.steps" steps={steps.labels} states={steps.states} style={styles.steps} /> : null}

      {remaining !== null && remaining > 0 ? (
        <View style={styles.countdown} testID="BookingDetail.countdown" accessibilityLiveRegion="polite">
          <Text variant="titleSm" color="warning" size={22}>{formatCountdown(remaining)}</Text>
          <Text variant="body" color="body" size={16} style={styles.flex}>{copy.countdown(formatCountdown(remaining))}</Text>
        </View>
      ) : null}

      <SectionTitle title={copy.tripHeading} style={styles.section} />
      <View style={styles.card} testID="BookingDetail.trip">
        <Text variant="titleSm" color="heading" size={19}>{formatDateLong(departure)} · {formatTime(departure)}</Text>
        <Text variant="body" color="body" size={16.5}>
          {(data.trip.originLabel ?? "") + (data.trip.originLabel !== null && data.trip.destinationLabel !== null ? " → " : "") + (data.trip.destinationLabel ?? "")}
        </Text>
        {data.roadDistanceM !== null ? <Text variant="body" color="muted" size={15.5}>{formatDistance(data.roadDistanceM)}</Text> : null}
      </View>

      <SectionTitle title={copy.driverHeading} style={styles.section} />
      <View style={[styles.card, styles.row]} testID="BookingDetail.driver">
        <Avatar source={driver.photoUrl} name={driver.displayName} size="lg" />
        <View style={styles.flex}>
          <Text variant="titleSm" color="heading" size={19}>{driver.displayName}</Text>
          <RatingBadge average={driver.ratingAverage} count={driver.ratingCount} />
          <Text variant="body" color="muted" size={15.5}>
            {data.trip.vehicle.displayName}
            {data.trip.vehicle.plateHint !== null ? `  ${copy.plateHint(data.trip.vehicle.plateHint)}` : ""}
          </Text>
        </View>
      </View>

      {stops.length > 0 ? (
        <>
          <SectionTitle title={copy.routeHeading} style={styles.section} />
          <View style={styles.card}>
            <RouteTimeline testID="BookingDetail.route" stops={stops} variant="compact" />
          </View>
        </>
      ) : null}

      {data.message !== null && data.message !== "" ? (
        <>
          <SectionTitle title={copy.messageHeading} style={styles.section} />
          <View style={styles.card} testID="BookingDetail.message">
            <Text variant="body" color="body" size={16.5}>{data.message}</Text>
          </View>
        </>
      ) : null}

      <SectionTitle title={copy.amountHeading} style={styles.section} />
      <View style={styles.card} testID="BookingDetail.amount">
        <KeyValueRow label={copy.contribution} value={formatMoney(data.quote.contribution)} />
        <KeyValueRow label={copy.management} value={formatMoney(data.quote.managementFee)} />
        <Divider />
        <KeyValueRow label={copy.total} value={formatMoney(data.booking !== null ? data.booking.amount : data.quote.total)} emphasis />
        <Text variant="body" color="muted" size={14.5} style={styles.note}>{copy.quoteNote}</Text>
      </View>

      <View style={styles.actions}>
        {primary !== null ? <Button testID={`BookingDetail.action.${primary}`} label={labelOf[primary]} onPress={() => run(primary)} /> : null}
        {secondary.map((action) => (
          <Button
            key={action}
            testID={`BookingDetail.action.${action}`}
            label={labelOf[action]}
            variant="outline"
            chevron={false}
            loading={action === "chat" && openChat.isPending}
            onPress={() => run(action)}
          />
        ))}
        {actions.includes("weekly") ? <Button testID="BookingDetail.action.weekly" label={labelOf.weekly} variant="outline" chevron={false} onPress={() => run("weekly")} /> : null}
      </View>

      <ConfirmDialog
        testID="BookingDetail.withdrawDialog"
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
  steps: { marginTop: 18 },
  section: { marginTop: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  card: {
    marginTop: 8,
    padding: SIDE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: "#FFFFFF",
    gap: 4,
  },
  countdown: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.amber.bg,
  },
  note: { marginTop: 6 },
  actions: { marginTop: 24, gap: 12, paddingBottom: 12 },
});
