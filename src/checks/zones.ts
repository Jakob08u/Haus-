import type { Level, Wall, ElecSymbol, ServiceLine, Vec2 } from '../model/types';
import { dist, dot, norm, perp, pointSegDist, sub } from '../geometry/vec';
import type { CeilingModel } from '../geometry/ceiling';
import type { DetectedRoom } from '../geometry/rooms';
import type { WallFootprint } from '../geometry/walls';
import { roomAt } from '../geometry/rooms';

/** Installationszonen nach DIN 18015-3 (Maße in mm) */
export const ZONES = {
  horizontal: {
    oben: { from: 150, to: 450, label: 'ZW-o (15–45 cm unter Decke)' },
    unten: { from: 150, to: 450, label: 'ZW-u (15–45 cm über Fußboden)' },
    mitte: { from: 900, to: 1300, label: 'ZW-m (90–130 cm, nur bei Arbeitsflächen)' },
  },
  vertical: { from: 100, to: 300, label: 'ZS (10–30 cm neben Tür/Fenster/Ecke)' },
};

const WORKTOP_ROOM = /küche|kueche|bad|wc|hauswirtschaft|waschk/i;

export interface WallFaceZones {
  wall: Wall;
  side: 1 | -1;
  /** Intervalle der senkrechten Zonen entlang der Wand (s ab Wandanfang a, Mittellinie) */
  vertical: [number, number][];
  /** Wandflächen-Anfang/-Ende entlang s */
  sStart: number;
  sEnd: number;
}

/** senkrechte Zonen je Wandseite */
export function verticalZones(level: Level, wall: Wall, side: 1 | -1, walls: Wall[], fp?: WallFootprint): WallFaceZones {
  const d = norm(sub(wall.b, wall.a));
  const n = perp(d);
  const L = dist(wall.a, wall.b);
  let sStart = 0, sEnd = L;
  if (fp) {
    const [pa, pb] = side === 1 ? [fp.plusA, fp.plusB] : [fp.minusA, fp.minusB];
    sStart = dot(sub(pa, wall.a), d);
    sEnd = dot(sub(pb, wall.a), d);
  }
  const corners: number[] = [];
  for (const o of walls) {
    if (o.id === wall.id) continue;
    for (const [p, q] of [[o.a, o.b], [o.b, o.a]] as const) {
      if (pointSegDist(p, wall.a, wall.b) > 5) continue;
      const s = dot(sub(p, wall.a), d);
      if (s < 10 || s > L - 10) continue; // Ecken an den Wandenden sind über sStart/sEnd erfasst
      const sideO = dot(norm(sub(q, p)), n);
      if (Math.abs(sideO) > 0.5 && Math.sign(sideO) === side) corners.push(s - o.thickness / 2, s + o.thickness / 2);
    }
  }
  const Z = ZONES.vertical;
  const iv: [number, number][] = [[sStart + Z.from, sStart + Z.to], [sEnd - Z.to, sEnd - Z.from]];
  for (const c of corners) iv.push([c - Z.to, c - Z.from], [c + Z.from, c + Z.to]);
  for (const o of level.openings) {
    if (o.wallId !== wall.id) continue;
    const s0 = o.offset - o.width / 2, s1 = o.offset + o.width / 2;
    iv.push([s0 - Z.to, s0 - Z.from], [s1 + Z.from, s1 + Z.to]);
  }
  return { wall, side, vertical: iv.filter(([a, b]) => b > sStart && a < sEnd), sStart, sEnd };
}

export function horizontalZonesAt(ceilingHeightHere: number, worktop: boolean): [number, number, string][] {
  const H = ZONES.horizontal;
  const z: [number, number, string][] = [
    [H.unten.from, H.unten.to, 'ZW-u'],
    [ceilingHeightHere - H.oben.to, ceilingHeightHere - H.oben.from, 'ZW-o'],
  ];
  if (worktop) z.push([H.mitte.from, H.mitte.to, 'ZW-m']);
  return z;
}

/** Wandseite und s-Position eines Punktes, wenn er nahe an einer Wandfläche liegt */
export function locateOnWall(walls: Wall[], p: Vec2, tol = 120): { wall: Wall; side: 1 | -1; s: number; faceDist: number } | null {
  let best: { wall: Wall; side: 1 | -1; s: number; faceDist: number } | null = null;
  for (const w of walls) {
    const d = norm(sub(w.b, w.a));
    const n = perp(d);
    const rel = sub(p, w.a);
    const s = dot(rel, d);
    const L = dist(w.a, w.b);
    if (s < -tol || s > L + tol) continue;
    const off = dot(rel, n);
    const side: 1 | -1 = off >= 0 ? 1 : -1;
    const faceDist = Math.abs(Math.abs(off) - w.thickness / 2);
    if (faceDist <= tol && (!best || faceDist < best.faceDist)) best = { wall: w, side, s, faceDist };
  }
  return best;
}

export interface ZoneIssue {
  message: string;
  at: Vec2;
  segment?: number;
}

function inIntervals(v: number, iv: [number, number][], tol = 1) {
  return iv.some(([a, b]) => v >= a - tol && v <= b + tol);
}

export function isWorktopRoom(rooms: DetectedRoom[], p: Vec2) {
  const r = roomAt(rooms, p);
  return !!r && WORKTOP_ROOM.test(`${r.name} ${r.meta?.usage ?? ''}`);
}

export function checkSymbolZone(level: Level, walls: Wall[], ceiling: CeilingModel, rooms: DetectedRoom[], e: ElecSymbol, fps?: Map<string, WallFootprint>): ZoneIssue | null {
  if (e.kind === 'lampe' || e.kind === 'rauchmelder') return null;
  const loc = e.wallId ? locateOnWall(walls.filter((w) => w.id === e.wallId), e, 400) : locateOnWall(walls, e, 150);
  if (!loc) return null;
  const vz = verticalZones(level, loc.wall, loc.side, walls, fps?.get(loc.wall.id));
  const hz = horizontalZonesAt(ceilingAtWall(ceiling, e), !!e.aboveWorktop || isWorktopRoom(rooms, e));
  const inH = hz.some(([a, b]) => e.height >= a - 1 && e.height <= b + 1);
  const inV = inIntervals(loc.s, vz.vertical);
  if (inH || inV) return null;
  return { message: `außerhalb der Installationszonen (Höhe ${Math.round(e.height / 10)} cm, kein senkrechter Zonenbereich)`, at: { x: e.x, y: e.y } };
}

function ceilingAtWall(ceiling: CeilingModel, p: Vec2) {
  return ceiling.heightAt(p);
}

/** Prüft eine Leitung; liefert Probleme je Segment */
export function checkLineZones(level: Level, walls: Wall[], ceiling: CeilingModel, rooms: DetectedRoom[], line: ServiceLine, fps?: Map<string, WallFootprint>): ZoneIssue[] {
  const issues: ZoneIssue[] = [];
  // DIN 18015-3 gilt für elektrische Leitungen (Strom, Daten). Wasser/Abwasser/Heizung: nur Verlauf prüfen.
  const electrical = line.kind === 'strom' || line.kind === 'lan';
  for (let i = 0; i < line.points.length - 1; i++) {
    const a = line.points[i], b = line.points[i + 1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const horizLen = dist(a, b);
    const dz = Math.abs(a.z - b.z);
    if (line.surface === 'wand') {
      const loc = locateOnWall(walls, mid, 150);
      if (!loc) {
        if (electrical) issues.push({ message: `Segment ${i + 1} liegt nicht an einer Wand`, at: mid, segment: i });
        continue;
      }
      if (horizLen > 20 && dz > 20) {
        issues.push({ message: `Segment ${i + 1} verläuft schräg – nur waagrecht oder senkrecht zulässig`, at: mid, segment: i });
        continue;
      }
      if (!electrical) continue;
      if (dz <= 20) {
        const hz = horizontalZonesAt(ceiling.heightAt(mid), isWorktopRoom(rooms, mid));
        const z = (a.z + b.z) / 2;
        if (!hz.some(([lo, hi]) => z >= lo - 1 && z <= hi + 1))
          issues.push({ message: `Segment ${i + 1}: waagrecht auf ${Math.round(z / 10)} cm – außerhalb ZW-u/ZW-o${isWorktopRoom(rooms, mid) ? '/ZW-m' : ''}`, at: mid, segment: i });
      } else {
        const vz = verticalZones(level, loc.wall, loc.side, walls, fps?.get(loc.wall.id));
        if (!inIntervals(loc.s, vz.vertical, 5))
          issues.push({ message: `Segment ${i + 1}: senkrecht außerhalb der Zonen neben Tür/Fenster/Ecke (10–30 cm)`, at: mid, segment: i });
      }
    } else {
      // Decke/Boden: achsparallel zu den Wänden empfohlen
      const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      const wallAngles = walls.map((w) => (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI);
      const ok = wallAngles.some((wa) => {
        const diff = Math.abs(((ang - wa) % 90 + 90) % 90);
        return diff < 2 || diff > 88;
      });
      if (!ok && horizLen > 50) issues.push({ message: `Segment ${i + 1} (${line.surface}) nicht parallel zu den Wänden`, at: mid, segment: i });
    }
  }
  return issues;
}
