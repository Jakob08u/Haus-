import { describe, expect, it } from 'vitest';
import { materialList, materialSummary, packagesFor, paintLiters, stripHeightsForFace, tileCount, wallFaces, wallpaperRolls } from '../src/calc/materials';
import { emptyProject } from '../src/model/defaults';
import type { Project } from '../src/model/types';
import { boxLevel } from './helpers';

const roll = { rollWidth: 530, rollLength: 10050 };

describe('Tapetenrollen', () => {
  it('4 m Wand, 2,50 m hoch, ohne Rapport: 8 Bahnen à 2,60 m → 3 Rollen', () => {
    const strips = stripHeightsForFace(4000, () => 2500, 530);
    expect(strips).toHaveLength(8);
    const r = wallpaperRolls(strips, roll);
    expect(r.stripLengths[0]).toBe(2600);
    expect(r.rolls).toBe(3);
  });

  it('Rapport 64 cm: Bahnlänge auf 3,20 m aufgerundet; versetzter Ansatz +32 cm', () => {
    const strips = stripHeightsForFace(4000, () => 2500, 530);
    expect(wallpaperRolls(strips, { ...roll, repeat: 640 })).toMatchObject({ rolls: 3 });
    expect(wallpaperRolls(strips, { ...roll, repeat: 640 }).stripLengths[0]).toBe(3200);
    const off = wallpaperRolls(strips, { ...roll, repeat: 640, repeatOffset: true });
    expect(off.stripLengths[0]).toBe(3520);
    expect(off.rolls).toBe(4);
  });

  it('Giebelwand unter Schräge: kurze Bahnen werden mit Resten kombiniert', () => {
    // Höhe fällt von 2,40 m auf 1,00 m
    const h = (s: number) => Math.max(1000, 2400 - s * 0.7);
    const strips = stripHeightsForFace(4000, h, 530);
    const r = wallpaperRolls(strips, roll);
    const naive = Math.ceil(strips.length / Math.floor(10050 / (2400 + 100)));
    expect(r.rolls).toBeLessThanOrEqual(naive);
    expect(r.strips).toBe(8);
  });
});

describe('Boden, Fliesen, Farbe', () => {
  it('Pakete mit 10 % Verschnitt', () => {
    const { gross, packages } = packagesFor(20e6, 10, 2.196e6);
    expect(gross).toBeCloseTo(22e6, -1);
    expect(packages).toBe(11);
  });
  it('Fliesenanzahl inkl. Fuge', () => {
    // 1 m² mit 30×60 Fliesen + 3 mm Fuge = 0,303 × 0,603 = 0,1827 m² → 5,47 → 6 (ohne Verschnitt)
    expect(tileCount(1e6, { tileLength: 600, tileWidth: 300, joint: 3 }, 0)).toBe(6);
  });
  it('Farbe: 50 m², 2 Anstriche, 7 m²/l = 14,3 l', () => {
    expect(paintLiters(50e6, 7, 2)).toBeCloseTo(14.29, 2);
  });
});

describe('Flächen aus dem Modell', () => {
  function proj(): Project {
    const p = emptyProject();
    const l = boxLevel(4000, 3000, 200, { ceilingHeight: 2500 });
    l.openings.push({ id: 'd', type: 'door', wallId: 'top', offset: 1000, width: 900, height: 2010, sill: 0, swing: 1, hinge: 'a' });
    p.levels = [l];
    p.assumptions = [];
    return p;
  }

  it('Wandflächen je Raum: Innenmaße, Öffnung abgezogen', () => {
    const p = proj();
    const faces = wallFaces(p.levels[0]);
    expect(faces).toHaveLength(4);
    const widths = faces.map((f) => Math.round(f.width)).sort((a, b) => a - b);
    expect(widths).toEqual([3000, 3000, 4000, 4000]);
    const top = faces.find((f) => f.wall.id === 'top')!;
    expect(top.grossArea).toBeCloseTo(4000 * 2500, -2);
    expect(top.openingArea).toBeCloseTo(900 * 2010, -2);
  });

  it('Bodenbelag und Tapete in der Materialliste', () => {
    const p = proj();
    const l = p.levels[0];
    l.rooms[0].floor = { materialId: 'mat_vinyl_eiche', pattern: 'third', rotation: 0 };
    for (const w of l.walls) w.finishes = { left: { kind: 'wallpaper', materialId: 'mat_tapete_vlies' }, right: { kind: 'wallpaper', materialId: 'mat_tapete_vlies' } };
    const list = materialList(p);
    const floor = list.find((x) => x.kind === 'Boden')!;
    expect(floor.area).toBeCloseTo(12e6, -3);
    // 12 m² + 10 % = 13,2 m² / 2,196 m² = 6,01 → 7 Pakete
    expect(floor.quantity).toBe('7 Pakete');
    const sum = materialSummary(p);
    const wp = sum.find((s) => s.kind === 'Tapete')!;
    // Umfang 14 m / 0,53 = 4+4+6+6 = 28 Bahnen; Rapport 64 cm → 3,20 m → 3 je Rolle → 10 Rollen
    expect(wp.quantity).toMatch(/^10 Rollen \(28 Bahnen/);
    expect(list.some((x) => x.kind === 'Sockelleiste')).toBe(true);
  });

  it('Fliesenspiegel bis 1,20 m Höhe', () => {
    const p = proj();
    const l = p.levels[0];
    const right = l.walls.find((w) => w.id === 'right')!;
    // Seite zum Raum ermitteln
    const face = wallFaces(l).find((f) => f.wall.id === 'right')!;
    right.finishes = { [face.side === 1 ? 'left' : 'right']: { kind: 'tile', materialId: 'mat_fliese_weiss', maxHeight: 1200 } };
    const t = materialList(p).find((x) => x.kind === 'Fliese')!;
    expect(t.area).toBeCloseTo(3000 * 1200, -3);
  });
});
