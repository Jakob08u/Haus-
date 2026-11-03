import type { Level } from '../model/types';
import type { DetectedRoom } from '../geometry/rooms';
import { derive } from '../store/derived';

export interface RoomStats {
  floorArea: number;
  living: number;
  below1: number;
  between1and2: number;
  above2: number;
  minHeight: number;
  maxHeight: number;
  /** Umfang der lichten Fläche (für Sockelleisten, Tapete) */
  perimeter: number;
}

const cache = new WeakMap<DetectedRoom, RoomStats>();

export function roomStats(level: Level, r: DetectedRoom): RoomStats {
  const hit = cache.get(r);
  if (hit) return hit;
  const D = derive(level);
  const la = D.ceiling.livingArea(r.net);
  let perimeter = 0;
  for (const poly of r.clear)
    for (const ring of poly)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        perimeter += Math.hypot(b.x - a.x, b.y - a.y);
      }
  const res: RoomStats = {
    floorArea: r.netArea,
    living: la.living,
    below1: la.below1,
    between1and2: la.between1and2,
    above2: la.above2,
    minHeight: la.minHeight,
    maxHeight: la.maxHeight,
    perimeter,
  };
  cache.set(r, res);
  return res;
}
