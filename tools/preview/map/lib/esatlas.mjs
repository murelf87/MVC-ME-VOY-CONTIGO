// Lectura mínima de TopoJSON (sin dependencias) para es-atlas (IGN). Devuelve anillos [lon, lat] en grados.
import fs from 'node:fs';
import path from 'node:path';

/** Decodifica los arcos (delta + cuantización) a coordenadas absolutas [lon, lat]. */
function decodeArcs(topo) {
  const [sx, sy] = topo.transform.scale;
  const [tx, ty] = topo.transform.translate;
  return topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
}

function ringFromArcs(arcIds, arcs) {
  const pts = [];
  for (const id of arcIds) {
    const a = id >= 0 ? arcs[id] : arcs[~id].slice().reverse();
    for (let i = pts.length ? 1 : 0; i < a.length; i++) pts.push(a[i]);
  }
  return pts;
}

/** Polígonos de una geometría: [[anillo exterior, huecos…], …]. */
function polygonsOf(geom, arcs) {
  if (geom.type === 'Polygon') return [geom.arcs.map((r) => ringFromArcs(r, arcs))];
  if (geom.type === 'MultiPolygon') return geom.arcs.map((poly) => poly.map((r) => ringFromArcs(r, arcs)));
  return [];
}

/** Carga es-atlas desde <cacheDir>/es-atlas/package/es/municipalities.json. */
export function loadEsAtlas(cacheDir) {
  const file = path.join(cacheDir, 'es-atlas', 'package', 'es', 'municipalities.json');
  if (!fs.existsSync(file)) throw new Error(`Falta ${file}. Ejecuta antes tools/preview/map/fetch-sources.sh`);
  const topo = JSON.parse(fs.readFileSync(file, 'utf8'));
  const arcs = decodeArcs(topo);
  const pick = (objName, filter) =>
    topo.objects[objName].geometries
      .filter(filter)
      .map((g) => ({ id: g.id, name: g.properties?.name ?? '', polygons: polygonsOf(g, arcs) }));
  return {
    province: pick('provinces', (g) => g.id === '41')[0],
    municipalities: pick('municipalities', (g) => typeof g.id === 'string' && g.id.startsWith('41')),
  };
}
