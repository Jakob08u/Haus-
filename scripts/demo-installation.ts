import type { ElecKind, Level, LineKind, LineSurface, LinePoint, Vec2 } from '../src/model/types';
import { newFurniture } from '../src/model/defaults';

let n = 0;
const id = (p: string) => `${p}${++n}`;

/** Beispiel-Elektroinstallation und Leitungen im DG (alle Positionen im gedrehten Planungssystem, mm) */
export function seedDemoElectrical(dg: Level, _toUser: (p: Vec2) => Vec2) {
  const wall = (wid: string) => dg.walls.find((w) => w.id === wid)!;

  /** Symbol an Wand: s = Abstand vom Wandanfang, towards = Punkt im Raum */
  const onWall = (wid: string, s: number, towards: Vec2, kind: ElecKind, height: number, extra: { label?: string; aboveWorktop?: boolean } = {}) => {
    const w = wall(wid);
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    const d = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const nrm = { x: -d.y, y: d.x };
    const side: 1 | -1 = (towards.x - w.a.x) * nrm.x + (towards.y - w.a.y) * nrm.y >= 0 ? 1 : -1;
    const n2 = { x: nrm.x * side, y: nrm.y * side };
    const p = { x: w.a.x + d.x * s + n2.x * (w.thickness / 2), y: w.a.y + d.y * s + n2.y * (w.thickness / 2) };
    dg.electrical.push({
      id: id('e'),
      kind,
      x: Math.round(p.x),
      y: Math.round(p.y),
      height,
      wallId: wid,
      side,
      rotation: Math.round((Math.atan2(n2.y, n2.x) * 180) / Math.PI - 90),
      ...extra,
    });
    return p;
  };
  const ceiling = (x: number, y: number, kind: ElecKind, label?: string) => dg.electrical.push({ id: id('e'), kind, x, y, height: 2400, label });
  const line = (kind: LineKind, surface: LineSurface, pts: [number, number, number][], label?: string) =>
    dg.lines.push({ id: id('l'), kind, surface, label, points: pts.map(([x, y, z]): LinePoint => ({ x, y, z })) });

  // Büro (Türwand Y = 3690, Kniestockwand Y = 300)
  const buero = { x: 5760, y: 2000 };
  onWall('dg_w_flur_buero', 4907 - 3700, buero, 'schalter', 1050, { label: 'Licht Büro' });
  onWall('dg_w_buero_oben', 4400 - 2420, buero, 'steckdose3', 300, { label: 'Schreibtisch links' });
  onWall('dg_w_buero_oben', 5600 - 2420, buero, 'steckdose2', 300, { label: 'Schreibtisch rechts' });
  onWall('dg_w_buero_oben', 5000 - 2420, buero, 'lan', 300, { label: 'Netzwerk' });
  ceiling(5760, 2000, 'lampe', 'Büro');
  line('strom', 'wand', [[4907, 3675, 1050], [4907, 3675, 2100]], 'Schalterleitung Büro');
  line('strom', 'decke', [[4907, 3675, 2400], [4907, 2000, 2400], [5760, 2000, 2400]], 'Deckenauslass Büro');
  line('strom', 'wand', [[4400, 315, 300], [5600, 315, 300]], 'Steckdosen Schreibtisch');
  line('lan', 'wand', [[5000, 315, 300], [2720, 315, 300]], 'LAN zur Ecke');

  // Schlafzimmer (Türwand Y = 8290)
  const schlaf = { x: 5900, y: 9800 };
  onWall('dg_w_schlaf_flur', 5167 - 3700, schlaf, 'schalter', 1050, { label: 'Licht Schlafen' });
  onWall('dg_w_schlaf_flur', 5400 - 3700, schlaf, 'steckdose2', 300, { label: 'Bett links' });
  onWall('dg_w_schlaf_flur', 6400 - 3700, schlaf, 'steckdose2', 300, { label: 'Bett rechts' });
  ceiling(5600, 9800, 'lampe', 'Schlafen');
  ceiling(4600, 10300, 'rauchmelder');
  line('strom', 'wand', [[5400, 8305, 300], [6400, 8305, 300]], 'Steckdosen Bett');

  // Bad (Türwand X = 6660, Wand zum Büro Y = 3990)
  const bad = { x: 7800, y: 5300 };
  onWall('dg_w_treppe_bad', 8190 - 5130, bad, 'schalter', 1050, { label: 'Licht Bad' });
  onWall('dg_w_flur_buero', 8450 - 3700, bad, 'steckdose1', 1150, { label: 'Spiegel', aboveWorktop: true });
  ceiling(7500, 5300, 'lampe', 'Bad');
  line('wasser_kalt', 'wand', [[7920, 4005, 550], [7920, 4005, 200], [6700, 4005, 200]], 'Kaltwasser Waschbecken');
  line('wasser_warm', 'wand', [[8080, 4005, 550], [8080, 4005, 260], [6700, 4005, 260]], 'Warmwasser Waschbecken');
  line('abwasser', 'wand', [[8000, 4005, 550], [8000, 4005, 120], [8935, 4005, 120], [8935, 4700, 120], [8935, 4700, 230]], 'Abwasser WB → WC-Strang');

  // Flur
  ceiling(4500, 5600, 'lampe', 'Flur');
  ceiling(4500, 7200, 'rauchmelder');

  // Heizkörper unter dem Giebelfenster im Schlafzimmer
  dg.furniture.push(newFurniture('heizkoerper', 6400, 11185, { name: 'Heizkörper (Beispiel)', width: 800, depth: 100, height: 600, elevation: 150, rotation: 180 }));
}
