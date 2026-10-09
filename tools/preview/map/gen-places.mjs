#!/usr/bin/env node
// Genera mobile/src/maps/placesData.ts a partir de tools/preview/map/data/places.json (fuente única de SEVILLA_PLACES y de los
// rótulos del mapa base). Uso:  node tools/preview/map/gen-places.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const SRC = path.join(HERE, 'data', 'places.json');
const OUT = path.join(ROOT, 'mobile', 'src', 'maps', 'placesData.ts');

const KINDS = new Set(['municipio', 'barrio', 'landmark', 'campus', 'hospital', 'estacion', 'calle', 'parque']);
const { places } = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const seen = new Set();
for (const p of places) {
  if (!/^[a-z0-9-]+$/.test(p.id)) throw new Error(`id inválido: ${p.id}`);
  if (seen.has(p.id)) throw new Error(`id duplicado: ${p.id}`);
  seen.add(p.id);
  if (!KINDS.has(p.kind)) throw new Error(`kind inválido en ${p.id}: ${p.kind}`);
  if (!(p.lat > 36.6 && p.lat < 38.2 && p.lng > -6.6 && p.lng < -4.9)) throw new Error(`${p.id} fuera de la provincia de Sevilla: ${p.lat},${p.lng}`);
}

const q = (s) => JSON.stringify(s);
const rows = places.map((p) => `  { id: ${q(p.id)}, name: ${q(p.name)}, kind: ${q(p.kind)}, municipio: ${q(p.municipio)}, lat: ${p.lat}, lng: ${p.lng} },`);

const ts = `/**
 * GENERADO por tools/preview/map/gen-places.mjs desde tools/preview/map/data/places.json. NO editar a mano.
 * Coordenadas APROXIMADAS (±300 m) escritas a mano para la provincia de Sevilla: sirven para semillas, vista previa y
 * pruebas; nunca como dato de geocodificación ni de navegación.
 */
export const SEVILLA_PLACES_DATA = [
${rows.join('\n')}
] as const;
`;
fs.writeFileSync(OUT, ts);
console.log(`placesData.ts: ${places.length} lugares → ${path.relative(ROOT, OUT)}`);
