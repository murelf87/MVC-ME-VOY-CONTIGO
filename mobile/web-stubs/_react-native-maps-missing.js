// Relleno MÍNIMO que Metro usa SOLO si todavía no existe mobile/web-stubs/react-native-maps.js (lo escribe el agente `map`).
// Así la vista previa se puede construir mientras tanto. Cuando exista el fichero real, este no se usa nunca.
import React from 'react';
import { Text, View } from 'react-native';

export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = null;

const MapView = React.forwardRef(function MapView(props, ref) {
  React.useImperativeHandle(ref, () => ({ animateToRegion() {}, animateCamera() {}, fitToCoordinates() {}, fitToElements() {}, getCamera: async () => ({}) }), []);
  return React.createElement(
    View,
    { style: [{ backgroundColor: '#E7ECF4', alignItems: 'center', justifyContent: 'center' }, props.style], testID: 'MapView.missing' },
    React.createElement(Text, { style: { color: '#44506B', fontSize: 12, textAlign: 'center', padding: 12 } }, 'Mapa no disponible: falta mobile/web-stubs/react-native-maps.js'),
    props.children,
  );
});
const Nothing = () => null;

export const Marker = Nothing;
export const Polyline = Nothing;
export const Polygon = Nothing;
export const Circle = Nothing;
export const Callout = Nothing;
export const Overlay = Nothing;
export const UrlTile = Nothing;
export default MapView;
