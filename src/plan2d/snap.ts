import type { Level, Settings, Vec2 } from '../model/types';
import { closestOnSegment, dist, len, sub } from '../geometry/vec';

export interface SnapResult {
  p: Vec2;
  kind: 'end' | 'wall' | 'angle' | 'grid' | 'none' | 'axis';
  guides?: { a: Vec2; b: Vec2 }[];
}

export function snapPoint(
  raw: Vec2,
  opts: { level: Level; settings: Settings; prev?: Vec2 | null; scale: number; disable?: boolean; excludeWallIds?: string[]; extraPoints?: Vec2[] },
): SnapResult {
  if (opts.disable) return { p: raw, kind: 'none' };
  const { level, settings, prev, scale } = opts;
  const tolEnd = 12 / scale;
  const tolWall = 8 / scale;
  const walls = level.walls.filter((w) => !opts.excludeWallIds?.includes(w.id));
  // 1. Endpunkte
  if (settings.snapEndpoints) {
    let best: Vec2 | null = null, bd = tolEnd;
    for (const w of walls)
      for (const q of [w.a, w.b]) {
        const d = dist(q, raw);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
    for (const q of opts.extraPoints ?? []) {
      const d = dist(q, raw);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    if (best) return { p: { ...best }, kind: 'end' };
  }
  // 2. Winkel relativ zum vorherigen Punkt
  let p = raw;
  let kind: SnapResult['kind'] = 'none';
  const guides: SnapResult['guides'] = [];
  if (prev && settings.snapAngle) {
    const d = sub(raw, prev);
    const L = len(d);
    if (L > 1) {
      const ang = Math.atan2(d.y, d.x);
      const step = Math.PI / 4;
      const snapped = Math.round(ang / step) * step;
      if (Math.abs(snapped - ang) < (7 * Math.PI) / 180) {
        const g = settings.snapGrid ? 10 : 1;
        const Lr = Math.round(L / g) * g;
        p = { x: prev.x + Math.cos(snapped) * Lr, y: prev.y + Math.sin(snapped) * Lr };
        if (Math.abs(Math.cos(snapped)) < 1e-9) p.x = prev.x;
        if (Math.abs(Math.sin(snapped)) < 1e-9) p.y = prev.y;
        kind = 'angle';
        guides.push({ a: prev, b: p });
      }
    }
  }
  // 3. auf Wandmittellinie
  if (settings.snapEndpoints) {
    let best: Vec2 | null = null, bd = tolWall;
    for (const w of walls) {
      const q = closestOnSegment(p, w.a, w.b);
      const d = dist(q, p);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    if (best) return { p: { x: Math.round(best.x), y: Math.round(best.y) }, kind: 'wall', guides };
  }
  if (kind === 'angle') return { p, kind, guides };
  // 4. Ausrichtung an anderen Endpunkten (Achsen)
  if (settings.snapEndpoints) {
    const tolAx = 6 / scale;
    let ax: number | null = null, ay: number | null = null;
    let ga: Vec2 | null = null, gb: Vec2 | null = null;
    for (const w of walls)
      for (const q of [w.a, w.b]) {
        if (ax == null && Math.abs(q.x - p.x) < tolAx) {
          ax = q.x;
          ga = q;
        }
        if (ay == null && Math.abs(q.y - p.y) < tolAx) {
          ay = q.y;
          gb = q;
        }
      }
    if (ax != null || ay != null) {
      const sp = { x: ax ?? gridRound(p.x, settings), y: ay ?? gridRound(p.y, settings) };
      const gs: SnapResult['guides'] = [];
      if (ga) gs.push({ a: ga, b: sp });
      if (gb) gs.push({ a: gb, b: sp });
      return { p: sp, kind: 'axis', guides: gs };
    }
  }
  // 5. Raster
  if (settings.snapGrid) return { p: { x: gridRound(p.x, settings), y: gridRound(p.y, settings) }, kind: 'grid' };
  return { p: { x: Math.round(p.x), y: Math.round(p.y) }, kind: 'none' };
}

function gridRound(v: number, s: Settings) {
  const g = Math.max(1, s.gridSize / 2);
  return Math.round(v / g) * g;
}
