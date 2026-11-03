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
  it('OG-Raumflächen stimmen mit der handschriftlichen Vinyl-Rechnung überein', () => {
    const dg = project.levels.find((l) => l.id === 'og')!;
    const rooms = Object.fromEntries(detectRooms(dg).map((r) => [r.name, m2(r.netArea)]));
    // Skizze: 3,39 × 6,38 = 21,63
    expect(rooms['Büro']).toBeCloseTo(21.63, 2);
    // 2,57 × 1,12 + 1,35 × 2,98 = 2,88 + 4,02 (Treppenloch abgezogen)
    expect(rooms['Flur OG']).toBeCloseTo(6.9, 1);
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

  it('Neigung aus Länge bzw. waagrechter Tiefe der Schräge und Deckenhöhe', () => {
    const lvl = boxLevel(4000, 5000, 200, { ceilingHeight: 2500 });
    const left = lvl.walls.find((w) => w.id === 'left')!;
    // Länge 2,05 m entlang der Schräge, Anstieg 1,45 m → sin α = 0,707 → 45°
    left.slope = { side: 1, knee: 1050, mode: 'length', pitchDeg: 0, slopeLength: 1450 * Math.SQRT2 };
    expect(new CeilingModel(lvl).heightAt({ x: 1000, y: 2500 })).toBeCloseTo(2050, 0);
    const lvl2 = boxLevel(4000, 5000, 200, { ceilingHeight: 2500 });
    lvl2.walls.find((w) => w.id === 'left')!.slope = { side: 1, knee: 1050, mode: 'depth', pitchDeg: 0, slopeDepth: 1450 };
    const cm = new CeilingModel(lvl2);
    expect(cm.heightAt({ x: 1000, y: 2500 })).toBeCloseTo(2050, 0);
    expect(cm.heightAt({ x: 1450, y: 2500 })).toBeCloseTo(2500, 0);
  });

  it('Deckenhöhe je Raum: Wände und Schrägen nutzen die Höhe des jeweiligen Raums', () => {
    const lvl = boxLevel(6000, 4000, 200, { ceilingHeight: 2500 });
    lvl.walls.push({ id: 'mid', a: { x: 3000, y: -100 }, b: { x: 3000, y: 4100 }, thickness: 100, type: 'neu' });
    lvl.rooms = [
      { id: 'r1', name: 'Links', seed: { x: 1500, y: 2000 }, ceilingHeight: 2800 },
      { id: 'r2', name: 'Rechts', seed: { x: 4500, y: 2000 } },
    ];
    // Schräge links mit waagrechter Tiefe 1,75 m: Anstieg 2,80 − 1,05 = 1,75 → 45°
    lvl.walls.find((w) => w.id === 'left')!.slope = { side: 1, knee: 1050, mode: 'depth', pitchDeg: 0, slopeDepth: 1750 };
    const cm = new CeilingModel(lvl);
    expect(cm.heightAt({ x: 4500, y: 2000 })).toBeCloseTo(2500, 0);
    expect(cm.heightAt({ x: 2500, y: 2000 })).toBeCloseTo(2800, 0);
    expect(cm.heightAt({ x: 1000, y: 2000 })).toBeCloseTo(2050, 0);
    // in der Trennwand gilt die höhere Decke (Wandoberkante)
    expect(cm.heightAt({ x: 3000, y: 2000 })).toBeCloseTo(2800, 0);
  });

  it('Schräge reicht nicht in einen Raum hinter der Wand (z. B. vorspringendes Bad)', () => {
    const lvl = boxLevel(4000, 3000, 200, { ceilingHeight: 2500 });
    lvl.walls.push(
      { id: 'top2', a: { x: 4100, y: -100 }, b: { x: 6100, y: -100 }, thickness: 200, type: 'bestand' },
      { id: 'right2', a: { x: 6100, y: -100 }, b: { x: 6100, y: 3100 }, thickness: 200, type: 'bestand' },
      { id: 'bottom2', a: { x: 6100, y: 3100 }, b: { x: 4100, y: 3100 }, thickness: 200, type: 'bestand' },
    );
    lvl.rooms.push({ id: 'r2', name: 'Hinten', seed: { x: 5000, y: 1500 } });
    lvl.walls.find((w) => w.id === 'right')!.slope = { side: 1, knee: 1000, mode: 'pitch', pitchDeg: 45 };
    const cm = new CeilingModel(lvl);
    expect(cm.heightAt({ x: 3990, y: 1500 })).toBeCloseTo(1010, 0);
    expect(cm.heightAt({ x: 4210, y: 1500 })).toBeCloseTo(2500, 0);
    const hinten = detectRooms(lvl).find((r) => r.name === 'Hinten')!;
    expect(cm.livingArea(hinten.net).minHeight).toBeCloseTo(2500, 0);
    // ohne Raum dahinter läuft die Schräge über die Wand bis zur Außenseite
    const solo = boxLevel(4000, 3000, 200, { ceilingHeight: 2500 });
    solo.walls.find((w) => w.id === 'right')!.slope = { side: 1, knee: 1000, mode: 'pitch', pitchDeg: 45 };
    expect(new CeilingModel(solo).heightAt({ x: 4200, y: 1500 })).toBeCloseTo(800, 0);
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

  it('Zweigeschossiges Haus: Schrägen laut Angabe, Bad und Flur ohne Schräge, Geschosse übereinander', () => {
    const og = project.levels.find((l) => l.id === 'og')!;
    const eg = project.levels.find((l) => l.id === 'eg')!;
    const knee = Object.fromEntries(og.walls.filter((w) => w.slope).map((w) => [w.id, w.slope!.knee]));
    expect(knee).toEqual({ og_w_schlaf_rechts: 1150, og_w_schlaf_rechts_t1: 1150, og_w_nische_aussen: 1030, og_w_buero_oben: 1050 });
    expect(og.elevation).toBeGreaterThanOrEqual(eg.elevation + eg.ceilingHeight + og.slabThickness);
    expect(eg.ceilingHeight).toBe(2600);
    const cm = new CeilingModel(og);
    const rooms = Object.fromEntries(detectRooms(og).map((r) => [r.name, { r, la: cm.livingArea(r.net) }]));
    expect(rooms['Büro'].la.minHeight).toBeCloseTo(1050, 0);
    expect(rooms['Schlafzimmer'].la.minHeight).toBeCloseTo(1030, 0);
    // Deckenhöhen je Raum laut Angabe
    expect(rooms['Bad'].la.maxHeight).toBeCloseTo(2630, 0);
    // Bad laut Skizze 3,32 × 2,60 m + WC-Nische 0,73 × 0,63 m; die Schräge des Schlafzimmers reicht nicht hinein
    expect(m2(rooms['Bad'].la.total)).toBeCloseTo(3.32 * 2.6 + 0.73 * 0.63, 2);
    expect(rooms['Bad'].la.minHeight).toBeCloseTo(2630, 0);
    expect(rooms['Flur OG'].la.minHeight).toBeCloseTo(2480, 0);
    expect(rooms['Büro'].la.maxHeight).toBeCloseTo(2790, 0);
    expect(rooms['Schlafzimmer'].la.maxHeight).toBeCloseTo(2720, 0);
    // Büro: Schräge 1,67 m tief von 1,05 m bis 2,79 m → tan α = 1,74 / 1,67;
    // Bereich 1,05–2,00 m (Tiefe 0,95 / tan α) zählt zur Hälfte über 6,38 m
    const tanA = 1.74 / 1.67;
    expect(m2(rooms['Büro'].la.living)).toBeCloseTo(21.63 - 0.5 * (0.95 / tanA) * 6.38, 1);
    // Treppenloch OG liegt über der Treppe im EG
    const so = og.stairs[0], se = eg.stairs[0];
    expect(Math.hypot(so.x - se.x, so.y - se.y)).toBeLessThan(5);
  });
});
