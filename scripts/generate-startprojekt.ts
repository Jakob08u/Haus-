/**
 * Erzeugt projekt.json aus den Skizzen in grundriss/.
 * Maße wurden von Hand aus den Fotos gelesen (siehe README „Startprojekt & Annahmen“).
 * Aufruf: npm run startprojekt
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Assumption, Level, Project, Vec2, Wall, WallType, Opening, RoomMeta } from '../src/model/types';
import { defaultMaterials, defaultSettings, newFurniture } from '../src/model/defaults';
import { detectRooms } from '../src/geometry/rooms';
import { CeilingModel } from '../src/geometry/ceiling';
import { dot, perp, norm, sub } from '../src/geometry/vec';
import { seedDemoElectrical } from './demo-installation';
import { wallFaces } from '../src/calc/materials';
import { splitWallAtJunctions, transformLevel } from '../src/model/ops';

const root = resolve(import.meta.dirname, '..');
const dataUrl = (file: string) => 'data:image/jpeg;base64,' + readFileSync(resolve(root, file)).toString('base64');

let n = 0;
const id = (p: string) => `${p}${++n}`;
const assumptions: Assumption[] = [];
const assume = (text: string, levelId: string, ref?: string) =>
  assumptions.push({ id: id('a'), text, levelId, ref, status: 'offen' });
/** von Jakob angegebene Werte (keine Annahme, zur Nachvollziehbarkeit als bestätigt geführt) */
const given = (text: string, levelId: string, ref?: string) =>
  assumptions.push({ id: id('a'), text, levelId, ref, status: 'bestaetigt' });

// ---------------------------------------------------------------------------
// Obergeschoss: Skizze „oben“. Koordinaten zuerst im Skizzensystem (mm, y nach unten),
// dann um 90° gegen den Uhrzeigersinn gedreht (Büro oben, Bad rechts, Schlaf unten).
// Am Ende werden OG und EG gemeinsam ausgerichtet (siehe „Geschosse übereinander“).
// ---------------------------------------------------------------------------
const OG = 'og';
const toUser = (p: Vec2): Vec2 => ({ x: p.y + 3850, y: -p.x + 11250 });

function mkWalls(defs: [string, number, number, number, number, number, WallType, string?][], tf: (p: Vec2) => Vec2): Wall[] {
  return defs.map(([key, ax, ay, bx, by, t, type, label]) => ({
    id: key,
    a: tf({ x: ax, y: ay }),
    b: tf({ x: bx, y: by }),
    thickness: t,
    type,
    label,
  }));
}

const ogWalls = mkWalls(
  [
    ['og_w_nische_aussen', -150, -3700, 2360, -3700, 300, 'bestand', 'Außenwand Schlaf links (Nische)'],
    ['og_w_nische_seite', 2360, -3700, 2360, -150, 300, 'bestand', 'Außenwand Nische'],
    ['og_w_schlaf_stufe', 2360, -150, 3060, -150, 300, 'bestand', 'Außenwand Schlaf'],
    ['og_w_flur_aussen', 3060, -150, 7410, -150, 300, 'bestand', 'Außenwand Flur'],
    ['og_w_buero_vorsprung', 7410, -150, 7410, -1430, 300, 'bestand', 'Außenwand Büro-Vorsprung'],
    ['og_w_buero_links', 7410, -1430, 11100, -1430, 300, 'bestand', 'Außenwand Büro links'],
    ['og_w_buero_oben', 11100, -1430, 11100, 5250, 300, 'bestand', 'Außenwand Büro oben'],
    ['og_w_buero_rechts', 11100, 5250, 7410, 5250, 300, 'bestand', 'Außenwand Büro rechts'],
    ['og_w_bad_rechts', 7410, 5250, 4495, 5250, 300, 'bestand', 'Außenwand Bad'],
    ['og_w_schlaf_rechts', 4495, 5250, -150, 5250, 300, 'bestand', 'Außenwand Schlaf rechts'],
    ['og_w_schlaf_unten', -150, 5250, -150, -3700, 300, 'bestand', 'Außenwand Schlaf unten'],
    ['og_w_schlaf_flur', 3060, -150, 3060, 2690, 200, 'bestand', 'Wand Schlaf/Flur'],
    ['og_w_treppe_bad', 3060, 2690, 7410, 2690, 240, 'bestand', 'Wand Treppe/Bad'],
    ['og_w_flur_buero', 7410, -150, 7410, 5250, 300, 'bestand', 'Wand Flur/Büro'],
    ['og_w_schlaf_bad', 4495, 2690, 4495, 5250, 150, 'bestand', 'Wand Schlaf/Bad'],
  ],
  toUser,
);

const wallById = (walls: Wall[], key: string) => walls.find((w) => w.id === key)!;
/** Seite der Wand (1/-1), auf der der Punkt liegt */
const sideOf = (w: Wall, p: Vec2): 1 | -1 => (dot(sub(p, w.a), perp(norm(sub(w.b, w.a)))) >= 0 ? 1 : -1);

const ogC = {
  buero: toUser({ x: 9255, y: 1910 }),
  flur: toUser({ x: 6700, y: 600 }),
  bad: toUser({ x: 5915, y: 3955 }),
  schlaf: toUser({ x: 1480, y: 2550 }),
  nische: toUser({ x: 1100, y: -1800 }),
};

// Dachschrägen laut Angabe (Kniestockhöhe = Wandhöhe bis zur Schräge); Neigung 45° angenommen
function slope(key: string, knee: number, towards: Vec2) {
  const w = wallById(ogWalls, key);
  w.slope = { side: sideOf(w, towards), knee, mode: 'pitch', pitchDeg: 45 };
}
slope('og_w_schlaf_rechts', 1870, ogC.schlaf);
slope('og_w_nische_aussen', 1970, ogC.nische);
slope('og_w_buero_oben', 1670, ogC.buero);

function door(walls: Wall[], key: string, offset: number, into: Vec2, hinge: 'a' | 'b' = 'a', width = 885, type: Opening['type'] = 'door'): Opening {
  const w = wallById(walls, key);
  return { id: id('o'), type, wallId: key, offset, width, height: 2010, sill: 0, hinge, swing: sideOf(w, into) };
}
function windowO(walls: Wall[], key: string, offset: number, into: Vec2, width = 1010, height = 1260, sill = 900): Opening {
  const w = wallById(walls, key);
  return { id: id('o'), type: 'window', wallId: key, offset, width, height, sill, hinge: 'a', swing: sideOf(w, into) };
}

const ogOpenings: Opening[] = [
  door(ogWalls, 'og_w_schlaf_flur', 825, ogC.schlaf, 'a'),
  door(ogWalls, 'og_w_flur_buero', 1850, ogC.buero, 'b'),
  door(ogWalls, 'og_w_treppe_bad', 3640, ogC.bad, 'b', 760),
  windowO(ogWalls, 'og_w_schlaf_unten', 2700, ogC.schlaf),
  // Fenster in Kniestockwänden: Oberkante unter dem Schrägenansatz
  windowO(ogWalls, 'og_w_schlaf_rechts', 2300, ogC.schlaf, 1260, 1100, 700),
  windowO(ogWalls, 'og_w_nische_aussen', 1255, ogC.nische, 1010, 1100, 800),
  windowO(ogWalls, 'og_w_buero_oben', 1100, ogC.buero, 1260, 1050, 500),
  windowO(ogWalls, 'og_w_buero_oben', 5800, ogC.buero, 1260, 1050, 500),
  windowO(ogWalls, 'og_w_buero_links', 2900, ogC.buero),
  windowO(ogWalls, 'og_w_bad_rechts', 1460, ogC.bad, 760, 1010, 1300),
  windowO(ogWalls, 'og_w_flur_aussen', 1800, ogC.flur),
];

const ogRooms: RoomMeta[] = [
  { id: 'r_buero', name: 'Büro', seed: ogC.buero, usage: 'Büro', floor: { materialId: 'mat_vinyl_eiche', pattern: 'third', rotation: 0 } },
  { id: 'r_flur_og', name: 'Flur OG', seed: ogC.flur, usage: 'Flur', floor: { materialId: 'mat_vinyl_eiche', pattern: 'third', rotation: 0 } },
  { id: 'r_bad_og', name: 'Bad', seed: ogC.bad, usage: 'Bad', floor: { materialId: 'mat_fliese_grau', pattern: 'half', rotation: 0 } },
  { id: 'r_schlaf', name: 'Schlafzimmer', seed: ogC.schlaf, usage: 'Schlafen', floor: { materialId: 'mat_vinyl_eiche', pattern: 'third', rotation: 90 } },
];

const stairCenter = toUser({ x: 4650, y: 1960 });
const og: Level = {
  id: OG,
  name: 'Obergeschoss',
  elevation: 2750,
  ceilingHeight: 2500,
  slabThickness: 250,
  background: {
    // markierte Skizze (Schrägen blau, Treppe gelb), 3-fach vergrößert
    src: dataUrl('grundriss/og-markiert.jpg'),
    x: -4677,
    y: -1075,
    scale: 40.53 / 3,
    aspect: 0.724,
    rotation: 0,
    opacity: 0.3,
    visible: true,
    naturalWidth: 1110,
    naturalHeight: 1500,
  },
  walls: ogWalls,
  openings: ogOpenings,
  roofWindows: [],
  stairs: [
    {
      id: 'og_treppe',
      x: stairCenter.x,
      y: stairCenter.y,
      length: 2980,
      width: 1220,
      rotation: -90,
      steps: 15,
      isOpening: true,
      railing: { left: true, right: false, end: false },
      direction: 'up',
    },
  ],
  rooms: ogRooms,
  furniture: [],
  electrical: [],
  lines: [],
  dimensions: [],
};

// Beispielmöbel (frei löschbar) – Koordinaten im gedrehten System vor der Geschoss-Ausrichtung:
// Büro X 2570–8950 / Y 300–3690 · Flur X 3850–6420 / Y 3990–8090 · Bad X 6660–8950 / Y 3990–6680
// Schlaf X 3850–8950 / Y 8290–11250, Nische X 300–3850 / Y 9040–11250, Ausbuchtung X 6660–8950 / Y 6830–8290
{
  const F = og.furniture;
  F.push(newFurniture('bett', 5900, 9290, { name: 'Bett 160×200 (Beispiel)', rotation: 0 }));
  F.push(newFurniture('kommode', 7400, 8590, { name: 'Nachttisch (Beispiel)', width: 450, depth: 400, height: 500, rotation: 0 }));
  F.push(newFurniture('schrank', 2550, 9340, { name: 'Kleiderschrank (Beispiel)', width: 1500, depth: 600, height: 2000, rotation: 0 }));
  F.push(newFurniture('kommode', 800, 10200, { name: 'Kommode (Beispiel)', width: 1000, depth: 450, height: 800, rotation: 270 }));
  F.push(newFurniture('schreibtisch', 5000, 700, { name: 'Schreibtisch (Beispiel)', width: 1600, depth: 800, height: 740, rotation: 0 }));
  F.push(newFurniture('stuhl', 5000, 1350, { name: 'Bürostuhl (Beispiel)', width: 650, depth: 650, height: 1100, rotation: 180 }));
  F.push(newFurniture('regal', 2720, 2400, { name: 'Regal (Beispiel)', width: 800, depth: 300, height: 2000, rotation: 270 }));
  F.push(newFurniture('dusche', 7110, 6230, { name: 'Dusche 90×90 (Beispiel)', rotation: 180 }));
  F.push(newFurniture('wc', 8670, 4700, { name: 'WC (Beispiel)', rotation: 90 }));
  F.push(newFurniture('waschbecken', 8000, 4225, { name: 'Waschbecken (Beispiel)', width: 600, depth: 470, rotation: 0 }));
}

given('Dachschrägen laut Angabe: Schlafzimmer rechts Kniestock 1,87 m, links (Nische) 1,97 m, Büro an der oberen Wand 1,67 m; Bad und Flur ohne Schräge.', OG);
assume('Dachneigung 45° für alle Schrägen.', OG);
assume('Flache Decke im OG bei 2,50 m (die Schrägen laufen bis zu dieser Höhe).', OG, 'level:og.ceilingHeight');
assume('Beide Skizzen gleich ausgerichtet angenommen und für die Darstellung um 90° gedreht (Büro oben, Bad rechts, Schlafzimmer unten).', OG);
assume('Lage OG über EG: linke Außenwand bündig, Treppenloch über dem Flur EG (OG dafür um 43 cm versetzt) – bitte prüfen; korrigierbar unter Eigenschaften → „Ebene verschieben/drehen“.', OG);
assume('Außenwände 30 cm stark.', OG);
assume('Wandstärken innen aus Laibungsmaßen der Vinyl-Rechnung abgeleitet: Schlaf/Flur 20 cm, Flur/Büro 30 cm; Treppe/Bad 24 cm (aus 2,57 m und 2,29 m); Schlaf/Bad 15 cm.', OG);
assume('Bad-Maße 2,69 × 2,29 m abgeleitet (nicht in der Skizze bemaßt).', OG, 'room:r_bad_og');
assume('Büro ragt 1,28 m über die Flurwand hinaus (6,38 m statt 5,10 m), Unterkante bündig mit Bad.', OG, 'room:r_buero');
given('Alle Wände bleiben (Bestand). Neue Trockenbauwände werden selbst eingezeichnet (Werkzeug „Wand“, Typ „Neu (Trockenbau)“).', OG);
assume('Türbreiten 88,5 cm (Bad 76 cm), Höhe 2,01 m, Aufschlag in den Raum.', OG);
assume('Fenster: nicht in der Skizze – Positionen und Größen geschätzt (in den Kniestockwänden unterhalb des Schrägenansatzes).', OG);
assume('Treppe: 15 Steigungen, Treppenloch 2,98 × 1,22 m, Austritt am Podest vor dem Büro.', OG, 'stair:og_treppe');
assume('Geschosshöhe EG→OG 2,75 m (2,50 m Raumhöhe + 25 cm Decke).', OG, 'level:og.elevation');
assume('Möbel im Startprojekt sind Beispiele.', OG);

// ---------------------------------------------------------------------------
// Erdgeschoss: Skizze „unten“ (im Skizzensystem; wird unten gedreht und unter das OG gelegt)
// ---------------------------------------------------------------------------
const EG = 'eg';
const id0 = (p: Vec2) => p;
const egWalls = mkWalls(
  [
    ['eg_w_links', -150, 6110, -150, -860, 300, 'bestand', 'Außenwand links'],
    ['eg_w_nische_oben', -150, -860, 2070, -860, 300, 'bestand', 'Außenwand Flurnische'],
    ['eg_w_kueche_links', 2070, -325, 2070, -5420, 300, 'bestand', 'Außenwand Küche links'],
    ['eg_w_kueche_oben', 2070, -5420, 4820, -5420, 300, 'bestand', 'Außenwand Küche oben'],
    ['eg_w_kueche_vorraum', 4820, -5420, 6920, -5420, 300, 'bestand', 'Wand Küche/Vorraum'],
    ['eg_w_vorraum_links', 4820, -5420, 4820, -7220, 300, 'bestand', 'Außenwand Vorraum'],
    ['eg_w_vorraum_oben', 4820, -7220, 6920, -7220, 300, 'bestand', 'Außenwand Vorraum oben'],
    ['eg_w_vorraum_rechts', 6920, -7220, 6920, -5420, 300, 'bestand', 'Außenwand Vorraum rechts'],
    ['eg_w_ess_oben', 6920, -5420, 11210, -5420, 300, 'bestand', 'Außenwand Essen oben'],
    ['eg_w_ess_rechts', 11210, -5420, 11210, -325, 300, 'bestand', 'Außenwand Essen rechts'],
    ['eg_w_mittelwand', 2070, -325, 11550, -325, 650, 'bestand', 'Mittelwand (schraffiert)'],
    ['eg_w_kueche_ess', 6920, -5420, 6920, -325, 240, 'bestand', 'Wand Küche/Essen'],
    ['eg_w_wohn_rechts', 11550, -325, 11550, 6110, 300, 'bestand', 'Außenwand Wohnen'],
    ['eg_w_unten', 11550, 6110, -150, 6110, 300, 'bestand', 'Außenwand unten'],
    ['eg_w_flur_wohn', 7160, -325, 7160, 6110, 260, 'bestand', 'Wand Flur/Wohnen'],
    ['eg_w_flur_gaeste', -150, 2300, 7160, 2300, 320, 'bestand', 'Wand Flur/Gäste/Bad'],
    ['eg_w_gaeste_bad', 5157.5, 2300, 5157.5, 6110, 115, 'bestand', 'Wand Gäste/Bad'],
  ],
  id0,
);
const egC = {
  flur: { x: 3500, y: 1070 },
  kueche: { x: 4510, y: -2960 },
  ess: { x: 9050, y: -2960 },
  wohn: { x: 9345, y: 2980 },
  gaeste: { x: 2550, y: 4210 },
  bad: { x: 6120, y: 4210 },
  vorraum: { x: 5870, y: -6320 },
};
const egOpenings: Opening[] = [
  door(egWalls, 'eg_w_mittelwand', 4060 - 2070, egC.kueche, 'a', 900),
  door(egWalls, 'eg_w_mittelwand', 5955 - 2070, egC.kueche, 'a', 1250, 'passage'),
  door(egWalls, 'eg_w_mittelwand', 8800 - 2070, egC.ess, 'a', 2700, 'passage'),
  door(egWalls, 'eg_w_flur_wohn', 1375, egC.wohn, 'a', 900),
  door(egWalls, 'eg_w_flur_gaeste', 900, egC.gaeste, 'a', 900),
  door(egWalls, 'eg_w_flur_gaeste', 6350, egC.bad, 'b', 900),
  door(egWalls, 'eg_w_kueche_vorraum', 1050, egC.kueche, 'a', 885, 'passage'),
  door(egWalls, 'eg_w_vorraum_oben', 1050, egC.vorraum, 'a', 1010),
  windowO(egWalls, 'eg_w_kueche_oben', 1400, egC.kueche, 1260, 1260, 900),
  windowO(egWalls, 'eg_w_ess_oben', 2150, egC.ess, 1760, 1260, 900),
  windowO(egWalls, 'eg_w_wohn_rechts', 2500, egC.wohn, 1760, 1260, 600),
  windowO(egWalls, 'eg_w_wohn_rechts', 5100, egC.wohn, 1760, 1260, 600),
  windowO(egWalls, 'eg_w_unten', 11550 - 2550, egC.gaeste, 1260, 1260, 900),
  windowO(egWalls, 'eg_w_unten', 11550 - 6120, egC.bad, 760, 760, 1400),
];
const eg: Level = {
  id: EG,
  name: 'Erdgeschoss',
  elevation: 0,
  ceilingHeight: 2500,
  slabThickness: 250,
  background: {
    src: dataUrl('grundriss/eg-unten-skizze.jpg'),
    x: -1228,
    y: -6912,
    scale: 23.13,
    aspect: 1.106,
    rotation: 0,
    opacity: 0.25,
    visible: true,
    naturalWidth: 570,
    naturalHeight: 540,
  },
  walls: egWalls,
  openings: egOpenings,
  roofWindows: [],
  stairs: [
    {
      // unter dem Treppenloch des OG (OG-Skizze x 3160–6140, y 1350–2570, um 43 cm versetzt)
      id: 'eg_treppe',
      x: 4650,
      y: 1530,
      length: 2980,
      width: 1220,
      rotation: 0,
      steps: 15,
      isOpening: false,
      railing: { left: true, right: false, end: false },
      direction: 'up',
    },
  ],
  rooms: [
    { id: 'r_flur_eg', name: 'Flur EG', seed: egC.flur, floor: { materialId: 'mat_fliese_grau', pattern: 'half', rotation: 0 } },
    { id: 'r_kueche', name: 'Küche', seed: egC.kueche, floor: { materialId: 'mat_fliese_grau', pattern: 'half', rotation: 0 } },
    { id: 'r_ess', name: 'Essen', seed: egC.ess, floor: { materialId: 'mat_fliese_grau', pattern: 'half', rotation: 0 } },
    { id: 'r_wohn', name: 'Wohnen', seed: egC.wohn, floor: { materialId: 'mat_fliese_grau', pattern: 'half', rotation: 0 } },
    { id: 'r_gaeste', name: 'Gäste', seed: egC.gaeste, floor: { materialId: 'mat_vinyl_eiche', pattern: 'third', rotation: 0 } },
    { id: 'r_bad_eg', name: 'Bad EG', seed: egC.bad },
    { id: 'r_vorraum', name: 'Vorraum', seed: egC.vorraum, floor: { materialId: 'mat_fliese_grau', pattern: 'half', rotation: 0 } },
  ],
  furniture: [],
  electrical: [],
  lines: [],
  dimensions: [],
};
assume('Treppe im EG ist in der Skizze nicht eingezeichnet – angenommen im Flur EG unter dem Treppenloch des OG, Antritt Richtung Gäste-WC/Wohnen.', EG, 'stair:eg_treppe');
assume('Raumhöhe EG 2,50 m, Außenwände 30 cm.', EG);
assume('Schraffierte Mittelwand als 65 cm starke Bestandswand mit Öffnungen 90 cm (Laibung 60 cm), 1,25 m und 2,70 m.', EG, 'wall:eg_w_mittelwand');
assume('Essen 4,02 × 4,62 m (Skizze 4,63 m; 1 cm angeglichen); Nische 1,00 × 0,30 m nicht modelliert.', EG, 'room:r_ess');
assume('Bad EG 1,82 × 3,50 m abgeleitet; Wand Gäste/Bad 11,5 cm.', EG, 'room:r_bad_eg');
assume('Fensterpositionen EG geschätzt.', EG);

seedDemoElectrical(og, toUser);

// Wände, die an mehrere Räume grenzen, an den Anschlüssen teilen (je Raum eigene Oberfläche)
for (const id of ['og_w_flur_buero', 'og_w_treppe_bad']) splitWallAtJunctions(og, id);
for (const w of og.walls) {
  if (w.label === 'Wand Flur/Büro' && w.id !== 'og_w_flur_buero') w.label = 'Wand Bad/Büro';
  if (w.label === 'Wand Treppe/Bad' && w.id === 'og_w_treppe_bad') w.label = 'Wand Treppe/Schlaf';
}

// Beispiel-Oberflächen
for (const f of wallFaces(og)) {
  const key = f.side === 1 ? 'left' : 'right';
  f.wall.finishes = f.wall.finishes ?? {};
  if (f.roomName === 'Bad') f.wall.finishes[key] = { kind: 'tile', materialId: 'mat_fliese_weiss', maxHeight: 1200 };
  if (f.roomName === 'Büro') f.wall.finishes[key] = { kind: 'paint', color: '#dfe7ec' };
  if (f.roomName === 'Schlafzimmer' && f.wall.id === 'og_w_schlaf_flur') f.wall.finishes[key] = { kind: 'wallpaper', materialId: 'mat_tapete_vlies' };
}
assume('Oberflächen (Fliesenspiegel Bad 1,20 m, Tapete hinter dem Bett, Farbe Büro) sind Beispiele.', OG);

// ---------------------------------------------------------------------------
// Geschosse übereinander: EG wie das OG um 90° gegen den Uhrzeigersinn drehen und beide in ein
// gemeinsames Koordinatensystem schieben. OG-Punkt (x, y) der Skizze liegt über EG-Punkt (x, y − 430).
// ---------------------------------------------------------------------------
transformLevel(eg, { rotate: -90, dx: 7500, dy: 11800 });
transformLevel(og, { dx: 3220, dy: 550 });

const now = new Date().toISOString();
const project: Project = {
  version: 1,
  name: 'Haus Umbau',
  createdAt: now,
  updatedAt: now,
  levels: [eg, og],
  materials: defaultMaterials(),
  cameras: [],
  assumptions,
  settings: defaultSettings(),
};

writeFileSync(resolve(root, 'projekt.json'), JSON.stringify(project, null, 1));

// Kontrolle: Flächen ausgeben
for (const lvl of project.levels) {
  const cm = new CeilingModel(lvl);
  console.log(`\n${lvl.name}`);
  let sum = 0, sumLiving = 0;
  for (const r of detectRooms(lvl)) {
    const la = cm.livingArea(r.net);
    sum += r.netArea;
    sumLiving += la.living;
    console.log(
      `  ${r.name.padEnd(18)} Grundfläche ${(r.netArea / 1e6).toFixed(2).padStart(6)} m²   Wohnfläche ${(la.living / 1e6).toFixed(2).padStart(6)} m²   (h ${(la.minHeight / 1000).toFixed(2)}–${(la.maxHeight / 1000).toFixed(2)} m)`,
    );
  }
  console.log(`  Summe Grundfläche ${(sum / 1e6).toFixed(2)} m², Wohnfläche ${(sumLiving / 1e6).toFixed(2)} m²`);
}
console.log('\nprojekt.json geschrieben.');
