/**
 * Consola del viaje en directo (conductor). Sin lámina propia: se diseña en el lenguaje de la lámina 21 «Esperando el
 * coche» (franja de estado verde, tarjeta azul con la hora, mapa a todo el ancho, franja «Última actualización») con la
 * lámina 20 «Solicitudes» al lado para las tarjetas de pasajero.
 *
 * Lo que dice el servidor manda: estado del viaje, siguiente recogida, ETA, estado del código de cada pasajero y qué
 * acciones están permitidas llegan en `GET /v1/me/trips/{id}/console`; la pantalla solo los traduce. La ubicación del
 * conductor se publica con `useDriverLocationSharing` mientras el viaje está en curso (solo primer plano).
 *
 * Estados: cargando (esqueleto) · error con reintento · sin conexión (datos guardados + aviso) · viaje de otra persona ·
 * viaje no encontrado / sin publicar · viaje publicado (salida prevista) · en curso (siguiente recogida, mapa, pasajeros) ·
 * terminado · cancelado · ubicación: sin preguntar / denegada / bloqueada / GPS apagado / sin compartir / buscando / sin
 * señal / envío fallido · propuesta de parada pendiente · iniciar y terminar con confirmación y error del servidor
 * (vehículo sin foto o seguro caducado con botón para resolverlo).
 */
import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { LiveConsole } from "@/api/types";
import { useIsOnline } from "@/hooks";
import type { AppScreenProps } from "@/navigation";
import { openMapsDirections, useKeepScreenAwake } from "@/platform";
import { colors } from "@/theme";
import { Banner, Button, ConfirmDialog, OfflineBanner, Screen, ScreenHeader, SectionHeader, Skeleton, Text, showToast } from "@/ui";
import { ConsoleMap } from "../components/ConsoleMap";
import { EtaHeroCard } from "../components/EtaHeroCard";
import { OpsErrorCard } from "../components/OpsErrorCard";
import { PassengerCard } from "../components/PassengerCard";
import { SharingCard } from "../components/SharingCard";
import { UpdateStrip } from "../components/UpdateStrip";
import { describeOps } from "../hooks/describe";
import { useDriverConsole } from "../hooks/useDriverConsole";
import { useDriverLocationSharing } from "../hooks/useDriverLocationSharing";
import { useNow } from "../hooks/useNow";
import { useOpenPassengerChat } from "../hooks/useOpenPassengerChat";
import { useTripDetail, routeOf } from "../hooks/useTripDetail";
import { useCompleteTrip, useStartTrip } from "../hooks/useTripTransitions";
import {
  bannerFor,
  confirmedCount,
  effectiveSignal,
  formatAge,
  mapModel,
  nextPickup,
  passengerCounter,
  passengerRows,
  positionAgeSeconds,
  routeChangeBanner,
  serverNowMs,
} from "../logic/console";
import type { OpsErrorAction, OpsErrorView } from "../logic/errors";
import { sharingCard, type SharingAction } from "../logic/sharing";
import { opsStrings } from "../strings";
import { formatTime } from "@/i18n";

const COPY = opsStrings.console;
const SCREEN_X = 14;
const MAP_HEIGHT = 240;

type DialogKind = "start" | "complete" | null;

function ConsoleSkeleton(): React.JSX.Element {
  return (
    <View testID="DriverConsole.loading" accessible accessibilityLabel={COPY.loading} accessibilityState={{ busy: true }}>
      <Skeleton height={69} radius={14} />
      <Skeleton height={150} radius={14} style={styles.gap} />
      <Skeleton height={MAP_HEIGHT} radius={0} style={[styles.gap, styles.bleed]} />
      <Skeleton height={44} radius={14} style={styles.gap} />
      <Skeleton height={150} radius={14} style={styles.gap} />
      <Skeleton height={150} radius={14} style={styles.gap} />
    </View>
  );
}

export function DriverConsoleScreen({ navigation, route }: AppScreenProps<"DriverConsole">): React.JSX.Element {
  const { tripId } = route.params;
  const query = useDriverConsole(tripId);
  const data = query.data;
  const receivedAtMs = query.receivedAtMs ?? 0;
  const now = useNow(10_000, data !== undefined);
  const online = useIsOnline();

  const active = data?.status === "active";
  const detail = useTripDetail(tripId, data !== undefined && data.status !== "cancelled");
  const routePoints = useMemo(() => routeOf(detail.data), [detail.data]);

  const sharing = useDriverLocationSharing({
    tripId,
    enabled: active,
    route: routePoints,
    resumeFrom: data?.position?.location ?? null,
  });
  useKeepScreenAwake(active);

  const start = useStartTrip(tripId);
  const complete = useCompleteTrip(tripId);
  const chat = useOpenPassengerChat(tripId);
  const [dialog, setDialog] = useState<DialogKind>(null);

  const vehicleId = detail.data?.vehicle.id ?? undefined;
  const startError = useMemo<OpsErrorView | null>(() => (start.error ? describeOps(start.error) : null), [start.error]);
  const completeError = useMemo<OpsErrorView | null>(() => (complete.error ? describeOps(complete.error) : null), [complete.error]);

  const openMyTrips = useCallback(() => navigation.navigate("MyTrips"), [navigation]);
  const openVehicle = useCallback(() => navigation.navigate("MyVehicle", vehicleId ? { vehicleId } : undefined), [navigation, vehicleId]);

  const confirmStart = useCallback(async () => {
    const result = await start.mutate();
    setDialog(null);
    if (result) showToast({ kind: "success", message: COPY.toast.started, id: "driver-ops.started" });
  }, [start]);

  const confirmComplete = useCallback(async () => {
    const result = await complete.mutate();
    setDialog(null);
    if (result) {
      showToast({ kind: "success", message: COPY.toast.completed, id: "driver-ops.completed" });
      navigation.replace("DriverTripFinished", { tripId });
    }
  }, [complete, navigation, tripId]);

  const onErrorAction = useCallback(
    (action: Exclude<OpsErrorAction, "none">) => {
      switch (action) {
        case "retry":
          if (start.error) void start.retry();
          else if (complete.error) void complete.retry();
          else void query.refetch();
          break;
        case "refresh":
          start.reset();
          complete.reset();
          void query.refetch();
          break;
        case "fixVehicle":
          openVehicle();
          break;
        case "openConsole":
          void query.refetch();
          break;
      }
    },
    [complete, openVehicle, query, start],
  );

  const onSharingAction = useCallback(
    (action: SharingAction) => {
      switch (action) {
        case "allow":
          sharing.allow();
          break;
        case "settings":
          sharing.openSettings();
          break;
        case "continue_without":
          sharing.continueWithout();
          break;
        case "resume":
          sharing.resume();
          break;
        case "retry":
          sharing.retry();
          break;
      }
    },
    [sharing],
  );

  const header = <ScreenHeader title={COPY.title} testID="DriverConsole.header" />;

  // ── Sin datos todavía ──────────────────────────────────────────────────────────────────────────────────────────────
  if (data === undefined) {
    if (query.isError || query.isOffline) {
      const error = describeOps(query.error);
      const closed = error.kind === "forbidden" || error.kind === "notFound" || error.kind === "conflict";
      return (
        <Screen testID="DriverConsole" paddingX={SCREEN_X} header={header}>
          <View style={styles.block}>
            <OpsErrorCard error={error} onAction={onErrorAction} testID="DriverConsole.error" />
            {closed ? <Button testID="DriverConsole.toTrips" label={COPY.states.goToTrips} variant="outline" chevron={false} onPress={openMyTrips} style={styles.gap} /> : null}
          </View>
        </Screen>
      );
    }
    return (
      <Screen testID="DriverConsole" paddingX={SCREEN_X} header={header}>
        <View style={styles.block}>
          <ConsoleSkeleton />
        </View>
      </Screen>
    );
  }

  return (
    <ConsoleBody
      data={data}
      receivedAtMs={receivedAtMs}
      now={now}
      online={online}
      refreshing={query.isRefreshing}
      failedToRefresh={query.failedToRefresh || query.isOffline}
      onRefresh={() => void query.refetch()}
      header={header}
      routePoints={routePoints}
      sharing={sharing}
      onSharingAction={onSharingAction}
      startError={startError}
      completeError={completeError}
      onErrorAction={onErrorAction}
      startPending={start.isPending}
      completePending={complete.isPending}
      dialog={dialog}
      setDialog={(next) => {
        if (next === "start") start.reset();
        if (next === "complete") complete.reset();
        setDialog(next);
      }}
      onConfirmStart={() => void confirmStart()}
      onConfirmComplete={() => void confirmComplete()}
      chatPendingFor={chat.pendingFor}
      onMessage={async (passengerUserId) => {
        const error = await chat.open(passengerUserId);
        if (error) showToast({ kind: "error", title: error.title, message: error.message, id: "driver-ops.chat" });
      }}
      onVerify={(bookingId) => navigation.navigate("PickupVerify", { tripId, bookingId })}
      onProposeRouteChange={() => navigation.navigate("ProposeRouteChange", { tripId })}
      onOpenProposal={() => navigation.navigate("ProposeRouteChange", { tripId })}
      onManage={() => navigation.navigate("DriverTripManage", { tripId })}
      onSummary={() => navigation.replace("DriverTripFinished", { tripId })}
      onToTrips={openMyTrips}
    />
  );
}

interface ConsoleBodyProps {
  data: LiveConsole;
  receivedAtMs: number;
  now: number;
  online: boolean;
  refreshing: boolean;
  failedToRefresh: boolean;
  onRefresh: () => void;
  header: React.ReactNode;
  routePoints: ReturnType<typeof routeOf>;
  sharing: ReturnType<typeof useDriverLocationSharing>;
  onSharingAction: (action: SharingAction) => void;
  startError: OpsErrorView | null;
  completeError: OpsErrorView | null;
  onErrorAction: (action: Exclude<OpsErrorAction, "none">) => void;
  startPending: boolean;
  completePending: boolean;
  dialog: DialogKind;
  setDialog: (dialog: DialogKind) => void;
  onConfirmStart: () => void;
  onConfirmComplete: () => void;
  chatPendingFor: string | null;
  onMessage: (passengerUserId: string) => Promise<void>;
  onVerify: (bookingId: string) => void;
  onProposeRouteChange: () => void;
  onOpenProposal: () => void;
  onManage: () => void;
  onSummary: () => void;
  onToTrips: () => void;
}

function ConsoleBody(props: ConsoleBodyProps): React.JSX.Element {
  const { data, receivedAtMs, now, sharing } = props;
  const serverNow = serverNowMs(data.serverTime, receivedAtMs, now);
  const age = positionAgeSeconds(data.position, receivedAtMs, now);
  const signal = effectiveSignal(data.signal, age);

  const banner = bannerFor(data);
  const next = nextPickup(data, serverNow);
  const rows = passengerRows(data, serverNow);
  const model = mapModel(data, signal === "stale");
  const proposal = routeChangeBanner(data);
  const card = sharingCard(sharing.status, { signal, ageText: age !== null ? formatAge(age, now) : null, sendFailed: sharing.sendFailed });
  const confirmed = confirmedCount(data);
  const scheduled = data.status === "published";
  const live = data.status === "published" || data.status === "active";

  const departureCard = useMemo(() => {
    if (!scheduled || !data.departureAt) return null;
    const minutes = Math.ceil((Date.parse(data.departureAt) - serverNow) / 60_000);
    return {
      time: formatTime(data.departureAt),
      detail: minutes > 0 ? COPY.departure.inMinutes(minutesLabel(minutes)) : COPY.departure.due,
    };
  }, [scheduled, data.departureAt, serverNow]);

  const openDirections = useCallback(async () => {
    if (!next) return;
    const target = data.passengers.find((p) => p.bookingId === next.bookingId)?.pickup.location;
    if (!target) return;
    const result = await openMapsDirections({ latitude: target.lat, longitude: target.lng, label: next.place });
    if (result !== "opened") showToast({ kind: "error", message: COPY.map.directionsFailed, id: "driver-ops.directions" });
  }, [data.passengers, next]);

  const proposeNote = !data.actions.canProposeRouteChange
    ? data.pendingRouteChange
      ? COPY.routeChange.proposeDisabledPending
      : live
        ? COPY.routeChange.proposeUnavailable
        : COPY.routeChange.proposeDisabledStatus
    : null;

  const footer = (() => {
    switch (data.status) {
      case "published":
        return (
          <Button
            testID="DriverConsole.start"
            label={COPY.actions.start}
            leadingIcon="navigate"
            disabled={!data.actions.canStart}
            loading={props.startPending}
            onPress={() => props.setDialog("start")}
          />
        );
      case "active":
        return (
          <Button
            testID="DriverConsole.complete"
            label={COPY.actions.complete}
            leadingIcon="flag"
            disabled={!data.actions.canComplete}
            loading={props.completePending}
            onPress={() => props.setDialog("complete")}
          />
        );
      case "completed":
        return <Button testID="DriverConsole.summary" label={COPY.actions.summary} onPress={props.onSummary} />;
      case "cancelled":
        return <Button testID="DriverConsole.toTrips" label={COPY.actions.backToTrips} onPress={props.onToTrips} />;
    }
  })();

  const messageable = (state: (typeof rows)[number]["state"]): boolean => state === "waiting" || state === "picked" || state === "code_locked" || state === "code_missing";

  return (
    <Screen
      testID="DriverConsole"
      paddingX={SCREEN_X}
      header={props.header}
      footer={footer}
      refreshing={props.refreshing}
      onRefresh={props.onRefresh}
    >
      <View style={styles.block}>
        {props.failedToRefresh ? (
          <OfflineBanner
            testID="DriverConsole.offline"
            title={opsStrings.common.offlineTitle}
            detail={opsStrings.common.offlineDetail}
            retryLabel={opsStrings.common.retry}
            onRetry={props.onRefresh}
            style={styles.bottomGap}
          />
        ) : null}
        {props.startError ? (
          <OpsErrorCard
            testID="DriverConsole.startError"
            error={props.startError.vehicleIssue ? { ...props.startError, title: COPY.startBlocked.title } : props.startError}
            icon={props.startError.vehicleIssue ? "car" : undefined}
            onAction={props.onErrorAction}
          />
        ) : null}
        {props.completeError ? <OpsErrorCard testID="DriverConsole.completeError" error={props.completeError} onAction={props.onErrorAction} /> : null}

        <Banner
          testID="DriverConsole.banner"
          kind={banner.kind}
          icon={banner.phase === "active" || banner.phase === "scheduled" ? "car" : undefined}
          tileTone={banner.phase === "active" || banner.phase === "scheduled" ? "blue" : undefined}
          tileSize={48}
          titleSize={20}
          messageSize={17.5}
          title={banner.title}
          message={banner.message}
          style={styles.banner}
        />

        {next ? (
          <EtaHeroCard
            testID="DriverConsole.next"
            label={COPY.next.eyebrow}
            time={next.eta ? next.eta.time : "--:--"}
            detail={next.eta ? COPY.next.minutesAndDistance(next.eta.minutesText, next.eta.distanceText) : COPY.next.noEta}
            caption={COPY.next.toPickup(next.passenger.firstName, next.place)}
            note={next.eta?.approximate ? COPY.next.approximate : null}
            accessibilityLabel={`${COPY.next.eyebrow}: ${next.passenger.firstName}, ${next.place}${next.eta ? `, ${next.eta.time}` : ""}`}
          />
        ) : departureCard ? (
          <EtaHeroCard
            testID="DriverConsole.departure"
            label={COPY.departure.eyebrow}
            time={departureCard.time}
            detail={departureCard.detail}
            caption={COPY.departure.passengers(confirmed)}
            accessibilityLabel={`${COPY.departure.eyebrow}: ${departureCard.time}. ${departureCard.detail}`}
          />
        ) : data.status === "active" ? (
          <Banner
            testID="DriverConsole.noNext"
            kind="success"
            size="sm"
            icon="checkCircle"
            title={data.counts.total === 0 ? COPY.next.noPassengersTitle : COPY.next.allAboardTitle}
            message={data.counts.total === 0 ? COPY.next.noPassengersMessage : COPY.next.allAboardMessage}
          />
        ) : null}
      </View>

      <View style={styles.bleed}>
        <ConsoleMap
          model={model}
          route={props.routePoints}
          fitKey={`${data.tripId}:${model.pickups.length}:${model.car ? 1 : 0}`}
          height={MAP_HEIGHT}
        />
      </View>

      <View style={styles.block}>
        {data.status === "active" ? (
          <>
            <UpdateStrip
              signal={data.signal}
              position={data.position}
              receivedAtMs={receivedAtMs}
              caption={card.ok ? card.detail : null}
              simulated={sharing.simulated}
            />
            <SharingCard model={card} onAction={props.onSharingAction} />
          </>
        ) : null}

        {next ? (
          <Button
            testID="DriverConsole.directions"
            label={COPY.map.directions}
            accessibilityLabel={COPY.map.directionsTo(next.place)}
            variant="outline"
            leadingIcon="navigate"
            onPress={() => void openDirections()}
            style={styles.gap}
          />
        ) : null}

        {proposal ? (
          <Banner
            testID="DriverConsole.proposal"
            kind="info"
            icon="route"
            title={COPY.routeChange.bannerTitle}
            message={proposal.expires ? `${proposal.message} · ${proposal.expires}` : proposal.message}
            chevron
            onPress={props.onOpenProposal}
            accessibilityLabel={`${COPY.routeChange.bannerTitle}. ${proposal.message}. ${COPY.routeChange.open}`}
            style={styles.gap}
          />
        ) : null}

        <SectionHeader
          testID="DriverConsole.passengersHeader"
          title={COPY.passengers.title}
          caption={data.counts.total > 0 && data.status !== "published" ? passengerCounter(data) : undefined}
          style={styles.section}
        />
        {rows.length === 0 ? (
          <View testID="DriverConsole.noPassengers" style={styles.empty}>
            <Text variant="rowTitle" color="heading" size={18} align="center">
              {COPY.passengers.empty}
            </Text>
            <Text variant="body" color="muted" size={16} lineHeight={21} align="center" style={styles.emptyText}>
              {COPY.passengers.emptyDetail}
            </Text>
          </View>
        ) : (
          rows.map((row) => (
            <View key={row.bookingId} style={styles.passenger}>
              <PassengerCard
                testID={`DriverConsole.passenger.${row.bookingId}`}
                row={row}
                onVerify={() => props.onVerify(row.bookingId)}
                {...(messageable(row.state) ? { onMessage: () => void props.onMessage(row.passenger.id) } : {})}
                messageBusy={props.chatPendingFor === row.passenger.id}
              />
            </View>
          ))
        )}

        {live ? (
          <View style={styles.section}>
            <Button
              testID="DriverConsole.propose"
              label={COPY.routeChange.propose}
              variant="outline"
              leadingIcon="pin"
              disabled={!data.actions.canProposeRouteChange}
              onPress={props.onProposeRouteChange}
            />
            {proposeNote ? (
              <Text testID="DriverConsole.proposeNote" variant="rowText" color="muted" size={14.5} lineHeight={18} align="center" style={styles.note}>
                {proposeNote}
              </Text>
            ) : null}
          </View>
        ) : null}

        {scheduled ? (
          <Button testID="DriverConsole.manage" label={COPY.actions.manage} variant="tint" onPress={props.onManage} style={styles.gap} />
        ) : null}
      </View>

      <ConfirmDialog
        testID="DriverConsole.startDialog"
        visible={props.dialog === "start"}
        icon="navigate"
        title={COPY.startDialog.title}
        message={`${COPY.startDialog.message(confirmed)}\n\n${COPY.startDialog.foreground}`}
        confirmLabel={COPY.startDialog.confirm}
        cancelLabel={COPY.startDialog.cancel}
        loading={props.startPending}
        onConfirm={props.onConfirmStart}
        onCancel={() => props.setDialog(null)}
      />
      <ConfirmDialog
        testID="DriverConsole.completeDialog"
        visible={props.dialog === "complete"}
        icon="flag"
        title={COPY.completeDialog.title}
        message={data.actions.willMarkNoShow > 0 ? COPY.completeDialog.messageNoShow(data.actions.willMarkNoShow) : COPY.completeDialog.messageAll}
        confirmLabel={COPY.completeDialog.confirm}
        cancelLabel={COPY.completeDialog.cancel}
        destructive={data.actions.willMarkNoShow > 0}
        loading={props.completePending}
        onConfirm={props.onConfirmComplete}
        onCancel={() => props.setDialog(null)}
      />
    </Screen>
  );
}

/** «48 min» · «1 h 5 min» (la duración la formatea `@/i18n` en el resto de la app; aquí ya viene en minutos enteros). */
function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

const styles = StyleSheet.create({
  block: { paddingTop: 4 },
  bleed: { marginHorizontal: -SCREEN_X, marginTop: 8 },
  gap: { marginTop: 8 },
  bottomGap: { marginBottom: 8 },
  banner: { marginBottom: 8 },
  section: { marginTop: 16 },
  passenger: { marginTop: 10 },
  note: { marginTop: 6 },
  empty: { marginTop: 10, borderRadius: 14, backgroundColor: colors.empty.bg, paddingVertical: 20, paddingHorizontal: 20 },
  emptyText: { marginTop: 4 },
});
