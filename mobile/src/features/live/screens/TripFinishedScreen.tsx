/**
 * Lámina 24 «Viaje terminado» (pasajero): «Has llegado», mapa del trayecto, resumen (duración, distancia, pasajeros, coche),
 * pago pendiente (por definir), «Valora tu viaje (opcional)» y «Reportar incidencia». Todo sale de
 * `GET /v1/bookings/{id}/summary`; la valoración se envía a `POST /v1/trips/{id}/ratings` y la decide el servidor.
 *
 * Honestidad: sin pago confirmado por el servidor el cobro es «pendiente (por definir)» y el importe es una propuesta;
 * la distancia es la del recorrido planificado, no una traza GPS. Estados: cargando · error · no encontrado · llegó ·
 * no se presentó · cancelado · aún no terminado · ya valorado · plazo cerrado · valoración enviada · error al enviar.
 */
import React, { useMemo, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { describeError } from "@/api";
import type { LiveBookingSummary } from "@/api/types";
import { Icon, type IconName } from "@/icons";
import { formatDistance, formatDurationSeconds, formatMoney, formatTime } from "@/i18n";
import { fitBounds, MvcMap, type MapMarkerSpec, type MapRouteSpec } from "@/maps";
import type { AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Banner, Button, Card, MapCard, RatingStars, Screen, ScreenHeader, Skeleton, Text, TextArea } from "@/ui";
import { LoadError } from "../components/LoadError";
import { useBookingSummary } from "../hooks/useBookingSummary";
import { useCreateRating } from "../hooks/useCreateRating";
import { plateText } from "../model/vehicle";
import { liveStrings } from "../strings";

const T = liveStrings.finished;
const SIDE = 14;
const MAP_HEIGHT = 172;

function Hero({ summary }: { summary: LiveBookingSummary }): React.JSX.Element {
  const state = summary.arrived
    ? { ok: true, title: T.arrivedTitle, message: T.arrivedMessage }
    : summary.bookingStatus === "no_show"
      ? { ok: false, title: T.noShowTitle, message: T.noShowMessage }
      : summary.bookingStatus === "cancelled" || summary.bookingStatus === "driver_cancelled" || summary.tripStatus === "cancelled"
        ? { ok: false, title: T.cancelledTitle, message: T.cancelledMessage }
        : summary.tripStatus !== "completed"
          ? { ok: false, title: T.notFinishedTitle, message: T.notFinishedMessage }
          : { ok: false, title: T.endedTitle, message: T.endedMessage };
  return (
    <View style={styles.hero} testID="TripFinished.hero" accessible accessibilityRole="header" accessibilityLabel={`${state.title}. ${state.message}`}>
      <View style={[styles.heroDisc, { backgroundColor: state.ok ? colors.success.solid : colors.warning.solid }]}>
        <Icon name={state.ok ? "check" : "exclaim"} size={34} color={colors.onPrimary} />
      </View>
      <View style={styles.flex}>
        <Text variant="titleSm" color="heading" size={28} lineHeight={32}>{state.title}</Text>
        <Text variant="body" color="strong" size={16.5} lineHeight={21}>{state.message}</Text>
      </View>
    </View>
  );
}

function RouteMap({ summary, width }: { summary: LiveBookingSummary; width: number }): React.JSX.Element {
  const markers = useMemo<MapMarkerSpec[]>(() => {
    const eastIsPickup = summary.pickup.location.lng >= summary.dropoff.location.lng;
    return [
      { id: "pickup", kind: "origin", position: summary.pickup.location, chip: { title: summary.pickup.label ?? liveStrings.common.unknownStop(summary.pickup.seq), ...(summary.pickup.at ? { subtitle: formatTime(summary.pickup.at) } : {}), tone: "brand", side: eastIsPickup ? "left" : "right" } },
      { id: "dropoff", kind: "destination", position: summary.dropoff.location, chip: { title: summary.dropoff.label ?? liveStrings.common.unknownStop(summary.dropoff.seq), ...(summary.dropoff.at ? { subtitle: formatTime(summary.dropoff.at) } : {}), tone: "brand", side: eastIsPickup ? "right" : "left" } },
    ];
  }, [summary]);
  const routes = useMemo<MapRouteSpec[]>(() => (summary.path.length >= 2 ? [{ id: "path", kind: "route", points: summary.path }] : []), [summary.path]);
  const region = useMemo(
    () => fitBounds([...summary.path, summary.pickup.location, summary.dropoff.location], { padding: { top: 62, bottom: 28, left: 56, right: 56 }, viewport: { width, height: MAP_HEIGHT }, maxZoom: 15 }),
    [summary, width],
  );
  return (
    <MapCard height={MAP_HEIGHT} radius={14} testID="TripFinished.map">
      <MvcMap key={summary.bookingId} style={styles.flex} markers={markers} routes={routes} initialRegion={region} accessibilityLabel={T.mapA11y} />
    </MapCard>
  );
}

function Row({ icon, label, value, testID }: { icon: IconName; label: string; value: string; testID?: string }): React.JSX.Element {
  return (
    <View style={styles.row} testID={testID} accessible accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} size={22} color={colors.primary} />
      <Text variant="body" color="strong" size={16} style={styles.flex}>{label}</Text>
      <Text variant="rowTitle" color="heading" size={16} align="right">{value}</Text>
    </View>
  );
}

export function TripFinishedScreen({ navigation, route }: AppScreenProps<"TripFinished">): React.JSX.Element {
  const bookingId = route.params?.bookingId ?? "";
  const query = useBookingSummary(bookingId);
  const summary = query.data;
  const rate = useCreateRating(summary?.tripId ?? "");
  const { width: windowWidth } = useWindowDimensions();
  const mapWidth = Math.min(windowWidth, 600) - 2 * SIDE;
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [starsError, setStarsError] = useState(false);

  const header = <ScreenHeader title={T.title} testID="TripFinished.header" />;
  const toMap = (): void => navigation.navigate("MapHome");

  if (summary === undefined) {
    if (query.error) {
      return (
        <Screen testID="TripFinished" paddingX={SIDE} header={header}>
          <View style={styles.block}>
            <LoadError error={query.error} onRetry={() => void query.refetch()} fallbackLabel={T.backToMap} onFallback={toMap} testID="TripFinished.error" />
          </View>
        </Screen>
      );
    }
    return (
      <Screen testID="TripFinished" paddingX={SIDE} header={header}>
        <View style={styles.block} testID="TripFinished.loading" accessible accessibilityLabel={T.loading} accessibilityState={{ busy: true }}>
          <Skeleton height={64} radius={14} />
          <Skeleton height={MAP_HEIGHT} radius={14} style={styles.gap} />
          <Skeleton height={150} radius={14} style={styles.gap} />
          <Skeleton height={96} radius={14} style={styles.gap} />
        </View>
      </Screen>
    );
  }

  const mine = rate.data ?? summary.rating.mine;
  const paymentConfirmed = summary.payment.status === "confirmed";
  const driverName = summary.driver.firstName;
  const canRate = summary.rating.canRate && mine === null;
  const blockedMessage = mine === null && !summary.rating.canRate && summary.rating.reason !== null ? T.rateBlocked[summary.rating.reason] : null;

  const submit = async (): Promise<void> => {
    if (stars < 1) {
      setStarsError(true);
      return;
    }
    setStarsError(false);
    await rate.mutate({ rateeUserId: summary.rating.rateeUserId, stars, ...(comment.trim() !== "" ? { comment: comment.trim() } : {}) });
  };

  return (
    <Screen testID="TripFinished" paddingX={SIDE} header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      <View style={styles.block}>
        <Hero summary={summary} />

        <View style={styles.gap}>
          <RouteMap summary={summary} width={mapWidth} />
        </View>

        <Card tone="blue" padding={12} style={styles.gap} testID="TripFinished.summary">
          <Text variant="rowTitle" color="heading" size={17} style={styles.cardTitle}>{T.summaryTitle}</Text>
          <Row icon="clock" label={T.duration} value={formatDurationSeconds(summary.duration.seconds)} testID="TripFinished.duration" />
          <Row icon="route" label={T.distance} value={formatDistance(summary.distance.meters)} testID="TripFinished.distance" />
          <Row icon="passenger" label={T.passengers} value={T.passengersValue(summary.passengers.count, summary.passengers.capacity)} testID="TripFinished.passengers" />
          <Row icon="car" label={T.with(driverName)} value={`${summary.vehicle.make} ${summary.vehicle.model} · ${plateText(summary.vehicle.plate)}`} testID="TripFinished.vehicle" />
        </Card>

        <Card tone={paymentConfirmed ? "green" : "blue"} padding={12} style={styles.gap} testID="TripFinished.payment">
          <View style={styles.payment}>
            <View style={styles.euro}>
              <Text variant="titleSm" color="inverse" size={20}>€</Text>
            </View>
            <View style={styles.flex}>
              <Text variant="rowTitle" color="heading" size={16.5}>
                {paymentConfirmed ? T.paymentConfirmed : T.paymentPending}
                {paymentConfirmed ? "" : ` ${T.paymentPendingTag}`}
              </Text>
              <View style={styles.amountRow}>
                <Text variant="titleSm" color="heading" size={24}>{formatMoney(summary.payment.amount)}</Text>
                {!paymentConfirmed && summary.payment.amount.cents !== null ? (
                  <View style={styles.chip}><Text variant="caption" color="muted" size={13.5}>{T.paymentProposal}</Text></View>
                ) : null}
              </View>
              <Text variant="body" color="strong" size={14.5} lineHeight={19}>{paymentConfirmed ? T.paymentConfirmedNote : T.paymentNote}</Text>
            </View>
          </View>
        </Card>

        <View style={styles.rateHead}>
          <Text variant="rowTitle" color="heading" size={18}>{T.rateTitle}</Text>
          <Text variant="body" color="muted" size={15}> {T.rateOptional}</Text>
        </View>

        {mine !== null ? (
          <Banner
            testID="TripFinished.rated"
            kind="success"
            title={T.rateThanksTitle}
            message={`${T.rateThanksMessage(driverName)} ${T.rateStarsLabel(mine.stars)}.`}
          />
        ) : canRate ? (
          <>
            <View style={styles.stars}>
              <RatingStars testID="TripFinished.stars" value={stars} onChange={(value) => { setStars(value); setStarsError(false); }} size={34} />
            </View>
            <TextArea testID="TripFinished.comment" value={comment} onChangeText={setComment} placeholder={T.rateComment} maxLength={500} minHeight={52} />
            {starsError ? <Text testID="TripFinished.starsError" variant="body" color="error" size={15} style={styles.noteTop}>{T.rateNeedStars}</Text> : null}
            {rate.error ? <Banner testID="TripFinished.rateError" kind="error" title={T.rateFailed} message={describeError(rate.error).message} style={styles.gap} /> : null}
            {stars > 0 ? <Button testID="TripFinished.rateSubmit" label={T.rateSubmit} loading={rate.isPending} onPress={() => void submit()} style={styles.gap} /> : null}
          </>
        ) : blockedMessage !== null ? (
          <Banner testID="TripFinished.rateBlocked" kind="notice" size="sm" title={blockedMessage} />
        ) : null}

        <Button
          testID="TripFinished.report"
          label={summary.incidents.mineCount > 0 ? T.reportCount(summary.incidents.mineCount) : T.report}
          variant="outline"
          leadingIcon="exclaim"
          disabled={!summary.incidents.canReport}
          onPress={() => navigation.navigate("ReportIncident", { tripId: summary.tripId, bookingId: summary.bookingId })}
          style={styles.gap}
        />
        <Button testID="TripFinished.toMap" label={T.backToMap} leadingIcon="map" onPress={toMap} style={styles.gapSm} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { paddingTop: 8, paddingBottom: 24 },
  gap: { marginTop: 12 },
  gapSm: { marginTop: 10 },
  noteTop: { marginTop: 6 },
  hero: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 6 },
  heroDisc: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  cardTitle: { marginBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 31 },
  payment: { flexDirection: "row", gap: 12 },
  euro: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.success.solid },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, backgroundColor: colors.bg.tintStrong },
  rateHead: { flexDirection: "row", alignItems: "baseline", marginTop: 12, marginBottom: 4 },
  stars: { alignItems: "center", marginBottom: 6 },
});
