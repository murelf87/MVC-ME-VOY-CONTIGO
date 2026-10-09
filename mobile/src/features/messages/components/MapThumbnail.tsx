/**
 * Miniatura de una ubicación compartida (lámina 26): una tarjeta de mapa esquemática con una chincheta azul.
 *
 * Es un DIBUJO vectorial fijo (calles, parque y agua genéricos), no un mapa real: el chat no descarga teselas por cada
 * mensaje ni envía coordenadas a ningún proveedor para pintar una miniatura. La posición exacta se ve abriendo el punto en
 * la app de mapas del móvil (tocar la tarjeta). Por eso no lleva ningún nombre de calle ni de lugar.
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import { colors } from "@/theme";

export interface MapThumbnailProps {
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

const VIEW_W = 120;
const VIEW_H = 88;

const ROAD = "#F7F7F2";
const ROAD_MAJOR = "#FFFFFF";
const BLOCK = "#E3E5E5";
const PARK = "#CBE4C3";
const WATER = "#BDD8EC";

export function MapThumbnail({ width = VIEW_W, height = VIEW_H, style }: MapThumbnailProps): React.JSX.Element {
  return (
    <View
      style={[styles.tile, { width, height }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={width} height={height} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid slice">
        <Rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill={BLOCK} />
        {/* Agua en dos esquinas */}
        <Path d="M0 0H30L14 34L0 26Z" fill={WATER} opacity={0.85} />
        <Path d="M92 0H120V16L100 22Z" fill={WATER} opacity={0.85} />
        {/* Parque en diagonal */}
        <Path d="M0 18L22 40L58 62L84 88H56L20 66L0 48Z" fill={PARK} opacity={0.9} />
        <Path d="M96 14L120 6V38L104 44Z" fill={PARK} opacity={0.8} />
        {/* Trama de calles girada */}
        <G rotation={-32} originX={60} originY={44}>
          {[-30, -6, 18, 42, 66, 90, 114, 138].map((x) => (
            <Rect key={`v${x}`} x={x} y={-60} width={2.4} height={220} fill={ROAD} />
          ))}
          {[-40, -14, 12, 38, 64, 90, 116].map((y) => (
            <Rect key={`h${y}`} x={-60} y={y} width={240} height={2.2} fill={ROAD} />
          ))}
          <Rect x={-60} y={34} width={240} height={4} fill={ROAD_MAJOR} />
          <Rect x={52} y={-60} width={4} height={220} fill={ROAD_MAJOR} />
        </G>
        {/* Chincheta */}
        <Circle cx={74} cy={66} r={9.5} fill="#FFFFFF" />
        <Circle cx={74} cy={66} r={5.5} fill={colors.primary} />
        <Path
          d="M74 68C74 68 56 52 56 36.5A18 18 0 0 1 92 36.5C92 52 74 68 74 68Z"
          fill={colors.primary}
          stroke="#FFFFFF"
          strokeWidth={1.5}
        />
        <Circle cx={74} cy={36.5} r={6.5} fill="#FFFFFF" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: 12, overflow: "hidden", backgroundColor: BLOCK },
});
