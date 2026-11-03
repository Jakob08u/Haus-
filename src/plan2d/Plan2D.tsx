import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore, useLevel, type Selection } from '../store/store';
import { derive } from '../store/derived';
import type { Furniture, Level, LinePoint, Vec2, Wall } from '../model/types';
import { add, bbox, dist, dot, fmtCm, fmtM2, mul, norm, perp, pointInPolygon, polygonArea, projectT, rotate, sub, uid, closestOnSegment, polygonCentroid } from '../geometry/vec';
import { snapPoint, type SnapResult } from './snap';
import { newFurniture, newOpening, ELEC_INFO, WALL_TYPE_INFO, LINE_INFO, CATEGORY_INFO } from '../model/defaults';
import { doorSwing, openingGeom, roofWindowFootprint, stairSteps, furnitureDoorSwing, furnitureFootprint } from '../geometry/openings';
import { stairPolygon } from '../geometry/rooms';
import { clipHalfPlane, union, type Multi } from '../geometry/polygon';
import { ElecGlyph, FurnitureGlyph } from './symbols';
import { dockFurniture, furnitureWallDistances, furniturePolys } from './geom2d';
import { checkLevelCached, clearanceZones } from '../checks/checks';
import { verticalZones } from '../checks/zones';
import { locateOnWall } from '../checks/zones';
import { roomStats } from '../calc/roomStats';

interface View { s: number; tx: number; ty: number }

const multiPath = (m: Multi) =>
  m.map((poly) => poly.map((ring) => 'M' + ring.map((p) => `${p.x},${p.y}`).join('L') + 'Z').join(' ')).join(' ');
const ringPath = (r: Vec2[]) => (r.length ? 'M' + r.map((p) => `${p.x},${p.y}`).join('L') + 'Z' : '');

type Drag =
  | { kind: 'pan'; sx: number; sy: number; tx: number; ty: number; moved: boolean }
  | { kind: 'furniture'; id: string; off: Vec2 }
  | { kind: 'elec'; id: string; off: Vec2 }
  | { kind: 'stair'; id: string; off: Vec2 }
  | { kind: 'wall'; id: string; start: Vec2; orig: Wall; links: { id: string; end: 'a' | 'b' }[]; origWalls: Map<string, Wall> }
  | { kind: 'wallEnd'; id: string; end: 'a' | 'b'; links: { id: string; end: 'a' | 'b' }[] }
  | { kind: 'opening'; id: string }
  | { kind: 'roofWindow'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'linePoint'; id: string; index: number }
  | { kind: 'stairDraw'; start: Vec2 }
  | { kind: 'dimension'; id: string; start: Vec2; orig: { a: Vec2; b: Vec2 } };

export function Plan2D({ printMode = false }: { printMode?: boolean }) {
  const project = useStore((s) => s.project);
  const level = useLevel();
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const layers = useStore((s) => s.layers);
  const toolOpts = useStore((s) => s.toolOpts);
  const measure = useStore((s) => s.measure);
  const settings = project.settings;
  const D = derive(level);
  const warnings = useMemo(() => (layers.warnungen ? checkLevelCached(level, project) : []), [level, project, layers.warnungen]);
  const warnIds = useMemo(() => {
    const m = new Map<string, 'error' | 'warn'>();
    for (const w of warnings)
      for (const r of w.refs) if (w.severity === 'error' || w.severity === 'warn') if (m.get(r.id) !== 'error') m.set(r.id, w.severity);
    return m;
  }, [warnings]);

  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ s: 0.05, tx: 50, ty: 50 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<Drag | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [snap, setSnap] = useState<SnapResult | null>(null);
  const [chain, setChain] = useState<Vec2[]>([]);
  const [linePts, setLinePts] = useState<LinePoint[]>([]);
  const [dimStart, setDimStart] = useState<Vec2 | null>(null);
  const [calib, setCalib] = useState<Vec2[]>([]);
  const [stairDraft, setStairDraft] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [space, setSpace] = useState(false);
  const fittedFor = useRef<string>('');

  // Größe beobachten
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (size.w < 50 || size.h < 50) return;
    const pts: Vec2[] = [];
    level.walls.forEach((w) => pts.push(w.a, w.b));
    level.furniture.forEach((f) => pts.push({ x: f.x, y: f.y }));
    if (pts.length === 0) pts.push({ x: 0, y: 0 }, { x: 10000, y: 8000 });
    const bb = bbox(pts);
    const pad = 1500;
    const s = Math.min(size.w / (bb.w + 2 * pad), size.h / (bb.h + 2 * pad));
    if (!isFinite(s) || s <= 0) return;
    setView({ s, tx: size.w / 2 - (bb.minX + bb.w / 2) * s, ty: size.h / 2 - (bb.minY + bb.h / 2) * s });
  }, [level, size]);

  useEffect(() => {
    if (size.w > 50 && size.h > 50 && fittedFor.current !== level.id) {
      fittedFor.current = level.id;
      fit();
    }
  }, [level.id, size, fit]);

  const viewMode = useStore((s) => s.view);
  useEffect(() => {
    const t = setTimeout(() => fit(), 80);
    return () => clearTimeout(t);
  }, [viewMode]);

  useEffect(() => {
    const h = () => fit();
    window.addEventListener('plan-fit', h);
    return () => window.removeEventListener('plan-fit', h);
  }, [fit]);

  // Werkzeugwechsel → Entwürfe verwerfen
  useEffect(() => {
    setChain([]);
    setLinePts([]);
    setDimStart(null);
    setCalib([]);
    setStairDraft(null);
  }, [tool, level.id]);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) setSpace(true);
      if (e.key === 'Escape') {
        if (tool === 'line' && linePts.length >= 2) finishLine();
        setChain([]);
        setLinePts([]);
        setDimStart(null);
        setCalib([]);
        useStore.getState().setMeasure({ points: [] });
      }
      if (e.key === 'Enter') {
        if (tool === 'line') finishLine();
        if (tool === 'wall') setChain([]);
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false);
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  });

  const toMM = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (e.clientX - r.left - v.tx) / v.s, y: (e.clientY - r.top - v.ty) / v.s };
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const s = Math.min(2, Math.max(0.005, v.s * k));
      const kk = s / v.s;
      return { s, tx: mx - (mx - v.tx) * kk, ty: my - (my - v.ty) * kk };
    });
  };

  const st = useStore.getState;

  /** Endpunkte anderer Wände, die an einem Punkt hängen */
  const linkedEnds = (p: Vec2, exceptId: string) =>
    level.walls.flatMap((w) => {
      if (w.id === exceptId) return [];
      const r: { id: string; end: 'a' | 'b' }[] = [];
      if (dist(w.a, p) < 3) r.push({ id: w.id, end: 'a' });
      if (dist(w.b, p) < 3) r.push({ id: w.id, end: 'b' });
      return r;
    });

  const nearestWallAt = (p: Vec2, maxDist: number, filter?: (w: Wall) => boolean) => {
    let best: { w: Wall; d: number; s: number } | null = null;
    for (const w of level.walls) {
      if (filter && !filter(w)) continue;
      const q = closestOnSegment(p, w.a, w.b);
      const d = dist(q, p);
      if (d <= maxDist && (!best || d < best.d)) best = { w, d, s: projectT(p, w.a, w.b) * dist(w.a, w.b) };
    }
    return best;
  };

  const finishLine = () => {
    const pts = linePts;
    if (pts.length >= 2) {
      const id = uid('l');
      st().updateLevel((l) => {
        l.lines.push({ id, kind: toolOpts.lineKind, surface: toolOpts.lineSurface, points: pts });
      });
      st().select({ kind: 'line', id });
    }
    setLinePts([]);
  };

  const lineSnap = (raw: Vec2): LinePoint => {
    const tolPx = 14 / view.s;
    // Anschlusspunkte von Möbeln
    for (const f of level.furniture)
      for (const c of f.connections ?? []) {
        const p = add(rotate({ x: c.x, y: c.y }, f.rotation), { x: f.x, y: f.y });
        if (dist(p, raw) < tolPx) return { x: Math.round(p.x), y: Math.round(p.y), z: f.elevation + c.z };
      }
    for (const e of level.electrical) if (dist(e, raw) < tolPx) return { x: e.x, y: e.y, z: e.height };
    for (const p of linePts) if (dist(p, raw) < tolPx) return { x: p.x, y: p.y, z: toolOpts.lineSurface === 'boden' ? 0 : toolOpts.lineHeight };
    let p = raw;
    if (toolOpts.lineSurface === 'wand') {
      const loc = locateOnWall(D.wallsPlanned, raw, 250);
      if (loc) {
        const d = norm(sub(loc.wall.b, loc.wall.a));
        const n = perp(d);
        p = add(add(loc.wall.a, mul(d, loc.s)), mul(n, loc.side * (loc.wall.thickness / 2 + 15)));
      }
    }
    const last = linePts[linePts.length - 1];
    if (last && settings.snapAngle) {
      const dx = p.x - last.x, dy = p.y - last.y;
      if (Math.abs(dx) < Math.abs(dy) * 0.15) p = { x: last.x, y: p.y };
      else if (Math.abs(dy) < Math.abs(dx) * 0.15) p = { x: p.x, y: last.y };
    }
    const z = toolOpts.lineSurface === 'boden' ? 0 : toolOpts.lineSurface === 'decke' ? Math.round(D.ceiling.heightAt(p)) : toolOpts.lineHeight;
    return { x: Math.round(p.x), y: Math.round(p.y), z };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toMM(e);
    const hit = (e.target as Element).closest('[data-kind]') as HTMLElement | null;
    const hk = hit?.dataset.kind as Selection['kind'] | undefined;
    const hid = hit?.dataset.id;
    const hsub = hit?.dataset.sub;
    const alt = e.altKey;

    if (e.button === 1 || e.button === 2 || space || tool === 'pan') {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty, moved: false };
      return;
    }

    switch (tool) {
      case 'select': {
        if (!hk || !hid) {
          drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty, moved: false };
          return;
        }
        const sel: Selection = { kind: hk, id: hid, sub: hsub };
        if (hk === 'wallEnd') {
          const w = level.walls.find((x) => x.id === hid)!;
          const end = hsub as 'a' | 'b';
          st().select({ kind: 'wall', id: hid });
          st().beginGesture();
          drag.current = { kind: 'wallEnd', id: hid, end, links: linkedEnds(w[end], hid) };
          return;
        }
        if (hk === 'linePoint') {
          st().select({ kind: 'line', id: hid, sub: Number(hsub) });
          st().beginGesture();
          drag.current = { kind: 'linePoint', id: hid, index: Number(hsub) };
          return;
        }
        st().select(sel);
        st().beginGesture();
        if (hk === 'furniture') {
          const f = level.furniture.find((x) => x.id === hid)!;
          drag.current = { kind: 'furniture', id: hid, off: sub(p, f) };
        } else if (hk === 'elec') {
          const f = level.electrical.find((x) => x.id === hid)!;
          drag.current = { kind: 'elec', id: hid, off: sub(p, f) };
        } else if (hk === 'stair') {
          const f = level.stairs.find((x) => x.id === hid)!;
          drag.current = { kind: 'stair', id: hid, off: sub(p, f) };
        } else if (hk === 'wall') {
          const w = level.walls.find((x) => x.id === hid)!;
          const links = [...linkedEnds(w.a, hid), ...linkedEnds(w.b, hid)];
          drag.current = { kind: 'wall', id: hid, start: p, orig: w, links, origWalls: new Map(level.walls.map((x) => [x.id, x])) };
        } else if (hk === 'opening') drag.current = { kind: 'opening', id: hid };
        else if (hk === 'roofWindow') drag.current = { kind: 'roofWindow', id: hid };
        else if (hk === 'room') drag.current = { kind: 'room', id: hid };
        else if (hk === 'dimension') {
          const dm = level.dimensions.find((x) => x.id === hid)!;
          drag.current = { kind: 'dimension', id: hid, start: p, orig: { a: dm.a, b: dm.b } };
        }
        return;
      }
      case 'wall': {
        const sp = snapPoint(p, { level, settings, prev: chain[chain.length - 1], scale: view.s, disable: alt });
        if (chain.length === 0) {
          setChain([sp.p]);
        } else {
          const a = chain[chain.length - 1];
          if (dist(a, sp.p) < 10) {
            setChain([]);
            return;
          }
          const w: Wall = { id: uid('w'), a, b: sp.p, thickness: settings.defaultWallThickness, type: settings.defaultWallType };
          st().updateLevel((l) => {
            l.walls.push(w);
          });
          // an Wandanschluss (Endpunkt einer anderen Wand) endet die Kette automatisch
          if (sp.kind === 'end' && chain.length > 1 && dist(sp.p, chain[0]) < 1) setChain([]);
          else setChain([...chain, sp.p]);
        }
        return;
      }
      case 'door':
      case 'window':
      case 'passage': {
        const nw = nearestWallAt(p, 400);
        if (!nw) return;
        const L = dist(nw.w.a, nw.w.b);
        const o = newOpening(tool, nw.w.id, 0);
        o.offset = Math.round(Math.max(o.width / 2, Math.min(L - o.width / 2, nw.s)) / 5) * 5;
        o.swing = dot(sub(p, nw.w.a), perp(norm(sub(nw.w.b, nw.w.a)))) >= 0 ? 1 : -1;
        st().updateLevel((l) => {
          l.openings.push(o);
        });
        st().select({ kind: 'opening', id: o.id });
        return;
      }
      case 'roofWindow': {
        const nw = nearestWallAt(p, 3000, (w) => !!w.slope);
        if (!nw) {
          st().setStatus('Dachfenster: zuerst eine Wand mit Dachschräge anlegen (Wand → Dachschräge).');
          return;
        }
        const id = uid('rw');
        const knee = nw.w.slope!.knee;
        st().updateLevel((l) => {
          l.roofWindows.push({ id, wallId: nw.w.id, offset: Math.round(nw.s), width: 780, length: 1400, bottomHeight: Math.max(knee + 50, 1100) });
        });
        st().select({ kind: 'roofWindow', id });
        return;
      }
      case 'stair': {
        const sp = snapPoint(p, { level, settings, scale: view.s, disable: alt });
        drag.current = { kind: 'stairDraw', start: sp.p };
        setStairDraft({ a: sp.p, b: sp.p });
        return;
      }
      case 'room': {
        const r = D.rooms.find((rr) => pointInPolygon(p, rr.face));
        if (!r) return;
        if (r.meta) {
          st().select({ kind: 'room', id: r.meta.id });
          st().setPanel('eigenschaften');
          return;
        }
        const name = window.prompt('Raumname:', 'Raum');
        if (!name) return;
        const id = uid('r');
        st().updateLevel((l) => {
          l.rooms.push({ id, name, seed: { x: Math.round(p.x), y: Math.round(p.y) } });
        });
        st().select({ kind: 'room', id });
        return;
      }
      case 'dimension': {
        const sp = snapPoint(p, { level, settings, prev: dimStart, scale: view.s, disable: alt });
        if (!dimStart) setDimStart(sp.p);
        else {
          const id = uid('d');
          st().updateLevel((l) => {
            l.dimensions.push({ id, a: dimStart, b: sp.p, offset: 300 });
          });
          setDimStart(null);
        }
        return;
      }
      case 'measure': {
        const sp = snapPoint(p, { level, settings: { ...settings, snapGrid: false }, prev: measure.points[measure.points.length - 1], scale: view.s, disable: alt });
        st().setMeasure({ points: [...measure.points, { ...sp.p, z: 0 }], space: '2d' });
        return;
      }
      case 'calibrate': {
        const pts = [...calib, p];
        if (pts.length < 2) {
          setCalib(pts);
          return;
        }
        setCalib([]);
        const bg = level.background;
        if (!bg) {
          st().setStatus('Kein Hintergrundbild geladen.');
          return;
        }
        const measured = dist(pts[0], pts[1]);
        const ans = window.prompt(`Gemessene Strecke: ${fmtCm(measured)} cm.\nEchte Länge in cm eingeben:`);
        const real = ans ? Number(ans.replace(',', '.')) * 10 : NaN;
        if (!real || !isFinite(real) || measured < 1) return;
        const k = real / measured;
        st().updateLevel((l) => {
          const b = l.background!;
          b.scale *= k;
          b.x = pts[0].x + (b.x - pts[0].x) * k;
          b.y = pts[0].y + (b.y - pts[0].y) * k;
        });
        st().setStatus(`Maßstab kalibriert: Faktor ${k.toFixed(3)}`);
        st().setTool('select');
        return;
      }
      case 'furniture': {
        const tpl = toolOpts.furnitureTemplate ?? {};
        const f = newFurniture((tpl.category as any) ?? toolOpts.furnitureCategory, Math.round(p.x), Math.round(p.y), { ...tpl, x: Math.round(p.x), y: Math.round(p.y) });
        st().setToolOpts({ furnitureTemplate: null });
        st().updateLevel((l) => {
          l.furniture.push(f);
        });
        st().select({ kind: 'furniture', id: f.id });
        st().setTool('select');
        return;
      }
      case 'elec': {
        const info = ELEC_INFO[toolOpts.elecKind];
        const id = uid('e');
        const h = info.heightKey ? settings.defaultHeights[info.heightKey] : info.defaultHeight;
        if (info.ceiling) {
          st().updateLevel((l) => {
            l.electrical.push({ id, kind: toolOpts.elecKind, x: Math.round(p.x), y: Math.round(p.y), height: Math.round(D.ceiling.heightAt(p)) });
          });
        } else {
          const loc = locateOnWall(D.wallsPlanned, p, 500);
          let pos = p, wallId: string | undefined, side: 1 | -1 | undefined, rotation = 0;
          if (loc) {
            const d = norm(sub(loc.wall.b, loc.wall.a));
            const n = mul(perp(d), loc.side);
            pos = add(add(loc.wall.a, mul(d, loc.s)), mul(n, loc.wall.thickness / 2));
            wallId = loc.wall.id;
            side = loc.side;
            rotation = (Math.atan2(n.y, n.x) * 180) / Math.PI - 90;
          }
          st().updateLevel((l) => {
            l.electrical.push({ id, kind: toolOpts.elecKind, x: Math.round(pos.x), y: Math.round(pos.y), height: h, wallId, side, rotation });
          });
        }
        st().select({ kind: 'elec', id });
        return;
      }
      case 'line': {
        const lp = lineSnap(p);
        const last = linePts[linePts.length - 1];
        if (last && dist(last, lp) < 1 && Math.abs(last.z - lp.z) < 1) {
          finishLine();
          return;
        }
        setLinePts([...linePts, lp]);
        return;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toMM(e);
    setCursor(p);
    st().setCursor(p);
    const dr = drag.current;
    const alt = e.altKey;
    if (tool === 'wall' && !dr) setSnap(snapPoint(p, { level, settings, prev: chain[chain.length - 1], scale: view.s, disable: alt }));
    else if ((tool === 'dimension' || tool === 'measure' || tool === 'stair') && !dr)
      setSnap(snapPoint(p, { level, settings: tool === 'measure' ? { ...settings, snapGrid: false } : settings, prev: tool === 'dimension' ? dimStart : measure.points[measure.points.length - 1], scale: view.s, disable: alt }));
    else if (snap) setSnap(null);
    if (!dr) return;
    switch (dr.kind) {
      case 'pan': {
        const dx = e.clientX - dr.sx, dy = e.clientY - dr.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) dr.moved = true;
        setView((v) => ({ ...v, tx: dr.tx + dx, ty: dr.ty + dy }));
        return;
      }
      case 'furniture': {
        const f0 = level.furniture.find((x) => x.id === dr.id);
        if (!f0) return;
        let np = sub(p, dr.off);
        if (settings.snapGrid && !alt) np = { x: Math.round(np.x / 10) * 10, y: Math.round(np.y / 10) * 10 };
        let cand: Furniture = { ...f0, x: np.x, y: np.y };
        if (!alt) {
          const walls = [...D.footprints.values()].map((f) => f.polygon);
          const docked = dockFurniture(cand, walls, 150 / Math.max(0.2, view.s * 20));
          cand = { ...cand, ...docked };
        }
        st().updateLevel((l) => {
          const f = l.furniture.find((x) => x.id === dr.id)!;
          f.x = Math.round(cand.x);
          f.y = Math.round(cand.y);
        });
        return;
      }
      case 'elec': {
        const e0 = level.electrical.find((x) => x.id === dr.id);
        if (!e0) return;
        const np = sub(p, dr.off);
        const info = ELEC_INFO[e0.kind];
        const loc = !info.ceiling && !alt ? locateOnWall(D.wallsPlanned, np, 400) : null;
        st().updateLevel((l) => {
          const s = l.electrical.find((x) => x.id === dr.id)!;
          if (loc) {
            const d = norm(sub(loc.wall.b, loc.wall.a));
            const n = mul(perp(d), loc.side);
            const pos = add(add(loc.wall.a, mul(d, Math.round(loc.s / 5) * 5)), mul(n, loc.wall.thickness / 2));
            s.x = Math.round(pos.x);
            s.y = Math.round(pos.y);
            s.wallId = loc.wall.id;
            s.side = loc.side;
            s.rotation = (Math.atan2(n.y, n.x) * 180) / Math.PI - 90;
          } else {
            s.x = Math.round(np.x);
            s.y = Math.round(np.y);
            if (!info.ceiling) s.wallId = undefined;
          }
        });
        return;
      }
      case 'stair': {
        const np = sub(p, dr.off);
        st().updateLevel((l) => {
          const s = l.stairs.find((x) => x.id === dr.id)!;
          s.x = Math.round(np.x / 10) * 10;
          s.y = Math.round(np.y / 10) * 10;
        });
        return;
      }
      case 'wall': {
        let delta = sub(p, dr.start);
        if (settings.snapGrid && !alt) delta = { x: Math.round(delta.x / 10) * 10, y: Math.round(delta.y / 10) * 10 };
        st().updateLevel((l) => {
          const w = l.walls.find((x) => x.id === dr.id)!;
          w.a = add(dr.orig.a, delta);
          w.b = add(dr.orig.b, delta);
          for (const lk of dr.links) {
            const o = l.walls.find((x) => x.id === lk.id);
            const ow = dr.origWalls.get(lk.id);
            if (o && ow) o[lk.end] = add(ow[lk.end], delta);
          }
        });
        return;
      }
      case 'wallEnd': {
        const w0 = level.walls.find((x) => x.id === dr.id)!;
        const other = dr.end === 'a' ? w0.b : w0.a;
        const sp = snapPoint(p, { level, settings, prev: other, scale: view.s, disable: alt, excludeWallIds: [dr.id, ...dr.links.map((l) => l.id)] });
        setSnap(sp);
        st().updateLevel((l) => {
          const w = l.walls.find((x) => x.id === dr.id)!;
          w[dr.end] = sp.p;
          for (const lk of dr.links) {
            const o = l.walls.find((x) => x.id === lk.id);
            if (o) o[lk.end] = sp.p;
          }
        });
        return;
      }
      case 'opening': {
        st().updateLevel((l) => {
          const o = l.openings.find((x) => x.id === dr.id)!;
          const w = l.walls.find((x) => x.id === o.wallId)!;
          const L = dist(w.a, w.b);
          const s = projectT(p, w.a, w.b) * L;
          o.offset = Math.round(Math.max(o.width / 2, Math.min(L - o.width / 2, s)) / 5) * 5;
        });
        return;
      }
      case 'roofWindow': {
        st().updateLevel((l) => {
          const o = l.roofWindows.find((x) => x.id === dr.id)!;
          const w = l.walls.find((x) => x.id === o.wallId)!;
          const L = dist(w.a, w.b);
          o.offset = Math.round(Math.max(o.width / 2, Math.min(L - o.width / 2, projectT(p, w.a, w.b) * L)) / 5) * 5;
        });
        return;
      }
      case 'room': {
        st().updateLevel((l) => {
          const r = l.rooms.find((x) => x.id === dr.id);
          if (r) r.seed = { x: Math.round(p.x), y: Math.round(p.y) };
        });
        return;
      }
      case 'linePoint': {
        const ln = level.lines.find((x) => x.id === dr.id);
        if (!ln) return;
        let np = { x: Math.round(p.x), y: Math.round(p.y) };
        const prev = ln.points[dr.index - 1] ?? ln.points[dr.index + 1];
        if (prev && !alt) {
          if (Math.abs(np.x - prev.x) < 60) np.x = prev.x;
          if (Math.abs(np.y - prev.y) < 60) np.y = prev.y;
        }
        st().updateLevel((l) => {
          const pt = l.lines.find((x) => x.id === dr.id)!.points[dr.index];
          pt.x = np.x;
          pt.y = np.y;
        });
        return;
      }
      case 'stairDraw': {
        const sp = snapPoint(p, { level, settings, scale: view.s, disable: alt });
        setStairDraft({ a: dr.start, b: sp.p });
        return;
      }
      case 'dimension': {
        const d0 = dr.orig;
        const dd = norm(sub(d0.b, d0.a));
        const n = perp(dd);
        const off = dot(sub(p, d0.a), n);
        st().updateLevel((l) => {
          const dm = l.dimensions.find((x) => x.id === dr.id)!;
          dm.offset = Math.round(off / 10) * 10;
        });
        return;
      }
    }
  };

  const onPointerUp = () => {
    const dr = drag.current;
    drag.current = null;
    if (!dr) return;
    if (dr.kind === 'pan') {
      if (!dr.moved && tool === 'select') st().select(null);
      return;
    }
    if (dr.kind === 'stairDraw' && stairDraft) {
      const { a, b } = stairDraft;
      setStairDraft(null);
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      if (w < 300 || h < 300) return;
      const horiz = w >= h;
      const id = uid('st');
      st().updateLevel((l) => {
        l.stairs.push({
          id,
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          length: horiz ? w : h,
          width: horiz ? h : w,
          rotation: horiz ? 0 : 90,
          steps: Math.max(3, Math.round((l.elevation > 0 ? l.elevation : 2750) / 180)),
          isOpening: true,
          railing: { left: true, right: true, end: false },
          direction: 'up',
        });
      });
      st().select({ kind: 'stair', id });
      st().setTool('select');
      return;
    }
    st().endGesture();
    if (dr.kind === 'wallEnd') setSnap(null);
  };

  const onDoubleClick = () => {
    if (tool === 'wall') setChain([]);
    if (tool === 'line') finishLine();
  };

  // ------------------------------------------------------------------ Render
  const s = view.s;
  const px = (n: number) => n / s; // Bildschirm-px → mm
  const isSel = (kind: Selection['kind'], id: string) => selection?.kind === kind && selection.id === id;
  const accent = '#2563eb';
  const selFurniture = selection?.kind === 'furniture' ? level.furniture.find((f) => f.id === selection.id) : undefined;

  const wallPolys = useMemo(() => [...D.footprints.values()].map((f) => f.polygon), [D]);

  const gridStep = (() => {
    let g = settings.gridSize;
    while (g * s < 8) g *= 5;
    return g;
  })();

  const cursorText = (() => {
    if (tool === 'wall' && chain.length && snap) {
      const a = chain[chain.length - 1];
      const L = dist(a, snap.p);
      const ang = (Math.atan2(snap.p.y - a.y, snap.p.x - a.x) * 180) / Math.PI;
      return `Länge ${fmtCm(L)} cm · ${Math.round(-ang)}°`;
    }
    if (tool === 'measure' && measure.points.length && cursor) {
      const pts = [...measure.points, ...(snap ? [{ ...snap.p, z: 0 }] : [])];
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
      const last = dist(pts[pts.length - 2] ?? pts[0], pts[pts.length - 1]);
      return `Segment ${fmtCm(last)} cm · Summe ${fmtCm(total)} cm`;
    }
    return null;
  })();

  const fontPx = (n: number) => n / s;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <svg
        ref={svgRef}
        className="plan2d"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setCursor(null);
          st().setCursor(null);
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: space || tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }}
      >
        <defs>
          <pattern id="hatch-slope" width={px(8)} height={px(8)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={px(8)} stroke="#3b82f6" strokeWidth={px(1)} opacity={0.5} />
          </pattern>
          <pattern id="hatch-neu" width={px(6)} height={px(6)} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <rect width={px(6)} height={px(6)} fill="#fde68a" />
            <line x1={0} y1={0} x2={0} y2={px(6)} stroke="#b45309" strokeWidth={px(0.8)} />
          </pattern>
          <pattern id="hatch-stair" width={px(6)} height={px(6)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={px(6)} height={px(6)} fill="#fff7d6" />
          </pattern>
        </defs>
        <g transform={`translate(${view.tx} ${view.ty}) scale(${s})`}>
          {/* Hintergrund */}
          {layers.hintergrund && level.background?.visible && (
            <image
              href={level.background.src}
              x={level.background.x}
              y={level.background.y}
              width={level.background.naturalWidth * level.background.scale}
              height={level.background.naturalHeight * level.background.scale * (level.background.aspect ?? 1)}
              opacity={level.background.opacity}
              transform={`rotate(${level.background.rotation} ${level.background.x} ${level.background.y})`}
              preserveAspectRatio="none"
              style={{ pointerEvents: 'none' }}
            />
          )}
          {/* Raster */}
          {layers.raster && !printMode && <Grid view={view} size={size} step={gridStep} />}

          {/* Räume */}
          {layers.raeume &&
            D.rooms.map((r) => (
              <path
                key={r.key}
                d={multiPath(r.clear)}
                fill={r.meta ? (isSel('room', r.meta.id) ? 'rgba(37,99,235,0.10)' : 'rgba(250,250,245,0.85)') : 'rgba(255,240,240,0.7)'}
                fillRule="evenodd"
                stroke="none"
              />
            ))}

          {/* Dachschrägen: Bereiche < 2 m und < 1 m */}
          {layers.schraegen && <SlopeZones level={level} />}

          {/* Treppen */}
          {layers.grundriss &&
            level.stairs.map((stp) => {
              const poly = stairPolygon(stp);
              const steps = stairSteps(stp);
              const sel = isSel('stair', stp.id);
              const c = { x: stp.x, y: stp.y };
              const dirv = rotate({ x: stp.direction === 'up' ? 1 : -1, y: 0 }, stp.rotation);
              const a0 = add(c, mul(dirv, -stp.length * 0.4)), a1 = add(c, mul(dirv, stp.length * 0.4));
              const ah = 160;
              const n = perp(dirv);
              return (
                <g key={stp.id} data-kind="stair" data-id={stp.id} style={{ cursor: 'move' }}>
                  <path d={ringPath(poly)} fill={stp.isOpening ? '#fff7d6' : '#f6f1e6'} stroke={sel ? accent : '#a16207'} strokeWidth={px(sel ? 2 : 1.2)} />
                  {steps.map((sp) => (
                    <path key={sp.index} d={ringPath(sp.poly)} fill="none" stroke="#a16207" strokeWidth={px(0.6)} />
                  ))}
                  <line x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke="#a16207" strokeWidth={px(1.2)} />
                  <path d={`M ${a1.x} ${a1.y} L ${a1.x - dirv.x * ah + n.x * ah * 0.5} ${a1.y - dirv.y * ah + n.y * ah * 0.5} M ${a1.x} ${a1.y} L ${a1.x - dirv.x * ah - n.x * ah * 0.5} ${a1.y - dirv.y * ah - n.y * ah * 0.5}`} stroke="#a16207" strokeWidth={px(1.2)} fill="none" />
                  <circle cx={a0.x} cy={a0.y} r={50} fill="#a16207" />
                </g>
              );
            })}

          {/* Möbel – Bewegungsflächen */}
          {layers.moebel && layers.bewegung &&
            level.furniture.map((f) =>
              clearanceZones(f, settings).map((z, i) => (
                <path key={f.id + i} d={ringPath(z.poly)} fill="rgba(16,185,129,0.06)" stroke="#10b981" strokeDasharray={`${px(4)} ${px(3)}`} strokeWidth={px(0.8)} style={{ pointerEvents: 'none' }} />
              )),
            )}

          {/* Wände */}
          {layers.grundriss && (
            <g>
              <path d={multiPath(D.outlineByType.bestand)} fill={WALL_TYPE_INFO.bestand.fill} fillRule="evenodd" stroke={WALL_TYPE_INFO.bestand.stroke} strokeWidth={px(1)} />
              <path d={multiPath(D.outlineByType.neu)} fill="url(#hatch-neu)" fillRule="evenodd" stroke={WALL_TYPE_INFO.neu.stroke} strokeWidth={px(1)} />
              <path d={multiPath(D.outlineByType.abriss)} fill={WALL_TYPE_INFO.abriss.fill} fillRule="evenodd" stroke={WALL_TYPE_INFO.abriss.stroke} strokeDasharray={`${px(5)} ${px(3)}`} strokeWidth={px(1.2)} />
              {level.walls.map((w) => {
                const fp = D.footprintsAll.get(w.id);
                if (!fp) return null;
                const sel = isSel('wall', w.id);
                const warn = warnIds.get(w.id);
                return (
                  <path
                    key={w.id}
                    data-kind="wall"
                    data-id={w.id}
                    d={ringPath(fp.polygon)}
                    fill={sel ? 'rgba(37,99,235,0.35)' : 'transparent'}
                    stroke={sel ? accent : warn ? '#dc2626' : 'transparent'}
                    strokeWidth={px(sel ? 2 : 1.5)}
                    style={{ cursor: tool === 'select' ? 'move' : undefined }}
                  />
                );
              })}
              {/* Kniestock-Kennzeichnung */}
              {layers.schraegen &&
                level.walls
                  .filter((w) => w.slope)
                  .map((w) => {
                    const d = norm(sub(w.b, w.a));
                    const n = mul(perp(d), w.slope!.side);
                    const m = add(mul(add(w.a, w.b), 0.5), mul(n, w.thickness / 2 + px(14)));
                    let ang = (Math.atan2(d.y, d.x) * 180) / Math.PI;
                    if (ang > 90 || ang < -90) ang += 180;
                    return (
                      <text key={'kn' + w.id} x={m.x} y={m.y} fontSize={fontPx(11)} fill="#1d4ed8" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${ang} ${m.x} ${m.y})`} style={{ pointerEvents: 'none' }}>
                        Kniestock {fmtCm(w.slope!.knee)} cm · {Math.round(w.slope!.mode === 'pitch' ? w.slope!.pitchDeg : 0) || ''}{w.slope!.mode === 'pitch' ? '°' : 'First'}
                      </text>
                    );
                  })}
            </g>
          )}

          {/* Öffnungen */}
          {layers.grundriss &&
            level.openings.map((o) => {
              const w = level.walls.find((x) => x.id === o.wallId);
              if (!w) return null;
              const g = openingGeom(w, o);
              const sel = isSel('opening', o.id);
              const col = sel ? accent : warnIds.get(o.id) ? '#dc2626' : '#1f2933';
              let content: React.ReactNode = null;
              if (o.type === 'door') {
                const ds = doorSwing(w, o);
                content = (
                  <g>
                    <line x1={ds.hinge.x} y1={ds.hinge.y} x2={ds.open.x} y2={ds.open.y} stroke={col} strokeWidth={px(1.6)} />
                    <path d={`M ${ds.closed.x} ${ds.closed.y} A ${ds.leafLen} ${ds.leafLen} 0 0 ${ds.sweep} ${ds.open.x} ${ds.open.y}`} fill="none" stroke={col} strokeWidth={px(0.8)} strokeDasharray={`${px(4)} ${px(3)}`} />
                  </g>
                );
              } else if (o.type === 'window') {
                const a = add(g.p0, mul(g.n, 0)), b = add(g.p1, mul(g.n, 0));
                const a1 = add(g.p0, mul(g.n, g.h)), b1 = add(g.p1, mul(g.n, g.h));
                const a2 = add(g.p0, mul(g.n, -g.h)), b2 = add(g.p1, mul(g.n, -g.h));
                content = (
                  <g>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} strokeWidth={px(1.4)} />
                    <line x1={a1.x} y1={a1.y} x2={b1.x} y2={b1.y} stroke={col} strokeWidth={px(0.8)} />
                    <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} stroke={col} strokeWidth={px(0.8)} />
                  </g>
                );
              }
              return (
                <g key={o.id} data-kind="opening" data-id={o.id} style={{ cursor: 'ew-resize' }}>
                  <path d={ringPath(g.cut)} fill={sel ? '#dbeafe' : '#ffffff'} stroke="none" />
                  <line x1={add(g.p0, mul(g.n, g.h)).x} y1={add(g.p0, mul(g.n, g.h)).y} x2={add(g.p0, mul(g.n, -g.h)).x} y2={add(g.p0, mul(g.n, -g.h)).y} stroke="#22252b" strokeWidth={px(1)} />
                  <line x1={add(g.p1, mul(g.n, g.h)).x} y1={add(g.p1, mul(g.n, g.h)).y} x2={add(g.p1, mul(g.n, -g.h)).x} y2={add(g.p1, mul(g.n, -g.h)).y} stroke="#22252b" strokeWidth={px(1)} />
                  {content}
                  {layers.masse && s > 0.03 && (
                    <text x={g.p0.x / 2 + g.p1.x / 2 + g.n.x * (g.h + px(12)) * (o.swing ?? 1) * -1} y={g.p0.y / 2 + g.p1.y / 2 + g.n.y * (g.h + px(12)) * (o.swing ?? 1) * -1} fontSize={fontPx(9.5)} textAnchor="middle" dominantBaseline="middle" fill="#475569">
                      {fmtCm(o.width)}/{fmtCm(o.height)}
                    </text>
                  )}
                </g>
              );
            })}

          {/* Dachfenster */}
          {layers.grundriss &&
            level.roofWindows.map((rw) => {
              const w = level.walls.find((x) => x.id === rw.wallId);
              const pl = D.ceiling.planes.find((p) => p.wallId === rw.wallId);
              if (!w || !pl) return null;
              const fp = roofWindowFootprint(rw, pl, w);
              const sel = isSel('roofWindow', rw.id);
              return (
                <g key={rw.id} data-kind="roofWindow" data-id={rw.id} style={{ cursor: 'ew-resize' }}>
                  <path d={ringPath(fp)} fill="rgba(125,211,252,0.35)" stroke={sel ? accent : '#0369a1'} strokeWidth={px(sel ? 2 : 1.2)} strokeDasharray={`${px(6)} ${px(3)}`} />
                  <line x1={fp[0].x} y1={fp[0].y} x2={fp[2].x} y2={fp[2].y} stroke="#0369a1" strokeWidth={px(0.6)} />
                  <line x1={fp[1].x} y1={fp[1].y} x2={fp[3].x} y2={fp[3].y} stroke="#0369a1" strokeWidth={px(0.6)} />
                </g>
              );
            })}

          {/* Installationszonen (senkrecht) */}
          {layers.zonen && <ZonesLayer level={level} />}

          {/* Leitungen */}
          {level.lines.map((ln) => {
            const info = LINE_INFO[ln.kind];
            if (!layers[info.layer]) return null;
            const sel = isSel('line', ln.id);
            const warn = warnIds.get(ln.id);
            const d = ln.points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('');
            return (
              <g key={ln.id}>
                <path d={d} fill="none" stroke="transparent" strokeWidth={px(10)} data-kind="line" data-id={ln.id} />
                <path d={d} fill="none" stroke={info.color} strokeWidth={px(sel ? 3.2 : 2.2)} strokeDasharray={ln.surface === 'boden' ? `${px(8)} ${px(4)}` : ln.surface === 'decke' ? `${px(2)} ${px(3)}` : undefined} style={{ pointerEvents: 'none' }} />
                {warn && <path d={d} fill="none" stroke="#dc2626" strokeWidth={px(6)} opacity={0.25} style={{ pointerEvents: 'none' }} />}
                {ln.points.map((p, i) => {
                  const vertical = ln.points.some((q, j) => j !== i && Math.abs(q.x - p.x) < 1 && Math.abs(q.y - p.y) < 1);
                  return vertical ? <circle key={'v' + i} cx={p.x} cy={p.y} r={px(4.5)} fill="#fff" stroke={info.color} strokeWidth={px(1.5)} style={{ pointerEvents: 'none' }} /> : null;
                })}
                {sel &&
                  ln.points.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={px(5)} fill="#fff" stroke={accent} strokeWidth={px(1.5)} data-kind="linePoint" data-id={ln.id} data-sub={i} style={{ cursor: 'move' }} />
                  ))}
              </g>
            );
          })}

          {/* Möbel */}
          {layers.moebel &&
            level.furniture.map((f) => {
              const sel = isSel('furniture', f.id);
              const warn = warnIds.get(f.id);
              const stroke = sel ? accent : warn === 'error' ? '#dc2626' : warn === 'warn' ? '#d97706' : '#374151';
              const swing = furnitureDoorSwing(f);
              return (
                <g key={f.id}>
                  {swing && <path d={ringPath(swing)} fill="none" stroke="#9ca3af" strokeWidth={px(0.7)} strokeDasharray={`${px(2)} ${px(3)}`} style={{ pointerEvents: 'none' }} />}
                  <g transform={`translate(${f.x} ${f.y}) rotate(${f.rotation})`} data-kind="furniture" data-id={f.id} style={{ cursor: 'move' }}>
                    <rect x={-f.width / 2} y={-f.depth / 2} width={f.width} height={f.depth} fill={f.category === 'teppich' ? f.color + '55' : '#ffffff'} fillOpacity={0.92} stroke={stroke} strokeWidth={px(sel || warn ? 2 : 1.2)} />
                    <rect x={-f.width / 2} y={-f.depth / 2} width={f.width} height={Math.min(f.depth, px(4))} fill={f.color} opacity={0.9} />
                    <FurnitureGlyph f={f} stroke={stroke} />
                    {s > 0.025 && (
                      <text x={0} y={0} fontSize={fontPx(10)} textAnchor="middle" dominantBaseline="middle" fill="#111827" transform={`rotate(${-f.rotation})`} style={{ pointerEvents: 'none' }}>
                        {f.name.length > 22 ? f.name.slice(0, 21) + '…' : f.name}
                      </text>
                    )}
                  </g>
                </g>
              );
            })}

          {/* Elektro */}
          {layers.elektro &&
            level.electrical.map((e) => {
              const sel = isSel('elec', e.id);
              const warn = warnIds.get(e.id);
              const col = sel ? accent : warn ? '#dc2626' : '#b91c1c';
              return (
                <g key={e.id} transform={`translate(${e.x} ${e.y}) rotate(${e.rotation ?? 0})`} data-kind="elec" data-id={e.id} style={{ cursor: 'move' }}>
                  <ElecGlyph kind={e.kind} color={col} />
                  {sel && <circle r={px(8)} fill="none" stroke={accent} strokeWidth={px(1.5)} />}
                  {s > 0.06 && (
                    <text x={0} y={-px(8)} fontSize={fontPx(9)} textAnchor="middle" fill={col} transform={`rotate(${-(e.rotation ?? 0)})`} style={{ pointerEvents: 'none' }}>
                      {Math.round(e.height / 10)}
                    </text>
                  )}
                </g>
              );
            })}

          {/* Raumbeschriftung + Innenmaße */}
          {layers.raeume && D.rooms.map((r) => <RoomLabel key={r.key} level={level} roomKey={r.key} s={s} selected={!!r.meta && isSel('room', r.meta.id)} showDims={layers.masse} />)}

          {/* Maßlinien */}
          {layers.masse && <Dimensions level={level} s={s} selectedId={selection?.kind === 'dimension' ? selection.id : undefined} />}

          {/* Abstände des gewählten Möbels zu Wänden */}
          {selFurniture && layers.masse &&
            furnitureWallDistances(selFurniture, wallPolys, furniturePolys(level, selFurniture.id)).map((d, i) => {
              const m = mul(add(d.from, d.to), 0.5);
              return (
                <g key={i} style={{ pointerEvents: 'none' }}>
                  <line x1={d.from.x} y1={d.from.y} x2={d.to.x} y2={d.to.y} stroke="#0ea5e9" strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(2)}`} />
                  <rect x={m.x - px(22)} y={m.y - px(8)} width={px(44)} height={px(16)} rx={px(3)} fill="#0ea5e9" />
                  <text x={m.x} y={m.y + px(0.5)} fontSize={fontPx(10)} fill="#fff" textAnchor="middle" dominantBaseline="middle">
                    {fmtCm(d.d)}
                  </text>
                </g>
              );
            })}

          {/* Wand-Endpunkt-Griffe */}
          {selection?.kind === 'wall' &&
            (() => {
              const w = level.walls.find((x) => x.id === selection.id);
              if (!w) return null;
              const L = dist(w.a, w.b);
              const m = mul(add(w.a, w.b), 0.5);
              const d = norm(sub(w.b, w.a));
              let ang = (Math.atan2(d.y, d.x) * 180) / Math.PI;
              if (ang > 90 || ang < -90) ang += 180;
              const n = perp(d);
              const tp = add(m, mul(n, w.thickness / 2 + px(14)));
              return (
                <g>
                  <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke={accent} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} style={{ pointerEvents: 'none' }} />
                  {(['a', 'b'] as const).map((k) => (
                    <circle key={k} cx={w[k].x} cy={w[k].y} r={px(6)} fill="#fff" stroke={accent} strokeWidth={px(2)} data-kind="wallEnd" data-id={w.id} data-sub={k} style={{ cursor: 'move' }} />
                  ))}
                  <text x={tp.x} y={tp.y} fontSize={fontPx(11)} fill={accent} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${ang} ${tp.x} ${tp.y})`} style={{ pointerEvents: 'none' }}>
                    {fmtCm(L)} cm (Achse) · d = {fmtCm(w.thickness)} cm
                  </text>
                </g>
              );
            })()}

          {/* Warnmarker */}
          {layers.warnungen &&
            warnings
              .filter((w) => w.at && (w.severity === 'error' || w.severity === 'warn'))
              .map((w) => (
                <g key={w.id} transform={`translate(${w.at!.x} ${w.at!.y})`} style={{ pointerEvents: 'none' }}>
                  <circle r={px(7)} fill={w.severity === 'error' ? '#dc2626' : '#d97706'} opacity={0.9} />
                  <text fontSize={fontPx(10)} fill="#fff" textAnchor="middle" dominantBaseline="central" fontWeight={700}>
                    !
                  </text>
                </g>
              ))}

          {/* Werkzeug-Vorschau */}
          {tool === 'wall' && chain.length > 0 && snap && (
            <g style={{ pointerEvents: 'none' }}>
              <polyline points={[...chain, snap.p].map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={accent} strokeWidth={settings.defaultWallThickness} strokeOpacity={0.25} />
              <polyline points={[...chain, snap.p].map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={accent} strokeWidth={px(1.5)} />
            </g>
          )}
          {snap && ['wall', 'dimension', 'measure', 'stair'].includes(tool) && (
            <g style={{ pointerEvents: 'none' }}>
              {snap.guides?.map((g, i) => (
                <line key={i} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke="#f59e0b" strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(3)}`} />
              ))}
              <circle cx={snap.p.x} cy={snap.p.y} r={px(snap.kind === 'end' ? 6 : 4)} fill={snap.kind === 'end' ? '#f59e0b' : 'none'} stroke="#f59e0b" strokeWidth={px(1.5)} />
            </g>
          )}
          {tool === 'line' && linePts.length > 0 && cursor && (
            <g style={{ pointerEvents: 'none' }}>
              <polyline points={[...linePts, lineSnap(cursor)].map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={LINE_INFO[toolOpts.lineKind].color} strokeWidth={px(2)} strokeDasharray={`${px(5)} ${px(3)}`} />
            </g>
          )}
          {tool === 'dimension' && dimStart && snap && (
            <line x1={dimStart.x} y1={dimStart.y} x2={snap.p.x} y2={snap.p.y} stroke={accent} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} style={{ pointerEvents: 'none' }} />
          )}
          {stairDraft && (
            <rect x={Math.min(stairDraft.a.x, stairDraft.b.x)} y={Math.min(stairDraft.a.y, stairDraft.b.y)} width={Math.abs(stairDraft.b.x - stairDraft.a.x)} height={Math.abs(stairDraft.b.y - stairDraft.a.y)} fill="rgba(234,179,8,0.2)" stroke="#a16207" strokeWidth={px(1.5)} />
          )}
          {calib.length > 0 && cursor && (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={calib[0].x} y1={calib[0].y} x2={cursor.x} y2={cursor.y} stroke="#e11d48" strokeWidth={px(1.5)} />
              <circle cx={calib[0].x} cy={calib[0].y} r={px(4)} fill="#e11d48" />
            </g>
          )}
          {(tool === 'door' || tool === 'window' || tool === 'passage' || tool === 'roofWindow' || tool === 'elec') && cursor && (() => {
            const nw = tool === 'roofWindow' ? nearestWallAt(cursor, 3000, (w) => !!w.slope) : nearestWallAt(cursor, 500);
            if (!nw) return null;
            const fp = D.footprintsAll.get(nw.w.id);
            return fp ? <path d={ringPath(fp.polygon)} fill="rgba(245,158,11,0.3)" stroke="#f59e0b" strokeWidth={px(1.5)} style={{ pointerEvents: 'none' }} /> : null;
          })()}

          {tool === 'furniture' && cursor && (() => {
            const tpl = toolOpts.furnitureTemplate ?? {};
            const info = CATEGORY_INFO[(tpl.category as keyof typeof CATEGORY_INFO) ?? toolOpts.furnitureCategory];
            const w = tpl.width ?? info.w, d = tpl.depth ?? info.d;
            return <rect x={cursor.x - w / 2} y={cursor.y - d / 2} width={w} height={d} fill="rgba(37,99,235,0.12)" stroke={accent} strokeWidth={px(1.2)} strokeDasharray={`${px(4)} ${px(3)}`} style={{ pointerEvents: 'none' }} />;
          })()}

          {/* Messwerkzeug */}
          {measure.points.length > 0 && measure.space === '2d' && (
            <g style={{ pointerEvents: 'none' }}>
              <polyline points={[...measure.points, ...(tool === 'measure' && snap ? [snap.p] : [])].map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#e11d48" strokeWidth={px(1.8)} />
              {measure.points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={px(3.5)} fill="#e11d48" />
              ))}
              {measure.points.slice(1).map((p, i) => {
                const a = measure.points[i];
                const m = mul(add(a, p), 0.5);
                return (
                  <text key={i} x={m.x} y={m.y - px(8)} fontSize={fontPx(11)} fill="#e11d48" textAnchor="middle" fontWeight={600}>
                    {fmtCm(dist(a, p))} cm
                  </text>
                );
              })}
            </g>
          )}
        </g>
      </svg>
      {!printMode && (
        <div className="hud">
          {cursor ? `x ${fmtCm(cursor.x, 0)} · y ${fmtCm(cursor.y, 0)} cm` : ''} {cursorText ? ` · ${cursorText}` : ''} · Zoom {(view.s * 100).toFixed(1)} px/m
          {tool === 'wall' && ' · Klick: Punkt · Doppelklick/Esc: Ende · Alt: ohne Fang'}
          {tool === 'line' && ' · Klick: Punkt · gleicher Punkt mit anderer Höhe: senkrecht · Enter/Doppelklick: fertig'}
          {tool === 'calibrate' && ' · Zwei Punkte einer bekannten Strecke im Hintergrundbild anklicken'}
          {tool === 'measure' && ' · Klick: Messpunkt · Esc: neu'}
        </div>
      )}
    </div>
  );
}

function Grid({ view, size, step }: { view: View; size: { w: number; h: number }; step: number }) {
  const x0 = Math.floor(-view.tx / view.s / step) * step;
  const y0 = Math.floor(-view.ty / view.s / step) * step;
  const x1 = (size.w - view.tx) / view.s, y1 = (size.h - view.ty) / view.s;
  const lines: React.ReactNode[] = [];
  let k = 0;
  for (let x = x0; x <= x1; x += step) lines.push(<line key={k++} x1={x} y1={y0} x2={x} y2={y1} stroke={Math.round(x) % (step * 10) === 0 ? '#d4d8de' : '#eceef1'} strokeWidth={1 / view.s} />);
  for (let y = y0; y <= y1; y += step) lines.push(<line key={k++} x1={x0} y1={y} x2={x1} y2={y} stroke={Math.round(y) % (step * 10) === 0 ? '#d4d8de' : '#eceef1'} strokeWidth={1 / view.s} />);
  return <g style={{ pointerEvents: 'none' }}>{lines}</g>;
}

function SlopeZones({ level }: { level: Level }) {
  const D = derive(level);
  const parts = useMemo(() => {
    const below2: string[] = [];
    const below1: string[] = [];
    const lines: string[] = [];
    for (const r of D.rooms) {
      for (const { poly, fn } of D.ceiling.pieces(r.clear)) {
        if (fn.ax === 0 && fn.ay === 0) continue;
        const b2 = clipHalfPlane(poly, -fn.ax, -fn.ay, 2000 - fn.c);
        const b1 = clipHalfPlane(poly, -fn.ax, -fn.ay, 1000 - fn.c);
        if (b2.length >= 3 && polygonArea(b2) > 10) below2.push(ringPath(b2));
        if (b1.length >= 3 && polygonArea(b1) > 10) below1.push(ringPath(b1));
        const all = clipHalfPlane(poly, -fn.ax, -fn.ay, level.ceilingHeight - 1 - fn.c);
        if (all.length >= 3 && polygonArea(all) > 10) lines.push(ringPath(all));
      }
    }
    return { below2, below1, lines };
  }, [D, level.ceilingHeight]);
  return (
    <g style={{ pointerEvents: 'none' }}>
      {parts.lines.map((d, i) => (
        <path key={'s' + i} d={d} fill="url(#hatch-slope)" stroke="none" />
      ))}
      {parts.below2.map((d, i) => (
        <path key={'a' + i} d={d} fill="rgba(59,130,246,0.10)" stroke="none" />
      ))}
      {parts.below1.map((d, i) => (
        <path key={'b' + i} d={d} fill="rgba(30,64,175,0.22)" stroke="none" />
      ))}
    </g>
  );
}

function ZonesLayer({ level }: { level: Level }) {
  const D = derive(level);
  const items = useMemo(() => {
    const res: { d: string }[] = [];
    for (const w of D.wallsPlanned) {
      const dd = norm(sub(w.b, w.a));
      const n = perp(dd);
      for (const side of [1, -1] as const) {
        const vz = verticalZones(level, w, side, D.wallsPlanned, D.footprints.get(w.id));
        for (const [a, b] of vz.vertical) {
          const o = mul(n, side * (w.thickness / 2));
          const p0 = add(add(w.a, mul(dd, a)), o), p1 = add(add(w.a, mul(dd, b)), o);
          const q0 = add(p0, mul(n, side * 60)), q1 = add(p1, mul(n, side * 60));
          res.push({ d: ringPath([p0, p1, q1, q0]) });
        }
      }
    }
    return res;
  }, [D, level]);
  return (
    <g style={{ pointerEvents: 'none' }}>
      {items.map((it, i) => (
        <path key={i} d={it.d} fill="rgba(34,197,94,0.35)" stroke="none" />
      ))}
    </g>
  );
}

function RoomLabel({ level, roomKey, s, selected, showDims }: { level: Level; roomKey: string; s: number; selected: boolean; showDims: boolean }) {
  const D = derive(level);
  const r = D.rooms.find((x) => x.key === roomKey)!;
  const stats = roomStats(level, r);
  const f = (n: number) => n / s;
  const p = r.labelPoint;
  const largest = r.clear.reduce((a, b) => (polygonArea(b[0]) > polygonArea(a[0]) ? b : a))[0];
  // Innenmaße an den Raumkanten
  const dims: React.ReactNode[] = [];
  if (showDims && s > 0.02) {
    const ccw = largest.length > 2 && (() => {
      let a = 0;
      for (let i = 0; i < largest.length; i++) {
        const p1 = largest[i], p2 = largest[(i + 1) % largest.length];
        a += p1.x * p2.y - p2.x * p1.y;
      }
      return a > 0;
    })();
    for (let i = 0; i < largest.length; i++) {
      const a = largest[i], b = largest[(i + 1) % largest.length];
      const L = dist(a, b);
      if (L < 250) continue;
      const d = norm(sub(b, a));
      let n = perp(d);
      if (!ccw) n = mul(n, -1);
      // n zeigt nach innen bei CCW? prüfen über Punkt
      const test = add(mul(add(a, b), 0.5), mul(n, 50));
      if (!pointInPolygon(test, largest)) n = mul(n, -1);
      const m = add(mul(add(a, b), 0.5), mul(n, f(9)));
      let ang = (Math.atan2(d.y, d.x) * 180) / Math.PI;
      if (ang > 90 || ang <= -90) ang += 180;
      dims.push(
        <text key={i} x={m.x} y={m.y} fontSize={f(9.5)} fill="#64748b" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${ang} ${m.x} ${m.y})`} style={{ pointerEvents: 'none' }}>
          {(L / 1000).toFixed(3).replace('.', ',')}
        </text>,
      );
    }
  }
  const lines = [r.name, `${fmtM2(r.netArea)} m² Grundfl.`];
  if (Math.abs(stats.living - r.netArea) > 1e4) lines.push(`${fmtM2(stats.living)} m² Wohnfl.`);
  return (
    <g>
      {dims}
      <g data-kind={r.meta ? 'room' : undefined} data-id={r.meta?.id} style={{ cursor: r.meta ? 'move' : undefined }}>
        {lines.map((t, i) => (
          <text key={i} x={p.x} y={p.y + (i - (lines.length - 1) / 2) * f(14)} fontSize={f(i === 0 ? 13 : 10.5)} fontWeight={i === 0 ? 600 : 400} fill={selected ? '#1d4ed8' : r.meta ? '#111827' : '#b91c1c'} textAnchor="middle" dominantBaseline="middle" paintOrder="stroke" stroke="#ffffff" strokeWidth={f(3)}>
            {t}
          </text>
        ))}
      </g>
    </g>
  );
}

function Dimensions({ level, s, selectedId }: { level: Level; s: number; selectedId?: string }) {
  const f = (n: number) => n / s;
  const D = derive(level);
  // Außenmaßketten aus dem Außenumriss aller Wände
  const outer = useMemo(() => {
    const u = union([...D.footprintsAll.values()].map((fp) => fp.polygon));
    if (!u.length) return [] as Vec2[];
    return u.reduce((a, b) => (polygonArea(b[0]) > polygonArea(a[0]) ? b : a))[0];
  }, [D]);
  const out: React.ReactNode[] = [];
  const dimLine = (a: Vec2, b: Vec2, off: number, key: string, color = '#334155', dataId?: string) => {
    const d = norm(sub(b, a));
    const n = perp(d);
    const a1 = add(a, mul(n, off)), b1 = add(b, mul(n, off));
    const m = mul(add(a1, b1), 0.5);
    let ang = (Math.atan2(d.y, d.x) * 180) / Math.PI;
    if (ang > 90 || ang <= -90) ang += 180;
    const tick = f(5);
    const td = mul(add(d, n), tick / Math.SQRT2);
    const L = dist(a, b);
    const showText = L * s > 28;
    out.push(
      <g key={key} data-kind={dataId ? 'dimension' : undefined} data-id={dataId} style={{ cursor: dataId ? 'move' : undefined }}>
        {off !== 0 && <line x1={a.x} y1={a.y} x2={a1.x} y2={a1.y} stroke={color} strokeWidth={f(0.6)} />}
        {off !== 0 && <line x1={b.x} y1={b.y} x2={b1.x} y2={b1.y} stroke={color} strokeWidth={f(0.6)} />}
        <line x1={a1.x} y1={a1.y} x2={b1.x} y2={b1.y} stroke={color} strokeWidth={f(0.9)} />
        <line x1={a1.x - td.x} y1={a1.y - td.y} x2={a1.x + td.x} y2={a1.y + td.y} stroke={color} strokeWidth={f(1.2)} />
        <line x1={b1.x - td.x} y1={b1.y - td.y} x2={b1.x + td.x} y2={b1.y + td.y} stroke={color} strokeWidth={f(1.2)} />
        {showText && (
          <text x={m.x - n.x * f(7)} y={m.y - n.y * f(7)} fontSize={f(10.5)} fill={color} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${ang} ${m.x - n.x * f(7)} ${m.y - n.y * f(7)})`}>
            {(L / 1000).toFixed(L < 1000 ? 3 : 2).replace('.', ',')}
          </text>
        )}
      </g>,
    );
  };
  if (outer.length) {
    const bb = bbox(outer);
    const xs = [...new Set(outer.map((p) => Math.round(p.x)))].sort((a, b) => a - b);
    const ys = [...new Set(outer.map((p) => Math.round(p.y)))].sort((a, b) => a - b);
    const dedupe = (arr: number[]) => arr.filter((v, i) => i === 0 || v - arr[i - 1] > 20);
    const cx = dedupe(xs), cy = dedupe(ys);
    const ox = bb.minY - f(34);
    for (let i = 1; i < cx.length; i++) dimLine({ x: cx[i - 1], y: ox }, { x: cx[i], y: ox }, 0, 'cx' + i);
    dimLine({ x: bb.minX, y: ox - f(20) }, { x: bb.maxX, y: ox - f(20) }, 0, 'tx');
    const oy = bb.minX - f(34);
    for (let i = 1; i < cy.length; i++) dimLine({ x: oy, y: cy[i] }, { x: oy, y: cy[i - 1] }, 0, 'cy' + i);
    dimLine({ x: oy - f(20), y: bb.maxY }, { x: oy - f(20), y: bb.minY }, 0, 'ty');
  }
  for (const dm of level.dimensions) dimLine(dm.a, dm.b, dm.offset, dm.id, dm.id === selectedId ? '#2563eb' : '#7c3aed', dm.id);
  return <g>{out}</g>;
}

// Kategorie-Info re-export für Panels
export { CATEGORY_INFO };
export const furnitureCenter = (f: Furniture) => polygonCentroid(furnitureFootprint(f));
