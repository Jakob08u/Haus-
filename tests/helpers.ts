import type { Level, Wall } from '../src/model/types';
import { emptyLevel } from '../src/model/defaults';

/** Rechteckiger Raum mit lichten Maßen w × h (mm), Wandstärke t, Innenecke bei (0,0) */
export function boxLevel(w: number, h: number, t = 200, extra: Partial<Level> = {}): Level {
  const o = t / 2;
  const P = (x: number, y: number) => ({ x, y });
  const walls: Wall[] = [
    { id: 'top', a: P(-o, -o), b: P(w + o, -o), thickness: t, type: 'bestand' },
    { id: 'right', a: P(w + o, -o), b: P(w + o, h + o), thickness: t, type: 'bestand' },
    { id: 'bottom', a: P(w + o, h + o), b: P(-o, h + o), thickness: t, type: 'bestand' },
    { id: 'left', a: P(-o, h + o), b: P(-o, -o), thickness: t, type: 'bestand' },
  ];
  return { ...emptyLevel('Test'), walls, rooms: [{ id: 'r1', name: 'Raum', seed: P(w / 2, h / 2) }], ...extra };
}
