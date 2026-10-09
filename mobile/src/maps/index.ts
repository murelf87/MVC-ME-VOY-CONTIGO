/**
 * Mapas de MVC. UNA sola implementación (`MvcMap`) para iOS (Apple Maps), Android (Google Maps) y la vista previa web
 * (mapa vectorial ilustrativo de Sevilla, `web-stubs/react-native-maps.js`). Ver docs/MAPS.md.
 *
 *   import { MvcMap, MapChip, MapLegend, RecenterButton, fitBounds, sevillaCenter, SEVILLA_PLACES, SEVILLA_ROAD_ROUTES } from '@/maps';
 */
export { MvcMap } from './MvcMap';
export { MapChip, type MapChipProps } from './MapChip';
export { MapLegend, type MapLegendItem, type MapLegendProps } from './MapLegend';
export { RecenterButton, type RecenterButtonProps } from './RecenterButton';

export type {
  CarMarker,
  ChipIcon,
  ChipSide,
  ChipSize,
  ChipTone,
  ClusterMarker,
  DestinationCapMarker,
  DestinationMarker,
  EdgePadding,
  FlagMarker,
  LabelMarker,
  MapBounds,
  MapChipSpec,
  MapFit,
  MapMarkerKind,
  MapMarkerSpec,
  MapPoint,
  MapRegion,
  MapRouteKind,
  MapRouteSpec,
  MvcMapHandle,
  MvcMapProps,
  OriginMarker,
  PickupMarker,
  RegionChangeMeta,
  StopMarker,
  UserMarker,
} from './types';

export {
  SEVILLA_CENTER,
  SEVILLA_PROVINCE_BOUNDS,
  SEVILLA_REGION,
  bearingDegrees,
  boundsCenter,
  boundsOf,
  distanceMeters,
  fitBounds,
  isValidPoint,
  pointAlong,
  polylineLengthMeters,
  regionForZoom,
  regionToBounds,
  sevillaCenter,
  validPoints,
  zoomForRegion,
  type FitBoundsOptions,
} from './geo';

export {
  SEVILLA_PLACES,
  SEVILLA_PLACE_BY_ID,
  findSevillaPlace,
  nearestSevillaPlace,
  sevillaPlace,
  sevillaPoint,
  type SevillaPlace,
  type SevillaPlaceId,
  type SevillaPlaceKind,
} from './places';

export {
  SEVILLA_ROAD_ROUTES,
  decodePolyline,
  encodePolyline,
  reverseRoadRoute,
  roadRouteBetween,
  roadRouteLngLat,
  roadRouteSpec,
  roadRoutesAt,
  sevillaRoadRoute,
  type SevillaRoadRoute,
  type SevillaRoadRouteId,
} from './roadRoutes';

export { carSeatsChip, seatsLabel } from './markerLayout';
export { measureChip, CHIP_SIZES, type ChipLayout } from './chipLayout';
export { MVC_MAP_STYLE_LIGHT } from './mapStyle';
export { MAP_COLORS, MAP_SHADOWS, MARKER_METRICS, ROUTE_STYLE, chipToneColor } from './mapTheme';
