import { describe, expect, it } from 'vitest';
import { checkLevel, clearanceZones } from '../src/checks/checks';
import { emptyProject, newFurniture } from '../src/model/defaults';
import type { Level, Project } from '../src/model/types';
import { boxLevel } from './helpers';

function setup(level: Level): Project {
  const p = emptyProject();
  p.levels = [level];
  p.assumptions = [];
  return p;
}
const msgs = (l: Level) => checkLevel(l, setup(l)).filter((w) => w.severity !== 'info').map((w) => `${w.category}: ${w.message}`);

describe('Kollisionsprüfung', () => {
  it('freistehendes Möbel ohne Konflikt', () => {
    const l = boxLevel(4000, 4000);
    l.furniture.push(newFurniture('kommode', 2000, 2000, { width: 800, depth: 400, height: 800, id: 'k' }));
    expect(msgs(l)).toEqual([]);
  });

  it('Möbel genau an der Wand (anliegend) ist keine Kollision', () => {
    const l = boxLevel(4000, 4000);
    // Rückseite bei y = 0 (Innenkante der oberen Wand), Front zeigt nach +y
    l.furniture.push(newFurniture('regal', 2000, 150, { width: 800, depth: 300, height: 2000, id: 'r' }));
    expect(msgs(l)).toEqual([]);
  });

  it('Möbel in der Wand wird gemeldet', () => {
    const l = boxLevel(4000, 4000);
    l.furniture.push(newFurniture('regal', 2000, 100, { width: 800, depth: 300, height: 2000, id: 'r' }));
    expect(msgs(l).some((m) => m.startsWith('kollision') && m.includes('Wand'))).toBe(true);
  });

  it('überlappende Möbel, aber Hängeschrank über Kommode ist erlaubt', () => {
    const l = boxLevel(4000, 4000);
    l.furniture.push(newFurniture('kommode', 2000, 2000, { width: 800, depth: 400, height: 800, id: 'a' }));
    l.furniture.push(newFurniture('kommode', 2300, 2000, { width: 800, depth: 400, height: 800, id: 'b' }));
    expect(msgs(l).filter((m) => m.includes('überschneidet'))).toHaveLength(1);
    l.furniture[1] = newFurniture('schrank', 2000, 2000, { width: 800, depth: 350, height: 600, elevation: 1400, id: 'b', doorType: 'none' });
    expect(msgs(l).filter((m) => m.includes('überschneidet'))).toHaveLength(0);
  });

  it('Stuhl unter Schreibtisch ist erlaubt', () => {
    const l = boxLevel(4000, 4000);
    l.furniture.push(newFurniture('schreibtisch', 2000, 500, { id: 'd' }));
    l.furniture.push(newFurniture('stuhl', 2000, 700, { id: 's' }));
    expect(msgs(l).filter((m) => m.includes('überschneidet'))).toHaveLength(0);
  });

  it('Schrank zu hoch unter Dachschräge', () => {
    const l = boxLevel(4000, 4000, 200, { ceilingHeight: 2500 });
    const left = l.walls.find((w) => w.id === 'left')!;
    left.slope = { side: 1, knee: 1000, mode: 'pitch', pitchDeg: 45 };
    // Schrank 60 cm tief, 2 m hoch, Rückwand an der Kniestockwand → an der Rückseite nur 1,00 m
    l.furniture.push(newFurniture('schrank', 300, 2000, { width: 1000, depth: 600, height: 2000, rotation: 270, id: 'sch' }));
    const m = msgs(l).filter((x) => x.startsWith('schraege'));
    expect(m).toHaveLength(1);
    expect(m[0]).toMatch(/max\. 100 cm/);
    // Weiter in den Raum gerückt passt er (Rückseite bei 1,0 m Abstand → 2,0 m)
    l.furniture[0].x = 1300;
    expect(msgs(l).filter((x) => x.startsWith('schraege'))).toHaveLength(0);
  });

  it('Möbel im Türschwenkbereich', () => {
    const l = boxLevel(4000, 4000);
    // Tür in der oberen Wand, schlägt in den Raum (Normale von top: perp((1,0)) = (0,1) → side 1 zeigt nach +y)
    l.openings.push({ id: 'door', type: 'door', wallId: 'top', offset: 1100, width: 900, height: 2010, sill: 0, hinge: 'a', swing: 1 });
    l.furniture.push(newFurniture('kommode', 1000, 500, { width: 600, depth: 400, height: 800, id: 'k' }));
    expect(msgs(l).some((m) => m.startsWith('tuer'))).toBe(true);
    l.furniture[0].x = 3000;
    expect(msgs(l).some((m) => m.startsWith('tuer'))).toBe(false);
  });

  it('hohes Möbel vor Fenster, niedriges darunter ok', () => {
    const l = boxLevel(4000, 4000);
    l.openings.push({ id: 'win', type: 'window', wallId: 'top', offset: 2000, width: 1000, height: 1200, sill: 900, swing: 1 });
    l.furniture.push(newFurniture('regal', 2000, 150, { width: 800, depth: 300, height: 2000, id: 'r' }));
    expect(msgs(l).some((m) => m.startsWith('fenster'))).toBe(true);
    l.furniture[0] = newFurniture('kommode', 2000, 200, { width: 800, depth: 400, height: 800, id: 'k' });
    expect(msgs(l).some((m) => m.startsWith('fenster'))).toBe(false);
  });

  it('Schranktüren schlagen gegen Bett, Bewegungsfläche vor Schrank zu klein', () => {
    const l = boxLevel(4000, 4000);
    l.furniture.push(newFurniture('schrank', 2000, 400, { width: 1000, depth: 600, height: 2000, id: 'sch', doors: 2, doorType: 'hinged' }));
    l.furniture.push(newFurniture('bett', 2000, 1900, { width: 1400, depth: 2000, height: 450, id: 'bett', rotation: 0 }));
    const m = msgs(l);
    expect(m.some((x) => x.includes('blockiert die Schranktüren'))).toBe(true);
    expect(m.some((x) => x.startsWith('bewegung') && x.includes('Schrank'))).toBe(true);
  });

  it('Bewegungsfläche: Zonen liegen vor der Front (lokal +y), auch gedreht', () => {
    const s = emptyProject().settings;
    const f = newFurniture('schrank', 0, 0, { width: 1000, depth: 600, rotation: 90 });
    const z = clearanceZones(f, s)[0].poly;
    // gedreht um 90°: Front zeigt nach -x
    expect(Math.max(...z.map((p) => p.x))).toBeCloseTo(-300, 0);
    expect(Math.min(...z.map((p) => p.x))).toBeCloseTo(-1000, 0);
  });

  it('Doppelbett braucht beide Seiten frei, Einzelbett eine', () => {
    const l = boxLevel(3000, 3000);
    // Doppelbett links an der Wand
    l.furniture.push(newFurniture('bett', 800 + 50, 1500, { width: 1600, depth: 2000, id: 'b' }));
    expect(msgs(l).some((m) => m.includes('Bett links'))).toBe(true);
    l.furniture[0] = newFurniture('bett', 450 + 50, 1500, { width: 900, depth: 2000, id: 'b' });
    expect(msgs(l).filter((m) => m.startsWith('bewegung'))).toEqual([]);
  });

  it('Wandfenster höher als der Kniestock wird gemeldet, passendes nicht', () => {
    const l = boxLevel(4000, 4000, 200, { ceilingHeight: 2500 });
    const left = l.walls.find((w) => w.id === 'left')!;
    left.slope = { side: 1, knee: 1050, mode: 'pitch', pitchDeg: 45 };
    l.openings.push({ id: 'win', type: 'window', wallId: 'left', offset: 2000, width: 1000, height: 1200, sill: 900, swing: 1 });
    expect(msgs(l).some((m) => m.startsWith('fenster') && m.includes('höher als die Wand'))).toBe(true);
    l.openings[0] = { ...l.openings[0], height: 600, sill: 400 };
    expect(msgs(l).some((m) => m.startsWith('fenster'))).toBe(false);
  });

  it('Dachfenster muss in die Schräge passen', () => {
    const l = boxLevel(4000, 4000, 200, { ceilingHeight: 2500 });
    const left = l.walls.find((w) => w.id === 'left')!;
    left.slope = { side: 1, knee: 1050, mode: 'pitch', pitchDeg: 45 };
    // Schräge von 1,05 m bis 2,50 m: entlang der Schräge 1,45 × √2 ≈ 2,05 m
    l.roofWindows.push({ id: 'rw', wallId: 'left', offset: 2000, width: 780, length: 1400, bottomHeight: 1150 });
    expect(msgs(l).some((m) => m.startsWith('fenster'))).toBe(false);
    l.roofWindows[0] = { ...l.roofWindows[0], length: 2000 };
    expect(msgs(l).some((m) => m.includes('ragt über die Schräge'))).toBe(true);
    l.roofWindows[0] = { ...l.roofWindows[0], wallId: 'top', length: 1180 };
    expect(msgs(l).some((m) => m.includes('ohne Dachschräge'))).toBe(true);
  });
});
