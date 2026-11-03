import type { Opening, RoofWindow, Vec2, Wall, Stair, Furniture } from '../model/types';
import { add, mul, perp, norm, sub, rotate, rectPolygon } from './vec';
import type { SlopePlane } from './ceiling';

export function openingGeom(w: Wall, o: Opening) {
  const d = norm(sub(w.b, w.a));
  const n = perp(d);
  const h = w.thickness / 2;
  const s0 = o.offset - o.width / 2, s1 = o.offset + o.width / 2;
  const p0 = add(w.a, mul(d, s0));
  const p1 = add(w.a, mul(d, s1));
  const cut: Vec2[] = [add(p0, mul(n, h + 1)), add(p1, mul(n, h + 1)), add(p1, mul(n, -h - 1)), add(p0, mul(n, -h - 1))];
  return { d, n, h, p0, p1, cut };
}

/** Türblatt und Schwenkbereich */
export function doorSwing(w: Wall, o: Opening, segments = 12) {
  const { d, n, h, p0, p1 } = openingGeom(w, o);
  const side = o.swing ?? 1;
  const face = mul(n, h * side);
  const hingeAtA = (o.hinge ?? 'a') === 'a';
  const hinge = add(hingeAtA ? p0 : p1, face);
  const closed = add(hingeAtA ? p1 : p0, face);
  const leafLen = o.width;
  const open = add(hinge, mul(n, leafLen * side));
  const sector: Vec2[] = [hinge];
  const a0 = Math.atan2(closed.y - hinge.y, closed.x - hinge.x);
  const a1 = Math.atan2(open.y - hinge.y, open.x - hinge.x);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (da * i) / segments;
    sector.push({ x: hinge.x + Math.cos(a) * leafLen, y: hinge.y + Math.sin(a) * leafLen });
  }
  return { hinge, closed, open, sector, leafLen, d, n, side, sweep: da > 0 ? 1 : 0 };
}

/** Bereich vor einem Fenster (Fensterflügel nach innen, Breite × halbe Breite) */
export function windowZone(w: Wall, o: Opening): Vec2[] {
  const { n, h, p0, p1 } = openingGeom(w, o);
  const side = o.swing ?? 1;
  const depth = Math.min(o.width / 2, 600);
  const f0 = add(p0, mul(n, h * side)), f1 = add(p1, mul(n, h * side));
  return [f0, f1, add(f1, mul(n, depth * side)), add(f0, mul(n, depth * side))];
}

/** Grundriss-Projektion eines Dachfensters */
export function roofWindowFootprint(rw: RoofWindow, plane: SlopePlane, w: Wall): Vec2[] {
  const d = norm(sub(w.b, w.a));
  const inn = mul(perp(d), plane.side);
  const tan = Math.tan((plane.pitchDeg * Math.PI) / 180);
  const cos = Math.cos((plane.pitchDeg * Math.PI) / 180);
  const d0 = Math.max(0, (rw.bottomHeight - plane.knee) / tan);
  const d1 = d0 + rw.length * cos;
  const base = add(plane.innerA, mul(d, rw.offset));
  const s0 = mul(d, -rw.width / 2), s1 = mul(d, rw.width / 2);
  return [add(add(base, s0), mul(inn, d0)), add(add(base, s1), mul(inn, d0)), add(add(base, s1), mul(inn, d1)), add(add(base, s0), mul(inn, d1))];
}

/** 3D-Ecken eines Dachfensters (mm, z = Höhe) */
export function roofWindowCorners3D(rw: RoofWindow, plane: SlopePlane, w: Wall) {
  const fp = roofWindowFootprint(rw, plane, w);
  const sin = Math.sin((plane.pitchDeg * Math.PI) / 180);
  const z0 = Math.max(rw.bottomHeight, plane.knee);
  const z1 = z0 + rw.length * sin;
  return [
    { ...fp[0], z: z0 },
    { ...fp[1], z: z0 },
    { ...fp[2], z: z1 },
    { ...fp[3], z: z1 },
  ];
}

export function stairSteps(s: Stair): { poly: Vec2[]; index: number }[] {
  const steps: { poly: Vec2[]; index: number }[] = [];
  const treads = Math.max(1, s.steps - 1);
  const tl = s.length / treads;
  for (let i = 0; i < treads; i++) {
    const cx = -s.length / 2 + tl * (i + 0.5);
    const poly = rectPolygon(cx, 0, tl, s.width, 0).map((p) => add(rotate(p, s.rotation), { x: s.x, y: s.y }));
    steps.push({ poly, index: i });
  }
  return steps;
}

/** Schwenkbereich von Schranktüren vor der Front (Vorderseite = lokale +y) */
export function furnitureDoorSwing(f: Furniture): Vec2[] | null {
  if (!f.doors || f.doorType !== 'hinged') return null;
  const leaf = f.width / f.doors;
  const c = { x: f.x, y: f.y };
  const local = rectPolygon(0, f.depth / 2 + leaf / 2, f.width, leaf, 0);
  return local.map((p) => add(rotate(p, f.rotation), c));
}

export function furnitureFootprint(f: Furniture): Vec2[] {
  return rectPolygon(f.x, f.y, f.width, f.depth, f.rotation);
}

/** Front-Richtung (lokal +y) in Weltkoordinaten */
export function furnitureFront(f: Furniture): Vec2 {
  return rotate({ x: 0, y: 1 }, f.rotation);
}
