import { useStore, getLevel } from '../store/store';
import { uid } from '../geometry/vec';
import type { Level } from '../model/types';

export function deleteSelection() {
  const st = useStore.getState();
  const sel = st.selection;
  if (!sel) return;
  st.updateLevel((l) => {
    switch (sel.kind) {
      case 'wall':
        l.walls = l.walls.filter((w) => w.id !== sel.id);
        l.openings = l.openings.filter((o) => o.wallId !== sel.id);
        l.roofWindows = l.roofWindows.filter((o) => o.wallId !== sel.id);
        break;
      case 'opening':
        l.openings = l.openings.filter((o) => o.id !== sel.id);
        break;
      case 'roofWindow':
        l.roofWindows = l.roofWindows.filter((o) => o.id !== sel.id);
        break;
      case 'stair':
        l.stairs = l.stairs.filter((o) => o.id !== sel.id);
        break;
      case 'room':
        l.rooms = l.rooms.filter((o) => o.id !== sel.id);
        break;
      case 'furniture':
        l.furniture = l.furniture.filter((o) => o.id !== sel.id);
        break;
      case 'elec':
        l.electrical = l.electrical.filter((o) => o.id !== sel.id);
        break;
      case 'line': {
        const ln = l.lines.find((x) => x.id === sel.id);
        if (ln && typeof sel.sub === 'number' && ln.points.length > 2) ln.points.splice(sel.sub, 1);
        else l.lines = l.lines.filter((o) => o.id !== sel.id);
        break;
      }
      case 'dimension':
        l.dimensions = l.dimensions.filter((o) => o.id !== sel.id);
        break;
    }
  });
  st.select(null);
}

export function rotateSelection(deg: number) {
  const st = useStore.getState();
  const sel = st.selection;
  if (!sel) return;
  st.updateLevel((l) => {
    const norm = (r: number) => ((Math.round(r * 10) / 10) % 360 + 360) % 360;
    if (sel.kind === 'furniture') {
      const f = l.furniture.find((x) => x.id === sel.id);
      if (f) f.rotation = norm(f.rotation + deg);
    } else if (sel.kind === 'stair') {
      const s = l.stairs.find((x) => x.id === sel.id);
      if (s) s.rotation = norm(s.rotation + deg);
    } else if (sel.kind === 'elec') {
      const e = l.electrical.find((x) => x.id === sel.id);
      if (e) e.rotation = norm((e.rotation ?? 0) + deg);
    } else if (sel.kind === 'opening' && Math.abs(deg) === 90) {
      const o = l.openings.find((x) => x.id === sel.id);
      if (o) {
        // Tür: Anschlag/Aufschlag durchschalten
        if (o.hinge === 'a' && o.swing === 1) o.hinge = 'b';
        else if (o.hinge === 'b' && o.swing === 1) o.swing = -1;
        else if (o.hinge === 'b' && o.swing === -1) o.hinge = 'a';
        else o.swing = 1;
      }
    }
  });
}

export function nudgeSelection(dx: number, dy: number) {
  const st = useStore.getState();
  const sel = st.selection;
  if (!sel) return;
  st.updateLevel((l) => {
    const move = (o: { x: number; y: number } | undefined) => {
      if (o) {
        o.x += dx;
        o.y += dy;
      }
    };
    if (sel.kind === 'furniture') move(l.furniture.find((x) => x.id === sel.id));
    if (sel.kind === 'elec') move(l.electrical.find((x) => x.id === sel.id));
    if (sel.kind === 'stair') move(l.stairs.find((x) => x.id === sel.id));
    if (sel.kind === 'room') move(l.rooms.find((x) => x.id === sel.id)?.seed);
    if (sel.kind === 'wall') {
      const w = l.walls.find((x) => x.id === sel.id);
      if (w) {
        const ends = [{ ...w.a }, { ...w.b }];
        for (const o of l.walls)
          for (const k of ['a', 'b'] as const)
            if (ends.some((p) => Math.abs(p.x - o[k].x) < 3 && Math.abs(p.y - o[k].y) < 3)) {
              o[k] = { x: o[k].x + dx, y: o[k].y + dy };
            }
      }
    }
  });
}

export function duplicateSelection() {
  const st = useStore.getState();
  const sel = st.selection;
  if (!sel) return;
  let newId = '';
  st.updateLevel((l: Level) => {
    if (sel.kind === 'furniture') {
      const f = l.furniture.find((x) => x.id === sel.id);
      if (f) {
        newId = uid('f');
        l.furniture.push({ ...structuredClone(f), id: newId, x: f.x + 200, y: f.y + 200 });
      }
    } else if (sel.kind === 'elec') {
      const f = l.electrical.find((x) => x.id === sel.id);
      if (f) {
        newId = uid('e');
        l.electrical.push({ ...structuredClone(f), id: newId, x: f.x + 150 });
      }
    }
  });
  if (newId) st.select({ kind: sel.kind, id: newId });
}

export function currentLevel(): Level {
  return getLevel();
}
