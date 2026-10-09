/**
 * 15a/15b · Revisa tu solicitud. Última comprobación antes de pedir plaza: trayecto, conductor, tu plaza, punto de
 * recogida, destino y el detalle de la aportación. Pedir plaza NO es reservar: el conductor debe aceptar y no se cobra
 * nada todavía (aviso naranja). Un trayecto (15a) o una reserva semanal con una solicitud por día (15b).
 *
 * Datos: `GET /v1/trips/:id` (cabecera, conductor), `POST /v1/trips/:id/quote` (punto, destino, distancia, aportación) y,
 * en la reserva semanal, `POST /v1/trips/:id/weekly-requests/preview` (días con plaza y desglose semanal). Enviar:
 * `POST /v1/trips/:id/requests` o `…/weekly-requests` con `Idempotency-Key` estable.
 *
 * Parámetros de ruta: `tripId`, `pickupPointId` (id opaco de la pantalla 13), `dropoffStopSeq?`, `weekly?` (días, inicio,
 * semanas, trayectos, excepciones, consentimiento a plazas parciales), `pickup?` (resumen del punto elegido) y `criteria?`.
 */
import { CommonActions, StackActions } from "@react-navigation/native";
import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import { Icon } from "@/icons";
import { requireAccount, type AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Banner, Button, OfflineBanner, Screen, ScreenHeader, Text, showToast } from "@/ui";
import { ContributionCard } from "../components/ContributionCard";
import { DetailListSheet, type DetailItem } from "../components/DetailListSheet";
import { DriverCard } from "../components/DriverCard";
import { DriverSheet } from "../components/DriverSheet";
import { DropoffSheet } from "../components/DropoffSheet";
import { InfoRow } from "../components/InfoRow";
import { InfoSheet } from "../components/InfoSheet";
import { ProblemCard } from "../components/ProblemCard";
import { ReviewSkeleton } from "../components/ReviewSkeleton";
import { RouteBar } from "../components/RouteBar";
import { useSendRequest, type SendVars } from "../hooks/useSendRequest";
import { useTripDetail } from "../hooks/useTripDetail";
import { useTripQuote } from "../hooks/useTripQuote";
import { useWeeklyPreview } from "../hooks/useWeeklyPreview";
import { describeRequestError, hasErrorCode } from "../logic/errors";
import {
  buildReviewModel,
  currentDropoffSeq,
  dropoffOptions,
  singleRequestBody,
  weeklyRequestBody,
} from "../logic/reviewModel";
import { listDates, occurrenceRows, summarizePreview } from "../logic/weekly";
import { requestStrings } from "../strings";

const copy = requestStrings.review;
const common = requestStrings.common;

/** Margen lateral de la lámina 15 (las tarjetas llegan a 14 pt del borde). */
const SCREEN_X = 14;

type Sheet = "driver" | "seat" | "dropoff" | "fee" | null;

export function ReviewRequestScreen({ navigation, route }: AppScreenProps<"ReviewRequest">): React.JSX.Element {
  const { tripId, pickupPointId, weekly, pickup, criteria } = route.params;
  const dropoffStopSeq = route.params.dropoffStopSeq ?? null;
  const isWeekly = weekly !== undefined;

  const trip = useTripDetail(tripId);
  const quote = useTripQuote(tripId, pickupPointId, dropoffStopSeq);
  const previewBody = useMemo(
    () => (weekly === undefined ? null : weeklyRequestBody({ weekly, pickupPointId, dropoffStopSeq, message: "" })),
    [weekly, pickupPointId, dropoffStopSeq],
  );
  const preview = useWeeklyPreview(tripId, previewBody, isWeekly);
  const send = useSendRequest();

  const [message, setMessage] = useState("");
  const [sheet, setSheet] = useState<Sheet>(null);
  const closeSheet = useCallback(() => setSheet(null), []);

  const queries = isWeekly ? [trip, quote, preview] : [trip, quote];
  const loading = queries.some((q) => q.isLoading);
  const failed = queries.find((q) => q.isError || (q.isOffline && q.data === undefined));
  const refreshing = queries.some((q) => q.isRefreshing);
  const stale = queries.some((q) => q.failedToRefresh) || (queries.some((q) => q.isOffline) && !failed);

  const refetchAll = useCallback(() => {
    for (const q of queries) void q.refetch();
  }, [queries]);

  const model = useMemo(() => {
    if (trip.data === undefined || (quote.data === undefined && preview.data === undefined)) return null;
    return buildReviewModel({
      trip: trip.data,
      quote: quote.data ?? null,
      preview: preview.data ?? null,
      weekly: weekly ?? null,
      pickup: pickup ?? null,
      dropoffStopSeq,
      criteria: criteria ?? null,
    });
  }, [trip.data, quote.data, preview.data, weekly, pickup, dropoffStopSeq, criteria]);

  const openRequestId = trip.data?.viewer.openRequest?.id ?? null;

  const goToStatus = useCallback(
    (params: { requestId: string; reservationId?: string }) => {
      navigation.dispatch(
        CommonActions.reset({ index: 1, routes: [{ name: "MapHome" }, { name: "RequestStatusPayment", params }] }),
      );
    },
    [navigation],
  );

  const openExistingRequest = useCallback(() => {
    if (openRequestId !== null) goToStatus({ requestId: openRequestId });
    else navigation.navigate("MyTrips", {});
  }, [openRequestId, goToStatus, navigation]);

  const onSend = useCallback(async () => {
    if (model === null || model.block !== null || send.isPending) return;
    if (!requireAccount({ name: "ReviewRequest", params: route.params })) return;
    const vars: SendVars =
      weekly !== undefined
        ? { kind: "weekly", tripId, body: weeklyRequestBody({ weekly, pickupPointId, dropoffStopSeq, message }) }
        : { kind: "single", tripId, body: singleRequestBody({ pickupPointId, dropoffStopSeq, message }) };
    const sent = await send.mutate(vars);
    if (sent === undefined) return;
    if (sent.kind === "single") {
      showToast({ kind: "success", message: copy.sentToast, id: "request.sent" });
      goToStatus({ requestId: sent.request.id });
      return;
    }
    const created = sent.reservation.occurrences.filter((o) => o.requestId !== null);
    const skipped = sent.reservation.occurrences.length - created.length;
    showToast({
      kind: "success",
      message: skipped > 0 ? copy.partialSentToast(created.length, skipped) : copy.weeklySentToast(created.length),
      id: "request.sent",
    });
    const first = created[0]?.requestId ?? null;
    if (first === null) navigation.navigate("MyTrips", {});
    else goToStatus({ requestId: first, reservationId: sent.reservation.id });
  }, [model, send, route.params, weekly, tripId, pickupPointId, dropoffStopSeq, message, goToStatus, navigation]);

  const changePickup = useCallback(() => {
    navigation.dispatch(
      StackActions.popTo("PickupPoint", {
        tripId,
        ...(criteria !== undefined ? { criteria } : {}),
        ...(dropoffStopSeq !== null ? { dropoffStopSeq } : {}),
      }),
    );
  }, [navigation, tripId, criteria, dropoffStopSeq]);

  const seeTrip = useCallback(() => {
    setSheet(null);
    navigation.navigate("TripDetail", { tripId, ...(criteria !== undefined ? { criteria } : {}) });
  }, [navigation, tripId, criteria]);

  const changeDays = useCallback(() => {
    setSheet(null);
    navigation.goBack();
  }, [navigation]);

  // ── Errores de envío ───────────────────────────────────────────────────────────────────────────────────────────
  const sendProblem = (() => {
    if (send.error === null || send.isPending) return null;
    if (hasErrorCode(send.error, "DUPLICATE_OPEN_REQUEST")) {
      return (
        <Banner
          kind="warning"
          size="sm"
          title={copy.duplicateTitle}
          message={copy.duplicateMessage}
          actionLabel={copy.openRequestAction}
          onAction={openExistingRequest}
          testID="ReviewRequest.sendError"
        />
      );
    }
    if (send.isOffline) {
      return (
        <OfflineBanner
          title={common.offlineTitle}
          detail={copy.sendOffline}
          retryLabel={common.retry}
          onRetry={() => void send.retry()}
          testID="ReviewRequest.sendOffline"
        />
      );
    }
    const description = describeRequestError(send.error);
    return (
      <Banner
        kind="error"
        size="sm"
        title={description.title}
        message={description.message}
        actionLabel={description.retryable ? common.retry : undefined}
        onAction={description.retryable ? () => void send.retry() : undefined}
        testID="ReviewRequest.sendError"
      />
    );
  })();

  // ── Hojas ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const seatItems: DetailItem[] = useMemo(() => {
    if (model === null) return [];
    if (preview.data !== undefined && isWeekly) {
      return occurrenceRows(preview.data.occurrences).map((row) => ({
        key: row.key,
        title: `${row.dateLabel} · ${row.legLabel}`,
        detail: row.time !== null ? requestStrings.weekly.legSheetBoards(row.time) : null,
        state: row.stateLabel,
        tone: row.tone,
      }));
    }
    return [{ key: "single", title: model.seat.lines[0] ?? copy.seat, detail: model.seat.lines[1] ?? null }];
  }, [model, preview.data, isWeekly]);

  const partial = preview.data !== undefined ? summarizePreview(preview.data) : null;
  const partialCount = partial?.fullDates.length ?? 0;

  const options = useMemo(() => (trip.data === undefined ? [] : dropoffOptions(trip.data, quote.data ?? null)), [trip.data, quote.data]);
  const selectedSeq = trip.data === undefined ? 0 : currentDropoffSeq(trip.data, dropoffStopSeq);

  const driver = model?.driver;

  return (
    <Screen
      testID="ReviewRequest"
      paddingX={SCREEN_X}
      header={<ScreenHeader title={copy.title} testID="ReviewRequest.header" />}
      refreshing={refreshing}
      onRefresh={refetchAll}
      footer={
        <Button
          label={copy.send}
          accessibilityLabel={send.isPending ? copy.sending : copy.send}
          loading={send.isPending}
          disabled={model === null || model.block !== null}
          onPress={() => void onSend()}
          testID="ReviewRequest.send"
        />
      }
    >
      {stale && model !== null ? (
        <OfflineBanner
          title={common.offlineTitle}
          detail={requestStrings.common.staleDetail}
          retryLabel={common.retry}
          onRetry={refetchAll}
          testID="ReviewRequest.offline"
          style={styles.offline}
        />
      ) : null}

      {loading && model === null ? <ReviewSkeleton /> : null}

      {!loading && model === null ? (
        <ProblemCard
          error={failed?.error ?? new Error(describeError(null).message)}
          offline={failed?.isOffline === true}
          onRetry={refetchAll}
          exitLabel={common.seeOtherTrips}
          onExit={() => navigation.navigate("MapHome")}
          testID="ReviewRequest.problem"
        />
      ) : null}

      {model !== null && driver !== undefined ? (
        <>
          <RouteBar from={model.route.from} to={model.route.to} category={model.route.category} testID="ReviewRequest.routeBar" />

          <View testID="ReviewRequest.distance" accessible accessibilityLabel={`${copy.distance}: ${model.distance}`} style={styles.distance}>
            <Icon name="distance" size={30} color={colors.heading} />
            <Text variant="body" color="body" size={19} lineHeight={24} style={styles.distanceLabel}>
              {copy.distance}
            </Text>
            <Text variant="heading" color="heading" size={22} lineHeight={26} align="right">
              {model.distance}
            </Text>
          </View>

          <DriverCard driver={driver} hasMessage={message.trim() !== ""} onPress={() => setSheet("driver")} testID="ReviewRequest.driver" />

          <View style={styles.rows}>
            <InfoRow
              icon="calendarGrid"
              title={model.seat.title}
              lines={model.seat.lines}
              onPress={() => setSheet("seat")}
              accessibilityHint={copy.daysSheetOpen}
              testID="ReviewRequest.seat"
            />
            <InfoRow
              icon="pin"
              title={model.pickup.title}
              lines={model.pickup.lines}
              onPress={changePickup}
              accessibilityHint={requestStrings.a11y.pickupHint}
              testID="ReviewRequest.pickup"
            />
            <InfoRow
              icon="school"
              title={model.dropoff.title}
              lines={model.dropoff.lines}
              onPress={() => setSheet("dropoff")}
              accessibilityHint={requestStrings.a11y.dropoffHint}
              testID="ReviewRequest.dropoff"
            />
          </View>

          {isWeekly && partialCount > 0 ? (
            <Banner
              kind="notice"
              size="xs"
              title={requestStrings.weekly.partialTitle(partialCount)}
              message={requestStrings.weekly.partialMessage(listDates(partial?.fullDates ?? []))}
              style={styles.block}
              testID="ReviewRequest.partial"
            />
          ) : null}

          <ContributionCard view={model.quote} onFeeHelp={() => setSheet("fee")} testID="ReviewRequest.contribution" />

          {model.block !== null ? (
            <Banner
              kind="error"
              size="sm"
              title={copy.blockedTitle}
              message={model.block.message}
              actionLabel={model.block.kind === "openRequest" ? copy.openRequestAction : model.block.kind === "weekly" ? requestStrings.weekly.changeDays : undefined}
              onAction={model.block.kind === "openRequest" ? openExistingRequest : model.block.kind === "weekly" ? changeDays : undefined}
              style={styles.block}
              testID="ReviewRequest.blocked"
            />
          ) : null}

          {sendProblem !== null ? <View style={styles.block}>{sendProblem}</View> : null}

          <Banner kind="warning" size="md" style={styles.warning} testID="ReviewRequest.warning" accessibilityLabel={`${copy.warningTitle} ${copy.warningMessage}`}>
            <Text variant="body" color={colors.warning.text} size={19} lineHeight={24} letterSpacing={-0.3}>
              {copy.warningTitle}
            </Text>
            <Text variant="body" color={colors.warning.text} size={19} lineHeight={24} letterSpacing={-0.3}>
              {copy.warningMessage}
            </Text>
          </Banner>
        </>
      ) : null}

      {driver !== undefined && trip.data !== undefined ? (
        <DriverSheet
          visible={sheet === "driver"}
          name={driver.name}
          vehicle={trip.data.vehicle.displayName}
          plateHint={trip.data.vehicle.plateHint}
          message={message}
          onSave={(next) => {
            setMessage(next);
            setSheet(null);
          }}
          onSeeTrip={seeTrip}
          onClose={closeSheet}
          testID="ReviewRequest.driverSheet"
        />
      ) : null}
      <DetailListSheet
        visible={sheet === "seat"}
        title={isWeekly ? requestStrings.weekly.daysSheetTitle : copy.seat}
        hint={isWeekly ? requestStrings.weekly.daysSheetHint : copy.seatSheetSingleHint}
        items={seatItems}
        closeLabel={common.close}
        onClose={closeSheet}
        testID="ReviewRequest.seatSheet"
      />
      <DropoffSheet
        visible={sheet === "dropoff"}
        options={options}
        selectedSeq={selectedSeq}
        onSelect={(seq) => {
          setSheet(null);
          if (seq !== selectedSeq) navigation.setParams({ dropoffStopSeq: seq });
        }}
        onClose={closeSheet}
        testID="ReviewRequest.dropoffSheet"
      />
      <InfoSheet
        visible={sheet === "fee"}
        title={copy.feeHelpTitle}
        message={copy.feeHelpMessage}
        closeLabel={copy.feeHelpClose}
        onClose={closeSheet}
        testID="ReviewRequest.feeSheet"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  offline: { marginBottom: 8 },
  distance: { minHeight: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, marginTop: 6 },
  distanceLabel: { flex: 1, marginLeft: 10 },
  rows: { marginTop: 4, gap: 2 },
  block: { marginTop: 10 },
  warning: { marginTop: 14, minHeight: 64 },
});
