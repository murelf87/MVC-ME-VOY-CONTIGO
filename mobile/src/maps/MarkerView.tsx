/**
 * Dibujo de cada tipo de marcador (react-native-svg + Views). Se usa dentro de `<Marker>` de react-native-maps (iOS /
 * Android) y, tal cual, en el sustituto web. Todo tiene tamaño explícito (ver `markerLayout.ts`): en Android los hijos de
 * un Marker se rasterizan, así que no puede haber medidas «automáticas».
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { measureChip } from './chipLayout';
import { CapGlyph, CarGlyph, CarSilhouette, DiamondGlyph, FlagGlyph } from './glyphs';
import { MapChip } from './MapChip';
import { capCardPath, capGlyphHeight, clusterSizes, isFullCar, type MarkerLayout } from './markerLayout';
import { MAP_FONTS } from './mapFonts';
import { MAP_COLORS, MARKER_METRICS } from './mapTheme';
import type { LabelMarker, MapMarkerSpec } from './types';

const M = MARKER_METRICS;
/** Azul marino del birrete y del texto de la tarjeta de universidad (lámina 11). */
const CAP_NAVY = '#0E1B66';

/** Sombra falsa (capas translúcidas): las sombras nativas no siguen la silueta de un SVG ni se rasterizan en Android. */
function ShadowRect(props: { x: number; y: number; w: number; h: number; r: number }): React.JSX.Element {
  const { x, y, w, h, r } = props;
  return (
    <>
      <Rect x={x - 2} y={y + 1} width={w + 4} height={h + 5} rx={r + 2} fill={MAP_COLORS.shadow} opacity={0.05} />
      <Rect x={x - 1} y={y + 2} width={w + 2} height={h + 3} rx={r + 1} fill={MAP_COLORS.shadow} opacity={0.08} />
    </>
  );
}

function CarPin({ full, selected }: { full: boolean; selected: boolean }): React.JSX.Element {
  const { body, radius, inner, innerRadius, tail, glyphW } = M.carPin;
  const color = full ? MAP_COLORS.pinFull : MAP_COLORS.pin;
  const off = (body - inner) / 2;
  const h = body + tail;
  return (
    <View style={{ width: body, height: h }}>
      <Svg width={body} height={h} viewBox={`0 0 ${body} ${h}`}>
        <ShadowRect x={0.5} y={0.5} w={body - 1} h={body - 1} r={radius} />
        <Rect x={0.5} y={0.5} width={body - 1} height={body - 1} rx={radius} fill={MAP_COLORS.white} />
        <Path d={`M${body / 2 - 8.5} ${body - 2.5}L${body / 2} ${h - 0.5}L${body / 2 + 8.5} ${body - 2.5}Z`} fill={MAP_COLORS.white} />
        <Rect x={off} y={off} width={inner} height={inner} rx={innerRadius} fill={color} />
        <Path d={`M${body / 2 - 6} ${body - off - 2}L${body / 2} ${h - 4}L${body / 2 + 6} ${body - off - 2}Z`} fill={color} />
        {selected ? <Rect x={off - 1} y={off - 1} width={inner + 2} height={inner + 2} rx={innerRadius + 1} fill="none" stroke={MAP_COLORS.white} strokeWidth={1.5} /> : null}
      </Svg>
      <View style={[styles.center, { width: body, height: body }]}>
        <CarGlyph width={glyphW} color={MAP_COLORS.white} cut={color} />
      </View>
    </View>
  );
}

function CarLive({ selected }: { selected: boolean }): React.JSX.Element {
  const { w, h, innerW, innerH, radius, innerRadius, glyphW } = M.carLive;
  const ox = (w - innerW) / 2;
  const oy = (h - innerH) / 2;
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <ShadowRect x={0.5} y={0.5} w={w - 1} h={h - 1} r={radius} />
        <Rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={radius} fill={MAP_COLORS.white} />
        <Rect x={ox} y={oy} width={innerW} height={innerH} rx={innerRadius} fill={MAP_COLORS.pin} />
        {selected ? <Rect x={ox - 1} y={oy - 1} width={innerW + 2} height={innerH + 2} rx={innerRadius + 1} fill="none" stroke={MAP_COLORS.white} strokeWidth={1.5} /> : null}
      </Svg>
      <View style={[styles.center, { width: w, height: h }]}>
        <CarGlyph width={glyphW} color={MAP_COLORS.white} cut={MAP_COLORS.pin} />
      </View>
    </View>
  );
}

function CarBadge(): React.JSX.Element {
  const { w, h } = M.carBadge;
  return (
    <View style={{ width: w, height: h }}>
      <CarSilhouette width={w} height={h} color={MAP_COLORS.pin} cut={MAP_COLORS.white} halo={MAP_COLORS.white} />
    </View>
  );
}

/** Contorno de la gota para `MARKER_METRICS.drop` (cabeza de 28 pt, altura 37 pt, margen superior 3 pt, ancho 36 pt). */
const DROP_PATH = 'M18 40C13.33 34.28 4 26.02 4 15.31C4 8.21 10.25 3 18 3C25.75 3 32 8.21 32 15.31C32 26.02 22.67 34.28 18 40Z';

/** Gota con hueco blanco o letra, apoyada en un punto con halo (la ubicación real). */
function DropPin(props: { color: string; letter?: string; selected: boolean }): React.JSX.Element {
  const { color, letter, selected } = props;
  const d = M.drop;
  const cx = d.w / 2;
  const cy = d.top + d.height + 5;
  const h = Math.ceil(cy + d.halo / 2 + 1);
  const headCy = d.top + d.head / 2;
  return (
    <View style={{ width: d.w, height: h }}>
      <Svg width={d.w} height={h} viewBox={`0 0 ${d.w} ${h}`}>
        <Circle cx={cx} cy={cy} r={d.halo / 2} fill={MAP_COLORS.haloUser} />
        <Circle cx={cx} cy={cy} r={d.dot / 2} fill={MAP_COLORS.white} />
        <Circle cx={cx} cy={cy} r={d.dot / 2 - 2.8} fill={color} />
        <Path d={DROP_PATH} fill={MAP_COLORS.white} stroke={MAP_COLORS.white} strokeWidth={(selected ? d.outline + 1 : d.outline) * 2} strokeLinejoin="round" />
        <Path d={DROP_PATH} fill={color} />
        {letter ? null : <Circle cx={cx} cy={headCy} r={d.hole} fill={MAP_COLORS.white} />}
      </Svg>
      {letter ? (
        <View style={[styles.center, { position: 'absolute', left: 0, top: d.top, width: d.w, height: d.head }]}>
          <Text allowFontScaling={false} style={styles.letter}>
            {letter}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Ring(props: { size: number; hole: number; border: number; color: string; index?: number; end?: boolean }): React.JSX.Element {
  const { size, hole, border, color, index, end } = props;
  const c = size / 2;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={c} cy={c + 1.2} r={c - 0.5} fill={MAP_COLORS.shadow} opacity={0.1} />
        <Circle cx={c} cy={c} r={c - 0.5} fill={MAP_COLORS.white} />
        <Circle cx={c} cy={c} r={c - border} fill={color} />
        {index === undefined && !end ? <Circle cx={c} cy={c} r={hole / 2} fill={MAP_COLORS.white} /> : null}
      </Svg>
      {index !== undefined ? (
        <View style={[styles.center, { width: size, height: size, position: 'absolute' }]}>
          <Text allowFontScaling={false} style={styles.stopIndex}>
            {index}
          </Text>
        </View>
      ) : null}
      {end && index === undefined ? (
        <View style={[styles.center, { width: size, height: size, position: 'absolute' }]}>
          <DiamondGlyph width={size * 0.44} color={MAP_COLORS.white} />
        </View>
      ) : null}
    </View>
  );
}

function CapDisc(): React.JSX.Element {
  const s = M.cap.size;
  return (
    <View style={{ width: s, height: s }}>
      <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
        <Circle cx={s / 2} cy={s / 2 + 1.6} r={s / 2 - 0.5} fill={MAP_COLORS.shadow} opacity={0.1} />
        <Circle cx={s / 2} cy={s / 2} r={s / 2 - 0.5} fill={MAP_COLORS.white} />
      </Svg>
      <View style={[styles.center, { width: s, height: s, position: 'absolute' }]}>
        <CapGlyph width={M.cap.glyphW} color={MAP_COLORS.pin} />
      </View>
    </View>
  );
}

function UserDot(): React.JSX.Element {
  const { core, ring } = M.user;
  return (
    <View style={{ width: 64, height: 64 }}>
      <Svg width={64} height={64} viewBox="0 0 64 64">
        <Circle cx={32} cy={32} r={31} fill={MAP_COLORS.haloUser} />
        <Circle cx={32} cy={33} r={core / 2 + 1} fill={MAP_COLORS.shadow} opacity={0.15} />
        <Circle cx={32} cy={32} r={core / 2} fill={MAP_COLORS.white} />
        <Circle cx={32} cy={32} r={core / 2 - ring} fill={MAP_COLORS.brand} />
      </Svg>
    </View>
  );
}

function Cluster({ count }: { count: number }): React.JSX.Element {
  const { core, halo } = clusterSizes(count);
  const c = halo / 2;
  return (
    <View style={{ width: halo, height: halo }}>
      <Svg width={halo} height={halo} viewBox={`0 0 ${halo} ${halo}`}>
        <Circle cx={c} cy={c} r={c - 0.5} fill={MAP_COLORS.haloCluster} />
        <Circle cx={c} cy={c + 1} r={core / 2 + M.cluster.ring} fill={MAP_COLORS.shadow} opacity={0.1} />
        <Circle cx={c} cy={c} r={core / 2 + M.cluster.ring} fill={MAP_COLORS.white} />
        <Circle cx={c} cy={c} r={core / 2} fill={MAP_COLORS.brand} />
      </Svg>
      <View style={[styles.center, { width: halo, height: halo, position: 'absolute' }]}>
        <Text allowFontScaling={false} style={styles.clusterCount}>
          {count > 99 ? '99+' : String(count)}
        </Text>
      </View>
    </View>
  );
}

function FlagHalo(): React.JSX.Element {
  const s = M.flag.halo;
  return (
    <View style={{ width: s, height: s }}>
      <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
        <Circle cx={s / 2} cy={s / 2} r={s / 2 - 0.5} fill={MAP_COLORS.haloFlag} />
      </Svg>
      <View style={[styles.center, { width: s, height: s, position: 'absolute' }]}>
        <FlagGlyph width={M.flag.glyphW} color={MAP_COLORS.pin} />
      </View>
    </View>
  );
}

function GraphicFor({ marker, selected }: { marker: Exclude<MapMarkerSpec, LabelMarker>; selected: boolean }): React.JSX.Element {
  switch (marker.kind) {
    case 'car':
      if (marker.variant === 'badge') return <CarBadge />;
      if (marker.variant === 'live') return <CarLive selected={selected} />;
      return <CarPin full={isFullCar(marker)} selected={selected} />;
    case 'pickupA':
      return <DropPin color={MAP_COLORS.pin} letter="A" selected={selected || marker.selected === true} />;
    case 'pickupB':
      return <DropPin color={MAP_COLORS.pinB} letter="B" selected={selected || marker.selected === true} />;
    case 'destination':
      return <DropPin color={marker.tone === 'success' ? MAP_COLORS.pinB : marker.tone === 'warning' ? MAP_COLORS.warning : MAP_COLORS.pin} selected={selected} />;
    case 'origin':
      return <Ring size={M.origin.size} hole={M.origin.hole} border={M.origin.border} color={MAP_COLORS.brand} />;
    case 'stop': {
      const size = marker.index !== undefined ? (marker.index >= 10 ? M.stop.size + 5 : M.stop.size + 1) : M.stop.size;
      return (
        <Ring
          size={size}
          hole={M.stop.hole}
          border={M.stop.border}
          color={marker.tone === 'warning' ? MAP_COLORS.warning : MAP_COLORS.brand}
          index={marker.index}
          end={marker.end}
        />
      );
    }
    case 'destinationCap':
      return <CapDisc />;
    case 'user':
      return <UserDot />;
    case 'cluster':
      return <Cluster count={marker.count} />;
    case 'flag':
      return <FlagHalo />;
  }
}

/** Tarjeta única «birrete + texto» (lámina 11: «Universidad de Sevilla»): lengüeta con el birrete sobre la tarjeta del nombre. */
function CapCard({ layout }: { layout: MarkerLayout }): React.JSX.Element | null {
  const chip = layout.chip;
  if (!chip) return null;
  const k = M.capCard;
  const c = measureChip(chip.spec, 'sm');
  const m = c.metrics;
  const w = layout.width;
  const shapeH = layout.height - k.shadowPad;
  const path = capCardPath(w, shapeH);
  return (
    <View style={{ width: w, height: layout.height }}>
      <Svg width={w} height={layout.height} viewBox={`0 0 ${w} ${layout.height}`}>
        <Path d={path} fill={MAP_COLORS.shadow} opacity={0.05} transform="translate(0 3.4)" />
        <Path d={path} fill={MAP_COLORS.shadow} opacity={0.09} transform="translate(0 1.6)" />
        <Path d={path} fill={MAP_COLORS.white} />
      </Svg>
      <View style={[styles.capCardIcon, { top: k.iconTop, width: w, height: capGlyphHeight(k.iconW) }]}>
        <CapGlyph width={k.iconW} color={CAP_NAVY} />
      </View>
      <View style={{ position: 'absolute', left: 0, top: k.tabH + k.padTop, width: w }}>
        {c.titleLines.map((line, i) => (
          <Text key={`t${i}`} allowFontScaling={false} numberOfLines={1} style={[styles.capTitle, { fontSize: m.title, lineHeight: m.titleLine }]}>
            {line}
          </Text>
        ))}
        {c.subtitleLines.map((line, i) => (
          <Text key={`s${i}`} allowFontScaling={false} numberOfLines={1} style={[styles.capSubtitle, { fontSize: m.subtitle, lineHeight: m.subtitleLine }]}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

export interface MarkerViewProps {
  marker: MapMarkerSpec;
  layout: MarkerLayout;
  selected?: boolean;
}

/** Conjunto completo «gráfico + chip» con el tamaño y la posición calculados en `layoutMarker`. */
export function MarkerView({ marker, layout, selected = false }: MarkerViewProps): React.JSX.Element {
  if (layout.capCard) return <CapCard layout={layout} />;
  const g = layout.graphic;
  const chip = layout.chip;
  return (
    <View style={{ width: layout.width, height: layout.height }}>
      {marker.kind === 'label' ? null : (
        <View style={{ position: 'absolute', left: g.x, top: g.y, width: g.w, height: g.h }}>
          <GraphicFor marker={marker} selected={selected} />
        </View>
      )}
      {chip ? (
        <View style={{ position: 'absolute', left: chip.x, top: chip.y, width: chip.w, height: chip.h }}>
          <MapChip {...chip.spec} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', position: 'absolute', left: 0, top: 0, pointerEvents: 'none' },
  letter: { fontFamily: MAP_FONTS.bold, fontSize: M.drop.letter, lineHeight: M.drop.letter + 3, color: MAP_COLORS.white, includeFontPadding: false },
  stopIndex: { fontFamily: MAP_FONTS.bold, fontSize: 13, lineHeight: 15, color: MAP_COLORS.white, includeFontPadding: false },
  clusterCount: { fontFamily: MAP_FONTS.bold, fontSize: 16, lineHeight: 19, color: MAP_COLORS.white, includeFontPadding: false },
  capCardIcon: { position: 'absolute', left: 0, alignItems: 'center', justifyContent: 'center' },
  capTitle: { fontFamily: MAP_FONTS.bold, color: CAP_NAVY, textAlign: 'center', includeFontPadding: false },
  capSubtitle: { fontFamily: MAP_FONTS.medium, color: CAP_NAVY, textAlign: 'center', includeFontPadding: false },
});
