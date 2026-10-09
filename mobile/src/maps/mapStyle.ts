/**
 * Estilo claro de Google Maps (`customMapStyle`, solo Android/Google; Apple Maps usa `mapType="mutedStandard"`).
 * Colores muestreados de las láminas aprobadas (ver docs/MAPS.md): tierra gris cálida #E8E6E4, parques #CDE6C5, agua #9CCCF8,
 * calles blancas con borde gris muy suave, arterias en naranja pálido #FADCAF y rótulos azul marino oscuro con halo blanco.
 */
import type { MapStyleElement } from 'react-native-maps';

export const MVC_MAP_STYLE_LIGHT: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#E8E6E4' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#2B3046' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FFFFFF' }, { weight: 3 }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#CFC9C2' }, { weight: 0.8 }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#1B2447' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#4A5068' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#E8E6E4' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#ECE9E5' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#E2DFDB' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#CDE6C5' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#5F8157' }] },
  { featureType: 'poi.medical', elementType: 'geometry', stylers: [{ color: '#EBDFDF' }] },
  { featureType: 'poi.school', elementType: 'geometry', stylers: [{ color: '#EAE4D8' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#E2DFDA' }, { weight: 0.6 }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#6D7385' }] },
  { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#FCE6C4' }] },
  { featureType: 'road.arterial', elementType: 'geometry.stroke', stylers: [{ color: '#F3D3A0' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#FADCAF' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#EEC98E' }] },
  { featureType: 'road.highway.controlled_access', elementType: 'geometry.fill', stylers: [{ color: '#F9D49A' }] },
  { featureType: 'road.highway.controlled_access', elementType: 'geometry.stroke', stylers: [{ color: '#EBBB6C' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.station', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#9CCCF8' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3B7BC4' }] },
];
