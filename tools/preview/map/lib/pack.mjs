// Empaquetado del mapa base: coordenadas cuantizadas (1e-5° ≈ 1 m) en deltas zig-zag + varint, todo en un único búfer base64.
// Formato (lo lee mobile/web-stubs/map-data/basemap.js): por capa, `n` rasgos; cada rasgo = nPartes, y por parte nPuntos + (dx, dy)…
// Las deltas son respecto al punto anterior de la capa (no se reinician entre partes). Los polígonos no repiten el primer punto.

const zig = (n) => (n >= 0 ? n * 2 : -n * 2 - 1);

class Bytes {
  constructor() {
    this.buf = Buffer.alloc(1 << 20);
    this.len = 0;
  }

  varint(n) {
    if (this.len + 10 > this.buf.length) {
      const bigger = Buffer.alloc(this.buf.length * 2);
      this.buf.copy(bigger);
      this.buf = bigger;
    }
    let v = n;
    while (v >= 128) {
      this.buf[this.len++] = (v % 128) | 128;
      v = Math.floor(v / 128);
    }
    this.buf[this.len++] = v;
  }

  result() {
    return this.buf.subarray(0, this.len);
  }
}

/**
 * @param layers [{ id, kind: 'line'|'poly', features: [{ parts: [[ [lon, lat], … ], …] }], props?: { nombre: [...] } }]
 * @returns { meta, data: Buffer }
 */
export function pack(layers, { q = 100000, x0 = -6.7, y0 = 36.8 } = {}) {
  const bytes = new Bytes();
  const metaLayers = [];
  let totalPoints = 0;
  for (const layer of layers) {
    const from = bytes.len;
    let px = 0;
    let py = 0;
    let points = 0;
    for (const f of layer.features) {
      bytes.varint(f.parts.length);
      for (const part of f.parts) {
        let pts = part;
        if (layer.kind === 'poly' && pts.length > 1) {
          const a = pts[0];
          const b = pts[pts.length - 1];
          if (a[0] === b[0] && a[1] === b[1]) pts = pts.slice(0, -1);
        }
        bytes.varint(pts.length);
        for (const [lon, lat] of pts) {
          const x = Math.round((lon - x0) * q);
          const y = Math.round((lat - y0) * q);
          bytes.varint(zig(x - px));
          bytes.varint(zig(y - py));
          px = x;
          py = y;
          points++;
        }
      }
    }
    totalPoints += points;
    metaLayers.push({ id: layer.id, kind: layer.kind, from, n: layer.features.length, props: layer.props ?? {}, points });
  }
  return { meta: { q, x0, y0, layers: metaLayers, totalPoints }, data: bytes.result() };
}
