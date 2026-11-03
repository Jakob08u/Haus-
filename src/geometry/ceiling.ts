import type { Level, Slope, Vec2, Wall } from '../model/types';
import { clipHalfPlane, triangulate, type Multi, type Ring } from './polygon';
import { polygonArea, polygonCentroid, sub, dot, norm, perp, dist, bbox } from './vec';
import { plannedWalls } from './rooms';

/** Affine Höhenfunktion h(p) = ax*x + ay*y + c (mm) */
export interface Affine { ax: number; ay: number; c: number }

export interface SlopePlane {
  wallId: string;
  fn: Affine;
  /** Gültigkeitsbereich: konvexes Gebiet als Halbebenen n·p + c >= 0 */
  domain: { nx: number; ny: number; c: number }[];
  knee: number;
  pitchDeg: number;
  /** Innenkante der Wand (Kniestocklinie) */
  innerA: Vec2;
  innerB: Vec2;
  side: 1 | -1;
}

/**
 * Wie weit gilt eine Schräge über das Wandende hinaus? An Ecken (anschließende Querwand) bis über
 * die halbe Wandstärke, damit die Ecke abgedeckt ist. Läuft die Außenwand in gleicher Richtung weiter
 * (anderer Raum, eigene oder keine Schräge), endet die Schräge genau am Knoten.
 */
function endExtension(w: Wall, end: 'a' | 'b', walls: Wall[]): number {
  const p = w[end];
  const d = norm(sub(w.b, w.a));
  let ext = 0;
  for (const o of walls) {
    if (o.id === w.id) continue;
    const atEnd = dist(o.a, p) < 3 || dist(o.b, p) < 3;
    const through = !atEnd && pointSegDistLocal(p, o.a, o.b) < 3;
    if (!atEnd && !through) continue;
    const od = norm(sub(o.b, o.a));
    const collinear = Math.abs(d.x * od.y - d.y * od.x) < 0.02;
    if (collinear && atEnd) return 0; // Fortsetzung der Wand → Schräge endet am Knoten
    if (!collinear) ext = Math.max(ext, o.thickness / 2 + 1);
  }
  return ext;
}
function pointSegDistLocal(p: Vec2, a: Vec2, b: Vec2) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

export function slopePitch(s: Slope): number {
  if (s.mode === 'ridge' && s.ridgeHeight != null && s.ridgeDistance && s.ridgeDistance > 0) {
    return (Math.atan2(s.ridgeHeight - s.knee, s.ridgeDistance) * 180) / Math.PI;
  }
  return s.pitchDeg;
}

export function slopePlanes(walls: Wall[]): SlopePlane[] {
  const planes: SlopePlane[] = [];
  for (const w of walls) {
    if (!w.slope) continue;
    const L = dist(w.a, w.b);
    if (L < 1) continue;
    const d = norm(sub(w.b, w.a));
    const n = perp(d);
    const s = w.slope.side;
    const inn = { x: n.x * s, y: n.y * s }; // Richtung in den Raum
    const half = w.thickness / 2;
    const innerA = { x: w.a.x + inn.x * half, y: w.a.y + inn.y * half };
    const innerB = { x: w.b.x + inn.x * half, y: w.b.y + inn.y * half };
    const pitch = Math.max(1, Math.min(89, slopePitch(w.slope)));
    const tan = Math.tan((pitch * Math.PI) / 180);
    // h = knee + tan * (inn·(p - innerA))
    const fn: Affine = { ax: tan * inn.x, ay: tan * inn.y, c: w.slope.knee - tan * (inn.x * innerA.x + inn.y * innerA.y) };
    const domain = [
      // Innenseite inkl. der Wand selbst
      { nx: inn.x, ny: inn.y, c: -(inn.x * innerA.x + inn.y * innerA.y) + w.thickness + 1 },
      // Streifen entlang der Wand
      { nx: d.x, ny: d.y, c: -(d.x * w.a.x + d.y * w.a.y) + endExtension(w, 'a', walls) },
      { nx: -d.x, ny: -d.y, c: d.x * w.a.x + d.y * w.a.y + L + endExtension(w, 'b', walls) },
    ];
    planes.push({ wallId: w.id, fn, domain, knee: w.slope.knee, pitchDeg: pitch, innerA, innerB, side: s });
  }
  return planes;
}

const evalA = (f: Affine, p: Vec2) => f.ax * p.x + f.ay * p.y + f.c;
const inDomain = (pl: SlopePlane, p: Vec2) => pl.domain.every((h) => h.nx * p.x + h.ny * p.y + h.c >= -1e-6);

export class CeilingModel {
  planes: SlopePlane[];
  H: number;
  constructor(public level: Level) {
    this.planes = slopePlanes(plannedWalls(level));
    this.H = level.ceilingHeight;
  }

  heightAt(p: Vec2): number {
    let h = this.H;
    for (const pl of this.planes) if (inDomain(pl, p)) h = Math.min(h, evalA(pl.fn, p));
    return h;
  }

  /** Stückweise affine Zerlegung eines Gebiets: konvexe Teile mit zugehöriger Höhenfunktion */
  pieces(region: Multi): { poly: Ring; fn: Affine }[] {
    const out: { poly: Ring; fn: Affine }[] = [];
    const flat: Affine = { ax: 0, ay: 0, c: this.H };
    for (const poly of region) {
      const bb = bbox(poly[0]);
      const rel = this.planes.filter((pl) => {
        // grob: Gebiet schneidet Domäne (Ecken der BBox prüfen + Mitte)
        const pts = [
          { x: bb.minX, y: bb.minY }, { x: bb.maxX, y: bb.minY }, { x: bb.maxX, y: bb.maxY }, { x: bb.minX, y: bb.maxY },
        ];
        return pl.domain.every((h) => pts.some((p) => h.nx * p.x + h.ny * p.y + h.c >= 0));
      });
      for (const tri of triangulate(poly)) {
        let parts: Ring[] = [tri as Ring];
        for (const pl of rel)
          for (const h of pl.domain) {
            const next: Ring[] = [];
            for (const part of parts) {
              const a = clipHalfPlane(part, h.nx, h.ny, h.c);
              const b = clipHalfPlane(part, -h.nx, -h.ny, -h.c);
              if (a.length >= 3 && polygonArea(a) > 1) next.push(a);
              if (b.length >= 3 && polygonArea(b) > 1) next.push(b);
            }
            parts = next;
          }
        for (const part of parts) {
          const c = polygonCentroid(part);
          const fns: Affine[] = [flat, ...rel.filter((pl) => inDomain(pl, c)).map((pl) => pl.fn)];
          fns.forEach((fk, k) => {
            let reg: Ring = part;
            for (let j = 0; j < fns.length && reg.length >= 3; j++) {
              if (j === k) continue;
              const fj = fns[j];
              // fj - fk >= 0 (bei Gleichstand gewinnt kleinerer Index)
              reg = clipHalfPlane(reg, fj.ax - fk.ax, fj.ay - fk.ay, fj.c - fk.c - (j < k ? 1e-6 : 0));
            }
            if (reg.length >= 3 && polygonArea(reg) > 1) out.push({ poly: reg, fn: fk });
          });
        }
      }
    }
    return out;
  }

  /**
   * Wohnfläche nach WoFlV §4: lichte Höhe ≥ 2 m voll, 1–2 m zur Hälfte, < 1 m nicht.
   * Liefert Flächen in mm².
   */
  livingArea(region: Multi) {
    let total = 0, ge1 = 0, ge2 = 0, minH = Infinity, maxH = -Infinity;
    for (const { poly, fn } of this.pieces(region)) {
      total += polygonArea(poly);
      const a1 = clipHalfPlane(poly, fn.ax, fn.ay, fn.c - 1000);
      const a2 = clipHalfPlane(poly, fn.ax, fn.ay, fn.c - 2000);
      if (a1.length >= 3) ge1 += polygonArea(a1);
      if (a2.length >= 3) ge2 += polygonArea(a2);
      for (const p of poly) {
        const h = evalA(fn, p);
        minH = Math.min(minH, h);
        maxH = Math.max(maxH, h);
      }
    }
    const below1 = total - ge1;
    const between = ge1 - ge2;
    return {
      total,
      below1,
      between1and2: between,
      above2: ge2,
      living: ge2 + 0.5 * between,
      minHeight: isFinite(minH) ? minH : this.H,
      maxHeight: isFinite(maxH) ? maxH : this.H,
    };
  }

  /** Höhenprofil entlang einer Strecke (exakte Knickpunkte) */
  profile(a: Vec2, b: Vec2): { s: number; h: number }[] {
    const L = dist(a, b);
    if (L < 1e-6) return [{ s: 0, h: this.heightAt(a) }];
    const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    const at = (s: number) => ({ x: a.x + d.x * s, y: a.y + d.y * s });
    const fns: Affine[] = [{ ax: 0, ay: 0, c: this.H }, ...this.planes.map((p) => p.fn)];
    const cand = new Set<number>([0, L]);
    // Schnitte der Funktionen entlang der Linie
    const lin = fns.map((f) => ({ h0: evalA(f, a), k: f.ax * d.x + f.ay * d.y }));
    for (let i = 0; i < lin.length; i++)
      for (let j = i + 1; j < lin.length; j++) {
        const dk = lin[i].k - lin[j].k;
        if (Math.abs(dk) < 1e-12) continue;
        const s = (lin[j].h0 - lin[i].h0) / dk;
        if (s > 0 && s < L) cand.add(s);
      }
    // Domänengrenzen
    for (const pl of this.planes)
      for (const h of pl.domain) {
        const den = h.nx * d.x + h.ny * d.y;
        if (Math.abs(den) < 1e-12) continue;
        const s = -(h.nx * a.x + h.ny * a.y + h.c) / den;
        if (s > 0 && s < L) {
          cand.add(Math.max(0, s - 0.5));
          cand.add(Math.min(L, s + 0.5));
        }
      }
    const ss = [...cand].sort((x, y) => x - y);
    const pts = ss.map((s) => ({ s, h: this.heightAt(at(s)) }));
    // kollineare Punkte entfernen
    const out: { s: number; h: number }[] = [];
    for (const p of pts) {
      if (out.length >= 2) {
        const p0 = out[out.length - 2], p1 = out[out.length - 1];
        const pred = p0.h + ((p1.h - p0.h) * (p.s - p0.s)) / (p1.s - p0.s || 1);
        if (Math.abs(pred - p.h) < 0.5) out.pop();
      }
      out.push(p);
    }
    return out;
  }

  /** minimale Deckenhöhe über einem konvexen Grundriss (z. B. Möbel) – Minimum liegt an Ecken bzw. Domänengrenzen */
  minOver(poly: Vec2[]): number {
    let m = Infinity;
    for (let i = 0; i < poly.length; i++) {
      for (const p of this.profile(poly[i], poly[(i + 1) % poly.length])) m = Math.min(m, p.h);
    }
    const c = polygonCentroid(poly);
    m = Math.min(m, this.heightAt(c));
    return m;
  }
}

export function affineAt(f: Affine, p: Vec2) {
  return evalA(f, p);
}
