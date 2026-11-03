import type { Level, Slope, Vec2, Wall } from '../model/types';
import { clipHalfPlane, triangulate, type Multi, type Ring } from './polygon';
import { polygonArea, polygonCentroid, add, mul, sub, norm, perp, dist, bbox, pointInPolygon, pointSegDist } from './vec';
import { plannedWalls, detectRooms, interiorPoint, type DetectedRoom } from './rooms';

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
function endExtension(w: Wall, end: 'a' | 'b', walls: Wall[], occupied?: (p: Vec2) => boolean): number {
  const p = w[end];
  const d = norm(sub(w.b, w.a));
  const out = end === 'a' ? -1 : 1;
  const inn = mul(perp(d), w.slope?.side ?? 1);
  let ext = 0;
  for (const o of walls) {
    if (o.id === w.id) continue;
    const atEnd = dist(o.a, p) < 3 || dist(o.b, p) < 3;
    const through = !atEnd && pointSegDistLocal(p, o.a, o.b) < 3;
    if (!atEnd && !through) continue;
    const od = norm(sub(o.b, o.a));
    const collinear = Math.abs(d.x * od.y - d.y * od.x) < 0.02;
    if (collinear && atEnd) return 0; // Fortsetzung der Wand → Schräge endet am Knoten
    if (!collinear) {
      // Liegt hinter der Querwand ein anderer Raum, endet die Schräge kurz vor deren Rückseite
      const beyond = [0, w.thickness / 2 + 100].some((t) =>
        occupied?.(add(add(p, mul(d, out * (o.thickness / 2 + 50))), mul(inn, t))),
      );
      ext = Math.max(ext, o.thickness / 2 + (beyond ? -1 : 1));
    }
  }
  return ext;
}
function pointSegDistLocal(p: Vec2, a: Vec2, b: Vec2) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Neigung in Grad; für length/depth wird die flache Deckenhöhe der Ebene gebraucht */
export function slopePitch(s: Slope, ceilingHeight = 2500): number {
  const rise = ceilingHeight - s.knee;
  if (s.mode === 'length' && s.slopeLength && s.slopeLength > 0 && rise > 0)
    return (Math.asin(Math.min(1, rise / s.slopeLength)) * 180) / Math.PI;
  if (s.mode === 'depth' && s.slopeDepth && s.slopeDepth > 0 && rise > 0) return (Math.atan2(rise, s.slopeDepth) * 180) / Math.PI;
  if (s.mode === 'ridge' && s.ridgeHeight != null && s.ridgeDistance && s.ridgeDistance > 0) {
    return (Math.atan2(s.ridgeHeight - s.knee, s.ridgeDistance) * 180) / Math.PI;
  }
  return s.pitchDeg;
}

/**
 * Schrägen-Ebenen. heightFor liefert die flache Deckenhöhe im Raum vor der Wand
 * (nötig, wenn die Neigung über Länge/Tiefe der Schräge angegeben ist).
 */
export function slopePlanes(
  walls: Wall[],
  heightFor: number | ((probe: Vec2) => number) = 2500,
  /** liegt p in einem Raum? (dann reicht die Schräge nicht bis auf die Rückseite der Wand) */
  occupied?: (p: Vec2) => boolean,
): SlopePlane[] {
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
    const probe = { x: (innerA.x + innerB.x) / 2 + inn.x * 300, y: (innerA.y + innerB.y) / 2 + inn.y * 300 };
    const H = typeof heightFor === 'number' ? heightFor : heightFor(probe);
    const pitch = Math.max(1, Math.min(89, slopePitch(w.slope, H)));
    const tan = Math.tan((pitch * Math.PI) / 180);
    // h = knee + tan * (inn·(p - innerA))
    const fn: Affine = { ax: tan * inn.x, ay: tan * inn.y, c: w.slope.knee - tan * (inn.x * innerA.x + inn.y * innerA.y) };
    // Außenwand: Schräge deckt die Wand bis zur Außenseite; grenzt hinten ein Raum an, endet sie kurz davor
    const backOccupied = [0.1, 0.3, 0.5, 0.7, 0.9].some((t) =>
      occupied?.({ x: w.a.x + d.x * L * t - inn.x * (half + 50), y: w.a.y + d.y * L * t - inn.y * (half + 50) }),
    );
    const domain = [
      // Innenseite inkl. der Wand selbst
      { nx: inn.x, ny: inn.y, c: -(inn.x * innerA.x + inn.y * innerA.y) + w.thickness + (backOccupied ? -1 : 1) },
      // Streifen entlang der Wand
      { nx: d.x, ny: d.y, c: -(d.x * w.a.x + d.y * w.a.y) + endExtension(w, 'a', walls, occupied) },
      { nx: -d.x, ny: -d.y, c: d.x * w.a.x + d.y * w.a.y + L + endExtension(w, 'b', walls, occupied) },
    ];
    planes.push({ wallId: w.id, fn, domain, knee: w.slope.knee, pitchDeg: pitch, innerA, innerB, side: s });
  }
  return planes;
}

const evalA = (f: Affine, p: Vec2) => f.ax * p.x + f.ay * p.y + f.c;
const inDomain = (pl: SlopePlane, p: Vec2) => pl.domain.every((h) => h.nx * p.x + h.ny * p.y + h.c >= -1e-6);

export class CeilingModel {
  planes: SlopePlane[];
  /** Deckenhöhe der Ebene (Standard für Räume ohne eigene Höhe) */
  H: number;
  rooms: { clear: Multi; H: number; bb: ReturnType<typeof bbox> }[];
  constructor(public level: Level, detected?: DetectedRoom[]) {
    this.H = level.ceilingHeight;
    const rs = detected ?? detectRooms(level);
    this.rooms = rs.map((r) => ({ clear: r.clear, H: r.meta?.ceilingHeight ?? level.ceilingHeight, bb: bbox(r.clear.flatMap((p) => p[0])) }));
    this.planes = slopePlanes(plannedWalls(level), (p) => this.roomHeightAt(p) ?? this.H, (p) => this.roomHeightAt(p) != null);
  }

  /** flache Deckenhöhe des Raums, in dem p liegt */
  roomHeightAt(p: Vec2): number | undefined {
    for (const r of this.rooms) {
      if (p.x < r.bb.minX || p.x > r.bb.maxX || p.y < r.bb.minY || p.y > r.bb.maxY) continue;
      if (r.clear.some((poly) => pointInPolygon(p, poly[0]) && !poly.slice(1).some((h) => pointInPolygon(p, h)))) return r.H;
    }
    return undefined;
  }

  /** flache Deckenhöhe an p; in Wänden die größte Höhe der angrenzenden Räume */
  flatAt(p: Vec2): number {
    const h = this.roomHeightAt(p);
    if (h != null) return h;
    let best = -Infinity;
    for (const r of this.rooms) {
      if (r.H <= best) continue;
      if (p.x < r.bb.minX - 600 || p.x > r.bb.maxX + 600 || p.y < r.bb.minY - 600 || p.y > r.bb.maxY + 600) continue;
      let near = false;
      for (const poly of r.clear)
        for (const ring of poly)
          for (let i = 0; i < ring.length && !near; i++) if (pointSegDist(p, ring[i], ring[(i + 1) % ring.length]) <= 600) near = true;
      if (near) best = r.H;
    }
    return isFinite(best) ? best : this.H;
  }

  heightAt(p: Vec2, H?: number): number {
    let h = H ?? this.flatAt(p);
    for (const pl of this.planes) if (inDomain(pl, p)) h = Math.min(h, evalA(pl.fn, p));
    return h;
  }

  /** Stückweise affine Zerlegung eines Gebiets: konvexe Teile mit zugehöriger Höhenfunktion */
  pieces(region: Multi, H?: number): { poly: Ring; fn: Affine }[] {
    const out: { poly: Ring; fn: Affine }[] = [];
    for (const poly of region) {
      const flat: Affine = { ax: 0, ay: 0, c: H ?? this.flatAt(interiorPoint(poly[0], poly.slice(1))) };
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
  livingArea(region: Multi, H?: number) {
    let total = 0, ge1 = 0, ge2 = 0, minH = Infinity, maxH = -Infinity;
    for (const { poly, fn } of this.pieces(region, H)) {
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
  profile(a: Vec2, b: Vec2, H?: number): { s: number; h: number }[] {
    const L = dist(a, b);
    const Hc = H ?? this.flatAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    if (L < 1e-6) return [{ s: 0, h: this.heightAt(a, Hc) }];
    const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    const at = (s: number) => ({ x: a.x + d.x * s, y: a.y + d.y * s });
    const fns: Affine[] = [{ ax: 0, ay: 0, c: Hc }, ...this.planes.map((p) => p.fn)];
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
    const pts = ss.map((s) => ({ s, h: this.heightAt(at(s), Hc) }));
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
    const c = polygonCentroid(poly);
    const H = this.flatAt(c);
    for (let i = 0; i < poly.length; i++) {
      for (const p of this.profile(poly[i], poly[(i + 1) % poly.length], H)) m = Math.min(m, p.h);
    }
    m = Math.min(m, this.heightAt(c, H));
    return m;
  }
}

export function affineAt(f: Affine, p: Vec2) {
  return evalA(f, p);
}
