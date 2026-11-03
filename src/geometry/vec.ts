import type { Vec2 } from '../model/types';

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
/** Normale (Seite +1) zu Richtung d: n = (-d.y, d.x) */
export const perp = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x });
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const rotate = (p: Vec2, deg: number, c: Vec2 = { x: 0, y: 0 }): Vec2 => {
  const r = (deg * Math.PI) / 180;
  const cs = Math.cos(r), sn = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
};
export const angleDeg = (d: Vec2) => (Math.atan2(d.y, d.x) * 180) / Math.PI;
export const eq = (a: Vec2, b: Vec2, tol = 1) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

/** Parameter t der Projektion von p auf Gerade a→b (0..1 auf der Strecke) */
export function projectT(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const l2 = dot(d, d);
  return l2 < 1e-12 ? 0 : dot(sub(p, a), d) / l2;
}

export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const t = Math.max(0, Math.min(1, projectT(p, a, b)));
  return lerp(a, b, t);
}

export function pointSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  return dist(p, closestOnSegment(p, a, b));
}

/** Schnitt zweier Geraden p + t*r und q + u*s */
export function lineIntersect(p: Vec2, r: Vec2, q: Vec2, s: Vec2): Vec2 | null {
  const rxs = cross(r, s);
  if (Math.abs(rxs) < 1e-9) return null;
  const t = cross(sub(q, p), s) / rxs;
  return { x: p.x + r.x * t, y: p.y + r.y * t };
}

/** Schnitt zweier Strecken inkl. Parametern */
export function segIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { p: Vec2; t: number; u: number } | null {
  const r = sub(b, a), s = sub(d, c);
  const rxs = cross(r, s);
  if (Math.abs(rxs) < 1e-9) return null;
  const t = cross(sub(c, a), s) / rxs;
  const u = cross(sub(c, a), r) / rxs;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { p: { x: a.x + r.x * t, y: a.y + r.y * t }, t, u };
}

export function polygonSignedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}
export const polygonArea = (poly: Vec2[]) => Math.abs(polygonSignedArea(poly));

export function polygonCentroid(poly: Vec2[]): Vec2 {
  const A = polygonSignedArea(poly);
  if (Math.abs(A) < 1e-9) {
    const s = poly.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return mul(s, 1 / Math.max(1, poly.length));
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function bbox(points: Vec2[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Rechteck (Mittelpunkt, Breite, Tiefe, Drehung) als Polygon */
export function rectPolygon(cx: number, cy: number, w: number, d: number, rotDeg: number): Vec2[] {
  const c = { x: cx, y: cy };
  return [
    { x: cx - w / 2, y: cy - d / 2 },
    { x: cx + w / 2, y: cy - d / 2 },
    { x: cx + w / 2, y: cy + d / 2 },
    { x: cx - w / 2, y: cy + d / 2 },
  ].map((p) => rotate(p, rotDeg, c));
}

let idCounter = 0;
export function uid(prefix = 'id'): string {
  idCounter++;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${idCounter}`;
}

export const round = (x: number, step = 1) => Math.round(x / step) * step;
export const fmtM = (mm: number, digits = 2) => (mm / 1000).toFixed(digits).replace('.', ',');
export const fmtCm = (mm: number, digits = 1) => {
  const s = (mm / 10).toFixed(digits).replace('.', ',');
  return s.replace(/,0+$/, '');
};
export const fmtM2 = (mm2: number, digits = 2) => (mm2 / 1e6).toFixed(digits).replace('.', ',');
