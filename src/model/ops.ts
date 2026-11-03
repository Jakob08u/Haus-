import type { Level, Wall } from './types';
import { dist, dot, norm, sub, add, mul, pointSegDist, uid } from '../geometry/vec';

/** Wand an Position s (Abstand vom Anfang) teilen; Öffnungen, Dachfenster und Elektro werden mitgenommen */
export function splitWall(level: Level, wallId: string, s: number, newId?: string): [string, string] | null {
  const w = level.walls.find((x) => x.id === wallId);
  if (!w) return null;
  const L = dist(w.a, w.b);
  if (s < 50 || s > L - 50) return null;
  const d = norm(sub(w.b, w.a));
  const p = add(w.a, mul(d, s));
  let idB = newId ?? uid('w');
  while (level.walls.some((x) => x.id === idB)) idB = idB + '_';
  const w2: Wall = structuredClone({ ...w, id: idB, a: { ...p } });
  w.b = { ...p };
  const i = level.walls.indexOf(w);
  level.walls.splice(i + 1, 0, w2);
  for (const o of level.openings) {
    if (o.wallId !== wallId) continue;
    if (o.offset > s) {
      o.wallId = idB;
      o.offset -= s;
    }
  }
  for (const r of level.roofWindows) {
    if (r.wallId !== wallId) continue;
    if (r.offset > s) {
      r.wallId = idB;
      r.offset -= s;
    }
  }
  for (const e of level.electrical) {
    if (e.wallId !== wallId) continue;
    if (dot(sub(e, w.a), d) > s) e.wallId = idB;
  }
  return [wallId, idB];
}

/** Wand an allen Stellen teilen, an denen andere Wände stumpf anschließen (T-Stöße) */
export function splitWallAtJunctions(level: Level, wallId: string): number {
  const w = level.walls.find((x) => x.id === wallId);
  if (!w) return 0;
  const d = norm(sub(w.b, w.a));
  const L = dist(w.a, w.b);
  const cuts = new Set<number>();
  for (const o of level.walls) {
    if (o.id === wallId) continue;
    for (const p of [o.a, o.b]) {
      if (pointSegDist(p, w.a, w.b) > 3) continue;
      const s = dot(sub(p, w.a), d);
      if (s > 50 && s < L - 50) cuts.add(Math.round(s));
    }
  }
  const sorted = [...cuts].sort((a, b) => b - a); // von hinten teilen, damit s gültig bleibt
  sorted.forEach((s, i) => splitWall(level, wallId, s, `${wallId}_t${sorted.length - i}`));
  return sorted.length;
}

/**
 * Ganze Ebene drehen (um den Ursprung, in 90°-Schritten, Bildschirmsinn: +90 = im Uhrzeigersinn)
 * und anschließend verschieben. Wandbezogene Objekte (Öffnungen, Dachfenster) bleiben gültig.
 */
export function transformLevel(level: Level, t: { rotate?: 0 | 90 | -90 | 180; dx?: number; dy?: number; cx?: number; cy?: number }) {
  const rot = t.rotate ?? 0;
  const cx = t.cx ?? 0, cy = t.cy ?? 0;
  const R = (p: { x: number; y: number }) => {
    const x = p.x - cx, y = p.y - cy;
    let q = { x, y };
    if (rot === 90) q = { x: -y, y: x };
    else if (rot === -90) q = { x: y, y: -x };
    else if (rot === 180) q = { x: -x, y: -y };
    return { x: Math.round((q.x + cx + (t.dx ?? 0)) * 10) / 10, y: Math.round((q.y + cy + (t.dy ?? 0)) * 10) / 10 };
  };
  const ang = (a: number | undefined) => ((((a ?? 0) + rot) % 360) + 360) % 360;
  for (const w of level.walls) {
    w.a = R(w.a);
    w.b = R(w.b);
  }
  for (const s of level.stairs) {
    Object.assign(s, R(s));
    s.rotation = ang(s.rotation);
  }
  for (const r of level.rooms) r.seed = R(r.seed);
  for (const f of level.furniture) {
    Object.assign(f, R(f));
    f.rotation = ang(f.rotation);
  }
  for (const e of level.electrical) {
    Object.assign(e, R(e));
    e.rotation = ang(e.rotation);
  }
  for (const l of level.lines) l.points = l.points.map((p) => ({ ...R(p), z: p.z }));
  for (const d of level.dimensions) {
    d.a = R(d.a);
    d.b = R(d.b);
  }
  if (level.background) {
    Object.assign(level.background, R(level.background));
    level.background.rotation = ang(level.background.rotation);
  }
}
