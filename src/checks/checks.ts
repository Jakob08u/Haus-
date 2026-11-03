import type { Furniture, Level, Project, Settings, Vec2 } from '../model/types';
import type { Selection } from '../store/store';
import { derive } from '../store/derived';
import { doorSwing, furnitureDoorSwing, furnitureFootprint, roofWindowFootprint, windowZone } from '../geometry/openings';
import { intersection, multiArea, offsetRing, type Ring } from '../geometry/polygon';
import { add, bbox, mul, polygonArea, polygonCentroid, rotate } from '../geometry/vec';
import { checkLineZones, checkSymbolZone } from './zones';
import { LINE_INFO, ELEC_INFO } from '../model/defaults';

export type Severity = 'error' | 'warn' | 'info' | 'assume';
export type WarnCategory = 'kollision' | 'bewegung' | 'schraege' | 'leitung' | 'elektro' | 'annahme' | 'tuer' | 'fenster' | 'raum';

export interface Warning {
  id: string;
  severity: Severity;
  category: WarnCategory;
  message: string;
  refs: Selection[];
  at?: Vec2;
  levelId: string;
}

const NO_COLLIDE = new Set(['teppich']);
const UNDER_OK: Record<string, string[]> = {
  stuhl: ['tisch', 'schreibtisch'],
};

function overlapArea(a: Ring, b: Ring) {
  const ba = bbox(a), bb = bbox(b);
  if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxY < bb.minY || bb.maxY < ba.minY) return 0;
  return multiArea(intersection(a, b));
}

function verticalOverlap(a: Furniture, b: Furniture) {
  return a.elevation < b.elevation + b.height - 1 && b.elevation < a.elevation + a.height - 1;
}

/** Bewegungsflächen eines Möbels (lokal vor der Front bzw. an den Seiten) */
export function clearanceZones(f: Furniture, s: Settings): { poly: Ring; label: string; optional?: boolean }[] {
  const c = s.clearance;
  const zones: { poly: Ring; label: string; optional?: boolean }[] = [];
  const W = f.width, D = f.depth;
  const toWorld = (pts: Vec2[]) => pts.map((p) => add(rotate(p, f.rotation), { x: f.x, y: f.y }));
  const rect = (x0: number, y0: number, x1: number, y1: number) => toWorld([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
  const front = (depth: number, label: string) => {
    if (depth > 0) zones.push({ poly: rect(-W / 2, D / 2, W / 2, D / 2 + depth), label });
  };
  const custom = f.clearanceFront;
  switch (f.category) {
    case 'schrank':
    case 'kommode':
      front(custom ?? c.schrank, `Bewegungsfläche vor ${f.category === 'schrank' ? 'Schrank' : 'Kommode'}`);
      break;
    case 'bett': {
      const side = f.clearanceSide ?? c.bettSeite;
      // Kopfende bei lokal -y, Seiten links/rechts
      zones.push({ poly: rect(-W / 2 - side, -D / 2, -W / 2, D / 2), label: 'Bewegungsfläche Bett links', optional: W < 1200 });
      zones.push({ poly: rect(W / 2, -D / 2, W / 2 + side, D / 2), label: 'Bewegungsfläche Bett rechts', optional: W < 1200 });
      if (c.bettFuss > 0) zones.push({ poly: rect(-W / 2, D / 2, W / 2, D / 2 + c.bettFuss), label: 'Bewegungsfläche Bett Fußende', optional: true });
      break;
    }
    case 'schreibtisch':
      front(custom ?? c.schreibtisch, 'Bewegungsfläche Schreibtisch (Stuhl)');
      break;
    case 'wc':
      front(custom ?? c.wc, 'Bewegungsfläche vor WC');
      break;
    case 'waschbecken':
      front(custom ?? c.waschbecken, 'Bewegungsfläche vor Waschbecken');
      break;
    case 'dusche':
    case 'wanne':
      front(custom ?? c.dusche, `Bewegungsfläche vor ${f.category === 'dusche' ? 'Dusche' : 'Wanne'}`);
      break;
    case 'waschmaschine':
      front(custom ?? c.allgemein, 'Bewegungsfläche vor Waschmaschine');
      break;
    default:
      if (custom) front(custom, 'Bewegungsfläche');
  }
  return zones;
}

export function checkLevel(level: Level, project: Project): Warning[] {
  const out: Warning[] = [];
  const D = derive(level);
  const s = project.settings;
  const walls = D.wallsPlanned;
  const wallPolys = walls.map((w) => ({ w, poly: D.footprints.get(w.id)?.polygon ?? [] }));
  const push = (w: Omit<Warning, 'id' | 'levelId'>) => out.push({ ...w, id: `${level.id}:${out.length}:${w.category}`, levelId: level.id });
  const fpOf = new Map<string, Ring>(level.furniture.map((f) => [f.id, furnitureFootprint(f)]));
  const fpShrunk = new Map<string, Ring>(level.furniture.map((f) => [f.id, offsetRing(fpOf.get(f.id)!, -3)]));

  const doorSectors = level.openings
    .filter((o) => o.type === 'door')
    .map((o) => {
      const w = level.walls.find((x) => x.id === o.wallId);
      return w ? { o, poly: doorSwing(w, o).sector } : null;
    })
    .filter(Boolean) as { o: (typeof level.openings)[number]; poly: Ring }[];
  const windowZones = level.openings
    .filter((o) => o.type === 'window')
    .map((o) => {
      const w = level.walls.find((x) => x.id === o.wallId);
      return w ? { o, poly: windowZone(w, o) } : null;
    })
    .filter(Boolean) as { o: (typeof level.openings)[number]; poly: Ring }[];

  for (const f of level.furniture) {
    if (NO_COLLIDE.has(f.category)) continue;
    const fp = fpShrunk.get(f.id)!;
    const ref: Selection = { kind: 'furniture', id: f.id };
    // Wände
    for (const { w, poly } of wallPolys) {
      if (poly.length < 3) continue;
      const a = overlapArea(fp, poly);
      if (a > 50) push({ severity: 'error', category: 'kollision', message: `„${f.name}“ kollidiert mit Wand${w.label ? ` „${w.label}“` : ''}`, refs: [ref, { kind: 'wall', id: w.id }], at: polygonCentroid(fp) });
    }
    // Treppenloch
    for (const st of level.stairs.filter((x) => x.isOpening)) {
      const sp = D.rooms.length ? [] : [];
      void sp;
      const poly = (() => {
        const r = [
          { x: -st.length / 2, y: -st.width / 2 }, { x: st.length / 2, y: -st.width / 2 },
          { x: st.length / 2, y: st.width / 2 }, { x: -st.length / 2, y: st.width / 2 },
        ];
        return r.map((p) => add(rotate(p, st.rotation), { x: st.x, y: st.y }));
      })();
      if (overlapArea(fp, poly) > 50) push({ severity: 'error', category: 'kollision', message: `„${f.name}“ steht im Treppenloch`, refs: [ref, { kind: 'stair', id: st.id }], at: polygonCentroid(fp) });
    }
    // Möbel untereinander
    for (const g of level.furniture) {
      if (g.id <= f.id || NO_COLLIDE.has(g.category)) continue;
      if (!verticalOverlap(f, g)) continue;
      if (UNDER_OK[f.category]?.includes(g.category) || UNDER_OK[g.category]?.includes(f.category)) continue;
      const a = overlapArea(fp, fpShrunk.get(g.id)!);
      if (a > 50) push({ severity: 'error', category: 'kollision', message: `„${f.name}“ überschneidet „${g.name}“`, refs: [ref, { kind: 'furniture', id: g.id }], at: polygonCentroid(fp) });
    }
    // Dachschräge
    const top = f.elevation + f.height;
    const maxH = D.ceiling.minOver(fpOf.get(f.id)!);
    if (top > maxH + 1) {
      const sloped = maxH < level.ceilingHeight - 1;
      push({
        severity: 'error',
        category: sloped ? 'schraege' : 'kollision',
        message: sloped
          ? `„${f.name}“ ist zu hoch für die Schräge: ${Math.round(top / 10)} cm hoch, an dieser Stelle max. ${Math.round(maxH / 10)} cm`
          : `„${f.name}“ (${Math.round(top / 10)} cm) ist höher als die Decke (${Math.round(maxH / 10)} cm)`,
        refs: [ref],
        at: { x: f.x, y: f.y },
      });
    }
    // Türschwenkbereiche
    for (const { o, poly } of doorSectors) {
      if (overlapArea(fp, poly) > 200) push({ severity: 'warn', category: 'tuer', message: `„${f.name}“ ragt in den Schwenkbereich einer Tür`, refs: [ref, { kind: 'opening', id: o.id }], at: polygonCentroid(fp) });
    }
    // Fenster
    for (const { o, poly } of windowZones) {
      if (top > o.sill + 20 && overlapArea(fp, poly) > 200)
        push({ severity: 'warn', category: 'fenster', message: `„${f.name}“ steht vor einem Fenster und ist höher als die Brüstung (${Math.round(o.sill / 10)} cm)`, refs: [ref, { kind: 'opening', id: o.id }], at: polygonCentroid(fp) });
    }
    for (const rw of level.roofWindows) {
      const w = level.walls.find((x) => x.id === rw.wallId);
      const pl = D.ceiling.planes.find((p) => p.wallId === rw.wallId);
      if (!w || !pl) continue;
      const poly = roofWindowFootprint(rw, pl, w);
      if (top > rw.bottomHeight - 50 && overlapArea(fp, poly) > 200)
        push({ severity: 'warn', category: 'fenster', message: `„${f.name}“ steht unter einem Dachfenster und reicht bis an dessen Unterkante`, refs: [ref, { kind: 'roofWindow', id: rw.id }], at: polygonCentroid(fp) });
    }
    // Schranktüren anderer Möbel
    for (const g of level.furniture) {
      if (g.id === f.id) continue;
      const sw = furnitureDoorSwing(g);
      if (!sw) continue;
      if (f.elevation >= g.elevation + g.height || g.elevation >= f.elevation + f.height) continue;
      if (overlapArea(fp, sw) > 200) push({ severity: 'warn', category: 'tuer', message: `„${f.name}“ blockiert die Schranktüren von „${g.name}“`, refs: [ref, { kind: 'furniture', id: g.id }], at: polygonCentroid(fp) });
    }
    // eigene Schranktüren gegen Wände
    const own = furnitureDoorSwing(f);
    if (own) {
      for (const { w, poly } of wallPolys)
        if (overlapArea(own, poly) > 200) push({ severity: 'warn', category: 'tuer', message: `Schranktüren von „${f.name}“ schlagen gegen eine Wand`, refs: [ref, { kind: 'wall', id: w.id }], at: polygonCentroid(own) });
    }
    // Bewegungsflächen
    const zones = clearanceZones(f, s);
    const blockedZones: string[] = [];
    let anyFree = false;
    for (const z of zones) {
      const za = polygonArea(z.poly);
      let blocked = 0;
      for (const { poly } of wallPolys) if (poly.length >= 3) blocked += overlapArea(z.poly, poly);
      for (const g of level.furniture) {
        if (g.id === f.id || NO_COLLIDE.has(g.category)) continue;
        if (g.category === 'stuhl' && (f.category === 'schreibtisch' || f.category === 'tisch')) continue;
        if (g.elevation > 900) continue; // Hängeschränke behindern Bewegungsfläche nicht
        blocked += overlapArea(z.poly, fpOf.get(g.id)!);
      }
      for (const st of level.stairs.filter((x) => x.isOpening)) {
        const poly = [
          { x: -st.length / 2, y: -st.width / 2 }, { x: st.length / 2, y: -st.width / 2 },
          { x: st.length / 2, y: st.width / 2 }, { x: -st.length / 2, y: st.width / 2 },
        ].map((p) => add(rotate(p, st.rotation), { x: st.x, y: st.y }));
        blocked += overlapArea(z.poly, poly);
      }
      if (blocked > za * 0.08) blockedZones.push(z.label + (z.optional ? '' : ''));
      else anyFree = true;
      if (blocked > za * 0.08 && !z.optional)
        push({ severity: 'warn', category: 'bewegung', message: `${z.label} von „${f.name}“ ist zu ${Math.round((blocked / za) * 100)} % verstellt`, refs: [ref], at: polygonCentroid(z.poly) });
    }
    if (f.category === 'bett' && f.width < 1200 && zones.length && !anyFree)
      push({ severity: 'warn', category: 'bewegung', message: `„${f.name}“: keine Bettseite hat ${Math.round(s.clearance.bettSeite / 10)} cm Bewegungsfläche`, refs: [ref], at: { x: f.x, y: f.y } });
  }

  // Fenster: passt das Fenster unter Kniestock/Decke? Dachfenster innerhalb der Schräge?
  for (const o of level.openings) {
    if (o.type === 'passage') continue;
    const w = level.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const dd = { x: (w.b.x - w.a.x) / (Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1), y: (w.b.y - w.a.y) / (Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1) };
    const nn = { x: -dd.y, y: dd.x };
    let wallTop = Infinity;
    for (const side of [1, -1]) {
      for (const s of [o.offset - o.width / 2 + 20, o.offset, o.offset + o.width / 2 - 20]) {
        const p = { x: w.a.x + dd.x * s + nn.x * side * (w.thickness / 2 + 30), y: w.a.y + dd.y * s + nn.y * side * (w.thickness / 2 + 30) };
        if (D.ceiling.roomHeightAt(p) == null) continue;
        wallTop = Math.min(wallTop, D.ceiling.heightAt(p));
      }
    }
    if (isFinite(wallTop) && o.sill + o.height > wallTop + 1)
      push({ severity: 'warn', category: 'fenster', message: `${o.type === 'window' ? 'Fenster' : 'Tür'} ${Math.round(o.width / 10)} × ${Math.round(o.height / 10)} cm ist höher als die Wand an dieser Stelle (Oberkante ${Math.round((o.sill + o.height) / 10)} cm, Wand nur ${Math.round(wallTop / 10)} cm) – kleiner machen oder als Dachfenster setzen`, refs: [{ kind: 'opening', id: o.id }], at: { x: w.a.x + dd.x * o.offset, y: w.a.y + dd.y * o.offset } });
  }
  for (const rw of level.roofWindows) {
    const pl = D.ceiling.planes.find((p) => p.wallId === rw.wallId);
    const w = level.walls.find((x) => x.id === rw.wallId);
    if (!pl || !w) {
      push({ severity: 'error', category: 'fenster', message: 'Dachfenster sitzt an einer Wand ohne Dachschräge', refs: [{ kind: 'roofWindow', id: rw.id }] });
      continue;
    }
    const top = Math.max(rw.bottomHeight, pl.knee) + rw.length * Math.sin((pl.pitchDeg * Math.PI) / 180);
    const dd = { x: (w.b.x - w.a.x) / (Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1), y: (w.b.y - w.a.y) / (Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1) };
    const probe = { x: pl.innerA.x + dd.x * rw.offset - dd.y * pl.side * 2000, y: pl.innerA.y + dd.y * rw.offset + dd.x * pl.side * 2000 };
    const flat = D.ceiling.flatAt(probe);
    if (rw.bottomHeight < pl.knee - 1)
      push({ severity: 'warn', category: 'fenster', message: `Dachfenster: Unterkante (${Math.round(rw.bottomHeight / 10)} cm) liegt unter dem Schrägenansatz (${Math.round(pl.knee / 10)} cm)`, refs: [{ kind: 'roofWindow', id: rw.id }] });
    if (top > flat + 1)
      push({ severity: 'warn', category: 'fenster', message: `Dachfenster ${Math.round(rw.width / 10)} × ${Math.round(rw.length / 10)} cm ragt über die Schräge hinaus (Oberkante ${Math.round(top / 10)} cm, Decke ${Math.round(flat / 10)} cm) – kürzeres Fenster oder tiefer setzen`, refs: [{ kind: 'roofWindow', id: rw.id }] });
  }

  // Elektro-Symbole
  for (const e of level.electrical) {
    const iss = checkSymbolZone(level, walls, D.ceiling, D.rooms, e, D.footprints);
    if (iss) push({ severity: 'warn', category: 'elektro', message: `${ELEC_INFO[e.kind].label}${e.label ? ` „${e.label}“` : ''}: ${iss.message}`, refs: [{ kind: 'elec', id: e.id }], at: iss.at });
    const facing = rotate({ x: 0, y: 1 }, e.rotation ?? 0);
    const maxH = D.ceiling.heightAt(e.wallId ? add(e, mul(facing, 100)) : e);
    if (e.height > maxH + 1) push({ severity: 'error', category: 'elektro', message: `${ELEC_INFO[e.kind].label} liegt über der Decke/Schräge (${Math.round(e.height / 10)} cm > ${Math.round(maxH / 10)} cm)`, refs: [{ kind: 'elec', id: e.id }], at: e });
  }
  // Leitungen
  for (const l of level.lines) {
    for (const iss of checkLineZones(level, walls, D.ceiling, D.rooms, l, D.footprints))
      push({ severity: 'warn', category: 'leitung', message: `${LINE_INFO[l.kind].label}${l.label ? ` „${l.label}“` : ''}: ${iss.message}`, refs: [{ kind: 'line', id: l.id }], at: iss.at });
  }
  // Leitungen kreuzen Türen/Fenster
  for (const l of level.lines.filter((x) => x.surface === 'wand')) {
    for (const o of level.openings) {
      const w = level.walls.find((x) => x.id === o.wallId);
      if (!w) continue;
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1;
      const d = { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
      for (let i = 0; i < l.points.length - 1; i++) {
        const a = l.points[i], b = l.points[i + 1];
        const offA = Math.abs(-d.y * (a.x - w.a.x) + d.x * (a.y - w.a.y));
        if (offA > w.thickness / 2 + 120) continue;
        const sa = d.x * (a.x - w.a.x) + d.y * (a.y - w.a.y);
        const sb = d.x * (b.x - w.a.x) + d.y * (b.y - w.a.y);
        const lo = Math.min(sa, sb), hi = Math.max(sa, sb);
        const zlo = Math.min(a.z, b.z), zhi = Math.max(a.z, b.z);
        if (hi > o.offset - o.width / 2 && lo < o.offset + o.width / 2 && zhi > o.sill && zlo < o.sill + o.height)
          push({ severity: 'error', category: 'leitung', message: `${LINE_INFO[l.kind].label}: Segment ${i + 1} kreuzt eine ${o.type === 'window' ? 'Fenster' : 'Tür'}öffnung`, refs: [{ kind: 'line', id: l.id }, { kind: 'opening', id: o.id }], at: mul(add(a, b), 0.5) });
      }
    }
  }
  // Räume ohne Namen
  for (const r of D.rooms) if (!r.meta) push({ severity: 'info', category: 'raum', message: `Unbenannter Raum (${(r.area / 1e6).toFixed(2).replace('.', ',')} m²) – mit Werkzeug „Raum“ benennen`, refs: [], at: r.labelPoint });
  // Annahmen
  for (const a of project.assumptions)
    if (a.status === 'offen' && (!a.levelId || a.levelId === level.id))
      push({ severity: 'assume', category: 'annahme', message: a.text, refs: refFromString(a.ref), at: undefined });
  return out;
}

export function refFromString(ref?: string): Selection[] {
  if (!ref) return [];
  const [kind, id] = ref.split(':');
  const map: Record<string, Selection['kind']> = { wall: 'wall', room: 'room', stair: 'stair', furniture: 'furniture', opening: 'opening' };
  if (map[kind] && id && !id.includes('.')) return [{ kind: map[kind], id }];
  return [];
}

const levelCache = new WeakMap<Level, { project: Project['assumptions']; settings: Settings; result: Warning[] }>();
export function checkLevelCached(level: Level, project: Project): Warning[] {
  const hit = levelCache.get(level);
  if (hit && hit.project === project.assumptions && hit.settings === project.settings) return hit.result;
  const result = checkLevel(level, project);
  levelCache.set(level, { project: project.assumptions, settings: project.settings, result });
  return result;
}
