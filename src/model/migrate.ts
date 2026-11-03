import type { Project } from './types';
import { defaultMaterials, defaultSettings } from './defaults';

/** Fehlende Felder ergänzen (ältere/handgeschriebene Projektdateien) */
export function migrate(p: Project): Project {
  const s = defaultSettings();
  p.settings = { ...s, ...(p.settings ?? {}), clearance: { ...s.clearance, ...(p.settings?.clearance ?? {}) }, defaultHeights: { ...s.defaultHeights, ...(p.settings?.defaultHeights ?? {}) } };
  p.materials = p.materials ?? defaultMaterials();
  p.cameras = p.cameras ?? [];
  p.assumptions = p.assumptions ?? [];
  p.levels = (p.levels ?? []).map((l) => ({
    ...l,
    elevation: l.elevation ?? 0,
    ceilingHeight: l.ceilingHeight ?? 2500,
    slabThickness: l.slabThickness ?? 250,
    walls: l.walls ?? [],
    openings: l.openings ?? [],
    roofWindows: l.roofWindows ?? [],
    stairs: l.stairs ?? [],
    rooms: l.rooms ?? [],
    furniture: l.furniture ?? [],
    electrical: l.electrical ?? [],
    lines: l.lines ?? [],
    dimensions: l.dimensions ?? [],
  }));
  return p;
}
