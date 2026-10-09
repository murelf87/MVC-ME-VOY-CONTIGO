import React from "react";
import { StyleSheet, View } from "react-native";
import type { RideRequestStatus } from "@/api/types";
import { Icon } from "@/icons";
import { formatDateShort, formatDateTime, formatRating, formatTime, formatWeekdays, strings } from "@/i18n";
import { useOpenPassengerChat } from "../../ops/hooks/useOpenPassengerChat";
import { useAppNavigation, useAppRoute } from "@/navigation";
import { colors, radii } from "@/theme";
import { Avatar, Banner, Button, ConfirmDialog, EmptyState, OfflineBanner, Screen, Skeleton, StatusPill, Text, showToast } from "@/ui";
import { DriverHeader } from "../components/DriverHeader";
import { LoadFailure } from "../components/LoadFailure";
import { DRIVER_SIDE, DRIVER_TOP_GAP } from "../components/metrics";
import { useDecideRequest } from "../hooks/useDriverRequests";
import { useRideRequestDetail, useWeeklyDetail } from "../hooks/useRequestDetail";
import { useNow } from "../hooks/useNow";
import { describePublishError } from "../logic/errors";
import { pillFor, secondsUntil } from "../logic/requests";
import { publishStrings } from "../strings";

const copy = publishStrings.requestDetail;
const list = publishStrings.requests;
const TONE = { amber: "amber", blue: "blue", green: "green", gray: "gray", red: "red" } as const;

const mapStatus = (status: string): RideRequestStatus => {
  switch (status) {
    case "partially_confirmed":
      return "confirmed";
    default:
      return status as RideRequestStatus;
  }
};

/**
 * «Detalle de la solicitud»: quién pide plaza, en qué tramo, el mensaje, la retención de plaza y las acciones del conductor
 * (aceptar o rechazar, también la reserva semanal entera). Hablar con el pasajero solo se abre cuando la reserva está
 * confirmada. Aceptar NO confirma la reserva: queda confirmada cuando el pasajero paga.
 */
export function DriverRequestDetailScreen(): React.JSX.Element {
  const navigation = useAppNavigation();
  const { params } = useAppRoute("DriverRequestDetail");
  const weeklyId = params?.weeklyReservationId;
  const requestId = weeklyId === undefined ? params?.requestId : undefined;
  const single = useRideRequestDetail(requestId);
  const weekly = useWeeklyDetail(weeklyId);
  const query = weeklyId !== undefined ? weekly : single;
  const decide = useDecideRequest();
  const now = useNow(1000, true);
  const [confirm, setConfirm] = React.useState<"accept" | "reject" | null>(null);
  const tripForChat = single.data?.trip.id ?? weekly.data?.occurrences.find((o) => o.tripId !== null)?.tripId ?? "";
  const chat = useOpenPassengerChat(tripForChat);

  const header = <DriverHeader title={copy.title} testID="DriverRequestDetail.header" />;
  const frame = { paddingTop: DRIVER_TOP_GAP } as const;

  if (requestId === undefined && weeklyId === undefined) return missing(navigation, header, frame);

  if (query.data === undefined) {
    if (query.isLoading) {
      return (
        <Screen header={header} paddingX={DRIVER_SIDE} contentContainerStyle={frame} testID="DriverRequestDetail">
          <View testID="DriverRequestDetail.loading" accessibilityLabel={copy.loading} accessibilityLiveRegion="polite">
            <Skeleton height={96} radius={radii.lg} />
            <Skeleton height={220} radius={radii.lg} style={styles.gap} />
          </View>
        </Screen>
      );
    }
    const code = describePublishError(query.error).code;
    if (code === "REQUEST_NOT_FOUND" || code === "WEEKLY_RESERVATION_NOT_FOUND" || code === "NOT_FOUND") return missing(navigation, header, frame);
    return (
      <Screen header={header} paddingX={DRIVER_SIDE} contentContainerStyle={frame} testID="DriverRequestDetail">
        <LoadFailure error={query.error} onRetry={() => void query.refetch()} testID="DriverRequestDetail.error" />
      </Screen>
    );
  }

  const isWeekly = weeklyId !== undefined && weekly.data !== undefined;
  const passenger = isWeekly ? weekly.data?.passenger : single.data?.passenger;
  const statusRaw = isWeekly ? weekly.data?.status : single.data?.status;
  if (passenger === undefined || statusRaw === undefined) return missing(navigation, header, frame);
  const status = mapStatus(statusRaw === "payment_pending" ? "payment_pending" : statusRaw);
  const pill = pillFor(status);
  const hold = (isWeekly ? weekly.data?.hold : single.data?.hold) ?? null;
  const holdSeconds = hold !== null && hold.active ? Math.max(0, secondsUntil(hold.expiresAt, now) ?? 0) : null;
  const requestedAt = isWeekly ? weekly.data?.createdAt : single.data?.requestedAt;
  const name = passenger.firstName;
  const decidable = status === "pending";
  const canTalk = status === "confirmed" && tripForChat !== "";
  const busy = decide.isPending;
  const offline = query.failedToRefresh || query.isOffline;

  const run = async (decision: "accept" | "reject"): Promise<void> => {
    const id = isWeekly ? (weeklyId as string) : (requestId as string);
    try {
      const result = await decide.mutateAsync({ id, kind: isWeekly ? "weekly" : "single", decision });
      setConfirm(null);
      if (decision === "reject") {
        showToast({ message: isWeekly ? list.rejectedWeeklyToast(name) : list.rejectedToast(name), kind: "success" });
      } else {
        const seconds = result.hold !== null ? secondsUntil(result.hold.expiresAt, Date.now()) : null;
        showToast({
          message: isWeekly ? list.acceptedWeeklyToast(name) : seconds !== null && seconds > 0 ? list.acceptedToastClock(name, list.holdCountdown(seconds)) : list.acceptedToast(name),
          kind: "success",
          durationMs: 6000,
        });
      }
      void query.refetch();
    } catch (raised) {
      setConfirm(null);
      const view = describePublishError(raised);
      showToast({ kind: "error", title: view.offline ? publishStrings.common.offlineTitle : view.title, message: view.offline ? publishStrings.common.offlineAction : view.message, durationMs: 7000 });
      void query.refetch();
    }
  };

  const onTalk = async (): Promise<void> => {
    const failure = await chat.open(passenger.id);
    if (failure !== null) showToast({ kind: "error", message: failure.message === "" ? copy.talkError : failure.message });
  };

  return (
    <>
      <Screen
        header={header}
        paddingX={DRIVER_SIDE}
        contentContainerStyle={frame}
        testID="DriverRequestDetail"
        footer={
          decidable ? (
            <View style={styles.footer}>
              <Button
                label={isWeekly ? list.rejectAll : list.reject}
                variant="outline"
                chevron={false}
                disabled={busy}
                onPress={() => setConfirm("reject")}
                accessibilityLabel={isWeekly ? list.rejectAllA11y(name) : list.rejectA11y(name)}
                testID="DriverRequestDetail.reject"
                style={styles.footerButton}
              />
              <View style={styles.footerGap} />
              <Button
                label={busy ? list.accepting : isWeekly ? list.acceptAll : list.accept}
                chevron={false}
                loading={busy}
                onPress={() => (isWeekly ? setConfirm("accept") : void run("accept"))}
                accessibilityLabel={isWeekly ? list.acceptAllA11y(name) : list.acceptA11y(name)}
                testID="DriverRequestDetail.accept"
                style={styles.footerButton}
              />
            </View>
          ) : undefined
        }
      >
        {offline ? <OfflineBanner testID="DriverRequestDetail.offline" style={styles.gapBottom} /> : null}

        <View style={styles.card} testID="DriverRequestDetail.passenger">
          <Avatar source={passenger.photoUrl} name={passenger.displayName} size="lg" />
          <View style={styles.passengerText}>
            <Text variant="title" color="deep" size={22} lineHeight={27} numberOfLines={1}>
              {passenger.displayName}
            </Text>
            <View style={styles.ratingRow}>
              <Icon name="star" size={18} color={colors.warning.solid} />
              <Text variant="body" color="heading" size={15.5} style={styles.ratingText}>
                {passenger.ratingAverage === null ? list.ratingNew : copy.ratingLine(formatRating(passenger.ratingAverage), passenger.ratingCount)}
              </Text>
            </View>
            {requestedAt !== undefined ? (
              <Text variant="caption" color="muted" size={14}>{copy.since(formatDateShort(requestedAt))}</Text>
            ) : null}
          </View>
          <StatusPill label={pill.label} tone={TONE[pill.tone]} size="sm" testID="DriverRequestDetail.status" />
        </View>

        {holdSeconds !== null ? (
          <Banner
            kind="info"
            icon="clock"
            size="sm"
            title={list.holdTitle}
            message={holdSeconds > 0 ? list.holdMessage(name, list.holdCountdown(holdSeconds)) : list.holdExpired}
            style={styles.gapTop}
            testID="DriverRequestDetail.hold"
          />
        ) : status === "payment_pending" || status === "accepted" ? (
          <Banner kind="info" icon="clock" size="sm" message={list.holdMessageNoClock(name)} style={styles.gapTop} testID="DriverRequestDetail.holdNoClock" />
        ) : null}

        <View style={[styles.card, styles.column, styles.gapTop]} testID="DriverRequestDetail.trip">
          {isWeekly && weekly.data !== undefined ? (
            <>
              <Row label={copy.weekly} value={`${formatWeekdays(weekly.data.weekdays)} · ${weekly.data.occurrences.length} viajes`} />
              <Row label={copy.category} value={strings.categories[weekly.data.category]} />
              <Row label={copy.day} value={list.weeklyStart(formatDateShort(weekly.data.startDate))} />
              {weekly.data.legs.map((leg) => (
                <Row key={leg.leg} label={leg.label} value={`${leg.fromLabel ?? ""} ${formatTime(leg.boardsAtLocal)} → ${leg.toLabel ?? ""} ${formatTime(leg.arrivesAtLocal)}`} />
              ))}
            </>
          ) : single.data !== undefined ? (
            <>
              <Row label={copy.day} value={formatDateTime(single.data.trip.departureAt)} />
              <Row label={copy.category} value={strings.categories[single.data.trip.category]} />
              <Row label={copy.boardAt} value={`${single.data.pickup?.label ?? list.stopFallback(1)}${single.data.pickup !== null ? ` · ${formatTime(single.data.pickup.atLocal)}` : ""}`} />
              <Row label={copy.leaveAt} value={`${single.data.dropoff?.label ?? list.stopFallback(2)}${single.data.dropoff !== null ? ` · ${formatTime(single.data.dropoff.atLocal)}` : ""}`} />
              {single.data.pickup?.detourMinutes != null ? (
                <Row label={copy.detour} value={single.data.pickup.detourMinutes > 0 ? list.detourValue(single.data.pickup.detourMinutes) : list.detourNone} />
              ) : null}
            </>
          ) : null}
        </View>

        {!isWeekly && single.data !== undefined ? (
          <View style={[styles.card, styles.column, styles.gapTop]} testID="DriverRequestDetail.message">
            <Text variant="rowTitle" color="deep" size={17} lineHeight={22}>{copy.message}</Text>
            <Text variant="body" color="heading" size={16.5} lineHeight={22} style={styles.messageText}>
              {single.data.message !== null && single.data.message.trim() !== "" ? single.data.message.trim() : copy.messageNone}
            </Text>
          </View>
        ) : null}

        {decidable ? <Text variant="caption" color="muted" size={14} lineHeight={18} style={styles.note}>{list.holdNotPaid}</Text> : null}

        <View style={styles.gapTop}>
          {canTalk ? (
            <Button
              label={copy.talkOpen(name)}
              variant="outline"
              chevron={false}
              leadingIcon="chat"
              loading={chat.isPending}
              onPress={() => void onTalk()}
              testID="DriverRequestDetail.talk"
            />
          ) : (
            <Text variant="caption" color="muted" size={14} lineHeight={18} testID="DriverRequestDetail.talkLocked">
              {copy.talkLocked(name)}
            </Text>
          )}
        </View>
      </Screen>

      <ConfirmDialog
        visible={confirm === "reject"}
        title={list.confirmRejectTitle(name)}
        message={isWeekly ? list.confirmRejectWeeklyMessage(name) : list.confirmRejectMessage(name)}
        confirmLabel={list.confirmRejectAction}
        cancelLabel={publishStrings.common.cancel}
        destructive
        onConfirm={() => void run("reject")}
        onCancel={() => setConfirm(null)}
        testID="DriverRequestDetail.rejectDialog"
      />
      <ConfirmDialog
        visible={confirm === "accept"}
        title={list.confirmAcceptWeeklyTitle(name)}
        message={list.confirmAcceptWeeklyMessage(weekly.data?.occurrences.length ?? 0)}
        confirmLabel={list.confirmAcceptWeeklyAction}
        cancelLabel={publishStrings.common.cancel}
        onConfirm={() => void run("accept")}
        onCancel={() => setConfirm(null)}
        testID="DriverRequestDetail.acceptDialog"
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="caption" color="muted" size={14.5} lineHeight={19} style={styles.rowLabel}>{label}</Text>
      <Text variant="rowTitle" color="strong" size={16.5} lineHeight={21} style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function missing(navigation: ReturnType<typeof useAppNavigation>, header: React.ReactNode, frame: { paddingTop: number }): React.JSX.Element {
  return (
    <Screen header={header} paddingX={DRIVER_SIDE} contentContainerStyle={frame} testID="DriverRequestDetail">
      <EmptyState
        testID="DriverRequestDetail.missing"
        icon="document"
        title={copy.notFoundTitle}
        message={copy.notFoundMessage}
        actionLabel={copy.notFoundAction}
        onAction={() => navigation.navigate("DriverRequests")}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 10 },
  gapBottom: { marginBottom: 10 },
  gapTop: { marginTop: 10 },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: colors.bg.tint, borderRadius: radii.lg, padding: 12 },
  column: { flexDirection: "column", alignItems: "stretch" },
  passengerText: { flex: 1, marginHorizontal: 12 },
  ratingRow: { flexDirection: "row", alignItems: "center", marginVertical: 2 },
  ratingText: { marginLeft: 4 },
  row: { flexDirection: "row", paddingVertical: 6 },
  rowLabel: { width: 104 },
  rowValue: { flex: 1 },
  messageText: { marginTop: 6 },
  note: { marginTop: 10, paddingHorizontal: 4 },
  footer: { flexDirection: "row" },
  footerButton: { flex: 1 },
  footerGap: { width: 10 },
});
