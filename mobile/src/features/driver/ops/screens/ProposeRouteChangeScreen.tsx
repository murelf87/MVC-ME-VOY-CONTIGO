/**
 * «Proponer una parada» (conductor). Sin lámina propia: se diseña con el lenguaje de la 22 «Cambio de ruta» (mapa con la
 * ruta anterior en gris y la nueva en azul, desvío, nunca recargo) para quien la propone. El servidor calcula el desvío y
 * quién debe aceptar: si nadie, se aplica al instante; si alguien, queda pendiente con caducidad y el conductor ve las
 * respuestas. Las respuestas del pasajero NO se simulan aquí: llegan del servidor.
 */
import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { LiveRouteChange } from "@/api/types";
import { usePlaceResult } from "@/features/search/browse/hooks/usePlaceResult";
import type { PlaceParam } from "@/features/search/routes";
import { formatDistance, formatDurationSeconds, formatTime } from "@/i18n";
import { MvcMap, type MapMarkerSpec, type MapRouteSpec } from "@/maps";
import type { AppScreenProps } from "@/navigation";
import { Avatar, Banner, Button, Card, ConfirmDialog, MapCard, Screen, ScreenHeader, SectionHeader, Skeleton, StatusPill, Text } from "@/ui";
import { OpsErrorCard } from "../components/OpsErrorCard";
import { describeOps } from "../hooks/describe";
import { useDriverConsole } from "../hooks/useDriverConsole";
import { useProposeRouteChange, useRouteChangeView, useWithdrawRouteChange } from "../hooks/useRouteChange";
import { routeOf, useTripDetail } from "../hooks/useTripDetail";
import { opsStrings } from "../strings";
import { tripStrings } from "../stringsTrip";

const T = tripStrings.propose;
const SCREEN_X = 14;
const MAP_HEIGHT = 230;

const STATUS_TONE = { pending: "info", accepted: "success", rejected: "error", expired: "warning", cancelled: "warning" } as const;

function ProposalMap({ change }: { change: LiveRouteChange }): React.JSX.Element {
  const routes = useMemo<MapRouteSpec[]>(
    () => [
      { id: "before", kind: "alt", points: change.path.before },
      { id: "after", kind: "route", points: change.path.after },
    ],
    [change],
  );
  const markers = useMemo<MapMarkerSpec[]>(
    () => [{ id: "new-stop", kind: "stop", position: change.newStop.location, chip: { title: change.newStop.label ?? T.stopTitle, subtitle: change.newStop.plannedArrivalAt ? formatTime(change.newStop.plannedArrivalAt) : undefined, tone: "brand", side: "right" } }],
    [change],
  );
  const fit = useMemo(() => [...change.path.before, ...change.path.after, change.newStop.location], [change]);
  return (
    <MapCard height={MAP_HEIGHT} radius={14} testID="ProposeRouteChange.map">
      <MvcMap style={styles.flex} markers={markers} routes={routes} fit={fit} fitKey={change.id} accessibilityLabel={T.mapTitle} />
    </MapCard>
  );
}

function ProposalView({ change, onWithdraw, withdrawing }: { change: LiveRouteChange; onWithdraw: () => void; withdrawing: boolean }): React.JSX.Element {
  const pending = change.status === "pending";
  const applied = change.autoApplied;
  const title = applied ? T.resultTitleApplied : pending ? T.resultTitlePending : T.statusLabel[change.status];
  const message = applied
    ? T.resultMessageApplied
    : pending
      ? T.resultMessagePending(change.counts.accepted, change.counts.required)
      : change.resolution
        ? T.resolution[change.resolution]
        : T.statusLabel[change.status];
  return (
    <View testID="ProposeRouteChange.view">
      <Banner testID="ProposeRouteChange.status" kind={applied ? "success" : STATUS_TONE[change.status]} title={title} message={message} />
      <View style={styles.gap}>
        <ProposalMap change={change} />
      </View>
      <Card tone="blue" padding={14} style={styles.gap}>
        <Text variant="rowTitle" color="heading" size={18}>{change.newStop.label ?? T.stopTitle}</Text>
        <Text variant="body" color="strong" size={16} style={styles.note}>{T.detour(formatDistance(change.detour.addedDistanceM), formatDurationSeconds(change.detour.addedDurationSeconds))}</Text>
        {change.newStop.plannedArrivalAt ? <Text variant="body" color="muted" size={15} style={styles.note}>{T.plannedAt(formatTime(change.newStop.plannedArrivalAt))}</Text> : null}
        <Text variant="body" color="success" size={15} weight="semibold" style={styles.note}>{T.noSurcharge}</Text>
        {pending && change.expiresAt ? <Text variant="body" color="muted" size={15} style={styles.note}>{T.expires(formatTime(change.expiresAt))}</Text> : null}
      </Card>

      {change.participants && change.participants.length > 0 ? (
        <>
          <SectionHeader title={T.participants} style={styles.section} />
          {change.participants.map((row) => (
            <Card key={row.bookingId} tone="white" padding={12} style={styles.rowGap} testID={`ProposeRouteChange.participant.${row.bookingId}`}>
              <View style={styles.participant}>
                <Avatar source={row.passenger.photoUrl} name={row.passenger.displayName} size={44} />
                <View style={styles.flex}>
                  <Text variant="rowTitle" color="heading" size={17} numberOfLines={1}>{row.passenger.firstName}</Text>
                  <Text variant="body" color="muted" size={14.5}>{T.delta(Math.round(row.deltaSeconds / 60))}</Text>
                </View>
                <StatusPill
                  size="sm"
                  label={!row.requiresAcceptance ? T.notRequired : row.decision === "accepted" ? T.decisionAccepted : row.decision === "rejected" ? T.decisionRejected : T.decisionPending}
                  tone={!row.requiresAcceptance ? "gray" : row.decision === "accepted" ? "green" : row.decision === "rejected" ? "red" : "amber"}
                />
              </View>
            </Card>
          ))}
        </>
      ) : null}

      {pending ? <Button testID="ProposeRouteChange.withdraw" label={T.withdraw} variant="dangerOutline" loading={withdrawing} onPress={onWithdraw} style={styles.gap} /> : null}
    </View>
  );
}

export function ProposeRouteChangeScreen({ navigation, route }: AppScreenProps<"ProposeRouteChange">): React.JSX.Element {
  const tripId = route.params?.tripId ?? "";
  const consoleQuery = useDriverConsole(tripId);
  const detail = useTripDetail(tripId, tripId !== "");
  const propose = useProposeRouteChange(tripId);
  const [stop, setStop] = useState<PlaceParam | null>(null);
  const [stopError, setStopError] = useState<string | undefined>();
  const [created, setCreated] = useState<LiveRouteChange | null>(null);
  const [withdrawDialog, setWithdrawDialog] = useState(false);

  usePlaceResult("stop", (place) => {
    setStop(place);
    setStopError(undefined);
    propose.reset();
  });

  const data = consoleQuery.data;
  const pendingId = created?.id ?? data?.pendingRouteChange?.id ?? null;
  const view = useRouteChangeView(pendingId);
  const withdraw = useWithdrawRouteChange(pendingId ?? "");
  const current = view.data ?? created;
  const routePoints = useMemo(() => routeOf(detail.data), [detail.data]);
  const error = useMemo(() => (propose.error ? describeOps(propose.error) : null), [propose.error]);

  const back = useCallback(() => navigation.navigate("DriverConsole", { tripId }), [navigation, tripId]);

  const pickStop = (): void =>
    navigation.navigate("PlaceSearch", {
      field: "place",
      title: T.stopTitle,
      ...(stop ? { current: stop } : {}),
      returnTo: { route: "ProposeRouteChange", param: "stop" },
    });

  const submit = async (): Promise<void> => {
    if (stop === null) {
      setStopError(T.stopRequired);
      return;
    }
    const result = await propose.mutate({ stop: { location: { lat: stop.latitude, lng: stop.longitude }, label: stop.label } });
    if (result) {
      setCreated(result);
    }
  };

  const doWithdraw = async (): Promise<void> => {
    const result = await withdraw.mutate();
    setWithdrawDialog(false);
    if (result) {
      setCreated(result);
    }
  };

  const header = <ScreenHeader title={T.title} testID="ProposeRouteChange.header" />;
  const backFooter = (
    <View style={styles.footer}>
      <Button testID="ProposeRouteChange.back" label={T.backToConsole} variant={current && current.status === "pending" ? "outline" : "primary"} chevron={false} onPress={back} />
    </View>
  );

  if (data === undefined) {
    if (consoleQuery.error) {
      return (
        <Screen testID="ProposeRouteChange" paddingX={SCREEN_X} header={header}>
          <View style={styles.block}>
            <OpsErrorCard error={describeOps(consoleQuery.error)} onAction={() => void consoleQuery.refetch()} testID="ProposeRouteChange.error" />
          </View>
        </Screen>
      );
    }
    return (
      <Screen testID="ProposeRouteChange" paddingX={SCREEN_X} header={header}>
        <View style={styles.block} testID="ProposeRouteChange.loading" accessible accessibilityLabel={opsStrings.console.loading} accessibilityState={{ busy: true }}>
          <Skeleton height={60} radius={14} />
          <Skeleton height={230} radius={14} style={styles.gap} />
        </View>
      </Screen>
    );
  }

  // Propuesta existente (pendiente al abrir, o recién creada / resuelta en esta pantalla).
  if (current !== null) {
    return (
      <Screen testID="ProposeRouteChange" paddingX={SCREEN_X} header={header} footer={backFooter}>
        <View style={styles.block}>
          <ProposalView change={current} withdrawing={withdraw.isPending} onWithdraw={() => { withdraw.reset(); setWithdrawDialog(true); }} />
          {withdraw.error ? <OpsErrorCard testID="ProposeRouteChange.withdrawError" error={describeOps(withdraw.error)} onAction={() => void doWithdraw()} /> : null}
        </View>
        <ConfirmDialog
          visible={withdrawDialog}
          destructive
          loading={withdraw.isPending}
          title={T.withdrawTitle}
          message={T.withdrawMessage}
          confirmLabel={T.withdrawConfirm}
          cancelLabel={opsStrings.common.cancel}
          onConfirm={() => void doWithdraw()}
          onCancel={() => setWithdrawDialog(false)}
          testID="ProposeRouteChange.withdrawDialog"
        />
      </Screen>
    );
  }

  if (!data.actions.canProposeRouteChange) {
    return (
      <Screen testID="ProposeRouteChange" paddingX={SCREEN_X} header={header} footer={backFooter}>
        <View style={styles.block}>
          <Banner
            testID="ProposeRouteChange.blocked"
            kind="warning"
            title={T.unavailable}
            message={data.status === "published" || data.status === "active" ? opsStrings.console.routeChange.proposeUnavailable : opsStrings.console.routeChange.proposeDisabledStatus}
          />
        </View>
      </Screen>
    );
  }

  const footer = (
    <View style={styles.footer}>
      <Button testID="ProposeRouteChange.submit" label={propose.isPending ? T.sending : T.submit} leadingIcon="route" loading={propose.isPending} onPress={() => void submit()} />
    </View>
  );

  const markers: MapMarkerSpec[] = stop ? [{ id: "new-stop", kind: "stop", position: { lat: stop.latitude, lng: stop.longitude }, chip: { title: stop.label, tone: "brand", side: "right" } }] : [];
  const routes: MapRouteSpec[] = routePoints.length >= 2 ? [{ id: "trip", kind: "route", points: routePoints.map(([lng, lat]) => ({ lat, lng })) }] : [];

  return (
    <Screen testID="ProposeRouteChange" paddingX={SCREEN_X} header={header} footer={footer}>
      <View style={styles.block}>
        <Text variant="body" color="strong" size={17} lineHeight={23}>{T.intro}</Text>

        <SectionHeader title={T.stopTitle} style={styles.section} />
        <Card tone="blue" padding={14} onPress={pickStop} accessibilityLabel={stop ? `${stop.label}. ${T.stopChange}` : T.stopPlaceholder} testID="ProposeRouteChange.stop">
          <Text variant="rowTitle" color={stop ? "heading" : "placeholder"} size={18} numberOfLines={2}>{stop ? stop.label : T.stopPlaceholder}</Text>
          <Text variant="body" color="link" size={15} weight="semibold" style={styles.note}>{stop ? T.stopChange : T.stopPlaceholder}</Text>
        </Card>
        {stopError ? <Text testID="ProposeRouteChange.stopError" variant="body" color="error" size={15} style={styles.note}>{stopError}</Text> : null}

        {routes.length > 0 || markers.length > 0 ? (
          <View style={styles.gap}>
            <MapCard height={MAP_HEIGHT} radius={14} testID="ProposeRouteChange.preview">
              <MvcMap style={styles.flex} markers={markers} routes={routes} fit={stop ? [...routes.flatMap((r) => r.points), ...markers.map((m) => m.position)] : "content"} fitKey={`${tripId}:${stop?.latitude ?? 0}:${stop?.longitude ?? 0}`} accessibilityLabel={T.mapTitle} />
            </MapCard>
          </View>
        ) : null}

        <Banner testID="ProposeRouteChange.noSurcharge" kind="success" size="sm" icon="checkCircle" title={T.noSurcharge} style={styles.gap} />
        {error ? <OpsErrorCard testID="ProposeRouteChange.error" error={error} onAction={() => void submit()} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { paddingTop: 8, paddingBottom: 24 },
  gap: { marginTop: 12 },
  rowGap: { marginTop: 8 },
  section: { marginTop: 18 },
  note: { marginTop: 6 },
  participant: { flexDirection: "row", alignItems: "center", gap: 12 },
  footer: { paddingHorizontal: SCREEN_X, paddingBottom: 8 },
});
