import * as THREE from 'three';
import type { Level, Opening, Wall, Vec2 } from '../model/types';
import type { LevelDerived } from '../store/derived';
import { affineAt, type Affine } from '../geometry/ceiling';
import { difference, type Multi, type Ring } from '../geometry/polygon';
import { add, dist, dot, mul, norm, perp, sub } from '../geometry/vec';
import { roofWindowFootprint } from '../geometry/openings';

/** mm → m und Grundriss (x, y) + Höhe z → three (x, z, y) */
export const S = 0.001;
export const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x * S, z * S, y * S);

export interface WallFaceGeom {
  wallId: string;
  side: 1 | -1 | 0; // 0 = Kanten/Oberseite/Laibung
  geometry: THREE.BufferGeometry;
  /** Fläche (mm²) abzüglich Öffnungen – für Materialberechnung */
  area: number;
}

function pushTri(arr: number[], uv: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number]) {
  arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  uv.push(...ua, ...ub, ...uc);
}

function geomFrom(pos: number[], uv: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Wandseite als Shape in (s, z) mit Öffnungslöchern; UV in Metern (für maßstäbliche Texturen) */
function faceGeometry(w: Wall, side: 1 | -1, start: Vec2, end: Vec2, D: LevelDerived, openings: Opening[]) {
  const d = norm(sub(w.b, w.a));
  const n = perp(d);
  const s0 = dot(sub(start, w.a), d);
  const s1 = dot(sub(end, w.a), d);
  const prof = D.ceiling.profile(start, end).map((p) => ({ s: s0 + (p.s * (s1 - s0)) / Math.max(1e-9, dist(start, end)), h: w.height ? Math.min(w.height, p.h) : p.h }));
  const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
  const shape = new THREE.Shape();
  shape.moveTo(lo, 0);
  shape.lineTo(hi, 0);
  const topPts = [...prof].sort((a, b) => b.s - a.s);
  for (const p of topPts) shape.lineTo(p.s, p.h);
  shape.closePath();
  let area = 0;
  for (let i = 0; i < topPts.length - 1; i++) area += ((topPts[i].h + topPts[i + 1].h) / 2) * Math.abs(topPts[i].s - topPts[i + 1].s);
  const topAt = (s: number) => {
    for (let i = 0; i < prof.length - 1; i++) {
      const a = prof[i], b = prof[i + 1];
      if ((s >= a.s && s <= b.s) || (s <= a.s && s >= b.s)) return a.h + ((b.h - a.h) * (s - a.s)) / (b.s - a.s || 1);
    }
    return prof[0]?.h ?? 2500;
  };
  for (const o of openings) {
    const a = Math.max(lo + 5, o.offset - o.width / 2), b = Math.min(hi - 5, o.offset + o.width / 2);
    if (b <= a) continue;
    const z0 = Math.max(0.5, o.sill);
    const z1 = Math.min(o.sill + o.height, Math.min(topAt(a), topAt(b)) - 10);
    if (z1 <= z0) continue;
    const hole = new THREE.Path();
    hole.moveTo(a, z0);
    hole.lineTo(a, z1);
    hole.lineTo(b, z1);
    hole.lineTo(b, z0);
    hole.closePath();
    shape.holes.push(hole);
    area -= (b - a) * (z1 - z0);
  }
  const sg = new THREE.ShapeGeometry(shape);
  const pos = sg.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const off = (side * w.thickness) / 2;
  for (let i = 0; i < pos.count; i++) {
    const s = pos.getX(i), z = pos.getY(i);
    const p = add(add(w.a, mul(d, s)), mul(n, off));
    pos.setXYZ(i, p.x * S, z * S, p.y * S);
    uv[i * 2] = (side === 1 ? s : -s) * S;
    uv[i * 2 + 1] = z * S;
  }
  sg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  sg.computeVertexNormals();
  return { geometry: sg as THREE.BufferGeometry, area };
}

/** Senkrechter Streifen entlang einer Strecke bis zur Decke/Schräge */
function stripGeometry(a: Vec2, b: Vec2, D: LevelDerived, maxH?: number, pos: number[] = [], uv: number[] = []) {
  const prof = D.ceiling.profile(a, b);
  const L = dist(a, b);
  if (L < 0.5) return { pos, uv };
  const at = (s: number) => add(a, mul(sub(b, a), s / L));
  for (let i = 0; i < prof.length - 1; i++) {
    const p0 = at(prof[i].s), p1 = at(prof[i + 1].s);
    const h0 = maxH ? Math.min(maxH, prof[i].h) : prof[i].h, h1 = maxH ? Math.min(maxH, prof[i + 1].h) : prof[i + 1].h;
    const A = V3(p0.x, p0.y, 0), B = V3(p1.x, p1.y, 0), C = V3(p1.x, p1.y, h1), Dd = V3(p0.x, p0.y, h0);
    pushTri(pos, uv, A, B, C, [prof[i].s * S, 0], [prof[i + 1].s * S, 0], [prof[i + 1].s * S, h1 * S]);
    pushTri(pos, uv, A, C, Dd, [prof[i].s * S, 0], [prof[i + 1].s * S, h1 * S], [prof[i].s * S, h0 * S]);
  }
  return { pos, uv };
}

/** Fläche (Grundriss) mit stückweiser Höhenfunktion als Dreiecksnetz; facing = Richtung der Vorderseite */
export function surfaceFromPieces(pieces: { poly: Ring; fn: Affine }[], maxH?: number, facing: 'up' | 'down' = 'up') {
  const pos: number[] = [];
  const uv: number[] = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const { poly, fn } of pieces) {
    for (let i = 1; i < poly.length - 1; i++) {
      const tri = [poly[0], poly[i], poly[i + 1]];
      const v = tri.map((p) => V3(p.x, p.y, maxH ? Math.min(maxH, affineAt(fn, p)) : affineAt(fn, p)));
      const u = tri.map((p) => [p.x * S, p.y * S] as [number, number]);
      const ny = e1.subVectors(v[1], v[0]).cross(e2.subVectors(v[2], v[0])).y;
      const flip = facing === 'up' ? ny < 0 : ny > 0;
      if (flip) pushTri(pos, uv, v[0], v[2], v[1], u[0], u[2], u[1]);
      else pushTri(pos, uv, v[0], v[1], v[2], u[0], u[1], u[2]);
    }
  }
  return geomFrom(pos, uv);
}

export function buildWallGeometries(level: Level, D: LevelDerived): WallFaceGeom[] {
  const out: WallFaceGeom[] = [];
  for (const w of D.wallsPlanned) {
    const fp = D.footprints.get(w.id);
    if (!fp) continue;
    const ops = level.openings.filter((o) => o.wallId === w.id);
    const plus = faceGeometry(w, 1, fp.plusA, fp.plusB, D, ops);
    const minus = faceGeometry(w, -1, fp.minusA, fp.minusB, D, ops);
    out.push({ wallId: w.id, side: 1, geometry: plus.geometry, area: plus.area });
    out.push({ wallId: w.id, side: -1, geometry: minus.geometry, area: minus.area });
    // Stirnseiten (alle Polygonkanten außer den beiden Langseiten)
    const poly = fp.polygon;
    let pos: number[] = [], uv: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const isPlus = dist(a, fp.plusA) < 0.5 && dist(b, fp.plusB) < 0.5;
      const isMinus = dist(a, fp.minusB) < 0.5 && dist(b, fp.minusA) < 0.5;
      if (isPlus || isMinus) continue;
      ({ pos, uv } = stripGeometry(a, b, D, w.height, pos, uv));
    }
    // Oberseite
    const top = D.ceiling.pieces([[poly]]);
    const topG = surfaceFromPieces(top, w.height, 'up');
    const tp = topG.getAttribute('position').array as Float32Array;
    const tu = topG.getAttribute('uv').array as Float32Array;
    pos.push(...tp);
    uv.push(...tu);
    // Laibungen
    const d = norm(sub(w.b, w.a));
    const n = perp(d);
    const h = w.thickness / 2;
    for (const o of ops) {
      const s0 = o.offset - o.width / 2, s1 = o.offset + o.width / 2;
      const z0 = Math.max(0.5, o.sill);
      const pA = add(w.a, mul(d, s0)), pB = add(w.a, mul(d, s1));
      const topLim = Math.min(D.ceiling.heightAt(pA), D.ceiling.heightAt(pB)) - 10;
      const z1 = Math.min(o.sill + o.height, w.height ?? Infinity, topLim);
      if (z1 <= z0) continue;
      const c = (p: Vec2, sgn: number, z: number) => {
        const q = add(p, mul(n, sgn * h));
        return V3(q.x, q.y, z);
      };
      const quad = (A: THREE.Vector3, B: THREE.Vector3, C: THREE.Vector3, Dd: THREE.Vector3) => {
        pushTri(pos, uv, A, B, C, [0, 0], [1, 0], [1, 1]);
        pushTri(pos, uv, A, C, Dd, [0, 0], [1, 1], [0, 1]);
      };
      quad(c(pA, 1, z0), c(pA, -1, z0), c(pA, -1, z1), c(pA, 1, z1));
      quad(c(pB, -1, z0), c(pB, 1, z0), c(pB, 1, z1), c(pB, -1, z1));
      quad(c(pA, 1, z1), c(pA, -1, z1), c(pB, -1, z1), c(pB, 1, z1));
      if (z0 > 1) quad(c(pA, 1, z0), c(pB, 1, z0), c(pB, -1, z0), c(pA, -1, z0));
    }
    out.push({ wallId: w.id, side: 0, geometry: geomFrom(pos, uv), area: 0 });
  }
  return out;
}

export function multiToShapes(m: Multi): THREE.Shape[] {
  return m.map((poly) => {
    const sh = new THREE.Shape(poly[0].map((p) => new THREE.Vector2(p.x, p.y)));
    for (const h of poly.slice(1)) sh.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))));
    return sh;
  });
}

/** Boden eines Raums auf z=0 (UV in Metern, ggf. gedreht für Verlegerichtung) */
export function floorGeometry(region: Multi, rotDeg = 0): THREE.BufferGeometry {
  const shapes = multiToShapes(region);
  const g = new THREE.ShapeGeometry(shapes);
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const r = (rotDeg * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setXYZ(i, x * S, 0, y * S);
    uv[i * 2] = (x * cs + y * sn) * S;
    uv[i * 2 + 1] = (-x * sn + y * cs) * S;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // Dreiecke so umdrehen, dass die Vorderseite nach oben zeigt
  const idx = g.getIndex();
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  g.computeVertexNormals();
  return g;
}

/** Decke eines Raums inkl. Schrägen; Dachfenster ausgespart. Liefert Teilflächen je Wand-Schräge (für Oberflächen) */
export function ceilingGeometries(level: Level, D: LevelDerived, region: Multi): { key: string; geometry: THREE.BufferGeometry }[] {
  const holes: Ring[] = [];
  for (const rw of level.roofWindows) {
    const w = level.walls.find((x) => x.id === rw.wallId);
    const pl = D.ceiling.planes.find((p) => p.wallId === rw.wallId);
    if (w && pl) holes.push(roofWindowFootprint(rw, pl, w));
  }
  const reg = holes.length ? difference(region, ...holes) : region;
  const pieces = D.ceiling.pieces(reg);
  const groups = new Map<string, typeof pieces>();
  for (const pc of pieces) {
    const pl = D.ceiling.planes.find((p) => p.fn === pc.fn);
    const key = pl ? `slope:${pl.wallId}` : 'flat';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(pc);
  }
  return [...groups.entries()].map(([key, ps]) => ({ key, geometry: surfaceFromPieces(ps, undefined, 'down') }));
}
