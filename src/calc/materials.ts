import type { Level, Material, Project, SurfaceFinish, Wall } from '../model/types';
import { derive } from '../store/derived';
import { dist, dot, norm, perp, sub, add, mul } from '../geometry/vec';
import { roomAt } from '../geometry/rooms';
import { polygonArea } from '../geometry/vec';

const de = (x: number, d = 2) => x.toFixed(d).replace('.', ',');

// ---------------------------------------------------------------- Grundrechnungen (rein, testbar)

/** Tapetenbedarf: Bahnen nach Höhe (Schrägen → unterschiedliche Längen), Rapport, Rollen per Packen (First-Fit-Decreasing) */
export function wallpaperRolls(
  stripHeights: number[],
  m: { rollWidth: number; rollLength: number; repeat?: number; repeatOffset?: boolean },
  trim = 100,
): { strips: number; stripLengths: number[]; rolls: number; usedLength: number } {
  const rep = m.repeat && m.repeat > 0 ? m.repeat : 0;
  const lengths = stripHeights
    .filter((h) => h > 0)
    .map((h) => {
      let L = h + trim;
      if (rep) L = Math.ceil(L / rep) * rep + (m.repeatOffset ? rep / 2 : 0);
      return L;
    })
    .sort((a, b) => b - a);
  const bins: number[] = [];
  for (const L of lengths) {
    if (L > m.rollLength) {
      // länger als eine Rolle (sehr hohe Wand) → anteilig
      bins.push(m.rollLength);
      continue;
    }
    const i = bins.findIndex((used) => used + L <= m.rollLength);
    if (i >= 0) bins[i] += L;
    else bins.push(L);
  }
  return { strips: lengths.length, stripLengths: lengths, rolls: bins.length, usedLength: lengths.reduce((s, x) => s + x, 0) };
}

/** Bahnhöhen entlang einer Wandfläche (Breite in mm, Höhenfunktion h(s)) */
export function stripHeightsForFace(width: number, heightAt: (s: number) => number, rollWidth: number, steps = 6): number[] {
  const n = Math.ceil(width / rollWidth - 1e-6);
  const res: number[] = [];
  for (let i = 0; i < n; i++) {
    const s0 = i * rollWidth, s1 = Math.min(width, (i + 1) * rollWidth);
    let h = 0;
    for (let k = 0; k <= steps; k++) h = Math.max(h, heightAt(s0 + ((s1 - s0) * k) / steps));
    res.push(h);
  }
  return res;
}

export function packagesFor(area: number, wastePct: number, packageArea?: number) {
  const gross = area * (1 + wastePct / 100);
  return { gross, packages: packageArea && packageArea > 0 ? Math.ceil(gross / packageArea - 1e-9) : undefined };
}

export function tileCount(area: number, m: { tileLength?: number; tileWidth?: number; joint?: number }, wastePct: number) {
  const L = (m.tileLength ?? 300) + (m.joint ?? 0), W = (m.tileWidth ?? 300) + (m.joint ?? 0);
  return Math.ceil((area * (1 + wastePct / 100)) / (L * W) - 1e-9);
}

export function paintLiters(area: number, coverage = 7, coats = 2) {
  return (area / 1e6) * coats / coverage;
}

// ---------------------------------------------------------------- Flächen aus dem Modell

export interface FaceInfo {
  wall: Wall;
  side: 1 | -1;
  roomName: string;
  /** Breite der Fläche (mm) */
  width: number;
  /** Bruttofläche bis Decke/Schräge */
  grossArea: number;
  /** Öffnungsfläche */
  openingArea: number;
  heightAt: (s: number) => number;
  finish?: SurfaceFinish;
}

export function wallFaces(level: Level): FaceInfo[] {
  const D = derive(level);
  const out: FaceInfo[] = [];
  for (const w of D.wallsPlanned) {
    const fp = D.footprints.get(w.id);
    if (!fp) continue;
    const d = norm(sub(w.b, w.a));
    const n = perp(d);
    for (const side of [1, -1] as const) {
      const [pa, pb] = side === 1 ? [fp.plusA, fp.plusB] : [fp.minusA, fp.minusB];
      const width = dist(pa, pb);
      if (width < 50) continue;
      const probe = add(mul(add(pa, pb), 0.5), mul(n, side * 150));
      const room = roomAt(D.rooms, probe);
      if (!room) continue; // Außenseite
      const prof = D.ceiling.profile(pa, pb, room.meta?.ceilingHeight ?? level.ceilingHeight).map((p) => ({ s: p.s, h: w.height ? Math.min(w.height, p.h) : p.h }));
      const heightAt = (s: number) => {
        for (let i = 0; i < prof.length - 1; i++) {
          const a = prof[i], b = prof[i + 1];
          if (s >= a.s - 1e-6 && s <= b.s + 1e-6) return a.h + ((b.h - a.h) * (s - a.s)) / (b.s - a.s || 1);
        }
        return prof[prof.length - 1]?.h ?? level.ceilingHeight;
      };
      let gross = 0;
      for (let i = 0; i < prof.length - 1; i++) gross += ((prof[i].h + prof[i + 1].h) / 2) * (prof[i + 1].s - prof[i].s);
      const s0 = dot(sub(pa, w.a), d);
      let openingArea = 0;
      for (const o of level.openings.filter((x) => x.wallId === w.id)) {
        const a = o.offset - o.width / 2 - s0, b = o.offset + o.width / 2 - s0;
        const top = Math.min(o.sill + o.height, heightAt((a + b) / 2));
        openingArea += Math.max(0, b - a) * Math.max(0, top - o.sill);
      }
      out.push({
        wall: w,
        side,
        roomName: room.name,
        width,
        grossArea: gross,
        openingArea,
        heightAt,
        finish: side === 1 ? w.finishes?.left : w.finishes?.right,
      });
    }
  }
  return out;
}

/** Fläche der Schräge über einer Wand (wahre Fläche, nicht Grundriss) je Raum */
export function slopeSurfaces(level: Level): { wall: Wall; roomName: string; area: number; finish?: SurfaceFinish }[] {
  const D = derive(level);
  const res: { wall: Wall; roomName: string; area: number; finish?: SurfaceFinish }[] = [];
  for (const r of D.rooms) {
    for (const pc of D.ceiling.pieces(r.clear)) {
      const pl = D.ceiling.planes.find((p) => p.fn === pc.fn);
      if (!pl) continue;
      const w = level.walls.find((x) => x.id === pl.wallId)!;
      const planArea = polygonArea(pc.poly);
      const trueArea = planArea / Math.cos((pl.pitchDeg * Math.PI) / 180);
      const ex = res.find((x) => x.wall.id === w.id && x.roomName === r.name);
      if (ex) ex.area += trueArea;
      else res.push({ wall: w, roomName: r.name, area: trueArea, finish: w.finishes?.slope });
    }
  }
  return res;
}

export interface MaterialLine {
  materialId?: string;
  name: string;
  kind: 'Tapete' | 'Farbe' | 'Fliese' | 'Boden' | 'Sockelleiste';
  where: string;
  area: number;
  /** Menge mit Einheit, z. B. „6 Rollen“ */
  quantity: string;
  detail: string;
  price?: number;
  /** numerische Werte für die Zusammenfassung */
  strips?: number[];
  rolls?: number;
  liters?: number;
  meters?: number;
  grossArea?: number;
}

export function materialList(project: Project): MaterialLine[] {
  const lines: MaterialLine[] = [];
  const mat = (id?: string): Material | undefined => project.materials.find((m) => m.id === id);
  const waste = project.settings.wastePercent;
  for (const level of project.levels) {
    const D = derive(level);
    // Böden
    for (const r of D.rooms) {
      const fl = r.meta?.floor;
      if (!fl?.materialId) continue;
      const m = mat(fl.materialId);
      if (!m) continue;
      let area = r.netArea;
      if (fl.includeReveals) area += revealArea(level, r.name);
      const w = fl.waste ?? (fl.pattern === 'herringbone' ? Math.max(waste, 15) : waste);
      const { gross, packages } = packagesFor(area, w, m.packageArea);
      const pieces = tileCount(area, { tileLength: m.tileLength, tileWidth: m.tileWidth, joint: m.kind === 'tile' ? m.joint : 0 }, w);
      lines.push({
        materialId: m.id,
        name: m.name,
        kind: m.kind === 'tile' ? 'Fliese' : 'Boden',
        where: `${level.name} · ${r.name}`,
        area,
        quantity: packages != null ? `${packages} Pakete` : `${pieces} Stück`,
        detail: `${de(area / 1e6)} m² + ${w} % Verschnitt = ${de(gross / 1e6)} m² · ca. ${pieces} ${m.kind === 'tile' ? 'Fliesen' : 'Dielen'} · Muster ${patternLabel(fl.pattern)}${fl.rotation ? `, ${fl.rotation}°` : ''}`,
        price: packages != null && m.price ? packages * m.price : undefined,
        grossArea: gross,
      });
      // Sockelleisten (nicht bei Fliesen im Bad)
      if (m.kind === 'floor') {
        const st = perimeterMinusDoors(level, r);
        lines.push({ name: 'Sockelleiste passend', kind: 'Sockelleiste', where: `${level.name} · ${r.name}`, area: 0, quantity: `${(st / 1000 * 1.1).toFixed(1).replace('.', ',')} m`, detail: `Umfang ohne Türen ${de(st / 1000)} m + 10 %`, meters: (st / 1000) * 1.1 });
      }
    }
    // Wände
    for (const f of wallFaces(level)) {
      const fin = f.finish;
      if (!fin || fin.kind === 'none') continue;
      const m = mat(fin.materialId);
      const net = f.grossArea - f.openingArea;
      const where = `${level.name} · ${f.roomName} · ${f.wall.label ?? 'Wand'}`;
      if (fin.kind === 'paint') {
        const liters = paintLiters(net, m?.coverage ?? 7, 2);
        lines.push({ materialId: m?.id ?? `paint:${fin.color}`, name: m?.name ?? `Wandfarbe (Farbton ${fin.color})`, kind: 'Farbe', where, area: net, quantity: `${liters.toFixed(1).replace('.', ',')} l`, detail: `${de(net / 1e6)} m² × 2 Anstriche`, liters });
      } else if (fin.kind === 'wallpaper' && m) {
        const bw = m.rollWidth ?? 530;
        const strips = stripHeightsForFace(f.width, f.heightAt, bw);
        const r = wallpaperRolls(strips, { rollWidth: bw, rollLength: m.rollLength ?? 10050, repeat: m.repeat, repeatOffset: m.repeatOffset });
        lines.push({ materialId: m.id, name: m.name, kind: 'Tapete', where, area: net, quantity: `${r.strips} Bahnen (${r.rolls} Rollen einzeln)`, detail: `Bahnlängen ${r.stripLengths.map((x) => (x / 1000).toFixed(2).replace('.', ',')).join(' / ')} m`, strips: r.stripLengths, rolls: r.rolls });
      } else if (fin.kind === 'tile' && m) {
        const maxH = fin.maxHeight;
        let area = net;
        if (maxH) {
          const steps = 40;
          let a = 0;
          for (let i = 0; i < steps; i++) a += Math.min(maxH, f.heightAt(((i + 0.5) * f.width) / steps)) * (f.width / steps);
          area = Math.max(0, a - Math.min(f.openingArea, f.openingArea));
        }
        const w = waste;
        const { gross, packages } = packagesFor(area, w, m.packageArea);
        lines.push({ materialId: m.id, name: m.name, kind: 'Fliese', where, area, quantity: packages != null ? `${packages} Pakete` : `${tileCount(area, m, w)} Stück`, detail: `${de(area / 1e6)} m²${maxH ? ` bis ${maxH / 10} cm Höhe` : ''} + ${w} % = ${de(gross / 1e6)} m² · ca. ${tileCount(area, m, w)} Fliesen`, grossArea: gross });
      }
    }
    // Schrägen
    for (const sl of slopeSurfaces(level)) {
      const fin = sl.finish;
      if (!fin || fin.kind === 'none') continue;
      const m = mat(fin.materialId);
      const where = `${level.name} · ${sl.roomName} · Schräge`;
      if (fin.kind === 'paint') {
        const liters = paintLiters(sl.area, m?.coverage ?? 7, 2);
        lines.push({ materialId: m?.id ?? `paint:${fin.color}`, name: m?.name ?? `Wandfarbe (Farbton ${fin.color})`, kind: 'Farbe', where, area: sl.area, quantity: `${liters.toFixed(1).replace('.', ',')} l`, detail: `${de(sl.area / 1e6)} m² Schräge × 2 Anstriche`, liters });
      } else if (fin.kind === 'wallpaper' && m) {
        const rollArea = (m.rollWidth ?? 530) * (m.rollLength ?? 10050);
        const n = Math.ceil((sl.area * 1.15) / rollArea);
        lines.push({ materialId: m.id, name: m.name, kind: 'Tapete', where, area: sl.area, quantity: `${n} Rollen`, detail: `${de(sl.area / 1e6)} m² Schräge + 15 % Verschnitt (Flächenrechnung)`, rolls: n });
      }
    }
  }
  return lines;
}

/** Zusammenfassung je Material (Tapeten: Bahnen aller Wände gemeinsam auf Rollen verteilt) */
export function materialSummary(project: Project) {
  const lines = materialList(project);
  const out: { name: string; kind: string; quantity: string; area: number; price?: number; materialId?: string }[] = [];
  const by = new Map<string, MaterialLine[]>();
  for (const l of lines) {
    const k = `${l.kind}:${l.materialId ?? l.name}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(l);
  }
  for (const [k, ls] of by) {
    const kind = ls[0].kind;
    const m = project.materials.find((x) => x.id === ls[0].materialId);
    const area = ls.reduce((s, l) => s + l.area, 0);
    let quantity = '';
    let price: number | undefined;
    if (kind === 'Tapete' && m) {
      // alle Bahnen gemeinsam auf Rollen verteilen (Reste anderer Wände nutzen)
      const strips = ls.flatMap((l) => l.strips ?? []);
      const slopeRolls = ls.filter((l) => !l.strips).reduce((s, l) => s + (l.rolls ?? 0), 0);
      const packed = wallpaperRolls(strips, { rollWidth: m.rollWidth ?? 530, rollLength: m.rollLength ?? 10050 }, 0);
      const rolls = packed.rolls + slopeRolls;
      quantity = `${rolls} Rollen (${strips.length} Bahnen${slopeRolls ? ` + Schrägen` : ''})`;
      price = m.price ? rolls * m.price : undefined;
    } else if (kind === 'Farbe') {
      const liters = ls.reduce((s, l) => s + (l.liters ?? 0), 0);
      const cont = m?.containerLiters ?? 10;
      const n = Math.ceil(liters / cont - 1e-9);
      quantity = `${liters.toFixed(1).replace('.', ',')} l → ${n} × ${cont} l`;
      price = m?.price ? n * m.price : undefined;
    } else if (kind === 'Sockelleiste') {
      const meters = ls.reduce((s, l) => s + (l.meters ?? 0), 0);
      quantity = `${meters.toFixed(1).replace('.', ',')} m`;
    } else {
      const wasteArea = ls.reduce((s, l) => s + (l.grossArea ?? l.area), 0);
      if (m?.packageArea) {
        const n = Math.ceil(wasteArea / m.packageArea - 1e-9);
        quantity = `${n} Pakete (${(wasteArea / 1e6).toFixed(2).replace('.', ',')} m² inkl. Verschnitt)`;
        price = m.price ? n * m.price : undefined;
      } else quantity = `${(wasteArea / 1e6).toFixed(2).replace('.', ',')} m² inkl. Verschnitt`;
    }
    out.push({ name: ls[0].name, kind, quantity, area, price, materialId: m?.id });
    void k;
  }
  return out;
}

export function patternLabel(p: string) {
  return ({ third: 'Drittelverband', half: 'Halbverband', random: 'wilder Verband', straight: 'gerade (Kreuzfuge)', herringbone: 'Fischgrät', shipdeck: 'Schiffsboden' } as Record<string, string>)[p] ?? p;
}

function revealArea(level: Level, roomName: string) {
  const D = derive(level);
  let a = 0;
  for (const o of level.openings) {
    if (o.type === 'window') continue;
    const w = level.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const d = norm(sub(w.b, w.a));
    const n = perp(d);
    const c = add(w.a, mul(d, o.offset));
    const side = (o.swing ?? 1) as 1 | -1;
    const r = roomAt(D.rooms, add(c, mul(n, side * (w.thickness / 2 + 200))));
    if (r?.name === roomName) a += o.width * w.thickness;
  }
  return a;
}

function perimeterMinusDoors(level: Level, r: ReturnType<typeof derive>['rooms'][number]) {
  let p = 0;
  for (const poly of r.clear)
    for (const ring of poly) for (let i = 0; i < ring.length; i++) p += dist(ring[i], ring[(i + 1) % ring.length]);
  const D = derive(level);
  for (const o of level.openings) {
    if (o.type === 'window') continue;
    const w = level.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const d = norm(sub(w.b, w.a));
    const n = perp(d);
    const c = add(w.a, mul(d, o.offset));
    for (const side of [1, -1] as const) {
      const rr = roomAt(D.rooms, add(c, mul(n, side * (w.thickness / 2 + 200))));
      if (rr?.key === r.key) p -= o.width;
    }
  }
  return Math.max(0, p);
}
