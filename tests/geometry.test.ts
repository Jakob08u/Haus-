import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Project } from '../src/model/types';
import { detectRooms, findFaces } from '../src/geometry/rooms';
import { CeilingModel } from '../src/geometry/ceiling';
import { wallFootprints } from '../src/geometry/walls';
import { polygonArea } from '../src/geometry/vec';
import { boxLevel } from './helpers';

const project = JSON.parse(readFileSync(resolve(__dirname, '../projekt.json'), 'utf8')) as Project;
const m2 = (mm2: number) => Math.round((mm2 / 1e6) * 100) / 100;

describe('Startprojekt aus dem Grundriss', () => {
  it('DG-Raumflächen stimmen mit der handschriftlichen Vinyl-Rechnung überein', () => {
    const dg = project.levels.find((l) => l.id === 'dg')!;
    const rooms = Object.fromEntries(detectRooms(dg).map((r) => [r.name, m2(r.netArea)]));
    // Skizze: 3,39 × 6,38 = 21,63
    expect(rooms['Büro']).toBeCloseTo(21.63, 2);
    // 2,57 × 1,12 + 1,35 × 2,98 = 2,88 + 4,02 (Treppenloch abgezogen)
    expect(rooms['Flur DG']).toBeCloseTo(6.9, 1);
    // 2,21 × 3,55 + 2,96 × 5,10 + 1,46 × 2,29 = 7,85 + 15,10 + 3,34
    expect(rooms['Schlafzimmer']).toBeCloseTo(26.29, 1);
    expect(Object.keys(rooms)).toHaveLength(4);
  });

  it('EG-Raumflächen stimmen mit der Fliesen-Rechnung überein', () => {
    const eg = project.levels.find((l) => l.id === 'eg')!;
    const rooms = Object.fromEntries(detectRooms(eg).map((r) => [r.name, m2(r.netArea)]));
    expect(rooms['Vorraum']).toBeCloseTo(2.7, 2);
    expect(rooms['Küche']).toBeCloseTo(21.16, 2);
    expect(rooms['Wohnen']).toBeCloseTo(24.5, 2);
    expect(rooms['Gäste']).toBeCloseTo(17.85, 2);
    // Flur: 2,14 × 7,03 + 1,92 × 0,71
    expect(rooms['Flur EG']).toBeCloseTo(15.04 + 1.36, 1);
  });
});

describe('Raumerkennung', () => {
  it('erkennt zwei Räume bei einer Trennwand (T-Stoß)', () => {
    const lvl = boxLevel(6000, 4000);
    lvl.walls.push({ id: 'mid', a: { x: 3000, y: -100 }, b: { x: 3000, y: 4100 }, thickness: 100, type: 'neu' });
    const faces = findFaces(lvl.walls);
    expect(faces).toHaveLength(2);
    const rooms = detectRooms(lvl);
    const areas = rooms.map((r) => m2(r.area)).sort();
    // 2950 × 4000 bzw. 2950 × 4000
    expect(areas).toEqual([11.8, 11.8]);
  });

  it('ignoriert Abrisswände und lose Wandenden', () => {
    const lvl = boxLevel(6000, 4000);
    lvl.walls.push({ id: 'abr', a: { x: 3000, y: -100 }, b: { x: 3000, y: 4100 }, thickness: 100, type: 'abriss' });
    lvl.walls.push({ id: 'stub', a: { x: 1000, y: 4100 }, b: { x: 1000, y: 2000 }, thickness: 100, type: 'neu' });
    const rooms = detectRooms(lvl);
    expect(rooms).toHaveLength(1);
    expect(m2(rooms[0].area)).toBeCloseTo(24 - 0.1 * 2.0, 2);
  });

  it('Wandumrisse: Ecken auf Gehrung, Fläche entspricht Wandvolumen', () => {
    const lvl = boxLevel(4000, 3000, 200);
    const fps = wallFootprints(lvl.walls);
    const total = [...fps.values()].reduce((s, f) => s + polygonArea(f.polygon), 0);
    // Außen 4400 × 3400 minus innen 4000 × 3000
    expect(total).toBeCloseTo(4400 * 3400 - 4000 * 3000, -2);
  });
});

describe('Wohnfläche nach WoFlV mit Dachschräge', () => {
  it('Kniestock 1,0 m, 45°: 1–2 m Bereich zur Hälfte', () => {
    const lvl = boxLevel(4000, 5000, 200, { ceilingHeight: 2500 });
    // Schräge an der linken Wand (5 m lang), steigt nach rechts in den Raum
    const left = lvl.walls.find((w) => w.id === 'left')!;
    // Normale von left (a unten → b oben): perp((0,-1)) = (1,0) → zeigt in den Raum → side 1
    left.slope = { side: 1, knee: 1000, mode: 'pitch', pitchDeg: 45 };
    const cm2 = new CeilingModel(lvl);
    expect(cm2.heightAt({ x: 0, y: 2500 })).toBeCloseTo(1000, 0);
    expect(cm2.heightAt({ x: 500, y: 2500 })).toBeCloseTo(1500, 0);
    expect(cm2.heightAt({ x: 3000, y: 2500 })).toBeCloseTo(2500, 0);
    const room = detectRooms(lvl)[0];
    const la = cm2.livingArea(room.net);
    expect(m2(la.total)).toBeCloseTo(20, 2);
    expect(m2(la.between1and2)).toBeCloseTo(5, 2); // 1,0 m × 5 m
    expect(m2(la.above2)).toBeCloseTo(15, 2);
    expect(m2(la.living)).toBeCloseTo(17.5, 2);
  });

  it('Kniestock 0,6 m: Fläche unter 1 m zählt nicht', () => {
    const lvl = boxLevel(4000, 5000, 200, { ceilingHeight: 2500 });
    const left = lvl.walls.find((w) => w.id === 'left')!;
    left.slope = { side: 1, knee: 600, mode: 'pitch', pitchDeg: 45 };
    const cm = new CeilingModel(lvl);
    const la = cm.livingArea(detectRooms(lvl)[0].net);
    expect(m2(la.below1)).toBeCloseTo(2, 2);
    expect(m2(la.between1and2)).toBeCloseTo(5, 2);
    expect(m2(la.above2)).toBeCloseTo(13, 2);
    expect(m2(la.living)).toBeCloseTo(15.5, 2);
  });

  it('Firsthöhe statt Neigung ergibt dieselbe Schräge', () => {
    const lvl = boxLevel(4000, 5000, 200, { ceilingHeight: 2500 });
    const left = lvl.walls.find((w) => w.id === 'left')!;
    left.slope = { side: 1, knee: 1000, mode: 'ridge', pitchDeg: 0, ridgeHeight: 4000, ridgeDistance: 3000 };
    const cm = new CeilingModel(lvl);
    expect(cm.heightAt({ x: 1000, y: 2500 })).toBeCloseTo(2000, 0);
    expect(cm.heightAt({ x: 0, y: 2500 })).toBeCloseTo(1000, 0);
  });

  it('zwei Schrägen (Satteldach) überlagern sich korrekt', () => {
    const lvl = boxLevel(4000, 5000, 200, { ceilingHeight: 5000 });
    for (const id of ['left', 'right']) {
      const w = lvl.walls.find((x) => x.id === id)!;
      w.slope = { side: 1, knee: 1000, mode: 'pitch', pitchDeg: 45 };
    }
    const cm = new CeilingModel(lvl);
    // First in der Mitte: 1000 + 2000 = 3000
    expect(cm.heightAt({ x: 2000, y: 2500 })).toBeCloseTo(3000, 0);
    expect(cm.heightAt({ x: 3500, y: 2500 })).toBeCloseTo(1500, 0);
    const la = cm.livingArea(detectRooms(lvl)[0].net);
    // 1–2 m: je 1 m Streifen links und rechts (2 × 5 m²), ≥ 2 m: 2 m × 5 m
    expect(m2(la.between1and2)).toBeCloseTo(10, 2);
    expect(m2(la.above2)).toBeCloseTo(10, 2);
  });

  it('DG: Wohnfläche kleiner als Grundfläche wegen Schrägen', () => {
    const dg = project.levels.find((l) => l.id === 'dg')!;
    const cm = new CeilingModel(dg);
    const buero = detectRooms(dg).find((r) => r.name === 'Büro')!;
    const la = cm.livingArea(buero.net);
    // Kniestock 1,05 m, 45°, Decke 2,40: 0,95 m Streifen × 6,38 m zur Hälfte
    expect(m2(la.between1and2)).toBeCloseTo(0.95 * 6.38, 1);
    expect(m2(la.living)).toBeCloseTo(21.63 - 0.5 * 0.95 * 6.38, 1);
  });
});
