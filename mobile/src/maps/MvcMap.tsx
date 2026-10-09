/**
 * `MvcMap`: el mapa de MVC. UNA sola implementación sobre la API de react-native-maps:
 *  - iOS: Apple Maps (`mutedStandard`, tonos suaves como las láminas).
 *  - Android: Google Maps con `customMapStyle` claro (`MVC_MAP_STYLE_LIGHT`).
 *  - Web (vista previa): Metro sustituye `react-native-maps` por `mobile/web-stubs/react-native-maps.js`, que dibuja un
 *    mapa vectorial ILUSTRATIVO de Sevilla con la misma API. Este archivo no sabe en qué plataforma está.
 *
 * El mapa no hace red ni guarda datos: recibe marcadores/rutas ya resueltos por la pantalla.
 */
import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type LatLng, type Region } from 'react-native-maps';
import { fitBounds, isValidPoint, normalizePadding, regionForZoom, SEVILLA_REGION, validPoints } from './geo';
import { MarkerView } from './MarkerView';
import { accessibilityLabelOf, defaultZIndex, layoutMarker, type MarkerLayout } from './markerLayout';
import { MVC_MAP_STYLE_LIGHT } from './mapStyle';
import { MAP_COLORS, ROUTE_STYLE } from './mapTheme';
import { RecenterButton } from './RecenterButton';
import type { EdgePadding, MapMarkerSpec, MapPoint, MapRegion, MapRouteSpec, MvcMapHandle, MvcMapProps } from './types';

const EMPTY_MARKERS: readonly MapMarkerSpec[] = [];
const EMPTY_ROUTES: readonly MapRouteSpec[] = [];
const DEFAULT_BASE_PADDING = 28;
/** Margen extra alrededor de los marcadores al encuadrar (pt). */
const MARKER_BREATHING = 8;
/** Tiempo que un marcador sigue «rastreando cambios de vista» tras dibujarse (Android rasteriza hijos del Marker). */
const TRACK_MS = 900;
/** Margen del botón «centrar» respecto al borde visible (pt), medido en las láminas 09 y 13a. */
const RECENTER_MARGIN_X = 8;
const RECENTER_MARGIN_Y = 6;

const toLatLng = (p: MapPoint): LatLng => ({ latitude: p.lat, longitude: p.lng });
const toRegion = (r: MapRegion): Region => ({ latitude: r.lat, longitude: r.lng, latitudeDelta: r.latDelta, longitudeDelta: r.lngDelta });
const fromRegion = (r: Region): MapRegion => ({ lat: r.latitude, lng: r.longitude, latDelta: r.latitudeDelta, lngDelta: r.longitudeDelta });

/** Firma estable de un marcador: evita re-renderizar cuando la pantalla recrea objetos idénticos. */
function markerSignature(m: MapMarkerSpec, selected: boolean): string {
  return JSON.stringify([m, selected]);
}

interface MarkerItemProps {
  marker: MapMarkerSpec;
  selected: boolean;
  signature: string;
  onPress?: (marker: MapMarkerSpec) => void;
}

const MarkerItem = memo(
  function MarkerItem({ marker, selected, onPress }: MarkerItemProps): React.JSX.Element | null {
    const layout: MarkerLayout = useMemo(() => layoutMarker(marker), [marker]);
    const [tracks, setTracks] = useState(true);
    useEffect(() => {
      setTracks(true);
      const t = setTimeout(() => setTracks(false), TRACK_MS);
      return () => clearTimeout(t);
    }, [layout, selected]);
    if (!isValidPoint(marker.position)) return null;
    const interactive = marker.kind !== 'user';
    return (
      <Marker
        identifier={marker.id}
        coordinate={toLatLng(marker.position)}
        anchor={layout.anchor}
        centerOffset={layout.centerOffset}
        tracksViewChanges={tracks}
        zIndex={(marker.zIndex ?? defaultZIndex(marker.kind)) + (selected ? 20 : 0)}
        stopPropagation
        tappable={interactive}
        onPress={interactive && onPress ? () => onPress(marker) : undefined}
        accessible
        accessibilityRole={interactive ? 'button' : 'image'}
        accessibilityLabel={accessibilityLabelOf(marker)}
      >
        <MarkerView marker={marker} layout={layout} selected={selected} />
      </Marker>
    );
  },
  (prev, next) => prev.signature === next.signature && prev.onPress === next.onPress,
);

const RouteLines = memo(function RouteLines({ route }: { route: MapRouteSpec }): React.JSX.Element | null {
  const style = ROUTE_STYLE[route.kind];
  const coordinates = useMemo(() => validPoints(route.points).map(toLatLng), [route.points]);
  if (coordinates.length < 2) return null;
  const width = route.width ?? style.width;
  const color = route.color ?? style.color;
  const base = route.zIndex ?? style.zIndex;
  const dash = style.dash ? [...style.dash] : undefined;
  const cap = style.round ? 'round' : dash ? 'butt' : 'round';
  return (
    <>
      {style.casing ? (
        <Polyline
          coordinates={coordinates}
          strokeColor={MAP_COLORS.routeCasing}
          strokeWidth={width + 3.5}
          lineCap={cap}
          lineJoin="round"
          lineDashPattern={dash}
          zIndex={base * 2}
        />
      ) : null}
      <Polyline coordinates={coordinates} strokeColor={color} strokeWidth={width} lineCap={cap} lineJoin="round" lineDashPattern={dash} zIndex={base * 2 + 1} />
    </>
  );
});

/** Colchón alrededor de los marcadores para que los pins y sus chips queden completos al encuadrar. */
function markerOverhang(markers: readonly MapMarkerSpec[]): EdgePadding {
  const o: EdgePadding = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const m of markers) {
    const l = layoutMarker(m);
    const ax = l.anchor.x * l.width;
    const ay = l.anchor.y * l.height;
    o.left = Math.max(o.left, ax);
    o.right = Math.max(o.right, l.width - ax);
    o.top = Math.max(o.top, ay);
    o.bottom = Math.max(o.bottom, l.height - ay);
  }
  return o;
}

export const MvcMap = forwardRef<MvcMapHandle, MvcMapProps>(function MvcMap(props, ref): React.JSX.Element {
  const {
    markers = EMPTY_MARKERS,
    routes = EMPTY_ROUTES,
    selectedMarkerId = null,
    onMarkerPress,
    onMapPress,
    onRegionChange,
    userLocation = null,
    showUserLocation = false,
    recenter = false,
    onRecenter,
    lite = false,
    style,
    testID = 'MvcMap',
    accessibilityLabel = 'Mapa',
    children,
  } = props;
  const interactive = lite ? false : props.interactive ?? true;
  const userPoint = isValidPoint(userLocation) ? userLocation : null;
  const mapRef = useRef<MapView>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  const regionRef = useRef<MapRegion>(props.initialRegion ?? SEVILLA_REGION);
  const fittedKeyRef = useRef<string | number | null | undefined>(undefined);
  const pendingFitRef = useRef(false);

  const padding = useMemo(() => normalizePadding(props.edgePadding), [props.edgePadding]);

  // Puntos a encuadrar.
  const fitSpec = props.fit ?? (props.initialRegion ? undefined : 'content');
  const fitPoints = useMemo<MapPoint[]>(() => {
    if (fitSpec === undefined) return [];
    if (fitSpec === 'content') return validPoints([...markers.map((m) => m.position), ...routes.flatMap((r) => r.points)]);
    if (Array.isArray(fitSpec)) return validPoints(fitSpec as readonly MapPoint[]);
    const b = fitSpec as { sw: MapPoint; ne: MapPoint };
    return validPoints([b.sw, b.ne]);
  }, [fitSpec, markers, routes]);
  const overhang = useMemo(() => markerOverhang(markers.filter((m) => m.kind !== 'user')), [markers]);
  const fitPadding = useMemo<EdgePadding>(
    () => ({
      top: padding.top + DEFAULT_BASE_PADDING + (overhang.top ? overhang.top + MARKER_BREATHING : 0),
      right: padding.right + DEFAULT_BASE_PADDING + (overhang.right ? overhang.right + MARKER_BREATHING : 0),
      bottom: padding.bottom + DEFAULT_BASE_PADDING + (overhang.bottom ? overhang.bottom + MARKER_BREATHING : 0),
      left: padding.left + DEFAULT_BASE_PADDING + (overhang.left ? overhang.left + MARKER_BREATHING : 0),
    }),
    [padding, overhang],
  );

  // Cámara inicial (se calcula una sola vez; el encuadre real se aplica al estar listo el mapa).
  const initialRegion = useMemo<Region>(() => {
    if (props.initialRegion) return toRegion(props.initialRegion);
    if (fitPoints.length) return toRegion(fitBounds(fitPoints, { padding: fitPadding }));
    return toRegion(SEVILLA_REGION);
    // Solo la primera vez: después la cámara la gobierna el encuadre automático o el usuario.
  }, []);

  const fitTo = useCallback(
    (points: readonly MapPoint[], animated: boolean, pad: EdgePadding) => {
      const map = mapRef.current;
      if (!map || !points.length) return;
      const coords = points.length === 1 ? [toLatLng(points[0] as MapPoint)] : points.map(toLatLng);
      if (coords.length === 1) {
        const region = regionForZoom(points[0] as MapPoint, 15, { width: Math.max(size.width, 200), height: Math.max(size.height, 200) });
        map.animateToRegion(toRegion(region), animated ? 350 : 0);
        return;
      }
      map.fitToCoordinates(coords, { edgePadding: { top: pad.top, right: pad.right, bottom: pad.bottom, left: pad.left }, animated });
    },
    [size.height, size.width],
  );

  // Encuadre automático: al estar listo el mapa, cuando llega contenido por primera vez y cuando cambia `fitKey`.
  const laidOut = size.width > 0 && size.height > 0;
  useEffect(() => {
    if (!ready || !laidOut || fitSpec === undefined) return;
    const key = props.fitKey ?? '__initial__';
    if (fitPoints.length === 0) {
      pendingFitRef.current = true;
      return;
    }
    const changedKey = fittedKeyRef.current !== undefined && fittedKeyRef.current !== key;
    if (fittedKeyRef.current === undefined || changedKey || pendingFitRef.current) {
      const first = fittedKeyRef.current === undefined;
      fittedKeyRef.current = key;
      pendingFitRef.current = false;
      fitTo(fitPoints, !first, fitPadding);
    }
  }, [ready, laidOut, fitSpec, fitPoints, fitPadding, fitTo, props.fitKey]);

  const doRecenter = useCallback(() => {
    if (userPoint) {
      const region = regionForZoom(userPoint, 14.5, { width: Math.max(size.width, 200), height: Math.max(size.height, 200) });
      mapRef.current?.animateToRegion(toRegion(region), 450);
    } else if (fitPoints.length) {
      fitTo(fitPoints, true, fitPadding);
    }
  }, [fitPadding, fitPoints, fitTo, size.height, size.width, userPoint]);

  useImperativeHandle(
    ref,
    () => ({
      fitToContent: (options) => {
        const pad = options?.padding ? { ...fitPadding, ...normalizePadding(options.padding) } : fitPadding;
        fitTo(validPoints([...markers.map((m) => m.position), ...routes.flatMap((r) => r.points)]), options?.animated ?? true, pad);
      },
      fitToPoints: (points, options) => {
        const pad = options?.padding ? { ...fitPadding, ...normalizePadding(options.padding) } : fitPadding;
        fitTo(validPoints(points), options?.animated ?? true, pad);
      },
      animateTo: (target, options) => {
        const map = mapRef.current;
        if (!map) return;
        const duration = options?.durationMs ?? 400;
        if ('latDelta' in target) {
          map.animateToRegion(toRegion(target), duration);
          return;
        }
        const cur = regionRef.current;
        const k = 2 ** -(options?.zoomDelta ?? 0);
        map.animateToRegion(toRegion({ lat: target.lat, lng: target.lng, latDelta: cur.latDelta * k, lngDelta: cur.lngDelta * k }), duration);
      },
      recenter: doRecenter,
      pointForCoordinate: async (point) => {
        const map = mapRef.current;
        if (!map) return null;
        try {
          return await map.pointForCoordinate(toLatLng(point));
        } catch {
          return null;
        }
      },
    }),
    [doRecenter, fitPadding, fitTo, markers, routes],
  );

  const handleRecenter = useCallback(() => {
    onRecenter?.();
    doRecenter();
  }, [doRecenter, onRecenter]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  const handleRegionChange = useCallback(
    (settled: boolean) => (region: Region, details?: { isGesture?: boolean }) => {
      const r = fromRegion(region);
      if (settled) regionRef.current = r;
      onRegionChange?.(r, { settled, byUser: details?.isGesture === true });
    },
    [onRegionChange],
  );
  const onRegionChangeMove = useMemo(() => (onRegionChange ? handleRegionChange(false) : undefined), [handleRegionChange, onRegionChange]);
  const onRegionChangeDone = useMemo(() => handleRegionChange(true), [handleRegionChange]);

  const pressMarker = useCallback((m: MapMarkerSpec) => onMarkerPress?.(m), [onMarkerPress]);

  const userMarker = useMemo<MapMarkerSpec | null>(
    () => (userPoint ? { id: '__user__', kind: 'user', position: userPoint, accuracyM: props.userAccuracyM } : null),
    [userPoint, props.userAccuracyM],
  );

  return (
    <View testID={testID} style={[styles.root, style]} onLayout={onLayout}>
      <View style={[StyleSheet.absoluteFill, { pointerEvents: interactive ? 'auto' : 'none' }]}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          customMapStyle={Platform.OS === 'android' ? MVC_MAP_STYLE_LIGHT : undefined}
          mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
          userInterfaceStyle="light"
          initialRegion={initialRegion}
          showsUserLocation={showUserLocation && !userPoint}
          showsMyLocationButton={false}
          showsCompass={false}
          showsPointsOfInterests={false}
          showsBuildings={false}
          showsTraffic={false}
          showsIndoors={false}
          showsIndoorLevelPicker={false}
          showsScale={false}
          toolbarEnabled={false}
          moveOnMarkerPress={false}
          rotateEnabled={false}
          pitchEnabled={false}
          scrollEnabled={interactive}
          zoomEnabled={interactive}
          zoomControlEnabled={false}
          loadingEnabled
          loadingBackgroundColor="#E8E6E4"
          loadingIndicatorColor={MAP_COLORS.brand}
          accessibilityLabel={accessibilityLabel}
          onMapReady={() => setReady(true)}
          onPress={onMapPress ? (e) => onMapPress({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude }) : undefined}
          onRegionChange={onRegionChangeMove}
          onRegionChangeComplete={onRegionChangeDone}
        >
          {routes.map((r) => (
            <RouteLines key={r.id} route={r} />
          ))}
          {markers.map((m) => {
            const selected = m.id === selectedMarkerId;
            return <MarkerItem key={m.id} marker={m} selected={selected} signature={markerSignature(m, selected)} onPress={onMarkerPress ? pressMarker : undefined} />;
          })}
          {userMarker ? <MarkerItem key={userMarker.id} marker={userMarker} selected={false} signature={markerSignature(userMarker, false)} /> : null}
        </MapView>
      </View>
      {recenter && !lite && interactive ? (
        <RecenterButton onPress={handleRecenter} style={[styles.recenter, { right: RECENTER_MARGIN_X + padding.right, bottom: RECENTER_MARGIN_Y + padding.bottom }]} />
      ) : null}
      {children ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay]}>
          {children}
        </View>
      ) : null}
    </View>
  );
});

MvcMap.displayName = 'MvcMap';

const styles = StyleSheet.create({
  root: { overflow: 'hidden', backgroundColor: '#E8E6E4' },
  recenter: { position: 'absolute' },
  overlay: { pointerEvents: 'box-none' },
});
