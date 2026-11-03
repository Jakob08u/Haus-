import type { Vec2, Wall, Opening } from '../model/types';
import { add, dist, lineIntersect, mul, norm, perp, pointSegDist, projectT, sub, len, dot } from './vec';

export const NODE_TOL = 3; // mm

export interface WallFootprint {
  wallId: string;
  /** Ecken auf der +Seite (Normale n = perp(a→b)) am Anfang a und Ende b */
  plusA: Vec2;
  plusB: Vec2;
  minusA: Vec2;
  minusB: Vec2;
  /** Knotenpunkt einschließen (Ecken/Kreuzungen), nicht bei T-Stoß auf durchlaufende Wand */
  nodeA: Vec2 | null;
  nodeB: Vec2 | null;
  polygon: Vec2[];
}

export function wallDir(w: Wall): Vec2 {
  return norm(sub(w.b, w.a));
}
export function wallNormal(w: Wall): Vec2 {
  return perp(wallDir(w));
}
export function wallLength(w: Wall): number {
  return dist(w.a, w.b);
}

interface Arm {
  wallId: string;
  dir: Vec2;
  angle: number;
  h: number;
  through: boolean;
}

/**
 * Wandumrisse mit sauberen Eck-/T-Anschlüssen.
 * Ecken: Gehrung; T-Stoß: Stichwand endet an der Fläche der durchlaufenden Wand.
 */
export function wallFootprints(walls: Wall[]): Map<string, WallFootprint> {
  const res = new Map<string, WallFootprint>();
  const valid = walls.filter((w) => dist(w.a, w.b) > 1);

  const armsAt = (p: Vec2, self: Wall): Arm[] => {
    const arms: Arm[] = [];
    for (const w of valid) {
      const h = w.thickness / 2;
      if (dist(w.a, p) <= NODE_TOL) {
        const d = norm(sub(w.b, w.a));
        arms.push({ wallId: w.id, dir: d, angle: Math.atan2(d.y, d.x), h, through: false });
      } else if (dist(w.b, p) <= NODE_TOL) {
        const d = norm(sub(w.a, w.b));
        arms.push({ wallId: w.id, dir: d, angle: Math.atan2(d.y, d.x), h, through: false });
      } else if (w.id !== self.id && pointSegDist(p, w.a, w.b) <= NODE_TOL) {
        const d1 = norm(sub(w.b, w.a));
        const d2 = mul(d1, -1);
        arms.push({ wallId: w.id, dir: d1, angle: Math.atan2(d1.y, d1.x), h, through: true });
        arms.push({ wallId: w.id + '#r', dir: d2, angle: Math.atan2(d2.y, d2.x), h, through: true });
      }
    }
    arms.sort((x, y) => x.angle - y.angle);
    return arms;
  };

  const endCorners = (node: Vec2, self: Wall, selfDir: Vec2) => {
    const arms = armsAt(node, self);
    const n = perp(selfDir);
    const h = self.thickness / 2;
    const idx = arms.findIndex((a) => a.wallId === self.id && Math.abs(a.dir.x - selfDir.x) < 1e-6 && Math.abs(a.dir.y - selfDir.y) < 1e-6);
    const defPlus = add(node, mul(n, h));
    const defMinus = add(node, mul(n, -h));
    const hasThrough = arms.some((a) => a.through);
    if (arms.length <= 1 || idx < 0) return { plus: defPlus, minus: defMinus, node: null as Vec2 | null };
    const next = arms[(idx + 1) % arms.length];
    const prev = arms[(idx - 1 + arms.length) % arms.length];
    const corner = (other: Arm, sideSelf: 1 | -1): Vec2 => {
      const on = perp(other.dir);
      const pSelf = add(node, mul(n, h * sideSelf));
      const pOther = add(node, mul(on, -other.h * sideSelf));
      const cr = selfDir.x * other.dir.y - selfDir.y * other.dir.x;
      // fast parallel (gerade Fortsetzung oder Rückfaltung)
      if (Math.abs(cr) < 1e-6) return pSelf;
      const ip = lineIntersect(pSelf, selfDir, pOther, other.dir);
      if (!ip) return pSelf;
      // sehr spitze Winkel begrenzen
      if (dist(ip, node) > 4 * Math.max(h, other.h) + 50) return pSelf;
      return ip;
    };
    const plus = next === arms[idx] ? defPlus : corner(next, 1);
    const minus = prev === arms[idx] ? defMinus : corner(prev, -1);
    return { plus, minus, node: hasThrough ? null : arms.length >= 2 ? node : null };
  };

  for (const w of valid) {
    const d = norm(sub(w.b, w.a));
    const A = endCorners(w.a, w, d);
    const B = endCorners(w.b, w, mul(d, -1));
    // am Ende b ist die +Seite der Arm-Richtung die −Seite der Wand
    const fp: WallFootprint = {
      wallId: w.id,
      plusA: A.plus,
      minusA: A.minus,
      plusB: B.minus,
      minusB: B.plus,
      nodeA: A.node,
      nodeB: B.node,
      polygon: [],
    };
    const poly: Vec2[] = [fp.plusA, fp.plusB];
    if (fp.nodeB) poly.push(fp.nodeB);
    poly.push(fp.minusB, fp.minusA);
    if (fp.nodeA) poly.push(fp.nodeA);
    fp.polygon = dedupe(poly);
    res.set(w.id, fp);
  }
  return res;
}

function dedupe(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > 0.01) out.push(p);
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) < 0.01) out.pop();
  return out;
}

/** Geometrie einer Öffnung in der Wand */
export function openingFrame(w: Wall, o: Opening) {
  const d = wallDir(w);
  const n = perp(d);
  const c = add(w.a, mul(d, o.offset));
  const s0 = o.offset - o.width / 2;
  const s1 = o.offset + o.width / 2;
  const p0 = add(w.a, mul(d, s0));
  const p1 = add(w.a, mul(d, s1));
  return { d, n, center: c, s0, s1, p0, p1, h: w.thickness / 2 };
}

/** Projektion eines Punktes auf eine Wand: Abstand entlang der Wand und senkrechter Abstand (vorzeichenbehaftet) */
export function projectOnWall(w: Wall, p: Vec2) {
  const d = wallDir(w);
  const n = perp(d);
  const rel = sub(p, w.a);
  return { s: dot(rel, d), off: dot(rel, n), t: projectT(p, w.a, w.b), length: len(sub(w.b, w.a)) };
}

/** Nächste Wand zu einem Punkt */
export function nearestWall(walls: Wall[], p: Vec2, maxDist = Infinity): { wall: Wall; dist: number } | null {
  let best: { wall: Wall; dist: number } | null = null;
  for (const w of walls) {
    const dd = pointSegDist(p, w.a, w.b);
    if (dd <= maxDist && (!best || dd < best.dist)) best = { wall: w, dist: dd };
  }
  return best;
}
