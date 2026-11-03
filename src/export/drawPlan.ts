/**
 * Zeichnet einen Grundriss über die Canvas-2D-API. Wird für PDF (jsPDF context2d, vektoriell)
 * und PNG (echtes Canvas) verwendet. Einheiten: Zeichnung in Papier-mm (PDF) bzw. Pixel (PNG).
 */
import type { Level, Project, Vec2 } from '../model/types';
import { derive } from '../store/derived';
import { bbox, add, mul, norm, perp, sub, dist, rotate, polygonArea } from '../geometry/vec';
import { union } from '../geometry/polygon';
import { doorSwing, openingGeom, roofWindowFootprint, stairSteps, furnitureFootprint } from '../geometry/openings';
import { stairPolygon } from '../geometry/rooms';
import { roomStats } from '../calc/roomStats';
import { clipHalfPlane } from '../geometry/polygon';
import { ELEC_INFO, LINE_INFO } from '../model/defaults';

type Ctx = CanvasRenderingContext2D;

export interface PlanLayout {
  /** mm Modell → Zeichnungseinheit */
  k: number;
  ox: number;
  oy: number;
  /** Basis-Schriftgröße in Zeichnungseinheiten */
  font: number;
  /** Linienbreite-Basis */
  lw: number;
}

export function planBounds(level: Level, margin = 1400) {
  const D = derive(level);
  const pts: Vec2[] = [...D.footprintsAll.values()].flatMap((f) => f.polygon);
  if (pts.length === 0) pts.push({ x: 0, y: 0 }, { x: 5000, y: 5000 });
  const bb = bbox(pts);
  return { minX: bb.minX - margin, minY: bb.minY - margin, maxX: bb.maxX + margin * 0.5, maxY: bb.maxY + margin * 0.5, w: bb.w + margin * 1.5, h: bb.h + margin * 1.5 };
}

/** Maßstab wählen: größter Normmaßstab, der passt */
export function chooseScale(level: Level, widthMM: number, heightMM: number) {
  const b = planBounds(level);
  for (const s of [20, 25, 50, 75, 100, 150, 200, 250]) if (b.w / s <= widthMM && b.h / s <= heightMM) return s;
  return Math.ceil(Math.max(b.w / widthMM, b.h / heightMM) / 50) * 50;
}

export function drawPlan(ctx: Ctx, level: Level, project: Project, L: PlanLayout, mode: 'grundriss' | 'elektro') {
  const D = derive(level);
  const T = (p: Vec2) => ({ x: L.ox + p.x * L.k, y: L.oy + p.y * L.k });
  const poly = (ring: Vec2[]) => {
    ctx.beginPath();
    ring.forEach((p, i) => {
      const q = T(p);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
  };
  const line = (a: Vec2, b: Vec2) => {
    const p = T(a), q = T(b);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  };
  const text = (t: string, p: Vec2, size: number, opts: { align?: CanvasTextAlign; color?: string; bold?: boolean; angle?: number } = {}) => {
    const q = T(p);
    ctx.save();
    ctx.fillStyle = opts.color ?? '#111111';
    ctx.font = `${opts.bold ? 'bold ' : ''}${size}px helvetica`;
    ctx.textAlign = opts.align ?? 'center';
    ctx.textBaseline = 'middle';
    if (opts.angle) {
      ctx.translate(q.x, q.y);
      ctx.rotate(opts.angle);
      ctx.fillText(t, 0, 0);
    } else ctx.fillText(t, q.x, q.y);
    ctx.restore();
  };
  const elec = mode === 'elektro';

  // Räume
  for (const r of D.rooms) {
    ctx.fillStyle = elec ? '#ffffff' : '#fbfaf6';
    for (const p of r.clear) {
      poly(p[0]);
      ctx.fill();
    }
  }
  // Schrägenbereiche (< 2 m schraffiert/hellblau)
  if (!elec) {
    for (const r of D.rooms)
      for (const { poly: pc, fn } of D.ceiling.pieces(r.clear)) {
        if (fn.ax === 0 && fn.ay === 0) continue;
        const b2 = clipHalfPlane(pc, -fn.ax, -fn.ay, 2000 - fn.c);
        if (b2.length >= 3 && polygonArea(b2) > 100) {
          ctx.fillStyle = '#e3edfb';
          poly(b2);
          ctx.fill();
        }
        const b1 = clipHalfPlane(pc, -fn.ax, -fn.ay, 1000 - fn.c);
        if (b1.length >= 3 && polygonArea(b1) > 100) {
          ctx.fillStyle = '#c9daf5';
          poly(b1);
          ctx.fill();
        }
      }
  }
  // Treppen
  for (const s of level.stairs) {
    ctx.fillStyle = elec ? '#ffffff' : '#fff6d8';
    ctx.strokeStyle = elec ? '#999999' : '#8a5a00';
    ctx.lineWidth = L.lw * 0.5;
    poly(stairPolygon(s));
    ctx.fill();
    ctx.stroke();
    for (const st of stairSteps(s)) {
      poly(st.poly);
      ctx.stroke();
    }
    const dv = rotate({ x: s.direction === 'up' ? 1 : -1, y: 0 }, s.rotation);
    const c = { x: s.x, y: s.y };
    const a0 = add(c, mul(dv, -s.length * 0.4)), a1 = add(c, mul(dv, s.length * 0.4));
    line(a0, a1);
    const n = perp(dv);
    line(a1, add(add(a1, mul(dv, -150)), mul(n, 80)));
    line(a1, add(add(a1, mul(dv, -150)), mul(n, -80)));
  }
  // Wände
  for (const w of level.walls) {
    const fp = D.footprintsAll.get(w.id);
    if (!fp) continue;
    ctx.fillStyle = elec ? '#c8c8c8' : w.type === 'neu' ? '#f4d77a' : w.type === 'abriss' ? '#ffffff' : '#555a62';
    poly(fp.polygon);
    ctx.fill();
    if (w.type === 'abriss') {
      ctx.strokeStyle = '#d62828';
      ctx.lineWidth = L.lw * 0.6;
      ctx.setLineDash([L.lw * 3, L.lw * 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.strokeStyle = elec ? '#888888' : '#1d1f23';
  ctx.lineWidth = L.lw * 0.8;
  for (const pp of union(level.walls.filter((w) => w.type !== 'abriss').map((w) => D.footprintsAll.get(w.id)?.polygon ?? [])))
    for (const ring of pp) {
      poly(ring);
      ctx.stroke();
    }
  // Öffnungen
  for (const o of level.openings) {
    const w = level.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const g = openingGeom(w, o);
    ctx.fillStyle = '#ffffff';
    poly(g.cut);
    ctx.fill();
    ctx.strokeStyle = '#1d1f23';
    ctx.lineWidth = L.lw * 0.5;
    line(add(g.p0, mul(g.n, g.h)), add(g.p0, mul(g.n, -g.h)));
    line(add(g.p1, mul(g.n, g.h)), add(g.p1, mul(g.n, -g.h)));
    if (o.type === 'door') {
      const ds = doorSwing(w, o, 16);
      ctx.lineWidth = L.lw * 0.7;
      line(ds.hinge, ds.open);
      ctx.lineWidth = L.lw * 0.35;
      ctx.beginPath();
      ds.sector.slice(1).forEach((p, i) => {
        const q = T(p);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.stroke();
    } else if (o.type === 'window') {
      ctx.lineWidth = L.lw * 0.4;
      line(g.p0, g.p1);
      line(add(g.p0, mul(g.n, g.h)), add(g.p1, mul(g.n, g.h)));
      line(add(g.p0, mul(g.n, -g.h)), add(g.p1, mul(g.n, -g.h)));
    }
    if (!elec) {
      const m = add(mul(add(g.p0, g.p1), 0.5), mul(g.n, -(o.swing ?? 1) * (g.h + 180)));
      text(`${Math.round(o.width / 10)}/${Math.round(o.height / 10)}`, m, L.font * 0.7, { color: '#475569' });
    }
  }
  // Dachfenster
  for (const rw of level.roofWindows) {
    const w = level.walls.find((x) => x.id === rw.wallId);
    const pl = D.ceiling.planes.find((p) => p.wallId === rw.wallId);
    if (!w || !pl) continue;
    const fp = roofWindowFootprint(rw, pl, w);
    ctx.strokeStyle = '#0369a1';
    ctx.lineWidth = L.lw * 0.5;
    ctx.setLineDash([L.lw * 2, L.lw * 1.2]);
    poly(fp);
    ctx.stroke();
    ctx.setLineDash([]);
    line(fp[0], fp[2]);
    line(fp[1], fp[3]);
  }
  // Möbel
  if (!elec) {
    for (const f of level.furniture) {
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = L.lw * 0.4;
      ctx.fillStyle = '#ffffff';
      const fp = furnitureFootprint(f);
      poly(fp);
      ctx.fill();
      ctx.stroke();
      text(f.name.replace(/\s*\(Beispiel\)/, '').slice(0, 24), { x: f.x, y: f.y }, L.font * 0.62, { color: '#374151' });
    }
  } else {
    // Bad-/Küchenobjekte mit Anschlüssen andeuten
    for (const f of level.furniture.filter((x) => (x.connections ?? []).length > 0)) {
      ctx.strokeStyle = '#b0b0b0';
      ctx.lineWidth = L.lw * 0.3;
      poly(furnitureFootprint(f));
      ctx.stroke();
    }
  }
  // Raumtexte
  for (const r of D.rooms) {
    const st = roomStats(level, r);
    const p = r.labelPoint;
    const t1 = r.name;
    const t2 = `${(r.netArea / 1e6).toFixed(2).replace('.', ',')} m²${Math.abs(st.living - r.netArea) > 1e4 ? ` (Wfl. ${(st.living / 1e6).toFixed(2).replace('.', ',')} m²)` : ''}`;
    const s = L.font;
    if (elec) text(t1, p, s * 0.9, { bold: true, color: '#555' });
    else {
      text(t1, { x: p.x, y: p.y - (s * 0.7) / L.k }, s, { bold: true });
      text(t2, { x: p.x, y: p.y + (s * 0.6) / L.k }, s * 0.75);
    }
    // Innenmaße an den Raumkanten
    if (!elec) {
      const ring = r.clear.reduce((a, b) => (polygonArea(b[0]) > polygonArea(a[0]) ? b : a))[0];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const Lm = dist(a, b);
        if (Lm < 400) continue;
        const d = norm(sub(b, a));
        let n = perp(d);
        const mid = mul(add(a, b), 0.5);
        const test = add(mid, mul(n, 60));
        if (!pointInRing(test, ring)) n = mul(n, -1);
        const at = add(mid, mul(n, (L.font * 0.6) / L.k));
        let ang = Math.atan2(d.y, d.x);
        if (ang > Math.PI / 2 || ang <= -Math.PI / 2) ang += Math.PI;
        text((Lm / 1000).toFixed(2).replace('.', ','), at, L.font * 0.6, { color: '#64748b', angle: ang });
      }
    }
  }
  // Elektro & Leitungen
  if (elec) {
    for (const ln of level.lines) {
      ctx.strokeStyle = LINE_INFO[ln.kind].color;
      ctx.lineWidth = L.lw * 1.1;
      if (ln.surface === 'boden') ctx.setLineDash([L.lw * 4, L.lw * 2]);
      else if (ln.surface === 'decke') ctx.setLineDash([L.lw, L.lw * 1.5]);
      ctx.beginPath();
      ln.points.forEach((p, i) => {
        const q = T(p);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const e of level.electrical) {
      const q = T(e);
      const r = Math.max(L.font * 0.45, 140 * L.k);
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(((e.rotation ?? 0) * Math.PI) / 180);
      ctx.strokeStyle = '#b91c1c';
      ctx.fillStyle = '#ffffff';
      ctx.lineWidth = L.lw * 0.6;
      drawElecGlyph(ctx, e.kind, r);
      ctx.restore();
      text(`${Math.round(e.height / 10)}`, { x: e.x, y: e.y }, L.font * 0.5, { color: '#7f1d1d', align: 'left' });
    }
  }
  // Außenmaßketten
  drawDimensionChains(ctx, level, L, T);
}

function pointInRing(p: Vec2, ring: Vec2[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function drawElecGlyph(ctx: Ctx, kind: string, r: number) {
  const stroke = () => ctx.stroke();
  ctx.beginPath();
  if (kind.startsWith('steckdose') || kind === 'starkstrom') {
    ctx.arc(0, 0, r, 0, Math.PI, false);
    ctx.closePath();
    if (kind === 'starkstrom') {
      ctx.fillStyle = '#b91c1c';
      ctx.fill();
    } else ctx.fill();
    stroke();
    const n = kind === 'steckdose3' ? 3 : kind === 'steckdose2' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * r * 0.45;
      ctx.beginPath();
      ctx.moveTo(x, r);
      ctx.lineTo(x, r * 1.6);
      stroke();
    }
  } else if (kind.includes('schalter')) {
    ctx.arc(0, r * 0.75, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    stroke();
    ctx.beginPath();
    ctx.moveTo(r * 0.3, r * 0.4);
    ctx.lineTo(r * 1.1, r * 1.4);
    stroke();
  } else if (kind === 'lampe' || kind === 'wandlampe') {
    const cy = kind === 'lampe' ? 0 : r * 0.75;
    ctx.arc(0, cy, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, cy - r * 0.5);
    ctx.lineTo(r * 0.5, cy + r * 0.5);
    ctx.moveTo(r * 0.5, cy - r * 0.5);
    ctx.lineTo(-r * 0.5, cy + r * 0.5);
    stroke();
  } else {
    ctx.rect(-r, 0, 2 * r, r * 1.3);
    ctx.fill();
    stroke();
    ctx.fillStyle = '#b91c1c';
    ctx.font = `${r * 0.8}px helvetica`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = kind === 'lan' ? 'LAN' : kind === 'antenne' ? 'TV' : kind === 'smarthome' ? 'SH' : kind === 'rauchmelder' ? 'RM' : kind === 'verteiler' ? 'UV' : '?';
    ctx.fillText(label, 0, r * 0.65);
  }
}

function drawDimensionChains(ctx: Ctx, level: Level, L: PlanLayout, T: (p: Vec2) => Vec2) {
  const D = derive(level);
  const u = union([...D.footprintsAll.values()].map((f) => f.polygon));
  if (!u.length) return;
  const outer = u.reduce((a, b) => (polygonArea(b[0]) > polygonArea(a[0]) ? b : a))[0];
  const bb = bbox(outer);
  const dd = (arr: number[]) => arr.filter((v, i) => i === 0 || v - arr[i - 1] > 20);
  const xs = dd([...new Set(outer.map((p) => Math.round(p.x)))].sort((a, b) => a - b));
  const ys = dd([...new Set(outer.map((p) => Math.round(p.y)))].sort((a, b) => a - b));
  const gap = L.font * 2.2 / L.k;
  ctx.strokeStyle = '#334155';
  ctx.fillStyle = '#334155';
  ctx.lineWidth = L.lw * 0.35;
  const seg = (a: Vec2, b: Vec2, label: boolean) => {
    const p = T(a), q = T(b);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    const d = norm(sub(b, a));
    const tk = L.font * 0.35;
    for (const r of [p, q]) {
      ctx.beginPath();
      ctx.moveTo(r.x - (d.x + d.y) * tk, r.y - (d.y - d.x) * tk);
      ctx.lineTo(r.x + (d.x + d.y) * tk, r.y + (d.y - d.x) * tk);
      ctx.stroke();
    }
    const Lm = dist(a, b);
    if (!label || Lm * L.k < L.font * 1.6) return;
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    ctx.save();
    ctx.translate(m.x, m.y);
    let ang = Math.atan2(d.y, d.x);
    if (ang > Math.PI / 2 || ang <= -Math.PI / 2) ang += Math.PI;
    ctx.rotate(ang);
    ctx.font = `${L.font * 0.62}px helvetica`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText((Lm / 1000).toFixed(Lm < 1000 ? 3 : 2).replace('.', ','), 0, -L.font * 0.12);
    ctx.restore();
  };
  const y1 = bb.minY - gap, y2 = bb.minY - gap * 1.8;
  for (let i = 1; i < xs.length; i++) seg({ x: xs[i - 1], y: y1 }, { x: xs[i], y: y1 }, true);
  seg({ x: bb.minX, y: y2 }, { x: bb.maxX, y: y2 }, true);
  const x1 = bb.minX - gap, x2 = bb.minX - gap * 1.8;
  for (let i = 1; i < ys.length; i++) seg({ x: x1, y: ys[i] }, { x: x1, y: ys[i - 1] }, true);
  seg({ x: x2, y: bb.maxY }, { x: x2, y: bb.minY }, true);
  // Hilfslinien
  ctx.lineWidth = L.lw * 0.2;
  ctx.strokeStyle = '#94a3b8';
  for (const x of xs) {
    const p = T({ x, y: bb.minY - gap * 0.3 }), q = T({ x, y: y2 });
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  for (const y of ys) {
    const p = T({ x: bb.minX - gap * 0.3, y }), q = T({ x: x2, y });
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
}

export { ELEC_INFO };
