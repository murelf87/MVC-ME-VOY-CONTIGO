// Escenas del banco de pruebas del mapa (ver entry.tsx).
//   ?scene=09|11|12|13a|19|21|22|24|37a   las 9 vistas de las láminas aprobadas (mismo tamaño en pt que el recorte de la lámina)
//   ?free=1&w=364&h=385&lat=37.38&lng=-5.99&z=12.5   mapa suelto
// Cada escena coloca los marcadores y trazos en la POSICIÓN DE PANTALLA que tienen en la lámina (px del recorte ÷ 2) y los
// convierte a coordenadas con la cámara de la escena: así se compara el estilo (colores, grosores, tipografías, tamaños de
// marcador y chip) con la misma composición. La geografía de fondo es la de Sevilla real (dibujo ilustrativo); la de las
// láminas es la que dibujó el generador de imágenes y no coincide métricamente (ver docs/MAPS.md §Fidelidad).
import React from 'react';
import { View } from 'react-native';
import { MapChip } from '../../../../mobile/src/maps/MapChip';
import { MapLegend } from '../../../../mobile/src/maps/MapLegend';
import { MvcMap } from '../../../../mobile/src/maps/MvcMap';
import { latFromMercatorY, lngFromMercatorX, mercatorX, mercatorY, regionForZoom } from '../../../../mobile/src/maps/geo';
import type { MapChipSpec, MapMarkerSpec, MapPoint, MapRouteSpec } from '../../../../mobile/src/maps/types';

type Px = readonly [number, number];

interface SceneContent {
  markers: MapMarkerSpec[];
  routes: MapRouteSpec[];
  recenter?: boolean;
  legend?: boolean;
  /** Tarjetas de pantalla (no ancladas a una coordenada): `x` = borde izquierdo o `right` = margen derecho, e `y` = borde superior (px de la lámina). */
  overlays?: Array<{ x?: number; right?: number; y: number; chip: MapChipSpec }>;
}

interface SceneDef {
  /** Tamaño del recorte de la lámina en px (2×). */
  wPx: number;
  hPx: number;
  /** Cámara de la escena (centro y zoom Web Mercator). */
  cam: { lat: number; lng: number; z: number };
  build: (at: (x: number, y: number) => MapPoint, line: (pts: readonly Px[]) => MapPoint[]) => SceneContent;
}

const SCENES: Record<string, SceneDef> = {
  // 09 · Buscar viaje: coches con plazas libres.
  '09': {
    wPx: 728,
    hPx: 770,
    cam: { lat: 37.372, lng: -5.995, z: 11.5 },
    build: (at) => ({
      recenter: true,
      markers: [
        { id: 'c1', kind: 'car', seats: 2, position: at(345, 232) },
        { id: 'c2', kind: 'car', seats: 1, position: at(115, 490) },
        { id: 'c3', kind: 'car', seats: 0, position: at(518, 487) },
        { id: 'c4', kind: 'car', seats: 2, position: at(477, 676) },
      ],
      routes: [],
    }),
  },
  // 11 · Resultado de búsqueda: origen, ruta y destino universitario.
  '11': {
    wPx: 728,
    hPx: 305,
    cam: { lat: 37.384, lng: -6.02, z: 11.8 },
    build: (at, line) => ({
      markers: [
        { id: 'o', kind: 'origin', position: at(203, 167) },
        { id: 'd', kind: 'destination', position: at(588, 97) },
        { id: 'u', kind: 'destinationCap', position: at(588, 160), chip: { title: 'Universidad\nde Sevilla', side: 'bottom', align: 'center', tone: 'neutral' } },
      ],
      routes: [
        {
          id: 'r',
          kind: 'route',
          points: line([[203, 167], [222, 190], [250, 188], [272, 180], [318, 180], [350, 195], [362, 215], [392, 233], [405, 238], [432, 210], [462, 203], [493, 196], [497, 110], [500, 95], [535, 92], [580, 97]]),
        },
      ],
    }),
  },
  // 12 · Ruta del conductor con paradas y horas.
  '12': {
    wPx: 678,
    hPx: 320,
    cam: { lat: 37.355, lng: -5.965, z: 11.3 },
    build: (at, line) => ({
      markers: [
        { id: 'o', kind: 'origin', position: at(55, 78), chip: { title: 'Montequinto', subtitle: '08:05', subtitleTone: 'neutral', size: 'sm' } },
        { id: 's1', kind: 'stop', position: at(183, 208) },
        { id: 's2', kind: 'stop', position: at(493, 262) },
        { id: 'u', kind: 'destinationCap', position: at(610, 193), chip: { title: 'Universidad\nde Sevilla', subtitle: '08:28', subtitleTone: 'neutral', side: 'top', align: 'center', size: 'sm' } },
      ],
      routes: [
        { id: 'r', kind: 'route', points: line([[55, 78], [62, 118], [100, 150], [145, 190], [183, 208], [250, 214], [300, 222], [385, 232], [420, 258], [460, 268], [493, 262], [520, 240], [580, 205]]) },
      ],
    }),
  },
  // 13a · Elegir punto de recogida: ruta del conductor y trayecto a pie.
  '13a': {
    wPx: 728,
    hPx: 765,
    cam: { lat: 37.389, lng: -5.985, z: 13.1 },
    build: (at, line) => ({
      recenter: true,
      legend: true,
      markers: [
        { id: 'car', kind: 'car', variant: 'live', position: at(311, 188) },
        { id: 'eta', kind: 'label', position: at(507, 263), chip: { title: 'A 6 km\nde tu destino', size: 'lg' } },
        { id: 'a', kind: 'pickupA', position: at(303, 470) },
        { id: 'b', kind: 'pickupB', position: at(428, 650) },
        { id: 'walk', kind: 'label', position: at(440, 508), chip: { icon: 'walk', title: '4 min' } },
      ],
      routes: [
        { id: 'r', kind: 'route', points: line([[318, 235], [323, 270], [380, 275], [378, 330], [340, 388], [305, 420]]) },
        { id: 'w', kind: 'walk', points: line([[303, 472], [330, 482], [350, 490], [362, 520], [365, 560], [385, 610], [410, 640], [428, 650]]) },
      ],
    }),
  },
  // 19 · Mis rutas del conductor: paradas y orden (las tarjetas son de la pantalla, alineadas a la derecha como en la lámina).
  '19': {
    wPx: 678,
    hPx: 782,
    cam: { lat: 37.352, lng: -6.03, z: 12.2 },
    build: (at, line) => ({
      markers: [
        { id: 'flag', kind: 'flag', position: at(268, 72) },
        { id: 's3', kind: 'stop', end: true, position: at(252, 130) },
        { id: 's2', kind: 'stop', position: at(232, 420) },
        { id: 's1', kind: 'destination', position: at(222, 700) },
      ],
      routes: [
        { id: 'r', kind: 'route', points: line([[222, 700], [222, 650], [225, 612], [245, 570], [262, 540], [268, 500], [240, 478], [232, 440], [232, 420], [210, 380], [188, 345], [190, 320], [210, 290], [240, 220], [252, 130]]) },
      ],
      overlays: [
        { x: 315, y: 52, chip: { title: 'Sevilla', tone: 'neutral' } },
        { right: 10, y: 122, chip: { title: '3. Sevilla', subtitle: 'Destino', subtitleTone: 'brand', trailing: '07:25', handle: true, size: 'lg' } },
        { right: 10, y: 382, chip: { title: '2. Mairena del Aljarafe', handle: true } },
        { right: 10, y: 637, chip: { title: '1. Palomares del Río', subtitle: 'Origen', subtitleTone: 'brand', trailing: '07:00', handle: true } },
      ],
    }),
  },
  // 21 · Seguimiento del coche que llega a la recogida.
  '21': {
    wPx: 728,
    hPx: 530,
    cam: { lat: 37.392, lng: -5.987, z: 13.2 },
    build: (at, line) => ({
      markers: [
        { id: 'car', kind: 'car', variant: 'live', position: at(205, 141), chip: { title: 'Ana\nllega en 8 min', align: 'center', size: 'lg' } },
        { id: 's', kind: 'stop', position: at(292, 290) },
        { id: 'p', kind: 'destination', position: at(437, 432), chip: { title: 'Tu recogida', subtitle: 'C. Luis Montoto', subtitleTone: 'brand', align: 'center' } },
      ],
      routes: [
        // La lámina dibuja el primer tramo (coche → parada) en azul real y el resto, hasta el anillo de la recogida, en azul más claro y algo más fino.
        { id: 'r1', kind: 'route', points: line([[243, 175], [248, 248], [265, 262], [292, 290]]) },
        { id: 'r2', kind: 'route', color: '#0A88F5', width: 4.6, points: line([[292, 290], [330, 320], [385, 358], [385, 415], [415, 430]]) },
      ],
    }),
  },
  // 22 · Cambio de ruta propuesto: nueva parada.
  '22': {
    wPx: 681,
    hPx: 417,
    cam: { lat: 37.389, lng: -5.985, z: 12.8 },
    build: (at, line) => ({
      markers: [
        { id: 'p', kind: 'destination', position: at(70, 155), chip: { title: 'Tu recogida\n07:25' } },
        { id: 'n', kind: 'stop', tone: 'warning', position: at(298, 232), chip: { title: 'Nueva parada\n08:05', tone: 'warning' } },
        { id: 'd', kind: 'destination', position: at(490, 385), chip: { title: 'Tu destino', tone: 'brand', size: 'sm' } },
      ],
      routes: [{ id: 'r', kind: 'approach', points: line([[70, 155], [120, 163], [210, 177], [250, 215], [300, 242], [300, 285], [350, 305], [440, 355], [490, 385]]) }],
    }),
  },
  // 24 · Detalle de viaje: aproximación y trayecto hasta la universidad.
  '24': {
    wPx: 678,
    hPx: 282,
    cam: { lat: 37.38, lng: -5.986, z: 12.6 },
    build: (at, line) => ({
      markers: [
        { id: 'o', kind: 'origin', position: at(45, 62), chip: { title: 'C. Luis Montoto\n07:25', size: 'sm' } },
        { id: 'd', kind: 'destination', position: at(575, 247), chip: { title: 'Universidad\nde Sevilla\n08:20', side: 'top', align: 'center' } },
      ],
      routes: [
        { id: 'a', kind: 'approach', points: line([[50, 100], [100, 150], [145, 190]]) },
        { id: 'r', kind: 'route', width: 4, points: line([[145, 190], [237, 160], [335, 150], [400, 145], [432, 212], [478, 215], [540, 190], [575, 195]]) },
      ],
    }),
  },
  // 37a · Panel de administración: actividad de coches (agrupaciones y coches sueltos).
  '37a': {
    wPx: 686,
    hPx: 455,
    cam: { lat: 37.394, lng: -5.984, z: 13.0 },
    build: (at) => ({
      markers: [
        { id: 'k1', kind: 'car', variant: 'badge', position: at(200, 71) },
        { id: 'k2', kind: 'car', variant: 'badge', position: at(363, 69) },
        { id: 'k3', kind: 'car', variant: 'badge', position: at(110, 152) },
        { id: 'k4', kind: 'car', variant: 'badge', position: at(635, 135) },
        { id: 'k5', kind: 'car', variant: 'badge', position: at(442, 339) },
        { id: 'c12', kind: 'cluster', count: 12, position: at(460, 122) },
        { id: 'c8', kind: 'cluster', count: 8, position: at(178, 346) },
      ],
      routes: [],
    }),
  },
};

const num = (p: URLSearchParams, k: string, d: number): number => {
  const v = p.get(k);
  return v === null || v === '' || Number.isNaN(Number(v)) ? d : Number(v);
};

/** Proyección pantalla (pt, dentro del mapa) → coordenadas, para una cámara y un tamaño dados. */
function projector(cam: { lat: number; lng: number; z: number }, w: number, h: number): (xPt: number, yPt: number) => MapPoint {
  const world = 256 * 2 ** cam.z;
  const cx = mercatorX(cam.lng);
  const cy = mercatorY(cam.lat);
  return (xPt, yPt) => ({ lat: latFromMercatorY(cy + (yPt - h / 2) / world), lng: lngFromMercatorX(cx + (xPt - w / 2) / world) });
}

function Scene({ id, def }: { id: string; def: SceneDef }): React.JSX.Element {
  const w = def.wPx / 2;
  const h = def.hPx / 2;
  const camera = React.useMemo(() => {
    const z = num(new URLSearchParams(window.location.search), 'z', def.cam.z);
    const lat = num(new URLSearchParams(window.location.search), 'lat', def.cam.lat);
    const lng = num(new URLSearchParams(window.location.search), 'lng', def.cam.lng);
    return { lat, lng, z };
  }, [def]);
  const proj = React.useMemo(() => projector(camera, w, h), [camera, w, h]);
  const content = React.useMemo(() => def.build((x, y) => proj(x / 2, y / 2), (pts) => pts.map(([x, y]) => proj(x / 2, y / 2))), [def, proj]);
  const region = regionForZoom({ lat: camera.lat, lng: camera.lng }, camera.z, { width: w, height: h });
  return (
    <View style={{ width: w, height: h }} testID="scene" nativeID={`scene-${id}`}>
      <MvcMap initialRegion={region} markers={content.markers} routes={content.routes} recenter={content.recenter} style={{ width: w, height: h }} interactive>
        {content.legend ? (
          <MapLegend
            items={[
              { icon: 'car', label: 'Ruta del conductor' },
              { icon: 'walk', label: 'Trayecto a pie desde el punto' },
            ]}
            position="topLeft"
            style={{ left: 15, top: 10 }}
          />
        ) : null}
        {content.overlays?.map((o) => (
          <View key={o.chip.title} style={o.right !== undefined ? { position: 'absolute', right: o.right / 2, top: o.y / 2 } : { position: 'absolute', left: (o.x ?? 0) / 2, top: o.y / 2 }}>
            <MapChip {...o.chip} />
          </View>
        ))}
      </MvcMap>
    </View>
  );
}

export function SceneView({ params }: { params: URLSearchParams }): React.JSX.Element {
  const id = params.get('scene');
  const def = id ? SCENES[id] : undefined;
  if (def && id) return <Scene id={id} def={def} />;
  const w = num(params, 'w', 364);
  const h = num(params, 'h', 385);
  const region = regionForZoom({ lat: num(params, 'lat', 37.3891), lng: num(params, 'lng', -5.9845) }, num(params, 'z', 12.5), { width: w, height: h });
  return (
    <View style={{ width: w, height: h }} testID="scene">
      <MvcMap initialRegion={region} style={{ width: w, height: h }} interactive />
    </View>
  );
}
