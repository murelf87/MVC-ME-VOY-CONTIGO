#!/usr/bin/env node
// Genera mobile/src/maps/textMetrics.ts: anchos de avance (em/1000) de los glifos de Roboto Condensed (400/500/700)
// leídos directamente de los TTF de @expo-google-fonts/roboto-condensed (licencia OFL-1.1).
//
// Para qué: los marcadores del mapa (pins con «chip» de texto) necesitan conocer el ancho del texto SIN medirlo en
// pantalla, porque en iOS/Android el punto de anclaje (anchor/centerOffset) de un Marker se fija antes de que exista el
// layout. Con estas tablas el ancho es determinista e idéntico en nativo y en la vista previa web.
//
// Uso:  node tools/preview/map/gen-text-metrics.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const FONT_DIR = path.join(ROOT, 'mobile/node_modules/@expo-google-fonts/roboto-condensed');
const OUT = path.join(ROOT, 'mobile/src/maps/textMetrics.ts');

const FACES = [
  ['regular', '400Regular/RobotoCondensed_400Regular.ttf'],
  ['medium', '500Medium/RobotoCondensed_500Medium.ttf'],
  ['bold', '700Bold/RobotoCondensed_700Bold.ttf'],
];

/** Lee cmap (formato 4) + hmtx de un TTF. Devuelve { unitsPerEm, advance(codePoint) }. */
function parseTtf(buf) {
  const u16 = (o) => buf.readUInt16BE(o);
  const u32 = (o) => buf.readUInt32BE(o);
  const numTables = u16(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables[buf.toString('ascii', o, o + 4)] = { offset: u32(o + 8), length: u32(o + 12) };
  }
  const unitsPerEm = u16(tables.head.offset + 18);
  const numHMetrics = u16(tables.hhea.offset + 34);
  const hmtx = tables.hmtx.offset;
  const advanceOfGlyph = (g) => u16(hmtx + Math.min(g, numHMetrics - 1) * 4);

  const cmap = tables.cmap.offset;
  const nSub = u16(cmap + 2);
  let sub = -1;
  for (let i = 0; i < nSub; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = u16(rec);
    const encoding = u16(rec + 2);
    const off = cmap + u32(rec + 4);
    if (u16(off) === 4 && ((platform === 3 && encoding === 1) || platform === 0)) sub = off;
  }
  if (sub < 0) throw new Error('cmap formato 4 no encontrado');
  const segCount = u16(sub + 6) / 2;
  const endO = sub + 14;
  const startO = endO + segCount * 2 + 2;
  const deltaO = startO + segCount * 2;
  const rangeO = deltaO + segCount * 2;
  const glyphOf = (cp) => {
    for (let s = 0; s < segCount; s++) {
      if (cp > u16(endO + s * 2)) continue;
      const start = u16(startO + s * 2);
      if (cp < start) return 0;
      const range = u16(rangeO + s * 2);
      const delta = u16(deltaO + s * 2);
      if (range === 0) return (cp + delta) & 0xffff;
      const g = u16(rangeO + s * 2 + range + (cp - start) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
  return { unitsPerEm, advance: (cp) => advanceOfGlyph(glyphOf(cp)) };
}

const RANGES = [[32, 126], [160, 255], [0x2013, 0x2014], [0x2018, 0x201d], [0x2022, 0x2022], [0x2026, 0x2026], [0x20ac, 0x20ac], [0x2192, 0x2192]];
const faces = {};
for (const [key, rel] of FACES) {
  const font = parseTtf(fs.readFileSync(path.join(FONT_DIR, rel)));
  const widths = {};
  for (const [a, b] of RANGES) {
    for (let cp = a; cp <= b; cp++) widths[cp] = Math.round((font.advance(cp) * 1000) / font.unitsPerEm);
  }
  faces[key] = widths;
}

// Compactación: array denso para 32..255 + mapa para el resto.
const dense = (w) => Array.from({ length: 224 }, (_, i) => w[i + 32] ?? 0);
const sparse = (w) => Object.fromEntries(Object.entries(w).filter(([cp]) => Number(cp) > 255));

const lines = [];
lines.push('// GENERADO por tools/preview/map/gen-text-metrics.mjs a partir de los TTF de @expo-google-fonts/roboto-condensed');
lines.push('// (licencia OFL-1.1). No editar a mano. Anchos de avance en milésimas de em; sin kerning (error típico < 2 %).');
lines.push('');
lines.push("export type MapFontWeight = 'regular' | 'medium' | 'bold';");
lines.push('');
lines.push('const DENSE: Record<MapFontWeight, readonly number[]> = {');
for (const key of Object.keys(faces)) lines.push(`  ${key}: [${dense(faces[key]).join(',')}],`);
lines.push('};');
lines.push('');
lines.push('const SPARSE: Record<MapFontWeight, Readonly<Record<number, number>>> = {');
for (const key of Object.keys(faces)) lines.push(`  ${key}: ${JSON.stringify(sparse(faces[key]))},`);
lines.push('};');
lines.push('');
lines.push('/** Ancho aproximado (pt) de una línea de texto en Roboto Condensed al tamaño dado. */');
lines.push('export function textWidth(text: string, fontSize: number, weight: MapFontWeight = \'regular\'): number {');
lines.push('  const dense = DENSE[weight];');
lines.push('  const sparse = SPARSE[weight];');
lines.push('  let units = 0;');
lines.push('  for (const ch of text) {');
lines.push('    const cp = ch.codePointAt(0) ?? 32;');
lines.push('    const w = cp >= 32 && cp <= 255 ? dense[cp - 32] : sparse[cp];');
lines.push('    units += w ?? 520;');
lines.push('  }');
lines.push('  return (units * fontSize) / 1000;');
lines.push('}');
lines.push('');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n'));
console.log(`✔ ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
