// Grafo viario de las carreteras ilustrativas (para generar rutas que SIGAN lo dibujado en el mapa base).
import { dist, pointSegDist, segIntersect } from './geo.mjs';

const SPEED = [1.0, 0.75, 0.55, 0.45]; // coste relativo por clase (0 autovía … 3 secundaria): menor = más rápido

export class RoadGraph {
  /** @param roads [{ id, cls, pts: [[x,y]…] }] (polilíneas densas en metros) */
  constructor(roads, { snapM = 160 } = {}) {
    this.nodes = [];
    this.adj = [];
    this.keyToNode = new Map();
    this.roads = roads;
    const lines = roads.map((r) => ({ ...r, inserts: r.pts.slice(1).map(() => []), links: [] }));
    this.collectCrossings(lines);
    this.collectSnaps(lines, snapM);
    for (const l of lines) {
      const seq = [];
      for (let i = 0; i < l.pts.length; i++) {
        seq.push(l.pts[i]);
        if (i < l.pts.length - 1) {
          for (const ins of l.inserts[i].sort((a, b) => a.t - b.t)) seq.push([ins.x, ins.y]);
        }
      }
      let prev = -1;
      for (const p of seq) {
        const id = this.node(p[0], p[1]);
        if (prev !== -1) this.edge(prev, id, l.cls, l.id);
        prev = id;
      }
    }
    for (const l of lines) for (const k of l.links) this.edge(this.node(k.from[0], k.from[1]), this.node(k.to[0], k.to[1]), l.cls, l.id);
  }

  node(x, y) {
    const key = `${Math.round(x)}:${Math.round(y)}`;
    let id = this.keyToNode.get(key);
    if (id === undefined) {
      id = this.nodes.length;
      this.nodes.push([x, y]);
      this.adj.push([]);
      this.keyToNode.set(key, id);
    }
    return id;
  }

  edge(a, b, cls, road) {
    if (a === b) return;
    if (this.adj[a].some((e) => e.to === b)) return;
    const w = dist(this.nodes[a], this.nodes[b]);
    const cost = w * SPEED[cls];
    this.adj[a].push({ to: b, w, cost, cls, road });
    this.adj[b].push({ to: a, w, cost, cls, road });
  }

  collectCrossings(lines) {
    const cell = 500;
    const grid = new Map();
    const segs = [];
    lines.forEach((l, li) => {
      for (let i = 1; i < l.pts.length; i++) {
        const id = segs.length;
        segs.push({ li, i: i - 1, a: l.pts[i - 1], b: l.pts[i] });
        const x0 = Math.floor(Math.min(l.pts[i - 1][0], l.pts[i][0]) / cell);
        const x1 = Math.floor(Math.max(l.pts[i - 1][0], l.pts[i][0]) / cell);
        const y0 = Math.floor(Math.min(l.pts[i - 1][1], l.pts[i][1]) / cell);
        const y1 = Math.floor(Math.max(l.pts[i - 1][1], l.pts[i][1]) / cell);
        for (let cx = x0; cx <= x1; cx++) {
          for (let cy = y0; cy <= y1; cy++) {
            const k = cx * 100003 + cy;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(id);
          }
        }
      }
    });
    const done = new Set();
    for (const ids of grid.values()) {
      for (let x = 0; x < ids.length; x++) {
        for (let y = x + 1; y < ids.length; y++) {
          const A = segs[ids[x]];
          const B = segs[ids[y]];
          if (A.li === B.li) continue;
          const key = ids[x] < ids[y] ? `${ids[x]}-${ids[y]}` : `${ids[y]}-${ids[x]}`;
          if (done.has(key)) continue;
          done.add(key);
          const hit = segIntersect(A.a, A.b, B.a, B.b);
          if (!hit) continue;
          lines[A.li].inserts[A.i].push({ t: hit[2], x: hit[0], y: hit[1] });
          lines[B.li].inserts[B.i].push({ t: hit[3], x: hit[0], y: hit[1] });
        }
      }
    }
  }

  collectSnaps(lines, snapM) {
    // Cada extremo de una carretera se enlaza con el punto más cercano de OTRA carretera si está a menos de snapM (160 m).
    // Incluye los extremos que solo «tocan» a otra vía (sin cruzarla): sin este enlace el grafo quedaría partido. Si el extremo
    // ya cae encima (< 1 m) el nodo se funde con el de la proyección (las claves de nodo se redondean al metro).
    for (const l of lines) {
      for (const end of [l.pts[0], l.pts[l.pts.length - 1]]) {
        let best = null;
        for (const o of lines) {
          if (o === l) continue;
          for (let i = 1; i < o.pts.length; i++) {
            const d = pointSegDist(end, o.pts[i - 1], o.pts[i]);
            if (d <= snapM && (!best || d < best.d)) best = { d, o, i: i - 1 };
          }
        }
        if (!best) continue;
        const a = best.o.pts[best.i];
        const b = best.o.pts[best.i + 1];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((end[0] - a[0]) * dx + (end[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        const px = a[0] + t * dx;
        const py = a[1] + t * dy;
        best.o.inserts[best.i].push({ t, x: px, y: py });
        l.links.push({ from: end, to: [px, py] });
      }
    }
  }

  /** Nodo más cercano a (x, y) con su distancia. */
  nearest(x, y) {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const d = Math.hypot(this.nodes[i][0] - x, this.nodes[i][1] - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return { id: best, d: bd };
  }

  /** Camino de coste mínimo entre dos nodos; devuelve { ids, lengthM } o null. */
  shortest(from, to) {
    const n = this.nodes.length;
    const cost = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap = [[0, from]];
    cost[from] = 0;
    const push = (item) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [c, u] = pop();
      if (c > cost[u]) continue;
      if (u === to) break;
      for (const e of this.adj[u]) {
        const nc = c + e.cost;
        if (nc < cost[e.to]) {
          cost[e.to] = nc;
          prev[e.to] = u;
          push([nc, e.to]);
        }
      }
    }
    if (!Number.isFinite(cost[to])) return null;
    const ids = [];
    for (let v = to; v !== -1; v = prev[v]) ids.push(v);
    ids.reverse();
    let lengthM = 0;
    for (let i = 1; i < ids.length; i++) lengthM += dist(this.nodes[ids[i - 1]], this.nodes[ids[i]]);
    return { ids, lengthM };
  }

  /** Componentes conexas (para comprobar que la red principal está conectada). */
  components() {
    const seen = new Int32Array(this.nodes.length).fill(-1);
    let c = 0;
    const sizes = [];
    for (let s = 0; s < this.nodes.length; s++) {
      if (seen[s] !== -1) continue;
      let count = 0;
      const stack = [s];
      seen[s] = c;
      while (stack.length) {
        const u = stack.pop();
        count++;
        for (const e of this.adj[u]) {
          if (seen[e.to] === -1) {
            seen[e.to] = c;
            stack.push(e.to);
          }
        }
      }
      sizes.push(count);
      c++;
    }
    return { seen, sizes };
  }
}
