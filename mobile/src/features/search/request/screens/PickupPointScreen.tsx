/**
 * 13a/13b · Punto de recogida. Mapa con la ruta del conductor y los puntos propuestos (A, B) y, debajo, las tarjetas para
 * elegir uno. El servidor propone y ordena los puntos (`GET /v1/trips/:id/pickup-points`, requiere sesión): minutos a pie,
 * desvío y «A 6 km de tu destino» salen de él. Elegir un punto lleva a «Tu plaza semanal» (14) si la búsqueda era semanal o
 * a «Revisa tu solicitud» (15) si era de un día.
 *
 * Estados: cargando (esqueleto), sin conexión / error (reintentar), sin cuenta (invitación a crearla; la ruta del conductor
 * sí se ve), sin punto de partida (preguntar desde dónde sale: ubicación del móvil o buscar un lugar), sin propuestas, viaje
 * no solicitable (propio, completo, cerrado, ya solicitado).
 *
 * Parámetros: `tripId`, `criteria?` (la búsqueda), `dropoffStopSeq?`, `origin?` (punto de partida; por defecto el de la
 * búsqueda).
 */
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MapPoint } from "@/maps/types";
import { requireAccount, type AppScreenProps } from "@/navigation";
import { useAuth } from "@/session";
import { colors } from "@/theme";
import { Banner, Button, ErrorStateCard, OfflineBanner, Screen, ScreenHeader, Text } from "@/ui";
import type { PlaceParam } from "../../routes";
import { usePlaceResult } from "../../browse/hooks/usePlaceResult";
import { PickupMap } from "../components/PickupMap";
import { OriginCard } from "../components/OriginCard";
import { PickupSkeleton } from "../components/PickupSkeleton";
import { ProblemCard } from "../components/ProblemCard";
import { ProposalCard } from "../components/ProposalCard";
import { GuestCard } from "../components/GuestCard";
import { useOriginPlace } from "../hooks/useOriginPlace";
import { usePickupPoints } from "../hooks/usePickupPoints";
import { useTripDetail } from "../hooks/useTripDetail";
import {
  buildPickupMap,
  buildRouteOnlyMap,
  initialSelection,
  locationProblem,
  summaryOf,
  toProposalViews,
  type PickupMapModel,
} from "../logic/pickup";
import { blockFromReason } from "../logic/reviewModel";
import { requestStrings } from "../strings";

const copy = requestStrings.pickup;
const common = requestStrings.common;

/** Radio de las esquinas de la hoja (el mapa se extiende por debajo de ellas). */
const PANEL_RADIUS = 22;
const NO_MAP: PickupMapModel = { markers: [], routes: [], focus: [] };

export function PickupPointScreen({ navigation, route }: AppScreenProps<"PickupPoint">): React.JSX.Element {
  const { tripId, criteria } = route.params;
  const dropoffStopSeq = route.params.dropoffStopSeq ?? null;
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const trip = useTripDetail(tripId);

  // Punto de partida: el que llega por parámetro o el elegido en el buscador; si no, el de la búsqueda.
  const [pickedOrigin, setPickedOrigin] = useState<PlaceParam | null>(null);
  usePlaceResult("origin", setPickedOrigin);
  const origin: PlaceParam | null = pickedOrigin ?? criteria?.origin ?? null;
  const originPoint = useMemo<MapPoint | null>(() => (origin === null ? null : { lat: origin.latitude, lng: origin.longitude }), [origin]);

  const signedIn = auth.isSignedIn;
  const pickups = usePickupPoints(tripId, originPoint, dropoffStopSeq, signedIn && trip.data !== undefined);
  const views = useMemo(() => toProposalViews(pickups.data?.proposals ?? []), [pickups.data]);

  const [chosenId, setChosenId] = useState<string | null>(null);
  const selectedId = chosenId !== null && views.some((v) => v.id === chosenId) ? chosenId : initialSelection(views, null);
  const selected = views.find((v) => v.id === selectedId) ?? null;

  // Ubicación del móvil: sirve de punto de partida (si falta) y para el botón «centrar en mi ubicación» del mapa.
  const device = useOriginPlace();
  const [userPoint, setUserPoint] = useState<MapPoint | null>(null);

  const geometry = trip.data?.route.geometry.coordinates;
  const mapModel = useMemo<PickupMapModel>(() => {
    if (geometry === undefined) return NO_MAP;
    if (views.length === 0) return buildRouteOnlyMap(geometry);
    return buildPickupMap({ geometry, views, selectedId, origin: originPoint });
  }, [geometry, views, selectedId, originPoint]);
  const fitKey = `${tripId}|${selectedId ?? "-"}|${views.length}|${originPoint === null ? "-" : `${originPoint.lat.toFixed(4)},${originPoint.lng.toFixed(4)}`}`;

  const searchOrigin = useCallback(() => {
    navigation.navigate("PlaceSearch", {
      field: "place",
      title: copy.originSearchTitle,
      returnTo: { route: "PickupPoint", param: "origin" },
      ...(origin !== null ? { current: origin } : {}),
    });
  }, [navigation, origin]);

  const useMyLocation = useCallback(async () => {
    const place = await device.locate();
    if (place !== null) setPickedOrigin(place);
  }, [device]);

  const recenter = useCallback(async () => {
    const place = await device.locate();
    if (place !== null) setUserPoint({ lat: place.latitude, lng: place.longitude });
  }, [device]);

  const createAccount = useCallback(() => {
    requireAccount({ name: "PickupPoint", params: route.params });
  }, [route.params]);

  const refetchAll = useCallback(() => {
    void trip.refetch();
    void pickups.refetch();
  }, [trip, pickups]);

  const openRequestId = trip.data?.viewer.openRequest?.id ?? null;
  const mode = criteria?.mode ?? (trip.data?.kind === "recurring" ? "weekly" : "one_off");
  const reason = trip.data?.canRequest === false ? trip.data.cannotRequestReason : null;
  const block = signedIn ? blockFromReason(mode === "weekly" && reason === "NO_CAPACITY" ? null : reason, openRequestId) : null;

  const choose = useCallback(() => {
    if (!requireAccount({ name: "PickupPoint", params: route.params })) return;
    if (selected === null || block !== null) return;
    const next = {
      tripId,
      pickupPointId: selected.id,
      pickup: summaryOf(selected),
      ...(criteria !== undefined ? { criteria } : {}),
      ...(dropoffStopSeq !== null ? { dropoffStopSeq } : {}),
    };
    if (mode === "weekly") navigation.navigate("WeeklySeat", next);
    else navigation.navigate("ReviewRequest", next);
  }, [route.params, selected, block, tripId, criteria, dropoffStopSeq, mode, navigation]);

  const openExistingRequest = useCallback(() => {
    if (openRequestId !== null) navigation.navigate("RequestStatusPayment", { requestId: openRequestId });
  }, [navigation, openRequestId]);

  const exitToSearch = useCallback(() => navigation.navigate("MapHome"), [navigation]);

  // ── Hoja inferior ──────────────────────────────────────────────────────────────────────────────────────────────────
  const stale = (pickups.failedToRefresh || trip.failedToRefresh || pickups.isOffline) && views.length > 0;
  const sheetMaxHeight = Math.round(windowHeight * 0.55);

  let body: React.ReactNode;
  let cta: React.ReactNode = null;

  if (!signedIn) {
    body = (
      <>
        <Text variant="heading" color="strong" size={19} lineHeight={24} style={styles.title} accessibilityRole="header">
          {copy.panelTitle}
        </Text>
        <GuestCard onCreateAccount={createAccount} testID="PickupPoint.guest" />
      </>
    );
    cta = <Button label={common.guestAction} onPress={createAccount} style={styles.cta} testID="PickupPoint.createAccount" />;
  } else if (origin === null) {
    body = (
      <OriginCard
        status={device.status}
        onUseLocation={() => void useMyLocation()}
        onSearch={searchOrigin}
        onOpenSettings={device.openSettings}
        testID="PickupPoint.origin"
      />
    );
  } else if (pickups.isLoading || (pickups.data === undefined && !pickups.isError && !pickups.isOffline)) {
    body = (
      <>
        <Text variant="heading" color="strong" size={19} lineHeight={24} style={styles.title} accessibilityRole="header">
          {copy.panelTitle}
        </Text>
        <PickupSkeleton />
      </>
    );
    cta = <Button label={copy.choose} disabled style={styles.cta} testID="PickupPoint.choose" />;
  } else if (pickups.data === undefined) {
    body = (
      <ProblemCard
        error={pickups.error}
        offline={pickups.isOffline}
        onRetry={refetchAll}
        exitLabel={common.seeOtherTrips}
        onExit={exitToSearch}
        testID="PickupPoint.problem"
      />
    );
  } else if (views.length === 0) {
    body = (
      <ErrorStateCard
        tone="amber"
        icon="pin"
        iconTone="solidAmber"
        title={copy.emptyTitle}
        message={copy.emptyMessage}
        actionLabel={copy.emptyAction}
        onAction={searchOrigin}
        testID="PickupPoint.empty"
      />
    );
  } else {
    const locationIssue = locationProblem(device.status);
    body = (
      <>
        <Text variant="heading" color="strong" size={19} lineHeight={24} style={styles.title} accessibilityRole="header">
          {copy.panelTitle}
        </Text>
        {pickedOrigin !== null || criteria === undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${copy.originFrom(origin.label)}. ${copy.originChange}`}
            onPress={searchOrigin}
            style={styles.originRow}
            testID="PickupPoint.changeOrigin"
          >
            <Text variant="body" color="muted" size={16} lineHeight={20} numberOfLines={1} style={styles.originText}>
              {copy.originFrom(origin.label)}
            </Text>
            <Text variant="rowTextStrong" color="link" underline size={16} lineHeight={20}>
              {copy.originChangeShort}
            </Text>
          </Pressable>
        ) : null}
        {stale ? (
          <OfflineBanner
            title={common.offlineTitle}
            detail={common.staleDetail}
            retryLabel={common.retry}
            onRetry={refetchAll}
            testID="PickupPoint.offline"
            style={styles.gapBottom}
          />
        ) : null}
        <View style={styles.cards} accessibilityRole="radiogroup">
          {views.map((view, index) => (
            <ProposalCard
              key={view.id}
              view={view}
              tone={index === 0 ? "blue" : "green"}
              selected={view.id === selectedId}
              onPress={() => setChosenId(view.id)}
              testID={`PickupPoint.proposal.${view.code}`}
            />
          ))}
        </View>
        {block !== null ? (
          <Banner
            kind="error"
            size="xs"
            title={requestStrings.review.blockedTitle}
            message={block.message}
            actionLabel={block.kind === "openRequest" && openRequestId !== null ? requestStrings.review.openRequestAction : undefined}
            onAction={block.kind === "openRequest" && openRequestId !== null ? openExistingRequest : undefined}
            style={styles.gapTop}
            testID="PickupPoint.blocked"
          />
        ) : null}
        {locationIssue !== null ? (
          <Banner kind="notice" size="xs" title={locationIssue.title} message={locationIssue.message} style={styles.gapTop} testID="PickupPoint.locationIssue" />
        ) : null}
        <Banner
          kind="info"
          size="md"
          tileSize={39}
          style={styles.gapTop}
          accessibilityLabel={pickups.data.safetyNotice !== "" ? pickups.data.safetyNotice : copy.safetyFallback}
          testID="PickupPoint.safety"
        >
          <Text variant="body" color="deep" size={17.5} lineHeight={21} letterSpacing={-0.2}>
            {pickups.data.safetyNotice !== "" ? pickups.data.safetyNotice : copy.safetyFallback}
          </Text>
        </Banner>
      </>
    );
    cta = <Button label={copy.choose} disabled={selected === null || block !== null} onPress={choose} style={styles.cta} testID="PickupPoint.choose" />;
  }

  // ── Pantalla ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const header = <ScreenHeader title={copy.title} testID="PickupPoint.header" />;

  if (trip.data === undefined) {
    return (
      <Screen testID="PickupPoint" header={header} padded>
        {trip.isLoading ? (
          <PickupSkeleton />
        ) : (
          <ProblemCard
            error={trip.error}
            offline={trip.isOffline}
            onRetry={() => void trip.refetch()}
            exitLabel={common.seeOtherTrips}
            onExit={exitToSearch}
            testID="PickupPoint.problem"
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen testID="PickupPoint" scroll={false} padded={false} header={header}>
      <View style={styles.body}>
        <PickupMap
          model={mapModel}
          fitKey={fitKey}
          userLocation={userPoint}
          onRecenter={() => void recenter()}
          bottomOverlap={PANEL_RADIUS}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 25) }]} testID="PickupPoint.sheet">
          <ScrollView
            style={{ flexGrow: 0, maxHeight: sheetMaxHeight }}
            contentContainerStyle={styles.sheetContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {body}
          </ScrollView>
          {cta}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  sheet: {
    marginTop: -PANEL_RADIUS,
    borderTopLeftRadius: PANEL_RADIUS,
    borderTopRightRadius: PANEL_RADIUS,
    backgroundColor: colors.bg.screen,
    paddingTop: 8,
    paddingHorizontal: 15,
    boxShadow: "0px -2px 10px rgba(10, 18, 80, 0.08)",
  },
  sheetContent: { paddingBottom: 0 },
  title: { marginLeft: 5, marginBottom: 6 },
  cards: { gap: 3 },
  gapTop: { marginTop: 11 },
  gapBottom: { marginBottom: 8 },
  cta: { marginTop: 11, height: 60 },
  originRow: { flexDirection: "row", alignItems: "center", minHeight: 44, marginLeft: 5, marginTop: -4, gap: 10 },
  originText: { flexShrink: 1 },
});
