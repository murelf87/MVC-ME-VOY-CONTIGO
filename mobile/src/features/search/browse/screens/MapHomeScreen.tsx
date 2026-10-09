/**
 * Mapa de inicio — lámina 09 «Coches en tu provincia». La pantalla principal de la app.
 *
 *  - Mapa de la provincia con los coches que salen pronto, en posición APROXIMADA (nunca el punto exacto) y con sus plazas
 *    («2 plazas», «1 plaza», «Completo» en gris). Los coches muy juntos se agrupan en un número que se desagrupa al acercar.
 *  - Provincia activa (se recuerda), «Busco coche | Ofrezco plazas», categorías, buscador «¿A dónde vas?» y filtro de plazas.
 *  - Barra inferior Mapa · Viajes · Publicar · Mensajes · Perfil (solo aquí; las otras pantallas se empujan con «atrás»).
 *  - Un invitado explora todo; ofrecer plazas, Viajes, Mensajes y Perfil piden cuenta (`requireAccount` / `openTarget`).
 *
 * Estados: cargando · sin provincias · error (con «Reintentar») · sin conexión (con o sin datos de antes) · lista recortada ·
 * sin coches (con o sin filtros) · sin permiso de ubicación (permitir / ajustes / reintentar) · fuera de provincia.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { MapCar } from "@/api/types";
import { MvcMap, regionForZoom, zoomForRegion } from "@/maps";
import type { MapMarkerSpec, MapPoint, MapRegion, MvcMapHandle, RegionChangeMeta } from "@/maps";
import { openTarget, requireAccount, type AppScreenProps } from "@/navigation";
import { useAuth } from "@/session";
import { BottomNav, ConfirmDialog, Screen, type BottomNavKey } from "@/ui";
import { BrowseHeader } from "../components/BrowseHeader";
import { CarPanel } from "../components/CarPanel";
import { MapAlert } from "../components/MapAlert";
import { MapControls, type MapRole } from "../components/MapControls";
import { MapFilterSheet, type MapFilterChoice } from "../components/MapFilterSheet";
import { MapNoticeView, MapOverlayView, MapPill } from "../components/MapStateCards";
import { ProvinceSheet } from "../components/ProvinceSheet";
import { useExploreCategory } from "../hooks/useExploreCategory";
import { useMapCars } from "../hooks/useMapCars";
import { useMapLocation } from "../hooks/useMapLocation";
import { useProvinces } from "../hooks/useProvinces";
import { locateProblem } from "../logic/locate";
import {
  DEFAULT_WITHIN_HOURS,
  filterLabel,
  findGroup,
  groupCars,
  groupMarkers,
  groupTapAction,
  hasFilterChanges,
  sortedForPanel,
  toggleCategory,
  zoomTargetForCluster,
  type MapFilter,
} from "../logic/mapCars";
import { deriveMapView } from "../logic/mapView";
import { DEFAULT_PROVINCE_REGION, provinceRegion } from "../logic/provinceView";
import { browseStrings } from "../strings";

const copy = browseStrings.mapHome;

const DEFAULT_CHOICE: MapFilterChoice = { onlyWithSeats: false, withinHours: DEFAULT_WITHIN_HOURS };
/** Alto de la barra inferior hasta que se mide (iPhone con isla: 76 pt en la lámina). */
const NAV_HEIGHT_ESTIMATE = 76;
/** Zoom con el que se centra el mapa en la persona (se ven calles, no solo el municipio). */
const LOCATE_ZOOM = 14;

const roundZoom = (zoom: number): number => Math.round(zoom * 4) / 4;

export function MapHomeScreen({ navigation }: AppScreenProps<"MapHome">): React.JSX.Element {
  const auth = useAuth();
  const provinces = useProvinces();
  const province = provinces.province;
  const [category, setCategory] = useExploreCategory();
  const [choice, setChoice] = useState<MapFilterChoice>(DEFAULT_CHOICE);
  const filter = useMemo<MapFilter>(() => ({ ...choice, category }), [choice, category]);
  const cars = useMapCars(province?.id ?? null, filter);
  const location = useMapLocation();

  const view = useMemo(
    () =>
      deriveMapView({
        provinces: { isLoading: provinces.isLoading, isError: provinces.isError, isOffline: provinces.isOffline, count: provinces.provinces.length },
        hasProvince: province !== null,
        cars: {
          data: cars.data,
          isLoading: cars.isLoading,
          isError: cars.isError,
          isOffline: cars.isOffline,
          failedToRefresh: cars.failedToRefresh,
          error: cars.error,
        },
        filter,
      }),
    [provinces.isLoading, provinces.isError, provinces.isOffline, provinces.provinces.length, province, cars.data, cars.isLoading, cars.isError, cars.isOffline, cars.failedToRefresh, cars.error, filter],
  );

  // ── Mapa: encuadre, zoom, agrupación y panel ───────────────────────────────────────────────────────────────────────
  const mapRef = useRef<MvcMapHandle>(null);
  const [mapSize, setMapSize] = useState({ width: 393, height: 419 });
  const [navHeight, setNavHeight] = useState(NAV_HEIGHT_ESTIMATE);
  const initialRegion = useRef<MapRegion>(provinceRegion(province) ?? DEFAULT_PROVINCE_REGION).current;
  const [zoom, setZoom] = useState(() => roundZoom(zoomForRegion(initialRegion, 393)));
  const [panelId, setPanelId] = useState<string | null>(null);
  const skipProvinceMove = useRef(false);

  const groups = useMemo(() => groupCars(cars.cars, zoom), [cars.cars, zoom]);
  const markers = useMemo(() => groupMarkers(groups), [groups]);
  const panelGroup = useMemo(() => findGroup(groups, panelId), [groups, panelId]);
  const panelCars = useMemo(() => (panelGroup === null ? [] : sortedForPanel(panelGroup.cars)), [panelGroup]);
  const nowMs = useMemo(() => Date.now(), [cars.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al cambiar de provincia el mapa vuela a su encuadre (salvo que ya lo mueva «Centrar en mi ubicación»).
  const shownProvince = useRef<string | null>(null);
  const provinceId = province?.id ?? null;
  useEffect(() => {
    if (provinceId === null || shownProvince.current === provinceId) return;
    const first = shownProvince.current === null;
    shownProvince.current = provinceId;
    setPanelId(null);
    if (skipProvinceMove.current) {
      skipProvinceMove.current = false;
      return;
    }
    const target = provinceRegion(province);
    if (target !== null) mapRef.current?.animateTo(target, { durationMs: first ? 0 : 500 });
  }, [provinceId, province]);

  const onRegionChange = useCallback(
    (region: MapRegion, meta: RegionChangeMeta) => {
      if (meta.settled) setZoom(roundZoom(zoomForRegion(region, mapSize.width)));
    },
    [mapSize.width],
  );

  const onMarkerPress = useCallback(
    (marker: MapMarkerSpec) => {
      const group = findGroup(groups, marker.id);
      if (group === null) return;
      if (groupTapAction(group, zoom) === "zoom") {
        setPanelId(null);
        mapRef.current?.animateTo(regionForZoom(group.center, zoomTargetForCluster(zoom), mapSize));
        return;
      }
      setPanelId(group.id);
    },
    [groups, zoom, mapSize],
  );

  const recenter = useCallback(async () => {
    setPanelId(null);
    const result = await location.locate();
    if (result === null) return;
    if (result.provinceChanged) skipProvinceMove.current = true;
    mapRef.current?.animateTo(regionForZoom(result.point, LOCATE_ZOOM, mapSize));
  }, [location, mapSize]);

  const resetMapView = useCallback(() => {
    setPanelId(null);
    const target = provinceRegion(province);
    if (target !== null) mapRef.current?.animateTo(target);
    else mapRef.current?.fitToContent();
  }, [province]);

  // ── Acciones ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const [provinceOpen, setProvinceOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);

  const offerSeats = useCallback(() => {
    if (!auth.isSignedIn) {
      setOfferOpen(true);
      return;
    }
    auth.setActiveRole("driver");
    openTarget({ name: "PublishRoute" });
  }, [auth]);

  const onRole = useCallback(
    (next: MapRole) => {
      if (next === "offering") {
        offerSeats();
        return;
      }
      if (auth.isSignedIn && auth.activeRole === "driver") auth.setActiveRole("passenger");
    },
    [auth, offerSeats],
  );

  const onTab = useCallback(
    (key: BottomNavKey) => {
      switch (key) {
        case "map":
          resetMapView();
          return;
        case "trips":
          openTarget({ name: "MyTrips" });
          return;
        case "publish":
          offerSeats();
          return;
        case "messages":
          openTarget({ name: "Inbox" });
          return;
        case "profile":
          openTarget({ name: "MyProfile" });
          return;
      }
    },
    [offerSeats, resetMapView],
  );

  const openTrip = useCallback(
    (car: MapCar) => {
      navigation.navigate("TripDetail", { tripId: car.tripId });
    },
    [navigation],
  );

  const defineRoute = useCallback(() => {
    navigation.navigate("DefineRoute", category !== null ? { category } : undefined);
  }, [navigation, category]);

  const clearFilters = useCallback(() => {
    setChoice(DEFAULT_CHOICE);
    setCategory(null);
    setPanelId(null);
  }, [setCategory]);

  const problem = locateProblem(location.status, copy);
  const role: MapRole = auth.isSignedIn && auth.activeRole === "driver" ? "offering" : "seeking";
  const provinceName = province?.name ?? null;
  const locating = location.isLocating;
  const showNotice = view.notice.kind !== "none";

  return (
    <Screen
      testID="MapHome"
      scroll={false}
      padded={false}
      topInset={false}
      header={<BrowseHeader title={copy.title} hideBack testID="MapHome.header" />}
    >
      <MapControls
        provinceName={provinceName}
        onProvince={() => setProvinceOpen(true)}
        role={role}
        onRole={onRole}
        category={category}
        onCategory={(picked) => {
          setCategory(toggleCategory(category, picked));
          setPanelId(null);
        }}
        filterLabel={filterLabel(filter)}
        filterActive={hasFilterChanges(filter)}
        onFilter={() => setFilterOpen(true)}
        onSearch={() => navigation.navigate("PlaceSearch", { field: "destination" })}
      />

      <View style={styles.mapArea} onLayout={(event) => setMapSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
        <MvcMap
          ref={mapRef}
          testID="MapHome.map"
          style={styles.map}
          accessibilityLabel={provinceName !== null ? copy.mapA11y(provinceName) : copy.mapA11yFallback}
          initialRegion={initialRegion}
          fit={provinceId !== null && provinceRegion(province) === null ? "content" : undefined}
          fitKey={provinceId ?? undefined}
          edgePadding={{ bottom: navHeight }}
          markers={markers}
          selectedMarkerId={panelGroup?.id ?? null}
          onMarkerPress={onMarkerPress}
          onMapPress={() => setPanelId(null)}
          onRegionChange={onRegionChange}
          userLocation={location.position !== null ? { lat: location.position.latitude, lng: location.position.longitude } : null}
          userAccuracyM={location.position?.accuracyM ?? undefined}
          recenter
          onRecenter={() => void recenter()}
        >
          <View style={styles.top}>
            {locating ? <MapPill label={browseStrings.place.locating} testID="MapHome.locating" /> : <MapOverlayView overlay={view.overlay} onRetryProvinces={provinces.refetch} onRetryCars={cars.refetch} onDefineRoute={defineRoute} onClearFilters={clearFilters} />}
            {problem !== null ? (
              <MapAlert
                tone={problem.needsSettings ? "notice" : "warning"}
                icon="locate"
                title={problem.title}
                message={problem.message}
                actionLabel={problem.canAllow ? copy.allowLocation : problem.needsSettings ? copy.openSettings : copy.retry}
                onAction={problem.needsSettings ? location.openSettings : () => void recenter()}
                onDismiss={location.dismissProblem}
                dismissLabel={copy.dismiss}
                testID="MapHome.locationProblem"
              />
            ) : null}
            {location.outsideProvince ? (
              <MapAlert
                tone="info"
                icon="pin"
                title={copy.locationOutsideTitle}
                message={copy.locationOutsideMessage(provinceName ?? "")}
                onDismiss={location.dismissOutside}
                dismissLabel={copy.dismiss}
                testID="MapHome.outside"
              />
            ) : null}
            {showNotice ? <MapNoticeView notice={view.notice} onRetry={cars.refetch} /> : null}
          </View>

          {panelGroup !== null ? (
            <CarPanel
              cars={panelCars}
              nowMs={nowMs}
              onOpenTrip={openTrip}
              onClose={() => setPanelId(null)}
              style={[styles.panel, { bottom: navHeight + 10 }]}
            />
          ) : null}

          <View style={styles.nav} onLayout={(event) => setNavHeight(Math.round(event.nativeEvent.layout.height))}>
            <BottomNav active="map" onNavigate={onTab} style={styles.navBar} />
          </View>
        </MvcMap>
      </View>

      <ProvinceSheet
        visible={provinceOpen}
        provinces={provinces.provinces}
        selectedId={provinceId}
        onSelect={(id) => {
          provinces.select(id);
          setProvinceOpen(false);
        }}
        onClose={() => setProvinceOpen(false)}
      />
      <MapFilterSheet
        visible={filterOpen}
        value={choice}
        onApply={(next) => {
          setChoice(next);
          setFilterOpen(false);
          setPanelId(null);
        }}
        onClose={() => setFilterOpen(false)}
      />
      <ConfirmDialog
        visible={offerOpen}
        title={copy.offerTitle}
        message={copy.offerMessage}
        confirmLabel={copy.offerCreate}
        cancelLabel={browseStrings.common.keepExploring}
        icon="car"
        onConfirm={() => {
          setOfferOpen(false);
          requireAccount({ name: "PublishRoute" });
        }}
        onCancel={() => setOfferOpen(false)}
        testID="MapHome.offerDialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  mapArea: { flex: 1, overflow: "hidden" },
  map: { flex: 1 },
  top: { position: "absolute", top: 10, left: 12, right: 12, gap: 8, pointerEvents: "box-none" },
  panel: { position: "absolute", left: 12, right: 12 },
  nav: { position: "absolute", left: 0, right: 0, bottom: 0 },
  /** La barra de la lámina 09 empieza ≈ 6 pt más arriba que la del sistema de diseño, con los iconos y etiquetas en el mismo sitio. */
  navBar: { paddingTop: 14 },
});
