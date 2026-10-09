// Sustituto web de react-native-maps (SOLO PARA LA VISTA PREVIA en el navegador; en iOS/Android MVC usa Apple Maps y Google Maps).
//
// Dibuja un mapa vectorial ILUSTRATIVO de Sevilla y su área metropolitana con el estilo claro de las láminas aprobadas:
// tierra gris cálida, casco histórico melocotón con bordes suaves, parques verdes, el Guadalquivir (con el doble brazo de
// La Cartuja) más ancho que el real para que se lea a zoom bajo, callejero local procedural, autovías y avenidas en naranja
// pálido, rótulos con halo, «Río Guadalquivir» a lo largo del cauce y escudos de carretera (SE-30, A-4…).
//
// ⚠ Los datos (mobile/web-stubs/map-data/sevilla-basemap.js, generado por tools/preview/map/build-basemap.mjs) son un dibujo
// aproximado hecho a mano + límites del IGN (es-atlas); NO son datos de navegación ni de ningún servicio de mapas.
// Ver docs/MAPS.md. Misma API que react-native-maps para lo que usa MvcMap (src/maps/MvcMap.tsx): MapView (initialRegion,
// animateToRegion, fitToCoordinates, pointForCoordinate, onRegionChange(Complete), onPress, onMapReady), Marker (anchor,
// zIndex, onPress, hijos), Polyline (trazo, discontinuo, punteado, cabos), Polygon y Circle.
import React, { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BASEMAP_INFO, getLabels, getLayer, getRiverPaths, latOf, lonOf, mercX, mercY } from './map-data/basemap';

export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = null;
export const MAP_TYPES = { STANDARD: 'standard', SATELLITE: 'satellite', HYBRID: 'hybrid', TERRAIN: 'terrain', NONE: 'none', MUTEDSTANDARD: 'mutedStandard' };

const TILE = 256;
const Z_MIN = 5;
const Z_MAX = 19;
const DEFAULT_REGION = { latitude: 37.3891, longitude: -5.9845, latitudeDelta: 0.19, longitudeDelta: 0.2 };
const FONT_STACK = 'Inter, Roboto, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const font = (weight, size, italic) => `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT_STACK}`;

// ───────────────────────────── Estilo (muestreado de las láminas aprobadas) ─────────────────────────────
const PAL = {
  land: '#E9E7E5',
  urban: '#F2E8DD',
  city: '#EBE8E4',
  peach: '#F5EADD',
  agri: '#DCEAD3',
  park: '#D1E5CB',
  parkBig: '#CCE2C4',
  water: '#9FD0F9',
  waterBank: '#D3E8FB',
  streetCase: '#DAD7D3',
  streetFill: '#FFFFFF',
  road: [
    { fill: '#FADFB4', casing: '#F0D3A3' },
    { fill: '#FCEBD0', casing: '#EFD8B2' },
    { fill: '#FFFFFF', casing: '#DAD7D2' },
    { fill: '#FFFFFF', casing: '#DDDAD6' },
  ],
  province: '#BDB7AE',
  muni: '#CFC9C1',
  text: '#252B47',
  textSoft: '#3B4160',
  textRoad: '#5B6178',
  halo: 'rgba(255,255,255,0.88)',
  river: '#2F6FE0',
  shield: '#2F6DB5',
  attribution: 'rgba(255,255,255,0.7)',
  attributionText: '#4A5068',
};

const lerpStops = (z, stops) => {
  if (z <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (z <= stops[i][0]) {
      const [z0, v0] = stops[i - 1];
      const [z1, v1] = stops[i];
      return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
    }
  }
  return stops[stops.length - 1][1];
};
const ramp = (z, from, to) => Math.max(0, Math.min(1, (z - from) / (to - from)));

const STREET_W = [[10, 0.35], [12, 0.6], [13, 0.9], [14, 1.3], [15, 1.9], [16, 3], [17, 4.6], [18, 7.5]];
const ROAD_W = [
  [[6, 0.7], [8, 1.2], [10, 1.8], [12, 2.7], [13, 3.4], [14, 4.4], [15, 6.2], [16, 9], [17, 13], [18, 20]],
  [[8, 0.5], [10, 1.1], [12, 2], [13, 2.8], [14, 3.8], [15, 5.2], [16, 7.4], [17, 11], [18, 17]],
  [[10, 0.6], [12, 1.2], [13, 1.8], [14, 2.6], [15, 3.8], [16, 5.6], [17, 8.4], [18, 13]],
  [[11.5, 0.5], [13, 1.3], [14, 2.1], [15, 3.1], [16, 4.7], [17, 7], [18, 10.5]],
];
const ROAD_MIN_Z = [6, 8, 10.4, 12];
const RIVER_MIN_PT = [[5, 1.5], [8, 4], [10, 10], [11, 22], [12, 32], [13, 40], [14, 48], [15, 52], [15.8, 0]];

// ───────────────────────────── Cámara ─────────────────────────────
const worldSize = (z) => TILE * 2 ** z;
const clampZ = (z, lo = Z_MIN, hi = Z_MAX) => Math.max(lo, Math.min(hi, z));

function cameraForRegion(region, w, h) {
  const r = region && Number.isFinite(region.latitude) && Number.isFinite(region.longitude) ? region : DEFAULT_REGION;
  const dLon = Math.max(1e-5, Math.abs(r.longitudeDelta || 0.05));
  const dLat = Math.max(1e-5, Math.abs(r.latitudeDelta || 0.05));
  const yTop = mercY(r.latitude + dLat / 2);
  const yBot = mercY(r.latitude - dLat / 2);
  const zLon = Math.log2((w * 360) / dLon / TILE);
  const zLat = Math.log2(h / Math.max(1e-9, yBot - yTop) / TILE);
  return { cx: mercX(r.longitude), cy: (yTop + yBot) / 2, z: clampZ(Math.min(zLon, zLat)) };
}

function regionForCamera(cam, w, h) {
  const ws = worldSize(cam.z);
  const top = latOf(cam.cy - h / 2 / ws);
  const bottom = latOf(cam.cy + h / 2 / ws);
  return { latitude: latOf(cam.cy), longitude: lonOf(cam.cx), latitudeDelta: Math.abs(top - bottom), longitudeDelta: (w / ws) * 360 };
}

// ───────────────────────────── Dibujo: trazados ─────────────────────────────
function tracePath(ctx, parts, ox, oy, ws, closed) {
  for (const arr of parts) {
    const n = arr.length / 2;
    let lx = arr[0] * ws + ox;
    let ly = arr[1] * ws + oy;
    ctx.moveTo(lx, ly);
    for (let k = 1; k < n; k++) {
      const x = arr[k * 2] * ws + ox;
      const y = arr[k * 2 + 1] * ws + oy;
      if (k < n - 1 && Math.abs(x - lx) + Math.abs(y - ly) < 0.7) continue;
      ctx.lineTo(x, y);
      lx = x;
      ly = y;
    }
    if (closed) ctx.closePath();
  }
}

function visibleFeatures(layer, view, filter) {
  const out = [];
  if (!layer) return out;
  for (const f of layer.features) {
    const b = f.bbox;
    if (b[2] < view[0] || b[0] > view[2] || b[3] < view[1] || b[1] > view[3]) continue;
    if (filter && !filter(f)) continue;
    out.push(f);
  }
  return out;
}

function fillFeatures(ctx, feats, ox, oy, ws, style) {
  if (!feats.length) return;
  ctx.beginPath();
  for (const f of feats) tracePath(ctx, f.parts, ox, oy, ws, true);
  ctx.fillStyle = style;
  ctx.fill('nonzero');
}

function strokeFeatures(ctx, feats, ox, oy, ws, color, width, dash) {
  if (!feats.length || width <= 0) return;
  ctx.beginPath();
  for (const f of feats) tracePath(ctx, f.parts, ox, oy, ws, false);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash || []);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Capas «blandas» (casco, mancha urbana, campo): se dibujan a baja resolución y se amplían con suavizado → bordes difusos
// como en las láminas. Un lienzo auxiliar por capa.
const softCanvases = new Map();
function drawSoft(ctx, key, feats, color, ox, oy, ws, w, h, k) {
  if (!feats.length) return;
  let cv = softCanvases.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    softCanvases.set(key, cv);
  }
  const pw = Math.ceil(w / k) + 2;
  const ph = Math.ceil(h / k) + 2;
  if (cv.width !== pw || cv.height !== ph) {
    cv.width = pw;
    cv.height = ph;
  }
  const pc = cv.getContext('2d');
  pc.setTransform(1, 0, 0, 1, 0, 0);
  pc.clearRect(0, 0, pw, ph);
  pc.setTransform(1 / k, 0, 0, 1 / k, 0, 0);
  pc.beginPath();
  for (const f of feats) tracePath(pc, f.parts, ox, oy, ws, true);
  pc.fillStyle = color;
  pc.fill('nonzero');
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  // «medium» (bilineal): con «high» Chrome aplica un filtro con sobreimpulso que dibuja un filo claro dentro de las manchas.
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(cv, 0, 0, pw * k, ph * k);
  ctx.restore();
}

function drawBasemap(ctx, cam, w, h) {
  const z = cam.z;
  const ws = worldSize(z);
  const ox = w / 2 - cam.cx * ws;
  const oy = h / 2 - cam.cy * ws;
  const m = 40 / ws;
  const view = [cam.cx - w / 2 / ws - m, cam.cy - h / 2 / ws - m, cam.cx + w / 2 / ws + m, cam.cy + h / 2 / ws + m];
  const mpp = (156543.03392 * Math.cos((latOf(cam.cy) * Math.PI) / 180)) / 2 ** z; // metros por punto

  ctx.fillStyle = PAL.land;
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Límites de municipio y provincia (solo zoom bajo/medio).
  if (z < 13.2) {
    const a = Math.min(1, (13.2 - z) / 1.2) * ramp(z, 8.2, 9.4);
    if (a > 0) {
      ctx.globalAlpha = a * 0.8;
      strokeFeatures(ctx, visibleFeatures(getLayer('munis'), view), ox, oy, ws, PAL.muni, lerpStops(z, [[8.5, 0.5], [12, 1]]), [2, 3]);
      ctx.globalAlpha = 1;
    }
  }
  if (z < 12.5) strokeFeatures(ctx, visibleFeatures(getLayer('province'), view), ox, oy, ws, PAL.province, lerpStops(z, [[5, 0.8], [9, 1.2], [12, 1.6]]), [5, 3]);

  // Campo (verde pálido), mancha urbana y casco histórico (melocotón): bordes suaves.
  drawSoft(ctx, 'agri', visibleFeatures(getLayer('agri'), view), PAL.agri, ox, oy, ws, w, h, 5);
  const urban = getLayer('urban');
  const urbanKind = urban ? urban.props.k : [];
  drawSoft(ctx, 'city', visibleFeatures(urban, view, (f) => urbanKind[f.i] === 0), PAL.city, ox, oy, ws, w, h, 5);
  drawSoft(ctx, 'town', visibleFeatures(urban, view, (f) => urbanKind[f.i] !== 0), PAL.urban, ox, oy, ws, w, h, 5);
  drawSoft(ctx, 'peach', visibleFeatures(getLayer('peach'), view), PAL.peach, ox, oy, ws, w, h, 6);

  // Parques (los pequeños aparecen al acercarse).
  const green = getLayer('green');
  const big = green ? green.props.big : [];
  const bigs = visibleFeatures(green, view, (f) => big[f.i] === 1);
  fillFeatures(ctx, bigs, ox, oy, ws, PAL.parkBig);
  const pocket = ramp(z, 10.8, 11.8);
  if (pocket > 0) {
    ctx.globalAlpha = pocket;
    fillFeatures(ctx, visibleFeatures(green, view, (f) => big[f.i] !== 1), ox, oy, ws, PAL.park);
    ctx.globalAlpha = 1;
  }

  // Callejero local: contorno (todas las capas) y relleno (todas las capas); aparece por niveles.
  const lods = [
    { id: 'st0', from: 11.8, to: 12.8 },
    { id: 'st1', from: 13.4, to: 14.2 },
    { id: 'st2', from: 14.9, to: 15.7 },
  ].map((l) => ({ ...l, a: ramp(z, l.from, l.to), feats: visibleFeatures(getLayer(l.id), view) }));
  const sw = lerpStops(z, STREET_W);
  const casing = z >= 13 ? 0.9 : 0.5;
  const streetAlpha = 0.72 + 0.28 * ramp(z, 12.5, 15);
  for (const l of lods) {
    if (l.a <= 0) continue;
    ctx.globalAlpha = l.a * streetAlpha * 0.5;
    strokeFeatures(ctx, l.feats, ox, oy, ws, PAL.streetCase, sw + casing);
  }
  for (const l of lods) {
    if (l.a <= 0) continue;
    ctx.globalAlpha = l.a * streetAlpha;
    strokeFeatures(ctx, l.feats, ox, oy, ws, PAL.streetFill, sw);
  }
  ctx.globalAlpha = 1;

  // Río: ancho real con un mínimo en puntos para que se lea a zoom bajo (como en las láminas).
  const river = getLayer('river');
  if (river) {
    const minPx = lerpStops(z, RIVER_MIN_PT);
    const feats = visibleFeatures(river, view);
    const branch = river.props.b;
    const widthOf = (f) => Math.max(river.props.w[f.i] / mpp, branch[f.i] === 1 || branch[f.i] === 2 ? minPx * 0.62 : minPx);
    for (const f of feats) strokeFeatures(ctx, [f], ox, oy, ws, PAL.waterBank, widthOf(f) + Math.min(5, 2 + widthOf(f) * 0.06));
    for (const f of feats) strokeFeatures(ctx, [f], ox, oy, ws, PAL.water, widthOf(f));
  }

  // Carreteras: de menos a más importante; cada clase con su contorno y su relleno.
  const roads = getLayer('roads');
  if (roads) {
    const cls = roads.props.c;
    const feats = visibleFeatures(roads, view);
    for (const c of [3, 2, 1, 0]) {
      if (z < ROAD_MIN_Z[c]) continue;
      const group = feats.filter((f) => cls[f.i] === c);
      if (!group.length) continue;
      const rw = lerpStops(z, ROAD_W[c]);
      strokeFeatures(ctx, group, ox, oy, ws, PAL.road[c].casing, rw + (c <= 1 ? 0.9 : 0.8));
      strokeFeatures(ctx, group, ox, oy, ws, PAL.road[c].fill, rw);
    }
  }
  return { view, ws, ox, oy, mpp };
}

// ───────────────────────────── Rótulos ─────────────────────────────
const widthCache = new Map();
function textWidth(ctx, fontSpec, text) {
  const key = `${fontSpec}|${text}`;
  let v = widthCache.get(key);
  if (v === undefined) {
    ctx.font = fontSpec;
    v = ctx.measureText(text).width;
    if (widthCache.size > 4000) widthCache.clear();
    widthCache.set(key, v);
  }
  return v;
}

const collides = (boxes, b) => {
  for (let i = 0; i < boxes.length; i++) {
    const o = boxes[i];
    if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return true;
  }
  return false;
};

function haloText(ctx, text, x, y, fill, halo, haloWidth) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = haloWidth;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function setSpacing(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

/** Rótulo de lugar (una o varias líneas, centrado). */
function placeLabel(ctx, boxes, text, x, y, size, weight, fill, view) {
  if (x < -30 || x > view.w + 30 || y < -20 || y > view.h + 20) return false;
  const fontSpec = font(weight, size);
  const lines = text.split('\n');
  const lh = size * 1.18;
  let tw = 0;
  for (const l of lines) tw = Math.max(tw, textWidth(ctx, fontSpec, l));
  const th = lh * lines.length;
  const box = [x - tw / 2 - 3, y - th / 2 - 2, x + tw / 2 + 3, y + th / 2 + 2];
  if (box[0] < 2 || box[2] > view.w - 2 || box[1] < 2 || box[3] > view.h - 2) return false;
  if (collides(boxes, box)) return false;
  boxes.push(box);
  ctx.font = fontSpec;
  lines.forEach((l, i) => haloText(ctx, l, x, y - th / 2 + lh * (i + 0.5), fill, PAL.halo, size >= 18 ? 4 : 3.4));
  return true;
}

/** Rótulo a lo largo de una polilínea de pantalla (río, calles). Devuelve true si se dibujó. */
function labelAlongPath(ctx, boxes, poly, text, { fontSpec, fill, spacing = 0, halo = PAL.halo, haloW = 3, size, view }) {
  ctx.font = fontSpec;
  setSpacing(ctx, spacing);
  const adv = [...text].map((ch) => ctx.measureText(ch).width + spacing);
  const tw = adv.reduce((a, b) => a + b, 0) - spacing;
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total < tw + 24) {
    setSpacing(ctx, 0);
    return false;
  }
  const at = (s) => {
    const t = Math.max(0, Math.min(total, s));
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= t) lo = mid;
      else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    const u = (t - cum[lo]) / seg;
    return [poly[lo][0] + (poly[hi][0] - poly[lo][0]) * u, poly[lo][1] + (poly[hi][1] - poly[lo][1]) * u];
  };
  let s0 = (total - tw) / 2;
  const a = at(s0);
  const b = at(s0 + tw);
  const reverse = b[0] < a[0];
  if (reverse) s0 = total - s0 - tw;
  const pathAt = reverse ? (s) => at(total - s) : at;
  // Ocupación para colisiones (centros de glifo ensanchados).
  const glyphs = [];
  let s = s0;
  for (let i = 0; i < adv.length; i++) {
    const c = pathAt(s + adv[i] / 2);
    const p1 = pathAt(s + adv[i] / 2 - Math.max(2, adv[i] / 2));
    const p2 = pathAt(s + adv[i] / 2 + Math.max(2, adv[i] / 2));
    glyphs.push({ ch: [...text][i], x: c[0], y: c[1], ang: Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) });
    s += adv[i];
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of glyphs) {
    minX = Math.min(minX, g.x);
    maxX = Math.max(maxX, g.x);
    minY = Math.min(minY, g.y);
    maxY = Math.max(maxY, g.y);
  }
  const box = [minX - size * 0.7, minY - size * 0.7, maxX + size * 0.7, maxY + size * 0.7];
  const bend = Math.abs(glyphs[glyphs.length - 1].ang - glyphs[0].ang);
  if (box[0] < 4 || box[2] > view.w - 4 || box[1] < 4 || box[3] > view.h - 4 || collides(boxes, box) || bend > 1.4) {
    setSpacing(ctx, 0);
    return false;
  }
  boxes.push(box);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const g of glyphs) {
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.ang);
    haloText(ctx, g.ch, 0, 0, fill, halo, haloW);
    ctx.restore();
  }
  setSpacing(ctx, 0);
  return true;
}

/** Tramo visible más largo de una polilínea Mercator, en coordenadas de pantalla. */
function visibleRun(arr, ox, oy, ws, view, margin) {
  let best = [];
  let cur = [];
  const n = arr.length / 2;
  for (let k = 0; k < n; k++) {
    const x = arr[k * 2] * ws + ox;
    const y = arr[k * 2 + 1] * ws + oy;
    if (x > margin && x < view.w - margin && y > margin && y < view.h - margin) cur.push([x, y]);
    else {
      if (cur.length > best.length) best = cur;
      cur = [];
    }
  }
  return cur.length > best.length ? cur : best;
}

function drawLabels(ctx, cam, w, h, base, reserved) {
  const { ws, ox, oy, view: viewN } = base;
  const z = cam.z;
  const view = { w, h };
  const boxes = reserved.slice();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const sx = (p) => p[0] * ws + ox;
  const sy = (p) => p[1] * ws + oy;

  // «Río Guadalquivir» a lo largo del cauce (primero: es el rótulo que más pesa en las láminas).
  if (z >= 9.8) {
    const size = lerpStops(z, [[9.8, 11], [12, 14], [15, 16]]);
    const paths = getRiverPaths().slice().sort((a, b) => b.branch - a.branch);
    for (const p of paths) {
      const run = visibleRun(p.pts, ox, oy, ws, view, 36);
      if (run.length < 2) continue;
      if (labelAlongPath(ctx, boxes, run, BASEMAP_INFO.name, { fontSpec: font(500, size, true), fill: PAL.river, spacing: 1.2, halo: 'rgba(255,255,255,0.65)', haloW: 2.4, size, view })) break;
    }
  }

  // Lugares: por rango y por tamaño del lugar (zoom mínimo menor = más importante).
  const lab = getLabels();
  const places = lab.places.filter((p) => z >= p.minZoom - 0.4 && z <= p.maxZoom).sort((a, b) => a.rank - b.rank || a.minZoom - b.minZoom);
  for (const p of places) {
    const x = sx(p.p);
    const y = sy(p.p);
    if (p.rank === 0) {
      const size = lerpStops(z, [[6, 11], [9, 15], [11, 19], [13, 20], [15, 25]]);
      placeLabel(ctx, boxes, p.name, x, y, size, 700, '#1B1F3B', view);
    } else if (p.rank <= 3) {
      const size = lerpStops(z, [[8, 12], [11, 13.5], [13, 14.5], [16, 16]]);
      placeLabel(ctx, boxes, p.name, x, y, size, 500, PAL.text, view);
    } else {
      const size = lerpStops(z, [[12, 11.5], [14, 12.5], [16, 14]]);
      placeLabel(ctx, boxes, p.name, x, y, size, 500, PAL.textSoft, view);
    }
  }

  // Escudos de carretera.
  if (z >= 9.6) {
    const placed = [];
    const fontSpec = font(700, 10.5);
    for (const s of lab.shields) {
      const x = sx(s.p);
      const y = sy(s.p);
      if (x < 24 || x > w - 24 || y < 16 || y > h - 16) continue;
      if (placed.some((q) => q.ref === s.ref && Math.hypot(q.x - x, q.y - y) < 220)) continue;
      const tw = textWidth(ctx, fontSpec, s.ref) + 12;
      const box = [x - tw / 2, y - 9, x + tw / 2, y + 9];
      if (collides(boxes, box)) continue;
      boxes.push(box);
      placed.push({ ref: s.ref, x, y });
      ctx.fillStyle = PAL.shield;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(box[0], box[1], tw, 18, 4);
      else ctx.rect(box[0], box[1], tw, 18);
      ctx.fill();
      ctx.stroke();
      ctx.font = fontSpec;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(s.ref, x, y + 0.5);
    }
  }

  // Nombres de calle a lo largo del trazado (solo muy cerca).
  if (z >= 15.2) {
    const roads = getLayer('roads');
    const names = roads ? roads.props.nm : [];
    const fontSpec = font(500, 11.5);
    for (const f of visibleFeatures(roads, viewN, (f) => names[f.i])) {
      const run = visibleRun(f.parts[0], ox, oy, ws, view, 22);
      if (run.length >= 2) labelAlongPath(ctx, boxes, run, names[f.i], { fontSpec, fill: PAL.textRoad, spacing: 0.3, haloW: 3, size: 11.5, view });
    }
  }
}

// ───────────────────────────── Formas de la app (polilíneas, polígonos, círculos) ─────────────────────────────
const cssColor = (c, fallback) => (typeof c === 'string' && c ? c : fallback);

function drawShapes(ctx, shapes, cam, w, h) {
  const ws = worldSize(cam.z);
  const ox = w / 2 - cam.cx * ws;
  const oy = h / 2 - cam.cy * ws;
  const toScreen = (c) => [mercX(c.longitude) * ws + ox, mercY(c.latitude) * ws + oy];
  const mpp = (156543.03392 * Math.cos((latOf(cam.cy) * Math.PI) / 180)) / 2 ** cam.z;
  const list = [...shapes.values()].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  for (const s of list) {
    if (s.type === 'polygon' && s.coordinates && s.coordinates.length > 2) {
      ctx.beginPath();
      s.coordinates.forEach((c, i) => {
        const [x, y] = toScreen(c);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      (s.holes || []).forEach((hole) => {
        hole.forEach((c, i) => {
          const [x, y] = toScreen(c);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      });
      ctx.fillStyle = cssColor(s.fillColor, 'rgba(0,40,85,0.2)');
      ctx.fill('evenodd');
      ctx.lineWidth = s.strokeWidth ?? 1.5;
      ctx.strokeStyle = cssColor(s.strokeColor, '#002855');
      ctx.setLineDash(s.lineDashPattern || []);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (s.type === 'circle' && s.center) {
      const [x, y] = toScreen(s.center);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, (s.radius || 0) / mpp), 0, Math.PI * 2);
      ctx.fillStyle = cssColor(s.fillColor, 'rgba(0,40,85,0.15)');
      ctx.fill();
      ctx.lineWidth = s.strokeWidth ?? 1.5;
      ctx.strokeStyle = cssColor(s.strokeColor, '#002855');
      ctx.stroke();
    } else if (s.type === 'polyline' && s.coordinates && s.coordinates.length > 1) {
      ctx.beginPath();
      s.coordinates.forEach((c, i) => {
        const [x, y] = toScreen(c);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineCap = s.lineCap === 'butt' || s.lineCap === 'square' ? s.lineCap : 'round';
      ctx.lineJoin = s.lineJoin === 'miter' || s.lineJoin === 'bevel' ? s.lineJoin : 'round';
      ctx.lineWidth = s.strokeWidth ?? 3;
      ctx.strokeStyle = cssColor(s.strokeColor, '#002855');
      ctx.setLineDash(s.lineDashPattern || []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

// ───────────────────────────── Componente MapView ─────────────────────────────
const MapContext = createContext(null);

const MapView = forwardRef(function MapView(props, ref) {
  const { initialRegion, region: controlledRegion, children, style, accessibilityLabel, minZoomLevel, maxZoomLevel, scrollEnabled = true, zoomEnabled = true } = props;
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const camRef = useRef(null);
  const shapesRef = useRef(new Map());
  const markersRef = useRef(new Map());
  const frameRef = useRef(0);
  const animRef = useRef(null);
  const gestureRef = useRef(false);
  const readyRef = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const zLimitsRef = useRef([Z_MIN, Z_MAX]);
  zLimitsRef.current = [Math.max(Z_MIN, minZoomLevel ?? Z_MIN), Math.min(Z_MAX, maxZoomLevel ?? Z_MAX)];
  const decorative = scrollEnabled === false;

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const cam = camRef.current;
    const { w, h } = sizeRef.current;
    if (!canvas || !cam || w < 2 || h < 2) return;
    const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ws = worldSize(cam.z);
    // Marcadores: posición en pantalla y recuadro reservado para que los rótulos no se pisen con ellos.
    const reserved = [];
    for (const m of markersRef.current.values()) {
      const c = m.props.coordinate;
      if (!c || !m.el) continue;
      const mw = m.w || m.el.offsetWidth || 0;
      const mh = m.h || m.el.offsetHeight || 0;
      const ax = m.props.anchor && typeof m.props.anchor.x === 'number' ? m.props.anchor.x : 0.5;
      const ay = m.props.anchor && typeof m.props.anchor.y === 'number' ? m.props.anchor.y : 0.5;
      const x = (mercX(c.longitude) - cam.cx) * ws + w / 2 - ax * mw;
      const y = (mercY(c.latitude) - cam.cy) * ws + h / 2 - ay * mh;
      m.screen = { x, y, w: mw, h: mh };
      if (mw > 0 && mh > 0 && m.props.tappable !== false) reserved.push([x - 4, y - 4, x + mw + 4, y + mh + 4]);
    }
    for (const sh of shapesRef.current.values()) {
      if (sh.type !== 'polyline' || !sh.coordinates || sh.coordinates.length < 2) continue;
      let px = 0;
      let py = 0;
      sh.coordinates.forEach((c, i) => {
        const x = (mercX(c.longitude) - cam.cx) * ws + w / 2;
        const y = (mercY(c.latitude) - cam.cy) * ws + h / 2;
        if (i > 0) {
          const n = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / 12));
          for (let k = 1; k <= n; k++) {
            const bx = px + ((x - px) * k) / n;
            const by = py + ((y - py) * k) / n;
            reserved.push([bx - 7, by - 7, bx + 7, by + 7]);
          }
        }
        px = x;
        py = y;
      });
    }
    const base = drawBasemap(ctx, cam, w, h);
    drawLabels(ctx, cam, w, h, base, reserved);
    drawShapes(ctx, shapesRef.current, cam, w, h);
    for (const m of markersRef.current.values()) {
      if (!m.el || !m.screen) continue;
      const { x, y, w: mw, h: mh } = m.screen;
      const hidden = x + mw < -80 || x > w + 80 || y + mh < -80 || y > h + 80 || mw === 0;
      m.el.style.visibility = hidden ? 'hidden' : 'visible';
      m.el.style.transform = `translate3d(${Math.round(x * 2) / 2}px, ${Math.round(y * 2) / 2}px, 0)`;
      m.el.style.zIndex = String(Math.round(m.props.zIndex ?? 0) + 10);
    }
    if (!readyRef.current) {
      readyRef.current = true;
      setTimeout(() => propsRef.current.onMapReady && propsRef.current.onMapReady(), 0);
    }
  }, []);

  const schedule = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const settleTimer = useRef(null);
  const emitComplete = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const cam = camRef.current;
      const { w, h } = sizeRef.current;
      if (!cam || w < 2) return;
      const cb = propsRef.current.onRegionChangeComplete;
      if (cb) cb(regionForCamera(cam, w, h), { isGesture: gestureRef.current });
      gestureRef.current = false;
    }, 140);
  }, []);

  const setCamera = useCallback(
    (next, { complete = false } = {}) => {
      const [zmin, zmax] = zLimitsRef.current;
      camRef.current = { cx: ((next.cx % 1) + 1) % 1, cy: Math.max(0.02, Math.min(0.98, next.cy)), z: clampZ(next.z, zmin, zmax) };
      const cb = propsRef.current.onRegionChange;
      if (cb && sizeRef.current.w > 1) cb(regionForCamera(camRef.current, sizeRef.current.w, sizeRef.current.h), { isGesture: gestureRef.current });
      schedule();
      if (complete) emitComplete();
    },
    [schedule, emitComplete],
  );

  const stopAnimation = () => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current.raf);
      animRef.current = null;
    }
  };

  const animateTo = useCallback(
    (target, duration = 500) => {
      stopAnimation();
      gestureRef.current = false;
      const from = camRef.current;
      if (!from || duration <= 0) {
        setCamera(target, { complete: true });
        return;
      }
      const start = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - start) / duration);
        const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
        setCamera({ cx: from.cx + (target.cx - from.cx) * e, cy: from.cy + (target.cy - from.cy) * e, z: from.z + (target.z - from.z) * e });
        if (k < 1) animRef.current = { raf: requestAnimationFrame(step) };
        else {
          animRef.current = null;
          emitComplete();
        }
      };
      animRef.current = { raf: requestAnimationFrame(step) };
    },
    [setCamera, emitComplete],
  );

  // Tamaño del mapa.
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === sizeRef.current.w && h === sizeRef.current.h) return;
      sizeRef.current = { w, h };
      if (!camRef.current && w > 1 && h > 1) camRef.current = cameraForRegion(controlledRegion || initialRegion || DEFAULT_REGION, w, h);
      setSize({ w, h });
      schedule();
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
    };
    // Efecto de montaje: la región inicial se lee una sola vez.
  }, []);

  // Región controlada.
  const regionKey = controlledRegion ? `${controlledRegion.latitude},${controlledRegion.longitude},${controlledRegion.latitudeDelta},${controlledRegion.longitudeDelta}` : '';
  useEffect(() => {
    if (!controlledRegion || sizeRef.current.w < 2) return;
    camRef.current = cameraForRegion(controlledRegion, sizeRef.current.w, sizeRef.current.h);
    schedule();
  }, [regionKey]);

  useEffect(() => () => {
    stopAnimation();
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  useImperativeHandle(ref, () => ({
    animateToRegion: (r, duration = 500) => {
      const { w, h } = sizeRef.current;
      if (!r || w < 2) return;
      animateTo(cameraForRegion(r, w, h), duration);
    },
    animateCamera: (camera, opts = {}) => {
      const cur = camRef.current;
      if (!cur || !camera) return;
      const c = camera.center;
      animateTo({ cx: c ? mercX(c.longitude) : cur.cx, cy: c ? mercY(c.latitude) : cur.cy, z: typeof camera.zoom === 'number' ? camera.zoom : cur.z }, opts.duration ?? 500);
    },
    setCamera: (camera) => {
      const cur = camRef.current;
      if (!cur || !camera) return;
      const c = camera.center;
      setCamera({ cx: c ? mercX(c.longitude) : cur.cx, cy: c ? mercY(c.latitude) : cur.cy, z: typeof camera.zoom === 'number' ? camera.zoom : cur.z }, { complete: true });
    },
    fitToCoordinates: (coords, opts = {}) => {
      const { w, h } = sizeRef.current;
      const pts = (coords || []).filter((c) => c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
      if (!pts.length || w < 2) return;
      const pad = opts.edgePadding || {};
      const iw = Math.max(40, w - (pad.left || 0) - (pad.right || 0));
      const ih = Math.max(40, h - (pad.top || 0) - (pad.bottom || 0));
      const xs = pts.map((c) => mercX(c.longitude));
      const ys = pts.map((c) => mercY(c.latitude));
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      const z = clampZ(Math.min(Math.log2(iw / Math.max(x1 - x0, 1e-7) / TILE), Math.log2(ih / Math.max(y1 - y0, 1e-7) / TILE), 17));
      const ws = worldSize(z);
      const cx = (x0 + x1) / 2 + ((pad.right || 0) - (pad.left || 0)) / 2 / ws;
      const cy = (y0 + y1) / 2 + ((pad.bottom || 0) - (pad.top || 0)) / 2 / ws;
      animateTo({ cx, cy, z }, opts.animated === false ? 0 : 450);
    },
    fitToElements: () => undefined,
    fitToSuppliedMarkers: () => undefined,
    getCamera: async () => {
      const cam = camRef.current || { cx: 0.5, cy: 0.5, z: 10 };
      return { center: { latitude: latOf(cam.cy), longitude: lonOf(cam.cx) }, zoom: cam.z, heading: 0, pitch: 0, altitude: 0 };
    },
    getMapBoundaries: async () => {
      const r = regionForCamera(camRef.current, sizeRef.current.w, sizeRef.current.h);
      return { northEast: { latitude: r.latitude + r.latitudeDelta / 2, longitude: r.longitude + r.longitudeDelta / 2 }, southWest: { latitude: r.latitude - r.latitudeDelta / 2, longitude: r.longitude - r.longitudeDelta / 2 } };
    },
    pointForCoordinate: async (c) => {
      const cam = camRef.current;
      const ws = worldSize(cam.z);
      return { x: (mercX(c.longitude) - cam.cx) * ws + sizeRef.current.w / 2, y: (mercY(c.latitude) - cam.cy) * ws + sizeRef.current.h / 2 };
    },
    coordinateForPoint: async (p) => {
      const cam = camRef.current;
      const ws = worldSize(cam.z);
      return { latitude: latOf(cam.cy + (p.y - sizeRef.current.h / 2) / ws), longitude: lonOf(cam.cx + (p.x - sizeRef.current.w / 2) / ws) };
    },
  }));

  // ── Gestos (arrastrar, pellizcar, rueda, doble toque, toque en marcador) ──
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const pointers = new Map();
    let drag = null;
    let pinch = null;
    let lastTap = 0;
    let inertia = 0;
    const local = (e) => {
      const r = el.getBoundingClientRect();
      const sx = r.width / (el.clientWidth || r.width || 1);
      const sy = r.height / (el.clientHeight || r.height || 1);
      return { x: (e.clientX - r.left) / (sx || 1), y: (e.clientY - r.top) / (sy || 1) };
    };
    const coordAt = (pt) => {
      const cam = camRef.current;
      const ws = worldSize(cam.z);
      return { latitude: latOf(cam.cy + (pt.y - sizeRef.current.h / 2) / ws), longitude: lonOf(cam.cx + (pt.x - sizeRef.current.w / 2) / ws) };
    };
    const zoomAround = (pt, nz, complete) => {
      const cam = camRef.current;
      if (!cam) return;
      const [zmin, zmax] = zLimitsRef.current;
      const z = clampZ(nz, zmin, zmax);
      const ws0 = worldSize(cam.z);
      const ws1 = worldSize(z);
      const { w, h } = sizeRef.current;
      const mx = cam.cx + (pt.x - w / 2) / ws0;
      const my = cam.cy + (pt.y - h / 2) / ws0;
      setCamera({ cx: mx - (pt.x - w / 2) / ws1, cy: my - (pt.y - h / 2) / ws1, z }, { complete });
    };
    const canMove = () => propsRef.current.scrollEnabled !== false;
    const canZoom = () => propsRef.current.zoomEnabled !== false && propsRef.current.scrollEnabled !== false;

    const onDown = (e) => {
      if (e.button !== undefined && e.button > 0) return;
      stopAnimation();
      cancelAnimationFrame(inertia);
      const pt = local(e);
      pointers.set(e.pointerId, { ...pt, t: performance.now() });
      try {
        el.setPointerCapture(e.pointerId);
      } catch (err) {
        // sin captura de puntero
      }
      if (pointers.size === 1) {
        drag = { start: pt, last: pt, moved: false, samples: [{ ...pt, t: performance.now() }], target: e.target };
      } else if (pointers.size === 2 && canZoom()) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: camRef.current.z, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        if (drag) drag.moved = true;
      }
    };
    const onMove = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const pt = local(e);
      pointers.set(e.pointerId, { ...pt, t: performance.now() });
      if (pinch && pointers.size >= 2) {
        gestureRef.current = true;
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const cam = camRef.current;
        if (canMove()) {
          const ws = worldSize(cam.z);
          camRef.current = { ...cam, cx: cam.cx - (mid.x - pinch.mid.x) / ws, cy: cam.cy - (mid.y - pinch.mid.y) / ws };
        }
        pinch.mid = mid;
        zoomAround(mid, pinch.z + Math.log2(Math.max(0.05, d / Math.max(1, pinch.d))), false);
        return;
      }
      if (!drag) return;
      const dx = pt.x - drag.last.x;
      const dy = pt.y - drag.last.y;
      if (!drag.moved && Math.hypot(pt.x - drag.start.x, pt.y - drag.start.y) > 6) drag.moved = true;
      if (drag.moved && canMove()) {
        gestureRef.current = true;
        const cam = camRef.current;
        const ws = worldSize(cam.z);
        setCamera({ cx: cam.cx - dx / ws, cy: cam.cy - dy / ws, z: cam.z });
        drag.samples.push({ ...pt, t: performance.now() });
        if (drag.samples.length > 6) drag.samples.shift();
      }
      drag.last = pt;
    };
    const onUp = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch (err) {
        // sin captura de puntero
      }
      if (pinch) {
        if (pointers.size < 2) {
          pinch = null;
          emitComplete();
        }
        if (pointers.size === 1 && drag) drag.last = [...pointers.values()][0];
        return;
      }
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.moved) {
        const s = d.samples;
        if (s.length >= 2 && canMove()) {
          const a = s[0];
          const b = s[s.length - 1];
          const dt = Math.max(16, b.t - a.t);
          let vx = ((b.x - a.x) / dt) * 16;
          let vy = ((b.y - a.y) / dt) * 16;
          if (performance.now() - b.t > 80 || Math.hypot(vx, vy) < 1.5) {
            emitComplete();
            return;
          }
          const step = () => {
            vx *= 0.93;
            vy *= 0.93;
            const cam = camRef.current;
            const ws = worldSize(cam.z);
            setCamera({ cx: cam.cx - vx / ws, cy: cam.cy - vy / ws, z: cam.z });
            if (Math.hypot(vx, vy) > 0.4) inertia = requestAnimationFrame(step);
            else emitComplete();
          };
          inertia = requestAnimationFrame(step);
        } else emitComplete();
        return;
      }
      // Toque: marcador → mapa. Doble toque: acercar.
      const now = performance.now();
      const pt = d.start;
      const markerEl = d.target && d.target.closest ? d.target.closest('[data-pv-marker]') : null;
      if (markerEl) {
        const m = markersRef.current.get(markerEl.getAttribute('data-pv-marker'));
        if (m && m.props.tappable !== false && m.props.onPress) m.props.onPress({ nativeEvent: { coordinate: m.props.coordinate, position: pt, action: 'marker-press', id: m.props.identifier }, stopPropagation: () => undefined });
        return;
      }
      if (now - lastTap < 300 && canZoom()) {
        lastTap = 0;
        const cam = camRef.current;
        const { w, h } = sizeRef.current;
        const ws0 = worldSize(cam.z);
        const mx = cam.cx + (pt.x - w / 2) / ws0;
        const my = cam.cy + (pt.y - h / 2) / ws0;
        const z = Math.min(zLimitsRef.current[1], cam.z + 1);
        const ws1 = worldSize(z);
        gestureRef.current = true;
        animateTo({ cx: mx - (pt.x - w / 2) / ws1, cy: my - (pt.y - h / 2) / ws1, z }, 260);
        gestureRef.current = true;
        return;
      }
      lastTap = now;
      const cb = propsRef.current.onPress;
      if (cb) cb({ nativeEvent: { coordinate: coordAt(pt), position: pt, action: 'press' } });
    };
    const onWheel = (e) => {
      if (!canZoom()) return;
      // Mapas pequeños dentro de una pantalla que se desplaza: la rueda mueve la pantalla y el zoom se hace con
      // pellizco (trackpad) o Ctrl + rueda. Los mapas a pantalla casi completa hacen zoom siempre.
      const vh = window.innerHeight || 800;
      if (!e.ctrlKey && !e.metaKey && el.clientHeight < vh * 0.55) return;
      e.preventDefault();
      stopAnimation();
      cancelAnimationFrame(inertia);
      gestureRef.current = true;
      const pt = local(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAround(pt, camRef.current.z - delta * (e.ctrlKey ? 0.012 : 0.0024), true);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(inertia);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
    // Los gestos leen siempre propsRef/refs: se instalan una vez.
  }, []);

  const ctxValue = useRef({
    registerMarker: (id, entry) => {
      markersRef.current.set(id, entry);
      schedule();
    },
    unregisterMarker: (id) => {
      markersRef.current.delete(id);
      schedule();
    },
    registerShape: (id, spec) => {
      shapesRef.current.set(id, spec);
      schedule();
    },
    unregisterShape: (id) => {
      shapesRef.current.delete(id);
      schedule();
    },
    schedule,
  });
  ctxValue.current.schedule = schedule;

  const touchAction = scrollEnabled === false ? 'pan-y' : 'none';
  const ready = size.w > 0 && size.h > 0;

  return (
    <View style={[styles.map, style]} accessibilityLabel={accessibilityLabel || 'Mapa ilustrativo de Sevilla'} accessibilityRole="image" testID="MapView.web">
      <div ref={hostRef} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, overflow: 'hidden', touchAction, cursor: scrollEnabled === false ? 'default' : 'grab', userSelect: 'none', WebkitUserSelect: 'none' }}>
        <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'block' }} aria-hidden="true" />
        <MapContext.Provider value={ctxValue.current}>
          <div style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none' }}>{ready ? children : null}</div>
        </MapContext.Provider>
      </div>
      {decorative ? null : (
        <View style={styles.attribution} accessibilityLabel={`Mapa ilustrativo. ${BASEMAP_INFO.attribution}`}>
          <span style={{ fontSize: 8.5, lineHeight: '11px', color: PAL.attributionText, fontFamily: FONT_STACK }}>{BASEMAP_INFO.attribution}</span>
        </View>
      )}
    </View>
  );
});

export default MapView;
export { MapView };
export const Animated = MapView;
export const AnimatedRegion = function AnimatedRegion(v) {
  return v;
};

// ───────────────────────────── Marker ─────────────────────────────
let markerSeq = 0;

export function Marker(props) {
  const ctx = useContext(MapContext);
  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = `m${++markerSeq}`;
  const elRef = useRef(null);
  const entryRef = useRef({ el: null, props, w: 0, h: 0, screen: null });
  entryRef.current.props = props;

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!ctx || !el) return undefined;
    const entry = entryRef.current;
    entry.el = el;
    const measure = () => {
      entry.w = el.offsetWidth;
      entry.h = el.offsetHeight;
      ctx.schedule();
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    ctx.registerMarker(idRef.current, entry);
    return () => {
      if (ro) ro.disconnect();
      ctx.unregisterMarker(idRef.current);
    };
    // Registro de montaje: `entry.props` se actualiza en cada render.
  }, [ctx]);

  useLayoutEffect(() => {
    if (ctx) ctx.schedule();
  });

  const interactive = props.tappable !== false;
  return (
    <div
      ref={elRef}
      data-pv-marker={idRef.current}
      aria-label={props.accessibilityLabel}
      role={props.accessibilityRole === 'button' ? 'button' : 'img'}
      style={{ position: 'absolute', left: 0, top: 0, visibility: 'hidden', pointerEvents: interactive ? 'auto' : 'none', cursor: interactive ? 'pointer' : 'default', opacity: props.opacity ?? 1, willChange: 'transform' }}
    >
      {props.children}
    </div>
  );
}

// ───────────────────────────── Formas ─────────────────────────────
let shapeSeq = 0;
function useShape(spec) {
  const ctx = useContext(MapContext);
  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = `s${++shapeSeq}`;
  useLayoutEffect(() => {
    if (!ctx) return undefined;
    ctx.registerShape(idRef.current, spec);
    return undefined;
  });
  useLayoutEffect(() => () => ctx && ctx.unregisterShape(idRef.current), [ctx]);
}

export function Polyline({ coordinates, strokeColor = '#002855', strokeWidth = 3, lineDashPattern, lineCap, lineJoin, zIndex }) {
  useShape({ type: 'polyline', coordinates, strokeColor, strokeWidth, lineDashPattern, lineCap, lineJoin, zIndex });
  return null;
}

export function Polygon({ coordinates, holes, fillColor = 'rgba(0,40,85,0.2)', strokeColor = '#002855', strokeWidth = 1.5, lineDashPattern, zIndex }) {
  useShape({ type: 'polygon', coordinates, holes, fillColor, strokeColor, strokeWidth, lineDashPattern, zIndex });
  return null;
}

export function Circle({ center, radius, fillColor = 'rgba(0,40,85,0.15)', strokeColor = '#002855', strokeWidth = 1.5, zIndex }) {
  useShape({ type: 'circle', center, radius, fillColor, strokeColor, strokeWidth, zIndex });
  return null;
}

export function UrlTile() {
  return null;
}
export function LocalTile() {
  return null;
}
export function WMSTile() {
  return null;
}
export function Overlay() {
  return null;
}
export function Heatmap() {
  return null;
}
export function Geojson() {
  return null;
}
export function Callout() {
  return null;
}
export function CalloutSubview({ children }) {
  return children ?? null;
}

const styles = StyleSheet.create({
  map: { overflow: 'hidden', flex: 1, backgroundColor: PAL.land },
  attribution: { position: 'absolute', left: 5, bottom: 3, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: PAL.attribution, pointerEvents: 'none' },
});
