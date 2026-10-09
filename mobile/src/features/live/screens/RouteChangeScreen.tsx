/**
 * Lámina 22 «Cambio de ruta» (pasajero). La persona que conduce propone una parada nueva; el servidor calcula cómo
 * cambian la hora de llegada y el precio y si hace falta la aceptación de esta persona. Aquí se ve el cambio (mapa con
 * recogida, parada nueva y destino; antes/ahora; precio sin recargo) y se acepta o rechaza. NADA se aplica sin respuesta:
 * lo decide el servidor (y caduca si nadie contesta).
 *
 * Estados: cargando · error con reintento · propuesta no encontrada · pendiente (aceptar/rechazar con confirmación) ·
 * ya respondida (aceptada/rechazada) · aplicada · caducada · retirada · sin cambio material · sin señal del coche · error al responder.
 */
import React, { useMemo, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { describeError } from "@/api";
import type { LiveRouteChange } from "@/api/types";
import { Icon } from "@/icons";
import { formatMoney, formatTime } from "@/i18n";
import { fitBounds, MvcMap, type MapMarkerSpec, type MapRouteSpec } from "@/maps";
import type { AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Banner, Button, Card, ConfirmDialog, MapCard, OfflineBanner, Screen, ScreenHeader, Skeleton, Text } from "@/ui";
import { LoadError } from "../components/LoadError";
import { SignalInfoSheet } from "../components/SignalStrip";
import { useRespondRouteChange, useRouteChange } from "../hooks/useRouteChange";
import { formatAge } from "../model/time";
import { liveStrings } from "../strings";

const T = liveStrings.routeChange;
const SIDE = 14;
const MAP_HEIGHT = 218;

function Mapa({ change, width }: { change: LiveRouteChange; width: number }): React.JSX.Element {
  const pickup = change.stops.pickup;
  const dropoff = change.stops.dropoff;
  const points = useMemo(() => {
    const list = [...change.path.after];
    if (pickup) list.push(pickup.location);
    if (dropoff) list.push(dropoff.location);
    list.push(change.newStop.location);
    return list;
  }, [change, pickup, dropoff]);
  const markers = useMemo<MapMarkerSpec[]>(() => {
    const list: MapMarkerSpec[] = [];
    if (pickup) list.push({ id: "pickup", kind: "destination", position: pickup.location, chip: { title: T.yourPickup, subtitle: change.myImpact ? formatTimeOrNull(change.myImpact.pickup.afterAt) : undefined, tone: "brand", side: "right" } });
    list.push({ id: "new-stop", kind: "stop", tone: "warning", position: change.newStop.location, chip: { title: T.newStop, subtitle: change.newStop.plannedArrivalAt ? formatTime(change.newStop.plannedArrivalAt) : undefined, tone: "warning", side: "left" } });
    if (dropoff) list.push({ id: "dropoff", kind: "destination", position: dropoff.location, chip: { title: T.yourDestination, tone: "brand", side: "left" } });
    return list;
  }, [change, pickup, dropoff]);
  const routes = useMemo<MapRouteSpec[]>(() => [{ id: "after", kind: "approach", points: change.path.after }], [change]);
  const region = useMemo(() => fitBounds(points, { padding: { top: 70, bottom: 30, left: 50, right: 70 }, viewport: { width, height: MAP_HEIGHT }, maxZoom: 15 }), [points, width]);
  return (
    <MapCard height={MAP_HEIGHT} radius={14} testID="RouteChange.map">
      <MvcMap key={change.id} style={styles.flex} markers={markers} routes={routes} initialRegion={region} accessibilityLabel={T.mapA11y} />
    </MapCard>
  );
}

function formatTimeOrNull(iso: string | null): string | undefined {
  return iso === null ? undefined : formatTime(iso);
}

export function RouteChangeScreen({ navigation, route }: AppScreenProps<"RouteChange">): React.JSX.Element {
  const proposalId = route.params?.proposalId ?? "";
  const query = useRouteChange(proposalId);
  const respond = useRespondRouteChange(proposalId);
  const { width: windowWidth } = useWindowDimensions();
  const mapWidth = Math.min(windowWidth, 600) - 2 * SIDE;
  const [rejectDialog, setRejectDialog] = useState(false);
  const [info, setInfo] = useState(false);
  const change = respond.data ?? query.data;

  const leave = (): void => {
    const bookingId = route.params?.bookingId;
    if (bookingId) navigation.navigate("WaitingForCar", { bookingId });
    else navigation.goBack();
  };

  const header = <ScreenHeader title={T.title} testID="RouteChange.header" />;

  if (change === undefined) {
    if (query.error) {
      return (
        <Screen testID="RouteChange" paddingX={SIDE} header={header}>
          <View style={styles.block}>
            <LoadError error={query.error} onRetry={() => void query.refetch()} fallbackLabel={T.backToTrip} onFallback={leave} testID="RouteChange.error" />
          </View>
        </Screen>
      );
    }
    return (
      <Screen testID="RouteChange" paddingX={SIDE} header={header}>
        <View style={styles.block} testID="RouteChange.loading" accessible accessibilityLabel={T.loading} accessibilityState={{ busy: true }}>
          <Skeleton height={68} radius={16} />
          <Skeleton height={MAP_HEIGHT} radius={14} style={styles.gap} />
          <Skeleton height={86} radius={14} style={styles.gap} />
          <Skeleton height={96} radius={14} style={styles.gap} />
        </View>
      </Screen>
    );
  }

  const impact = change.myImpact;
  const pending = change.status === "pending";
  const mine = change.myDecision;
  const needs = impact?.requiresAcceptance === true;
  const canDecide = pending && needs && mine === null;
  const delta = impact ? Math.round(impact.dropoff.deltaSeconds / 60) : 0;
  const driverName = change.driver.firstName;
  const ageSeconds = change.driverSignal.ageSeconds;
  const stale = change.driverSignal.state === "stale" || change.driverSignal.state === "none";

  const banner = (() => {
    if (mine === "accepted" && pending) return { kind: "success" as const, title: T.acceptedTitle, message: T.acceptedMessage };
    if (mine === "rejected" && pending) return { kind: "notice" as const, title: T.rejectedTitle, message: T.rejectedMessage };
    if (pending && !needs) return { kind: "info" as const, title: T.notRequiredTitle, message: T.notRequiredMessage };
    if (pending) {
      return { kind: "warning" as const, title: T.proposesTitle(driverName), message: T.proposesMessage };
    }
    if (change.status === "accepted") return { kind: "success" as const, title: T.resolvedTitle.accepted, message: T.resolvedMessage.accepted };
    const key = change.status === "rejected" ? "rejected" : change.status === "expired" ? "expired" : "cancelled";
    return { kind: "notice" as const, title: T.resolvedTitle[key], message: T.resolvedMessage[key] };
  })();

  const submit = async (decision: "accept" | "reject"): Promise<void> => {
    const result = await respond.mutate({ decision });
    if (decision === "reject") setRejectDialog(false);
    void result;
  };

  const footer = canDecide ? (
    <View style={styles.footer}>
      <Button testID="RouteChange.reject" label={T.reject} variant="dangerOutline" leadingIcon="close" chevron={false} disabled={respond.isPending} onPress={() => { respond.reset(); setRejectDialog(true); }} style={styles.half} />
      <Button testID="RouteChange.accept" label={T.accept} leadingIcon="check" chevron={false} loading={respond.isPending && respond.variables?.decision === "accept"} disabled={respond.isPending} onPress={() => void submit("accept")} style={styles.half} />
    </View>
  ) : (
    <View style={styles.footer}>
      <Button testID="RouteChange.back" label={T.backToTrip} chevron={false} onPress={leave} />
    </View>
  );

  return (
    <Screen testID="RouteChange" paddingX={SIDE} header={header} footer={footer} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      <View style={styles.block}>
        <Banner testID="RouteChange.banner" kind={banner.kind} icon={banner.kind === "warning" ? "exclaim" : undefined} title={banner.title} message={banner.message} />

        <View style={styles.gap}>
          <Mapa change={change} width={mapWidth} />
        </View>

        {stale ? (
          <OfflineBanner
            testID="RouteChange.signal"
            title={liveStrings.signal.staleTitle}
            detail={ageSeconds !== null ? liveStrings.signal.staleDetail(formatAge(ageSeconds)) : liveStrings.signal.noneDetail}
            onInfo={() => setInfo(true)}
            style={styles.gap}
          />
        ) : null}

        {impact ? (
          <>
            <Card tone="white" padding={0} style={[styles.gap, styles.times]} testID="RouteChange.times">
              <View style={styles.timeCol}>
                <Text variant="rowTitle" color="primary" size={16}>{T.before}</Text>
                <Text variant="caption" color="muted" size={14}>{T.arrivalEstimated}</Text>
                <Text variant="titleSm" color="primary" size={26}>{impact.dropoff.beforeAt ? formatTime(impact.dropoff.beforeAt) : "—"}</Text>
              </View>
              <View style={[styles.timeCol, styles.timeColMid]}>
                <Text variant="rowTitle" color="primary" size={16}>{T.now}</Text>
                <Text variant="caption" color="muted" size={14}>{T.arrivalEstimated}</Text>
                <Text variant="titleSm" color="primary" size={26}>{impact.dropoff.afterAt ? formatTime(impact.dropoff.afterAt) : "—"}</Text>
              </View>
              <View style={[styles.delta, delta > 0 ? styles.deltaUp : styles.deltaFlat]}>
                <Text variant="titleSm" color={delta > 0 ? "error" : "success"} size={22}>{T.deltaMinutes(delta)}</Text>
                <Text variant="caption" color={delta > 0 ? "error" : "success"} size={13}>{T.deltaCaption}</Text>
              </View>
            </Card>

            <Card tone="blue" padding={12} style={styles.gap} testID="RouteChange.price">
              <View style={styles.priceHead}>
                <Icon name="car" size={22} color={colors.primary} />
                <Text variant="rowTitle" color="heading" size={17}>{`${T.priceTitle} ${T.priceIllustrative}`}</Text>
              </View>
              <View style={styles.priceRow}>
                <View style={[styles.priceBox, styles.priceBefore]}>
                  <Text variant="caption" color="primary" size={14}>{T.priceBefore}</Text>
                  <Text variant="titleSm" color="heading" size={24}>{formatMoney(impact.price.before)}</Text>
                </View>
                <View style={[styles.priceBox, styles.priceNow]}>
                  <Text variant="caption" color="success" size={14}>{T.priceNow}</Text>
                  <Text variant="titleSm" color="heading" size={24}>{formatMoney(impact.price.after)}</Text>
                </View>
                <View style={styles.flex}>
                  <Text variant="rowTitle" color="success" size={14.5} lineHeight={18}>{T.noSurcharge}</Text>
                </View>
              </View>
            </Card>
          </>
        ) : null}

        {pending ? (
          <View testID="RouteChange.note" style={[styles.note, styles.gap]} accessible accessibilityLabel={`${T.appliedOnlyIfAccepted}${change.expiresAt ? ` ${T.expiresAt(formatTime(change.expiresAt))}` : ""}`}>
            <View style={styles.noteDisc}>
              <Icon name="infoMark" size={15} color={colors.onPrimary} />
            </View>
            <View style={styles.flex}>
              <Text variant="body" color="deep" size={15.5} lineHeight={20}>{T.appliedOnlyIfAccepted}</Text>
              {change.expiresAt ? <Text variant="caption" color="muted" size={14}>{T.expiresAt(formatTime(change.expiresAt))}</Text> : null}
            </View>
          </View>
        ) : null}

        {respond.error ? (
          <Banner testID="RouteChange.respondError" kind="error" title={T.sendFailed} message={describeError(respond.error).message} style={styles.gap} />
        ) : null}
      </View>

      <SignalInfoSheet visible={info} kind="stale" onClose={() => setInfo(false)} />
      <ConfirmDialog
        visible={rejectDialog}
        destructive
        loading={respond.isPending}
        title={T.rejectTitle}
        message={T.rejectMessage}
        confirmLabel={T.rejectConfirm}
        cancelLabel={T.rejectBack}
        onConfirm={() => void submit("reject")}
        onCancel={() => setRejectDialog(false)}
        testID="RouteChange.rejectDialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { paddingTop: 8, paddingBottom: 24 },
  gap: { marginTop: 10 },
  footer: { flexDirection: "row", gap: 12, paddingHorizontal: SIDE, paddingBottom: 8 },
  half: { flex: 1 },
  times: { flexDirection: "row", alignItems: "stretch", overflow: "hidden" },
  timeCol: { flex: 1, padding: 12 },
  timeColMid: { borderLeftWidth: 1, borderLeftColor: colors.gray.line },
  delta: { alignItems: "center", justifyContent: "center", paddingHorizontal: 12, margin: 8, borderRadius: 12 },
  deltaUp: { backgroundColor: colors.error.bg },
  deltaFlat: { backgroundColor: colors.success.bg },
  note: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.bg.tint },
  noteDisc: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.gray.help },
  priceHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  priceBox: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, minWidth: 104 },
  priceBefore: { backgroundColor: colors.bg.tintStrong },
  priceNow: { backgroundColor: colors.success.bg },
});
