import type { Level, Wall } from '../model/types';
import { wallFootprints, type WallFootprint } from '../geometry/walls';
import { detectRooms, plannedWalls, type DetectedRoom } from '../geometry/rooms';
import { CeilingModel } from '../geometry/ceiling';
import { union, type Multi } from '../geometry/polygon';

export interface LevelDerived {
  /** Umrisse aller Wände (inkl. Abriss, für 2D) */
  footprintsAll: Map<string, WallFootprint>;
  /** Umrisse im Planungszustand (ohne Abriss, für 3D/Räume) */
  footprints: Map<string, WallFootprint>;
  outlineByType: Record<Wall['type'], Multi>;
  rooms: DetectedRoom[];
  ceiling: CeilingModel;
  wallsPlanned: Wall[];
}

const cache = new WeakMap<object, LevelDerived>();
const keyFor = (l: Level) => l.walls; // Wände bestimmen Geometrie; Räume/Treppen separat geprüft

export function derive(level: Level): LevelDerived {
  const hit = cache.get(level);
  if (hit) return hit;
  // Teil-Cache: wenn sich nur Möbel o. ä. geändert haben, Wandgeometrie wiederverwenden
  const wallHit = wallCache.get(keyFor(level));
  let footprintsAll: Map<string, WallFootprint>, footprints: Map<string, WallFootprint>, outlineByType: LevelDerived['outlineByType'];
  if (wallHit) ({ footprintsAll, footprints, outlineByType } = wallHit);
  else {
    footprintsAll = wallFootprints(level.walls);
    const planned = plannedWalls(level);
    footprints = wallFootprints(planned);
    const byType = (t: Wall['type'], src: Map<string, WallFootprint>) =>
      union(level.walls.filter((w) => w.type === t && src.has(w.id)).map((w) => src.get(w.id)!.polygon));
    outlineByType = {
      bestand: byType('bestand', footprints),
      neu: byType('neu', footprints),
      abriss: byType('abriss', footprintsAll),
    };
    wallCache.set(keyFor(level), { footprintsAll, footprints, outlineByType });
  }
  const roomKey = `${level.ceilingHeight}`;
  const rk = roomCache.get(level.walls);
  let rooms: DetectedRoom[];
  let ceiling: CeilingModel;
  if (rk && rk.rooms === level.rooms && rk.stairs === level.stairs && rk.key === roomKey) {
    rooms = rk.result;
    ceiling = rk.ceiling;
  } else {
    rooms = detectRooms(level);
    ceiling = new CeilingModel(level);
    roomCache.set(level.walls, { rooms: level.rooms, stairs: level.stairs, key: roomKey, result: rooms, ceiling });
  }
  const d: LevelDerived = { footprintsAll, footprints, outlineByType, rooms, ceiling, wallsPlanned: plannedWalls(level) };
  cache.set(level, d);
  return d;
}

const wallCache = new WeakMap<object, { footprintsAll: Map<string, WallFootprint>; footprints: Map<string, WallFootprint>; outlineByType: LevelDerived['outlineByType'] }>();
const roomCache = new WeakMap<object, { rooms: Level['rooms']; stairs: Level['stairs']; key: string; result: DetectedRoom[]; ceiling: CeilingModel }>();
