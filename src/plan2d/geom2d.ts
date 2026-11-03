import type { Furniture, Level, Vec2, Wall } from '../model/types';
import { add, dot, mul, norm, perp, rotate, sub, dist, lineIntersect } from '../geometry/vec';
import type { WallFootprint } from '../geometry/walls';
import { furnitureFootprint } from '../geometry/openings';

/** Strahl gegen Polygonkanten: kleinster positiver Abstand */
export function rayCast(origin: Vec2, dir: Vec2, polys: Vec2[][], maxDist = 6000): number | null {
  let best: number | null = null;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const s = sub(b, a);
      const den = dir.x * s.y - dir.y * s.x;
      if (Math.abs(den) < 1e-9) continue;
      const q = sub(a, origin);
      const t = (q.x * s.y - q.y * s.x) / den;
      const u = (q.x * dir.y - q.y * dir.x) / den;
      if (t > -0.5 && u >= -1e-6 && u <= 1 + 1e-6 && t <= maxDist && (best == null || t < best)) best = Math.max(0, t);
    }
  }
  return best;
}

export interface WallDistance {
  from: Vec2;
  to: Vec2;
  d: number;
  dir: Vec2;
}

/** Abstände eines Möbels zu den nächsten Wänden in seinen 4 Richtungen */
export function furnitureWallDistances(f: Furniture, wallPolys: Vec2[][], others: Vec2[][] = []): WallDistance[] {
  const res: WallDistance[] = [];
  const dirs = [
    { x: 0, y: 1, half: f.depth / 2 },
    { x: 0, y: -1, half: f.depth / 2 },
    { x: 1, y: 0, half: f.width / 2 },
    { x: -1, y: 0, half: f.width / 2 },
  ];
  for (const d of dirs) {
    const wd = rotate({ x: d.x, y: d.y }, f.rotation);
    const from = add({ x: f.x, y: f.y }, mul(wd, d.half));
    const t = rayCast(from, wd, [...wallPolys, ...others]);
    if (t != null && t < 6000) res.push({ from, to: add(from, mul(wd, t)), d: t, dir: wd });
  }
  return res;
}

/** Andocken: Möbel an nahe Wandflächen schieben (bis zu zwei Richtungen) */
export function dockFurniture(f: Furniture, wallPolys: Vec2[][], tol = 120): { x: number; y: number } {
  let x = f.x, y = f.y;
  const ds = furnitureWallDistances(f, wallPolys);
  const used: Vec2[] = [];
  for (const d of ds.sort((a, b) => a.d - b.d)) {
    if (d.d > tol || d.d < 0.5) continue;
    if (used.some((u) => Math.abs(dot(u, d.dir)) > 0.5)) continue;
    x += d.dir.x * d.d;
    y += d.dir.y * d.d;
    used.push(d.dir);
  }
  return { x, y };
}

/** Rückseite des Möbels zur nächsten Wand drehen und andocken */
export function snapToNearestWall(f: Furniture, level: Level, footprints: Map<string, WallFootprint>): Partial<Furniture> | null {
  let best: { wall: Wall; side: 1 | -1; dist: number } | null = null;
  for (const w of level.walls) {
    if (w.type === 'abriss') continue;
    const d = norm(sub(w.b, w.a));
    const n = perp(d);
    const rel = sub({ x: f.x, y: f.y }, w.a);
    const s = dot(rel, d);
    const L = dist(w.a, w.b);
    if (s < 0 || s > L) continue;
    const off = dot(rel, n);
    const fd = Math.abs(off) - w.thickness / 2;
    if (fd < 0) continue;
    if (!best || fd < best.dist) best = { wall: w, side: off >= 0 ? 1 : -1, dist: fd };
  }
  if (!best) return null;
  const d = norm(sub(best.wall.b, best.wall.a));
  const n = mul(perp(d), best.side); // zeigt von der Wand in den Raum
  // lokale +y (Front) soll in Richtung n zeigen → rotation so dass rotate((0,1)) = n
  const rot = (Math.atan2(n.y, n.x) * 180) / Math.PI - 90;
  const face0 = add(best.wall.a, mul(perp(d), (best.side * best.wall.thickness) / 2));
  const rel = sub({ x: f.x, y: f.y }, face0);
  const s = dot(rel, d);
  const pos = add(add(face0, mul(d, s)), mul(n, f.depth / 2));
  const res = { x: Math.round(pos.x), y: Math.round(pos.y), rotation: Math.round(((rot % 360) + 360) % 360) };
  void footprints;
  return res;
}

export function furniturePolys(level: Level, exceptId?: string) {
  return level.furniture.filter((f) => f.id !== exceptId && f.category !== 'teppich').map(furnitureFootprint);
}

export function intersectLines(p: Vec2, r: Vec2, q: Vec2, s: Vec2) {
  return lineIntersect(p, r, q, s);
}
