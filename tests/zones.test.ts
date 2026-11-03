import { describe, expect, it } from 'vitest';
import { checkLevel } from '../src/checks/checks';
import { emptyProject } from '../src/model/defaults';
import type { Level, LinePoint } from '../src/model/types';
import { boxLevel } from './helpers';

function warnings(l: Level) {
  const p = emptyProject();
  p.levels = [l];
  p.assumptions = [];
  return checkLevel(l, p).filter((w) => w.category === 'elektro' || w.category === 'leitung').map((w) => w.message);
}
// Raum 4 × 4 m, Wandstärke 200; obere Wand: Innenfläche bei y = 0, Normale +y zeigt in den Raum
const level = () => {
  const l = boxLevel(4000, 4000, 200, { ceilingHeight: 2500 });
  l.openings.push({ id: 'door', type: 'door', wallId: 'top', offset: 1100, width: 900, height: 2010, sill: 0, hinge: 'a', swing: 1 });
  return l;
};
const wallLine = (pts: [number, number, number][]): LinePoint[] => pts.map(([x, y, z]) => ({ x, y, z }));

describe('Installationszonen DIN 18015-3', () => {
  it('waagrecht in ZW-u (30 cm) ist ok, auf 70 cm nicht', () => {
    const l = level();
    l.lines.push({ id: 'a', kind: 'strom', surface: 'wand', points: wallLine([[2000, 15, 300], [3500, 15, 300]]) });
    expect(warnings(l)).toEqual([]);
    l.lines[0].points.forEach((p) => (p.z = 700));
    expect(warnings(l)[0]).toMatch(/außerhalb ZW-u\/ZW-o/);
  });

  it('waagrecht in ZW-o (15–45 cm unter Decke) ist ok', () => {
    const l = level();
    l.lines.push({ id: 'a', kind: 'strom', surface: 'wand', points: wallLine([[2000, 15, 2200], [3500, 15, 2200]]) });
    expect(warnings(l)).toEqual([]);
  });

  it('senkrecht neben der Tür (10–30 cm) ist ok, mitten auf der Wand nicht', () => {
    const l = level();
    // Türkante rechts bei x = 1100 + 450 - 100 (Wandanfang a liegt bei x = -100) = 1450 → Zone 1550–1750
    l.lines.push({ id: 'a', kind: 'strom', surface: 'wand', points: wallLine([[1650, 15, 1050], [1650, 15, 2200]]) });
    expect(warnings(l)).toEqual([]);
    l.lines[0].points.forEach((p) => (p.x = 2500));
    expect(warnings(l)[0]).toMatch(/senkrecht außerhalb/);
  });

  it('senkrecht an der Raumecke (10–30 cm) ist ok', () => {
    const l = level();
    l.lines.push({ id: 'a', kind: 'strom', surface: 'wand', points: wallLine([[3800, 15, 300], [3800, 15, 2200]]) });
    expect(warnings(l)).toEqual([]);
  });

  it('schräge Leitung wird gemeldet', () => {
    const l = level();
    l.lines.push({ id: 'a', kind: 'strom', surface: 'wand', points: wallLine([[2000, 15, 300], [3000, 15, 1200]]) });
    expect(warnings(l)[0]).toMatch(/schräg/);
  });

  it('Leitung über Türöffnung wird gemeldet', () => {
    const l = level();
    l.lines.push({ id: 'a', kind: 'strom', surface: 'wand', points: wallLine([[300, 15, 300], [2000, 15, 300]]) });
    expect(warnings(l).some((m) => m.includes('kreuzt eine Tür'))).toBe(true);
  });

  it('Wasserleitungen sind nicht an die Elektro-Zonen gebunden', () => {
    const l = level();
    l.lines.push({ id: 'w', kind: 'wasser_kalt', surface: 'wand', points: wallLine([[2500, 15, 700], [2500, 15, 200], [3500, 15, 200]]) });
    expect(warnings(l)).toEqual([]);
  });

  it('Schalter neben Tür und Steckdose auf 30 cm sind ok, Steckdose mitten auf 70 cm nicht', () => {
    const l = level();
    l.electrical.push({ id: 's', kind: 'schalter', x: 1650, y: 0, height: 1050, wallId: 'top', side: 1 });
    l.electrical.push({ id: 'd', kind: 'steckdose2', x: 2500, y: 0, height: 300, wallId: 'top', side: 1 });
    expect(warnings(l)).toEqual([]);
    l.electrical[1].height = 700;
    expect(warnings(l)[0]).toMatch(/Steckdose 2-fach: außerhalb der Installationszonen/);
  });

  it('Steckdose über der Arbeitsfläche (ZW-m) im Bad ok', () => {
    const l = level();
    l.rooms[0].name = 'Bad';
    l.electrical.push({ id: 'd', kind: 'steckdose1', x: 2500, y: 0, height: 1150, wallId: 'top', side: 1 });
    expect(warnings(l)).toEqual([]);
    // neuer Level (die App arbeitet unveränderlich; Caches hängen am Objekt)
    const l2 = level();
    l2.rooms = [{ ...l2.rooms[0], name: 'Schlafzimmer' }];
    l2.electrical.push({ id: 'd', kind: 'steckdose1', x: 2500, y: 0, height: 1150, wallId: 'top', side: 1 });
    expect(warnings(l2).length).toBe(1);
  });

  it('Decke unter Schräge: ZW-o folgt der Kniestockhöhe', () => {
    const l = level();
    const left = l.walls.find((w) => w.id === 'left')!;
    left.slope = { side: 1, knee: 1000, mode: 'pitch', pitchDeg: 45 };
    // waagrecht an der Kniestockwand auf 80 cm = 20 cm unter Kniestock → ZW-o
    l.lines.push({ id: 'a', kind: 'strom', surface: 'wand', points: wallLine([[15, 1000, 800], [15, 3000, 800]]) });
    expect(warnings(l)).toEqual([]);
  });
});
