import polygonClipping, { type MultiPolygon, type Polygon as PcPolygon } from 'polygon-clipping';
import { ShapeUtils, Vector2 } from 'three';
import type { Vec2 } from '../model/types';
import { polygonSignedArea } from './vec';

export type Ring = Vec2[];
/** Polygon mit Löchern: [außen, ...löcher] */
export type PolyWithHoles = Ring[];
export type Multi = PolyWithHoles[];

export const toPc = (ring: Ring): [number, number][] => ring.map((p) => [p.x, p.y] as [number, number]);
const fromPcRing = (r: [number, number][]): Ring => {
  const pts = r.map(([x, y]) => ({ x, y }));
  // polygon-clipping schließt Ringe (letzter = erster)
  if (pts.length > 1) {
    const f = pts[0], l = pts[pts.length - 1];
    if (f.x === l.x && f.y === l.y) pts.pop();
  }
  return pts;
};
export const fromPcMulti = (m: MultiPolygon): Multi => m.map((poly) => poly.map(fromPcRing));
export const toPcMulti = (m: Multi): MultiPolygon => m.map((poly) => poly.map(toPc)) as MultiPolygon;

export function union(rings: Ring[]): Multi {
  const valid = rings.filter((r) => r.length >= 3 && Math.abs(polygonSignedArea(r)) > 1e-6);
  if (valid.length === 0) return [];
  const polys: PcPolygon[] = valid.map((r) => [toPc(r)]);
  return fromPcMulti(polygonClipping.union(polys[0], ...polys.slice(1)));
}

export function difference(subject: Multi | Ring, ...clips: (Multi | Ring)[]): Multi {
  const s = isRing(subject) ? ([[toPc(subject)]] as MultiPolygon) : toPcMulti(subject);
  const cs = clips
    .map((c) => (isRing(c) ? ([[toPc(c)]] as MultiPolygon) : toPcMulti(c)))
    .filter((c) => c.length > 0);
  if (s.length === 0) return [];
  if (cs.length === 0) return fromPcMulti(s);
  return fromPcMulti(polygonClipping.difference(s, ...cs));
}

export function intersection(a: Multi | Ring, b: Multi | Ring): Multi {
  const s = isRing(a) ? ([[toPc(a)]] as MultiPolygon) : toPcMulti(a);
  const c = isRing(b) ? ([[toPc(b)]] as MultiPolygon) : toPcMulti(b);
  if (s.length === 0 || c.length === 0) return [];
  return fromPcMulti(polygonClipping.intersection(s, c));
}

function isRing(x: Multi | Ring): x is Ring {
  return x.length === 0 || 'x' in (x as any)[0];
}

export function multiArea(m: Multi): number {
  let a = 0;
  for (const poly of m) {
    poly.forEach((ring, i) => {
      const ar = Math.abs(polygonSignedArea(ring));
      a += i === 0 ? ar : -ar;
    });
  }
  return a;
}

/** Sutherland-Hodgman: Polygon an Halbebene n·p + c >= 0 beschneiden */
export function clipHalfPlane(poly: Ring, nx: number, ny: number, c: number): Ring {
  const out: Ring = [];
  const f = (p: Vec2) => nx * p.x + ny * p.y + c;
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const fc = f(cur), fp = f(prev);
    const inC = fc >= -1e-9, inP = fp >= -1e-9;
    if (inC) {
      if (!inP) out.push(interp(prev, cur, fp, fc));
      out.push(cur);
    } else if (inP) {
      out.push(interp(prev, cur, fp, fc));
    }
  }
  return out;
}
function interp(a: Vec2, b: Vec2, fa: number, fb: number): Vec2 {
  const t = fa / (fa - fb);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Triangulierung (Earcut aus three) – liefert Dreiecke als Punkt-Tripel */
export function triangulate(poly: PolyWithHoles): [Vec2, Vec2, Vec2][] {
  if (poly.length === 0 || poly[0].length < 3) return [];
  const contour = poly[0].map((p) => new Vector2(p.x, p.y));
  const holes = poly.slice(1).map((h) => h.map((p) => new Vector2(p.x, p.y)));
  const all = [...poly[0], ...poly.slice(1).flat()];
  const faces = ShapeUtils.triangulateShape(contour, holes);
  return faces.map(([a, b, c]) => [all[a], all[b], all[c]]);
}

/** Polygon nach innen/außen versetzen (nur für einfache Polygone, Ecken per Geradenschnitt) */
export function offsetRing(ring: Ring, d: number): Ring {
  const n = ring.length;
  const ccw = polygonSignedArea(ring) > 0;
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i + n - 1) % n], p1 = ring[i], p2 = ring[(i + 1) % n];
    const e1 = norm2(p1.x - p0.x, p1.y - p0.y), e2 = norm2(p2.x - p1.x, p2.y - p1.y);
    const s = ccw ? 1 : -1;
    // Normale nach außen
    const n1 = { x: e1.y * s, y: -e1.x * s }, n2 = { x: e2.y * s, y: -e2.x * s };
    const a1 = { x: p0.x + n1.x * d, y: p0.y + n1.y * d }, a2 = { x: p1.x + n2.x * d, y: p1.y + n2.y * d };
    const cr = e1.x * e2.y - e1.y * e2.x;
    if (Math.abs(cr) < 1e-9) {
      out.push({ x: p1.x + n1.x * d, y: p1.y + n1.y * d });
    } else {
      const t = ((a2.x - a1.x) * e2.y - (a2.y - a1.y) * e2.x) / cr;
      out.push({ x: a1.x + e1.x * t, y: a1.y + e1.y * t });
    }
  }
  return out;
}
function norm2(x: number, y: number) {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}
