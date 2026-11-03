import type { Level, RoomMeta, Stair, Vec2, Wall } from '../model/types';
import { difference, multiArea, union, type Multi, type Ring } from './polygon';
import { bbox, dist, pointInPolygon, pointSegDist, polygonArea, polygonCentroid, polygonSignedArea, rectPolygon, segIntersect, projectT, lerp } from './vec';
import { wallFootprints } from './walls';

const TOL = 5; // mm

export interface DetectedRoom {
  key: string;
  meta?: RoomMeta;
  name: string;
  /** Polygon auf Wandmittellinien */
  face: Ring;
  /** lichte Raumfläche (ohne Wände) */
  clear: Multi;
  /** lichte Fläche abzüglich Treppenlöcher */
  net: Multi;
  area: number;
  netArea: number;
  labelPoint: Vec2;
}

/** Wände, die im Planungszustand stehen (ohne Abriss) */
export function plannedWalls(level: Level): Wall[] {
  return level.walls.filter((w) => w.type !== 'abriss');
}

export function stairPolygon(s: Stair): Ring {
  return rectPolygon(s.x, s.y, s.length, s.width, s.rotation);
}

/** Flächen (Faces) des planaren Graphen aus Wandmittellinien */
export function findFaces(walls: Wall[]): Ring[] {
  const segs = walls.filter((w) => dist(w.a, w.b) > TOL).map((w) => [w.a, w.b] as [Vec2, Vec2]);
  // Teilungsparameter je Segment
  const splits: number[][] = segs.map(() => [0, 1]);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const [a, b] = segs[i], [c, d] = segs[j];
      const ip = segIntersect(a, b, c, d);
      if (ip) {
        splits[i].push(ip.t);
        splits[j].push(ip.u);
      }
      // T-Stöße mit Toleranz
      for (const p of [c, d]) if (pointSegDist(p, a, b) <= TOL) splits[i].push(projectT(p, a, b));
      for (const p of [a, b]) if (pointSegDist(p, c, d) <= TOL) splits[j].push(projectT(p, c, d));
    }
  }
  // Knoten
  const verts: Vec2[] = [];
  const vid = (p: Vec2): number => {
    for (let k = 0; k < verts.length; k++) if (dist(verts[k], p) <= TOL) return k;
    verts.push(p);
    return verts.length - 1;
  };
  const edgeSet = new Set<string>();
  const adj = new Map<number, Set<number>>();
  const addEdge = (u: number, w: number) => {
    if (u === w) return;
    const k = u < w ? `${u}_${w}` : `${w}_${u}`;
    if (edgeSet.has(k)) return;
    edgeSet.add(k);
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(w)) adj.set(w, new Set());
    adj.get(u)!.add(w);
    adj.get(w)!.add(u);
  };
  segs.forEach(([a, b], i) => {
    const ts = [...new Set(splits[i].map((t) => Math.min(1, Math.max(0, t))).map((t) => Math.round(t * 1e6) / 1e6))].sort((x, y) => x - y);
    let prev = vid(lerp(a, b, ts[0]));
    for (let k = 1; k < ts.length; k++) {
      const cur = vid(lerp(a, b, ts[k]));
      addEdge(prev, cur);
      prev = cur;
    }
  });
  // lose Enden entfernen
  let changed = true;
  while (changed) {
    changed = false;
    for (const [u, ns] of adj) {
      if (ns.size <= 1) {
        for (const w of ns) adj.get(w)?.delete(u);
        adj.delete(u);
        changed = true;
      }
    }
  }
  // sortierte Nachbarn
  const sorted = new Map<number, number[]>();
  for (const [u, ns] of adj) {
    const arr = [...ns].sort((p, q) => {
      const ap = Math.atan2(verts[p].y - verts[u].y, verts[p].x - verts[u].x);
      const aq = Math.atan2(verts[q].y - verts[u].y, verts[q].x - verts[u].x);
      return ap - aq;
    });
    sorted.set(u, arr);
  }
  const used = new Set<string>();
  const faces: Ring[] = [];
  for (const [u, ns] of sorted) {
    for (const w of ns) {
      if (used.has(`${u}>${w}`)) continue;
      const face: number[] = [];
      let a = u, b = w, guard = 0;
      while (!used.has(`${a}>${b}`) && guard++ < 10000) {
        used.add(`${a}>${b}`);
        face.push(a);
        const nb = sorted.get(b)!;
        const i = nb.indexOf(a);
        const next = nb[(i - 1 + nb.length) % nb.length];
        a = b;
        b = next;
      }
      if (face.length >= 3) faces.push(face.map((k) => verts[k]));
    }
  }
  // Innenflächen haben bei dieser Laufregel positive Orientierung; Außenfläche (negativ) verwerfen
  return faces.filter((f) => polygonSignedArea(f) > 1);
}

/** Punkt im Inneren eines (ggf. konkaven) Polygons, möglichst weit vom Rand */
export function interiorPoint(poly: Ring, holes: Ring[] = []): Vec2 {
  const c = polygonCentroid(poly);
  const inside = (p: Vec2) => pointInPolygon(p, poly) && !holes.some((h) => pointInPolygon(p, h));
  const edgeDist = (p: Vec2) => {
    let m = Infinity;
    for (const r of [poly, ...holes])
      for (let i = 0; i < r.length; i++) m = Math.min(m, pointSegDist(p, r[i], r[(i + 1) % r.length]));
    return m;
  };
  const bb = bbox(poly);
  let best = inside(c) ? c : poly[0];
  let bestD = inside(c) ? edgeDist(c) : -1;
  const N = 24;
  for (let i = 1; i < N; i++)
    for (let j = 1; j < N; j++) {
      const p = { x: bb.minX + (bb.w * i) / N, y: bb.minY + (bb.h * j) / N };
      if (!inside(p)) continue;
      const d = edgeDist(p) - dist(p, c) * 0.15; // leicht zur Mitte ziehen
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  return best;
}

export function detectRooms(level: Level): DetectedRoom[] {
  const walls = plannedWalls(level);
  const faces = findFaces(walls);
  const fps = wallFootprints(walls);
  const wallUnion = union([...fps.values()].map((f) => f.polygon));
  const stairHoles = level.stairs.filter((s) => s.isOpening).map(stairPolygon);
  const usedMeta = new Set<string>();
  const rooms: DetectedRoom[] = [];
  faces.forEach((face) => {
    const clear = difference(face, wallUnion).filter((p) => polygonArea(p[0]) > 1e4);
    if (clear.length === 0) return;
    const net = stairHoles.length ? difference(clear, ...stairHoles) : clear;
    const meta = level.rooms.find((m) => !usedMeta.has(m.id) && pointInPolygon(m.seed, face));
    if (meta) usedMeta.add(meta.id);
    const largest = clear.reduce((a, b) => (polygonArea(b[0]) > polygonArea(a[0]) ? b : a));
    const c = polygonCentroid(face);
    rooms.push({
      key: meta?.id ?? `auto_${Math.round(c.x / 10)}_${Math.round(c.y / 10)}`,
      meta,
      name: meta?.name ?? 'Raum (unbenannt)',
      face,
      clear,
      net,
      area: multiArea(clear),
      netArea: multiArea(net),
      labelPoint: meta?.seed && pointInPolygon(meta.seed, largest[0]) ? meta.seed : interiorPoint(largest[0], largest.slice(1)),
    });
  });
  return rooms;
}

export function roomAt(rooms: DetectedRoom[], p: Vec2): DetectedRoom | undefined {
  return rooms.find((r) => r.clear.some((poly) => pointInPolygon(p, poly[0]) && !poly.slice(1).some((h) => pointInPolygon(p, h))));
}
